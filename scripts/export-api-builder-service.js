#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const TEMPLATE_ROOT = path.resolve(__dirname, '..', 'templates', 'service-repo');
const DEFAULT_POSTMAN_API_BASE = 'https://api.getpostman.com';
const DEFAULT_POSTMAN_GATEWAY_BASE = 'https://gateway.postman.com';
const POSTMAN_USER_AGENT = 'Postman CLI/1.33.1';

function fail(message) {
  throw new Error(message);
}

function resolvePostmanAuth() {
  const apiKey = String(process.env.POSTMAN_API_KEY || '').trim();
  if (apiKey) {
    return {
      kind: 'apiKey',
      headerName: 'X-Api-Key',
      value: apiKey
    };
  }

  const accessToken = String(process.env.POSTMAN_ACCESS_TOKEN || '').trim();
  if (accessToken) {
    return {
      kind: 'accessToken',
      headerName: 'x-access-token',
      value: accessToken
    };
  }

  fail('POSTMAN_API_KEY or POSTMAN_ACCESS_TOKEN is required when exporting from Postman');
}

function getPostmanBaseUrl(base) {
  if (base === 'gateway') {
    return process.env.POSTMAN_GATEWAY_BASE || DEFAULT_POSTMAN_GATEWAY_BASE;
  }

  return process.env.POSTMAN_API_BASE || DEFAULT_POSTMAN_API_BASE;
}

function parseArgs(argv) {
  const args = {
    config: 'config/api-builder-services.json',
    service: '',
    outputDir: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === '--config' && next) {
      args.config = next;
      index += 1;
    } else if (token === '--service' && next) {
      args.service = next;
      index += 1;
    } else if (token === '--output-dir' && next) {
      args.outputDir = next;
      index += 1;
    } else if (token === '--help' || token === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/export-api-builder-service.js --service <name> --output-dir <dir> [--config <path>]',
          '',
          'Reads config/api-builder-services.json, exports the requested spec from Postman API Builder,',
          'and writes a self-contained service repo scaffold into the output directory.'
        ].join('\n') + '\n'
      );
      process.exit(0);
    }
  }

  if (!args.service) {
    fail('--service is required');
  }

  if (!args.outputDir) {
    fail('--output-dir is required');
  }

  return args;
}

function loadJson(filePath) {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    fail(`JSON file not found: ${absolutePath}`);
  }

  try {
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    fail(`Invalid JSON in ${absolutePath}: ${error.message}`);
  }
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toPrettyTitle(value) {
  return String(value || '')
    .split(/[-_]+/)
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(' ');
}

function ensureDir(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function writeFile(targetPath, content) {
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, content, 'utf8');
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function resolveOptionalString(...values) {
  for (const value of values) {
    if (value === undefined || value === null) {
      continue;
    }

    const normalized = String(value).trim();
    if (normalized) {
      return normalized;
    }
  }

  return '';
}

function resolveOptionalBoolean(...values) {
  for (const value of values) {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') {
        return true;
      }
      if (normalized === 'false') {
        return false;
      }
    }
  }

  return undefined;
}

function normalizeStringMap(rawConfig) {
  if (!isPlainObject(rawConfig)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(rawConfig)
      .filter(([key, value]) => key && value !== undefined && value !== null)
      .sort(([left], [right]) => String(left).localeCompare(String(right)))
      .map(([key, value]) => [String(key), String(value)])
  );
}

function stringifyEnvironmentValue(value) {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value);
}

function normalizeEnvironmentValues(rawConfig) {
  if (!isPlainObject(rawConfig)) {
    return {};
  }

  const entries = Object.entries(rawConfig);
  if (entries.length === 0) {
    return {};
  }

  const looksLikeFlatValueMap = entries.every(([, value]) =>
    value === null || ['string', 'number', 'boolean'].includes(typeof value)
  );

  if (looksLikeFlatValueMap) {
    return {
      all: Object.fromEntries(
        entries.map(([key, value]) => [key, stringifyEnvironmentValue(value)])
      )
    };
  }

  const normalized = {};
  for (const [scope, valueMap] of entries) {
    if (!isPlainObject(valueMap)) {
      continue;
    }

    normalized[scope] = Object.fromEntries(
      Object.entries(valueMap)
        .filter(([, value]) => value === null || ['string', 'number', 'boolean'].includes(typeof value))
        .map(([key, value]) => [key, stringifyEnvironmentValue(value)])
    );
  }

  return normalized;
}

function mergeEnvironmentValueScopes(...configs) {
  const merged = {};

  for (const config of configs) {
    for (const [scope, values] of Object.entries(config || {})) {
      merged[scope] = {
        ...(merged[scope] || {}),
        ...(values || {})
      };
    }
  }

  return merged;
}

function renderTemplate(relativePath, values) {
  const templatePath = path.join(TEMPLATE_ROOT, relativePath);
  const template = fs.readFileSync(templatePath, 'utf8');
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) {
      return match;
    }
    return values[key];
  });
}

async function postmanRequest(method, endpoint, body, options = {}) {
  const auth = resolvePostmanAuth();
  const headers = {
    Accept: options.accept || 'application/json',
    'User-Agent': POSTMAN_USER_AGENT
  };
  headers[auth.headerName] = auth.value;
  if (options.service) {
    headers['x-pstmn-req-service'] = options.service;
  }
  if (options.postmanService) {
    headers['x-postman-service'] = options.postmanService;
  }

  const requestOptions = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    requestOptions.body = JSON.stringify(body);
  }

  const response = await fetch(`${getPostmanBaseUrl(options.base)}${endpoint}`, requestOptions);
  const text = await response.text();

  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      parsed = null;
    }
  }

  if (!response.ok) {
    const detail = parsed ? JSON.stringify(parsed) : text;
    fail(`Postman API ${method} ${endpoint} failed (${response.status}): ${detail}`);
  }

  return {
    status: response.status,
    text,
    json: parsed
  };
}

function normalizePosixPath(value) {
  return String(value || '').replace(/\\/g, '/');
}

async function exportApiSchemaFromGateway(service, source) {
  const apiResponse = await postmanRequest(
    'GET',
    `/apis/${source.api_id}?populate=schemas&populate=versions&populate=relations`,
    undefined,
    {
      base: 'gateway',
      service: 'api-dev-platform',
      postmanService: 'cloud-api'
    }
  );

  const api = apiResponse.json && apiResponse.json.data;
  const versions = api && Array.isArray(api.versions) ? api.versions : [];
  const version = versions[0];

  if (!version) {
    fail(`Postman API Builder did not return a version for ${service.name}`);
  }

  let schema =
    Array.isArray(version.schemas) &&
    (version.schemas.find((entry) => !source.schema_id || entry.id === source.schema_id) ||
      version.schemas[0]);

  if (!schema && Array.isArray(version.relations)) {
    const relation =
      version.relations.find(
        (entry) => entry.type === 'apiDefinition' && (!source.schema_id || entry.id === source.schema_id)
      ) ||
      version.relations.find((entry) => entry.type === 'apiDefinition');

    if (relation) {
      const schemaResponse = await postmanRequest(
        'GET',
        `/apis/${source.api_id}/versions/${version.id}/schemas/${relation.id}`,
        undefined,
        {
          base: 'gateway',
          service: 'api-dev-platform',
          postmanService: 'cloud-api'
        }
      );

      schema =
        (schemaResponse.json && schemaResponse.json.schema) ||
        (schemaResponse.json &&
          schemaResponse.json.data &&
          schemaResponse.json.data.schema) ||
        null;
    }
  }

  const specContent = schema && (schema.content || schema.schema);
  if (!specContent) {
    fail(`Postman API Builder returned an empty schema for ${service.name}`);
  }

  return {
    specContent,
    sourceType: 'api-builder',
    sourceApiId: source.api_id || '',
    sourceSchemaId: (schema && schema.id) || source.schema_id || '',
    sourceSchemaFilePath: source.schema_file_path || `${slugify(service.name)}.yaml`,
    sourceFilePath: source.schema_file_path || `${slugify(service.name)}.yaml`
  };
}

async function exportSpecificationFile(service, source) {
  const response = await postmanRequest(
    'GET',
    `/specifications/${source.spec_id}/files?fields=id,name,content,type,path`,
    undefined,
    {
      base: 'gateway',
      service: 'api-specification',
      postmanService: 'postman-api'
    }
  );

  const files = (response.json && response.json.data) || [];
  if (!Array.isArray(files) || files.length === 0) {
    fail(`Postman spec export did not return any files for ${service.name}`);
  }

  const requestedPath = normalizePosixPath(source.spec_file_path);
  const requestedFileName = path.posix.basename(requestedPath);
  const targetFile =
    files.find((file) => normalizePosixPath(file.path) === requestedPath) ||
    files.find((file) => path.posix.basename(normalizePosixPath(file.path)) === requestedFileName) ||
    files.find((file) => file.type === 'ROOT') ||
    files[0];

  const specContent = targetFile && targetFile.content;
  if (!specContent) {
    fail(`Postman spec export returned an empty file for ${service.name}`);
  }

  return {
    specContent,
    sourceType: 'specification',
    sourceSpecId: source.spec_id || '',
    sourceFilePath: targetFile.path || targetFile.name || source.spec_file_path
  };
}

async function exportSpecFromPostman(service, config) {
  const source = service.source || {};
  const sourceWorkspaceId =
    source.workspace_id ||
    service.source_workspace_id ||
    (config.postman && config.postman.source_workspace_id) ||
    '';

  if (source.local_path) {
    const localSpecPath = path.resolve(source.local_path);
    if (!fs.existsSync(localSpecPath)) {
      fail(`Local source spec not found for ${service.name}: ${localSpecPath}`);
    }

    return {
      specContent: fs.readFileSync(localSpecPath, 'utf8'),
      sourceType: 'local',
      sourceWorkspaceId,
      sourceApiId: '',
      sourceSpecId: '',
      sourceSchemaId: '',
      sourceSchemaFilePath: path.basename(localSpecPath),
      sourceFilePath: path.basename(localSpecPath)
    };
  }

  if (source.api_id && source.schema_id && source.schema_file_path) {
    const exported = await exportApiSchemaFromGateway(service, source);

    return {
      specContent: exported.specContent,
      sourceType: exported.sourceType,
      sourceWorkspaceId,
      sourceApiId: source.api_id,
      sourceSpecId: '',
      sourceSchemaId: exported.sourceSchemaId,
      sourceSchemaFilePath: exported.sourceSchemaFilePath,
      sourceFilePath: exported.sourceFilePath
    };
  }

  if (source.spec_id && source.spec_file_path) {
    const exported = await exportSpecificationFile(service, source);

    return {
      specContent: exported.specContent,
      sourceType: exported.sourceType,
      sourceWorkspaceId,
      sourceApiId: '',
      sourceSpecId: exported.sourceSpecId,
      sourceSchemaId: '',
      sourceSchemaFilePath: '',
      sourceFilePath: exported.sourceFilePath
    };
  }

  fail(
    `Service "${service.name}" must define source.local_path, source.spec_id/source.spec_file_path, or source.api_id/source.schema_id/source.schema_file_path`
  );
}

function resolveRepoMetadata(service, config) {
  const repoOwner =
    (service.github && service.github.owner) ||
    (config.github && config.github.owner) ||
    process.env.GITHUB_REPOSITORY_OWNER ||
    '';
  const repoPrefix =
    (service.github && service.github.repo_prefix) ||
    (config.github && config.github.repo_prefix) ||
    '';
  const repoName =
    (service.github && service.github.repo_name) ||
    service.repo_name ||
    `${repoPrefix}${slugify(service.name)}`;
  const repoVisibility =
    (service.github && service.github.visibility) ||
    (config.github && config.github.visibility) ||
    'private';
  const repoDescription =
    (service.github && service.github.description) ||
    service.repo_description ||
    `${service.project_name || service.name} exported from Postman API Builder`;

  if (!repoOwner) {
    fail(`Missing GitHub owner for ${service.name}`);
  }

  return {
    owner: repoOwner,
    name: repoName,
    fullName: `${repoOwner}/${repoName}`,
    visibility: repoVisibility,
    description: repoDescription
  };
}

function resolveTargetWorkspaceId(service, config) {
  return (
    service.target_workspace_id ||
    (service.postman && service.postman.workspace_id) ||
    (config.postman && config.postman.workspace_id) ||
    ''
  );
}

function resolveEnvironmentValues(service, config) {
  const merged = mergeEnvironmentValueScopes(
    normalizeEnvironmentValues(config.environment_values),
    normalizeEnvironmentValues(
      (config.postman && config.postman.environment_values) || {}
    ),
    normalizeEnvironmentValues(service.environment_values),
    normalizeEnvironmentValues(
      (service.postman && service.postman.environment_values) || {}
    )
  );

  const defaultServiceApiKey =
    service.default_service_api_key ||
    (service.postman && service.postman.default_service_api_key) ||
    (config.postman && config.postman.default_service_api_key) ||
    '';

  if (defaultServiceApiKey) {
    merged.all = {
      ...(merged.all || {}),
      apiKey: merged.all && merged.all.apiKey ? merged.all.apiKey : String(defaultServiceApiKey)
    };
  }

  return merged;
}

function buildManifest(service, config, repoMetadata, specRelativePath, sourceInfo) {
  const serviceName = service.name;
  const projectName = service.project_name || toPrettyTitle(serviceName);
  const configPostman = isPlainObject(config.postman) ? config.postman : {};
  const servicePostman = isPlainObject(service.postman) ? service.postman : {};
  const domain = service.domain || configPostman.domain || '';
  const domainCode = service.domain_code || configPostman.domain_code || '';
  const workspaceName =
    service.workspace_name ||
    (domainCode ? `[${domainCode}] ${projectName}` : projectName);
  const collectionName = service.collection_name || projectName;
  const workspaceId = resolveTargetWorkspaceId(service, config);
  const environmentValues = resolveEnvironmentValues(service, config);
  const governanceMapping = {
    ...normalizeStringMap(configPostman.governance_mapping),
    ...normalizeStringMap(service.governance_mapping),
    ...normalizeStringMap(servicePostman.governance_mapping)
  };
  const systemEnvMap = {
    ...normalizeStringMap(configPostman.system_env_map),
    ...normalizeStringMap(service.system_env_map),
    ...normalizeStringMap(servicePostman.system_env_map)
  };
  const requesterEmail = resolveOptionalString(
    servicePostman.requester_email,
    service.requester_email,
    configPostman.requester_email
  );
  const workspaceAdminUserIds = resolveOptionalString(
    servicePostman.workspace_admin_user_ids,
    service.workspace_admin_user_ids,
    configPostman.workspace_admin_user_ids
  );
  const postmanTeamId = resolveOptionalString(
    servicePostman.team_id,
    service.team_id,
    configPostman.team_id
  );
  const workspaceTeamId = resolveOptionalString(
    servicePostman.workspace_team_id,
    service.workspace_team_id,
    configPostman.workspace_team_id
  );
  const orgMode =
    resolveOptionalBoolean(
      servicePostman.org_mode,
      service.org_mode,
      configPostman.org_mode
    ) ?? false;
  const requireApiCatalogLink =
    resolveOptionalBoolean(
      servicePostman.require_api_catalog_link,
      service.require_api_catalog_link,
      configPostman.require_api_catalog_link
    ) ?? true;
  const requireSystemEnvAssociation =
    resolveOptionalBoolean(
      servicePostman.require_system_env_association,
      service.require_system_env_association,
      configPostman.require_system_env_association
    ) ?? true;
  const integrationBackend =
    resolveOptionalString(
      servicePostman.integration_backend,
      service.integration_backend,
      configPostman.integration_backend
    ) || 'bifrost';

  return {
    name: serviceName,
    project_name: projectName,
    domain,
    domain_code: domainCode,
    spec_path: specRelativePath,
    source: {
      type: sourceInfo.sourceType || '',
      workspace_id: sourceInfo.sourceWorkspaceId || '',
      api_id: sourceInfo.sourceApiId || '',
      spec_id: sourceInfo.sourceSpecId || '',
      schema_id: sourceInfo.sourceSchemaId || '',
      schema_file_path: sourceInfo.sourceSchemaFilePath || '',
      spec_file_path: sourceInfo.sourceFilePath || ''
    },
    github: {
      owner: repoMetadata.owner,
      repo: repoMetadata.name
    },
    environments: Array.isArray(service.environments) ? service.environments : ['prod'],
    runtime_urls:
      service.runtime_urls && typeof service.runtime_urls === 'object'
        ? service.runtime_urls
        : {},
    environment_values: environmentValues,
    postman: {
      workspace_id: workspaceId,
      workspace_name: workspaceName,
      spec_name: service.spec_name || projectName,
      collection_name: collectionName,
      smoke_collection_name:
        service.smoke_collection_name || `${collectionName} Smoke`,
      environment_name_prefix: service.environment_name_prefix || projectName,
      monitor_name: service.monitor_name || `${projectName} Smoke Monitor`,
      governance_mapping: governanceMapping,
      system_env_map: systemEnvMap,
      requester_email: requesterEmail,
      workspace_admin_user_ids: workspaceAdminUserIds,
      team_id: postmanTeamId,
      workspace_team_id: workspaceTeamId,
      org_mode: orgMode,
      require_api_catalog_link: requireApiCatalogLink,
      require_system_env_association: requireSystemEnvAssociation,
      integration_backend: integrationBackend
    }
  };
}

function buildResourcesYaml(specRelativePath, workspaceId) {
  const specPathFromPostmanDir = path.posix.join('..', specRelativePath.replace(/\\/g, '/'));
  const lines = [
    '# Workspace id is optional. The onboarding workflow will reuse or create it by name.',
  ];

  if (workspaceId) {
    lines.push('workspace:');
    lines.push(`  id: ${workspaceId}`);
    lines.push('');
  }

  lines.push('localResources:');
  lines.push('  specs:');
  lines.push(`    - ${specPathFromPostmanDir}`);
  lines.push('');

  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadJson(args.config);
  const service = config.services.find((entry) => entry.name === args.service);

  if (!service) {
    fail(`Service "${args.service}" was not found in ${path.resolve(args.config)}`);
  }

  const repoMetadata = resolveRepoMetadata(service, config);
  const sourceInfo = await exportSpecFromPostman(service, config);
  const outputRoot = path.resolve(args.outputDir);
  const slug = slugify(service.name);
  const specFileName =
    service.output_spec_file_name ||
    sourceInfo.sourceFilePath ||
    `${slug}.yaml`;
  const specRelativePath = path.posix.join('specs', specFileName);
  const manifest = buildManifest(service, config, repoMetadata, specRelativePath, sourceInfo);
  const templateValues = {
    PROJECT_NAME: manifest.project_name,
    PROJECT_TITLE: manifest.project_name,
    SERVICE_NAME: manifest.name,
    SPEC_PATH: manifest.spec_path,
    SPEC_FILE_NAME: path.basename(manifest.spec_path),
    WORKSPACE_NAME: manifest.postman.workspace_name,
    DOMAIN: manifest.domain,
    DOMAIN_CODE: manifest.domain_code,
    REPO_FULL_NAME: repoMetadata.fullName
  };

  fs.rmSync(outputRoot, { recursive: true, force: true });
  ensureDir(outputRoot);

  writeFile(path.join(outputRoot, manifest.spec_path), sourceInfo.specContent);
  writeFile(
    path.join(outputRoot, 'api-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  writeFile(
    path.join(outputRoot, '.postman', 'resources.yaml'),
    buildResourcesYaml(manifest.spec_path, manifest.postman.workspace_id)
  );
  writeFile(
    path.join(outputRoot, 'README.md'),
    renderTemplate('README.md.tpl', templateValues)
  );
  writeFile(
    path.join(outputRoot, '.github', 'workflows', 'onboard-to-postman.yml'),
    renderTemplate(
      path.join('.github', 'workflows', 'onboard-to-postman.yml.tpl'),
      templateValues
    )
  );
  writeFile(
    path.join(outputRoot, 'scripts', 'resolve-system-env-map.js'),
    renderTemplate(
      path.join('scripts', 'resolve-system-env-map.js.tpl'),
      templateValues
    )
  );

  process.stdout.write(
    [
      `Scaffolded ${repoMetadata.fullName}`,
      `  Service:      ${manifest.name}`,
      `  Spec path:    ${manifest.spec_path}`,
      `  Workspace:    ${manifest.postman.workspace_name}`,
      `  Output dir:   ${outputRoot}`
    ].join('\n') + '\n'
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
