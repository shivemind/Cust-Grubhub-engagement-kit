#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const { spawnSync } = require('child_process');

const MANIFEST_PATH = process.env.API_MANIFEST_PATH || 'api-manifest.json';
const DEFAULT_POSTMAN_API_BASE = process.env.POSTMAN_API_BASE || 'https://api.getpostman.com';
const DEFAULT_POSTMAN_GATEWAY_BASE =
  process.env.POSTMAN_GATEWAY_BASE || 'https://gateway.postman.com';
const POSTMAN_USER_AGENT = 'Postman CLI/1.33.1';

function appendSummary(lines) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;

  fs.appendFileSync(summaryPath, `${lines.join('\n')}\n`, 'utf8');
}

function fail(message) {
  throw new Error(message);
}

function loadManifest() {
  const absolutePath = path.resolve(MANIFEST_PATH);
  if (!fs.existsSync(absolutePath)) {
    fail(`Manifest not found: ${absolutePath}`);
  }

  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
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

  fail('POSTMAN_API_KEY or POSTMAN_ACCESS_TOKEN is required');
}

function readWorkspaceIdFromResources() {
  const resourcesPath = path.resolve('.postman', 'resources.yaml');
  if (!fs.existsSync(resourcesPath)) return '';

  const content = fs.readFileSync(resourcesPath, 'utf8');
  const match = content.match(/workspace:\s*\n\s*id:\s*([^\s]+)/m);
  return match ? match[1] : '';
}

function normalizePosixPath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringifyEnvironmentValue(value) {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value);
}

function normalizeEnvironmentValueConfig(rawConfig) {
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

function parseEnvironmentValueConfig(rawValue, label) {
  const trimmed = String(rawValue || '').trim();
  if (!trimmed) {
    return {};
  }

  try {
    return normalizeEnvironmentValueConfig(JSON.parse(trimmed));
  } catch (error) {
    fail(`Invalid ${label}: ${error.message}`);
  }
}

function getNormalizedEnvironmentValueConfig(manifest) {
  return mergeEnvironmentValueScopes(
    normalizeEnvironmentValueConfig(manifest.environment_values || {}),
    parseEnvironmentValueConfig(
      process.env.POSTMAN_ENVIRONMENT_VALUES_JSON,
      'POSTMAN_ENVIRONMENT_VALUES_JSON'
    ),
    parseEnvironmentValueConfig(
      process.env.POSTMAN_ENVIRONMENT_VALUES_JSON_SECRET,
      'POSTMAN_ENVIRONMENT_VALUES_JSON_SECRET'
    )
  );
}

function getConfiguredEnvironmentValueKeys(manifest) {
  const keys = new Set(['baseUrl', 'apiKey']);
  const config = getNormalizedEnvironmentValueConfig(manifest);

  for (const values of Object.values(config)) {
    for (const key of Object.keys(values || {})) {
      keys.add(key);
    }
  }

  return keys;
}

function inferPostmanValueType(key) {
  return /token|secret|password|api[-_]?key/i.test(String(key || ''))
    ? 'secret'
    : 'default';
}

function getPostmanBaseUrl(base = 'gateway') {
  if (base === 'api') {
    return DEFAULT_POSTMAN_API_BASE;
  }

  return DEFAULT_POSTMAN_GATEWAY_BASE;
}

async function requestPostman(method, endpoint, options = {}) {
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
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    requestOptions.body = JSON.stringify(options.body);
  }

  const response = await fetch(`${getPostmanBaseUrl(options.base)}${endpoint}`, requestOptions);
  const text = await response.text();

  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch (error) {
      json = null;
    }
  }

  if (!response.ok) {
    const detail = json ? JSON.stringify(json) : text;
    fail(`Postman ${method} ${endpoint} failed (${response.status}): ${detail}`);
  }

  return {
    status: response.status,
    text,
    json
  };
}

async function listWorkspaces() {
  const response = await requestPostman('GET', '/workspaces', {
    base: 'gateway',
    service: 'workspaces'
  });

  return (response.json && response.json.data) || [];
}

async function getWorkspaceDetails(workspaceId) {
  const response = await requestPostman('GET', `/workspaces/${workspaceId}`, {
    base: 'gateway',
    service: 'workspaces'
  });

  return (response.json && response.json.data) || null;
}

async function getWorkspaceElementIds(workspaceId) {
  const response = await requestPostman(
    'GET',
    `/workspaces/${workspaceId}?include=elements`,
    {
      base: 'gateway',
      service: 'workspaces'
    }
  );

  return (
    response.json &&
    response.json.data &&
    response.json.data.elements
  ) || {
    collections: [],
    environments: [],
    specifications: []
  };
}

function unwrapCollection(payload) {
  const data = payload && payload.data ? payload.data : payload;
  return (data && data.collection) || payload.collection || data || null;
}

function unwrapEnvironment(payload) {
  const data = payload && payload.data ? payload.data : payload;
  return (data && data.environment) || payload.environment || data || null;
}

async function getCollection(uid) {
  const response = await requestPostman(
    'GET',
    `/collection/${uid}?format=2.1.0&populate=true`,
    {
      base: 'gateway',
      service: 'sync'
    }
  );

  return unwrapCollection(response.json);
}

async function deleteCollection(uid) {
  await requestPostman(
    'DELETE',
    `/collection/${uid}?format=2.1.0&populate=true`,
    {
      base: 'gateway',
      service: 'sync'
    }
  );
}

async function importCollection(workspaceId, collection) {
  await requestPostman(
    'POST',
    `/collection/import?workspace=${encodeURIComponent(workspaceId)}&format=2.1.0`,
    {
      base: 'gateway',
      service: 'sync',
      body: collection
    }
  );
}

async function findCollectionUidByName(workspaceId, collectionName) {
  const elements = await getWorkspaceElementIds(workspaceId);
  for (const uid of elements.collections || []) {
    const collection = await getCollection(uid);
    if (collection && collection.info && collection.info.name === collectionName) {
      return uid;
    }
  }

  return '';
}

async function getEnvironment(uid) {
  const response = await requestPostman(
    'GET',
    `/environment/${uid}`,
    {
      base: 'gateway',
      service: 'sync'
    }
  );

  return unwrapEnvironment(response.json);
}

async function createEnvironment(workspaceId, environment) {
  await requestPostman(
    'POST',
    `/environment/import?workspace=${encodeURIComponent(workspaceId)}&format=2.1.0`,
    {
      base: 'gateway',
      service: 'sync',
      body: environment
    }
  );
}

async function updateEnvironment(uid, values) {
  await requestPostman(
    'PUT',
    `/environment/${uid}`,
    {
      base: 'gateway',
      service: 'sync',
      body: { values }
    }
  );
}

async function findEnvironmentUidByName(workspaceId, environmentName) {
  const elements = await getWorkspaceElementIds(workspaceId);
  for (const uid of elements.environments || []) {
    const environment = await getEnvironment(uid);
    if (environment && environment.name === environmentName) {
      return uid;
    }
  }

  return '';
}

async function getSpecificationDetails(specId) {
  const response = await requestPostman(
    'GET',
    `/specifications/${specId}`,
    {
      base: 'gateway',
      service: 'api-specification',
      postmanService: 'postman-api'
    }
  );

  return response.json && response.json.data;
}

async function getSpecificationFiles(specId) {
  const response = await requestPostman(
    'GET',
    `/specifications/${specId}/files?fields=id,name,content,type,path`,
    {
      base: 'gateway',
      service: 'api-specification',
      postmanService: 'postman-api'
    }
  );

  return (response.json && response.json.data) || [];
}

async function createSpecification(workspaceId, specName, specFileName, specContent) {
  const response = await requestPostman(
    'POST',
    `/specifications?containerType=workspace&containerId=${encodeURIComponent(workspaceId)}`,
    {
      base: 'gateway',
      service: 'api-specification',
      postmanService: 'postman-api',
      body: {
        name: specName,
        type: 'OPENAPI:3.0',
        files: [
          {
            path: specFileName,
            content: specContent,
            type: 'ROOT'
          }
        ]
      }
    }
  );

  return (response.json && response.json.data) || response.json || {};
}

async function updateSpecificationFile(specId, specFileName, specContent) {
  await requestPostman(
    'PATCH',
    `/specs/${specId}/files/${encodeURIComponent(specFileName)}`,
    {
      base: 'gateway',
      service: 'api-specification',
      postmanService: 'postman-api',
      body: [
        {
          op: 'replace',
          path: '/content',
          value: specContent
        }
      ]
    }
  );
}

async function resolveWorkspace(manifest) {
  const desiredName =
    (manifest.postman && manifest.postman.workspace_name) ||
    (manifest.domain_code ? `[${manifest.domain_code}] ${manifest.project_name}` : manifest.project_name);
  const explicitWorkspaceId =
    process.env.POSTMAN_WORKSPACE_ID ||
    readWorkspaceIdFromResources() ||
    ((manifest.postman && manifest.postman.workspace_id) || '') ||
    '';

  if (explicitWorkspaceId) {
    const workspace = await getWorkspaceDetails(explicitWorkspaceId);
    return {
      id: explicitWorkspaceId,
      name: (workspace && workspace.name) || desiredName,
      created: false
    };
  }

  const existing = await listWorkspaces();
  const match = existing.find((workspace) => workspace.name === desiredName);
  if (match) {
    return { id: match.id, name: desiredName, created: false };
  }

  const auth = resolvePostmanAuth();
  if (auth.kind !== 'apiKey') {
    fail(
      `Workspace "${desiredName}" was not found. Set POSTMAN_WORKSPACE_ID when using POSTMAN_ACCESS_TOKEN.`
    );
  }

  const workspaceBody = {
    workspace: {
      name: desiredName,
      type: 'team',
      about: `${manifest.project_name} provisioned from Git`
    }
  };

  try {
    const created = await requestPostman('POST', '/workspaces', {
      base: 'api',
      body: workspaceBody
    });
    return {
      id: created.json.workspace.id,
      name: desiredName,
      created: true
    };
  } catch (error) {
    const fallback = await requestPostman('POST', '/workspaces', {
      base: 'api',
      body: {
        workspace: {
          name: desiredName,
          type: 'personal',
          about: `${manifest.project_name} provisioned from Git`
        }
      }
    });
    return {
      id: fallback.json.workspace.id,
      name: desiredName,
      created: true
    };
  }
}

async function upsertSpec(workspaceId, manifest, specContent, specFileName) {
  const specName =
    (manifest.postman && manifest.postman.spec_name) ||
    manifest.project_name;
  const elements = await getWorkspaceElementIds(workspaceId);
  const specIds = elements.specifications || [];
  let existing = null;

  for (const specId of specIds) {
    const details = await getSpecificationDetails(specId);
    if (details && details.name === specName) {
      existing = details;
      break;
    }
  }

  if (existing) {
    const files = await getSpecificationFiles(existing.id);
    const rootFile =
      files.find((entry) => entry.type === 'ROOT') ||
      files.find(
        (entry) =>
          normalizePosixPath(entry.path) === normalizePosixPath(specFileName)
      ) ||
      files[0];

    await updateSpecificationFile(
      existing.id,
      (rootFile && rootFile.path) || specFileName,
      specContent
    );
    return existing.id;
  }

  const created = await createSpecification(
    workspaceId,
    specName,
    specFileName,
    specContent
  );

  return created.id;
}

function convertSpecToCollection(specPath, collectionName) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openapi-to-postman-'));
  const outputPath = path.join(tmpDir, 'collection.json');
  const result = spawnSync(
    'npx',
    [
      '--yes',
      'openapi-to-postmanv2',
      '-s',
      specPath,
      '-o',
      outputPath,
      '-p',
      '-O',
      'folderStrategy=Tags,parametersResolution=Example,enableOptionalParameters=false'
    ],
    {
      encoding: 'utf8'
    }
  );

  if (result.status !== 0) {
    fail(
      `Failed to convert ${specPath} into a Postman collection: ${
        result.stderr || result.stdout || 'Unknown conversion error'
      }`
    );
  }

  const collection = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  if (collection && collection.info) {
    collection.info.name = collectionName;
  }

  return collection;
}

function visitCollectionItems(items, visitor) {
  if (!Array.isArray(items)) {
    return;
  }

  for (const item of items) {
    if (Array.isArray(item.item)) {
      visitCollectionItems(item.item, visitor);
      continue;
    }

    if (item && item.request) {
      visitor(item.request);
    }
  }
}

function normalizeCollectionRequests(collection, configuredKeys) {
  visitCollectionItems(collection.item, (request) => {
    if (!request || !request.url || typeof request.url !== 'object') {
      return;
    }

    const url = request.url;

    if (Array.isArray(url.variable)) {
      for (const variable of url.variable) {
        if (!variable || !variable.key) {
          continue;
        }

        const value = String(variable.value || '').trim();
        if (configuredKeys.has(variable.key)) {
          variable.value = `{{${variable.key}}}`;
        } else if (!value || /^<.+>$/.test(value)) {
          variable.value = `{{${variable.key}}}`;
        }
      }
    }

    if (Array.isArray(url.query)) {
      for (const query of url.query) {
        if (!query || typeof query !== 'object') {
          continue;
        }

        const value = String(query.value || '').trim();
        if (configuredKeys.has(query.key) && (!value || /^<.+>$/.test(value))) {
          query.value = `{{${query.key}}}`;
          query.disabled = false;
        } else if (value && /^<.+>$/.test(value)) {
          query.disabled = true;
        }
      }
    }
  });

  return collection;
}

async function replaceCollectionByName(workspaceId, collectionName, collection) {
  const existingUid = await findCollectionUidByName(workspaceId, collectionName);
  if (existingUid) {
    await deleteCollection(existingUid);
  }

  await importCollection(workspaceId, resetCollectionIdentity(cloneCollection(collection)));
  const collectionUid = await findCollectionUidByName(workspaceId, collectionName);
  if (!collectionUid) {
    fail(`Collection import did not return a collection for ${collectionName}`);
  }

  return collectionUid;
}

async function deleteCollectionByName(workspaceId, collectionName) {
  const existingUid = await findCollectionUidByName(workspaceId, collectionName);
  if (existingUid) {
    await deleteCollection(existingUid);
  }
}

function cloneCollection(collection) {
  return JSON.parse(JSON.stringify(collection));
}

function resetCollectionIdentity(collection) {
  if (!collection || typeof collection !== 'object') {
    return collection;
  }

  if (collection.info && typeof collection.info === 'object') {
    collection.info._postman_id = randomUUID();
  }

  const visit = (items) => {
    if (!Array.isArray(items)) {
      return;
    }

    for (const item of items) {
      if (!item || typeof item !== 'object') {
        continue;
      }

      if (item.id) {
        item.id = randomUUID();
      }

      if (Array.isArray(item.response)) {
        for (const response of item.response) {
          if (response && typeof response === 'object' && response.id) {
            response.id = randomUUID();
          }
        }
      }

      if (Array.isArray(item.item)) {
        visit(item.item);
      }
    }
  };

  visit(collection.item);
  return collection;
}

function getRequestMethod(request) {
  return String((request && request.method) || '').trim().toUpperCase();
}

function getRequestPathVariableKeys(request) {
  const url = request && request.url;
  if (!url || typeof url !== 'object' || !Array.isArray(url.variable)) {
    return [];
  }

  return url.variable
    .map((entry) => entry && entry.key)
    .filter(Boolean);
}

function isReadOnlyMethod(method) {
  return ['GET', 'HEAD', 'OPTIONS'].includes(method);
}

function canResolvePathVariables(request, configuredKeys) {
  const variableKeys = getRequestPathVariableKeys(request);
  return variableKeys.every((key) => configuredKeys.has(key));
}

function isSmokeSafeRequest(request, configuredKeys) {
  const method = getRequestMethod(request);
  if (!isReadOnlyMethod(method)) {
    return false;
  }

  return canResolvePathVariables(request, configuredKeys);
}

function filterSmokeItems(items, configuredKeys) {
  if (!Array.isArray(items)) {
    return [];
  }

  const filtered = [];

  for (const item of items) {
    if (Array.isArray(item.item)) {
      const nextItems = filterSmokeItems(item.item, configuredKeys);
      if (nextItems.length > 0) {
        filtered.push({
          ...item,
          item: nextItems
        });
      }
      continue;
    }

    if (item && item.request && isSmokeSafeRequest(item.request, configuredKeys)) {
      filtered.push(item);
    }
  }

  return filtered;
}

function buildSmokeCollection(fullCollection, smokeCollectionName, configuredKeys) {
  const smokeCollection = cloneCollection(fullCollection);
  if (smokeCollection.info) {
    smokeCollection.info.name = smokeCollectionName;
    smokeCollection.info.description = [
      'Smoke-safe collection generated from the API spec.',
      'Includes only read-only requests that do not require customer-specific seeded resource IDs unless those IDs are explicitly configured in the environment.'
    ].join('\n\n');
  }

  smokeCollection.item = filterSmokeItems(smokeCollection.item, configuredKeys);

  if (!Array.isArray(smokeCollection.item) || smokeCollection.item.length === 0) {
    return null;
  }

  return smokeCollection;
}

async function refreshCollections(workspaceId, manifest, specPath) {
  const collectionName =
    (manifest.postman && manifest.postman.collection_name) ||
    manifest.project_name;
  const smokeCollectionName =
    (manifest.postman && manifest.postman.smoke_collection_name) ||
    `${collectionName} Smoke`;
  const configuredKeys = getConfiguredEnvironmentValueKeys(manifest);
  const fullCollection = normalizeCollectionRequests(
    convertSpecToCollection(specPath, collectionName),
    configuredKeys
  );
  const smokeCollection = buildSmokeCollection(
    fullCollection,
    smokeCollectionName,
    configuredKeys
  );

  const fullCollectionUid = await replaceCollectionByName(
    workspaceId,
    collectionName,
    fullCollection
  );

  let smokeCollectionUid = '';
  if (smokeCollection) {
    smokeCollectionUid = await replaceCollectionByName(
      workspaceId,
      smokeCollectionName,
      smokeCollection
    );
  } else {
    await deleteCollectionByName(workspaceId, smokeCollectionName);
  }

  return {
    fullCollectionUid,
    smokeCollectionUid
  };
}

function buildEnvironmentName(manifest, environmentSlug) {
  const prefix =
    (manifest.postman && manifest.postman.environment_name_prefix) ||
    manifest.project_name;
  return `${prefix} - ${environmentSlug}`;
}

function buildEnvironmentValues(manifest, environmentSlug) {
  const runtimeUrls = manifest.runtime_urls || {};
  const normalizedEnvironmentValues = getNormalizedEnvironmentValueConfig(manifest);
  const environmentOverrides = {
    ...(normalizedEnvironmentValues.all || {}),
    ...(normalizedEnvironmentValues[environmentSlug] || {})
  };
  const baseUrl =
    environmentOverrides.baseUrl ||
    runtimeUrls[environmentSlug] ||
    process.env.DEFAULT_BASE_URL ||
    'https://example.com';
  const apiKey =
    process.env.DEFAULT_SERVICE_API_KEY_SECRET ||
    process.env.DEFAULT_SERVICE_API_KEY ||
    environmentOverrides.apiKey ||
    'set-in-postman-or-ci';

  const values = [
    {
      key: 'baseUrl',
      value: baseUrl,
      type: 'default',
      enabled: true
    },
    {
      key: 'apiKey',
      value: apiKey,
      type: 'secret',
      enabled: true
    }
  ];

  for (const [key, value] of Object.entries(environmentOverrides).sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    if (key === 'baseUrl' || key === 'apiKey') {
      continue;
    }

    values.push({
      key,
      value,
      type: inferPostmanValueType(key),
      enabled: true
    });
  }

  return values;
}

async function upsertEnvironments(workspaceId, manifest) {
  const environmentSlugs =
    Array.isArray(manifest.environments) && manifest.environments.length > 0
      ? manifest.environments
      : ['prod'];
  const resolved = {};

  for (const environmentSlug of environmentSlugs) {
    const name = buildEnvironmentName(manifest, environmentSlug);
    const values = buildEnvironmentValues(manifest, environmentSlug);
    const existingUid = await findEnvironmentUidByName(workspaceId, name);

    if (existingUid) {
      await updateEnvironment(existingUid, values);
      resolved[environmentSlug] = existingUid;
    } else {
      await createEnvironment(workspaceId, {
        id: randomUUID(),
        name,
        values
      });

      const createdUid = await findEnvironmentUidByName(workspaceId, name);
      if (!createdUid) {
        fail(`Environment import did not return an environment for ${name}`);
      }

      resolved[environmentSlug] = createdUid;
    }
  }

  return resolved;
}

async function maybeUpsertMonitor(workspaceId, manifest, collectionUid, environmentUids) {
  const cron = process.env.POSTMAN_MONITOR_CRON || '';
  const timezone = process.env.POSTMAN_MONITOR_TIMEZONE || 'UTC';
  if (!cron) return '';

  const auth = resolvePostmanAuth();
  if (auth.kind !== 'apiKey') {
    console.warn('POSTMAN_MONITOR_CRON is set, but monitor provisioning requires POSTMAN_API_KEY. Skipping monitor creation.');
    return '';
  }

  const environmentIds = Object.values(environmentUids);
  if (environmentIds.length === 0) return '';

  const monitorName =
    (manifest.postman && manifest.postman.monitor_name) ||
    `${manifest.project_name} Smoke Monitor`;
  const monitorsResponse = await requestPostman('GET', '/monitors', {
    base: 'api'
  });
  const existingMonitors = (monitorsResponse.json && monitorsResponse.json.monitors) || [];
  const existing = existingMonitors.find((entry) => entry.name === monitorName);

  const payload = {
    monitor: {
      name: monitorName,
      collection: collectionUid,
      environment: environmentIds[0],
      schedule: {
        cron,
        timezone
      }
    }
  };

  if (existing) {
    await requestPostman('PUT', `/monitors/${existing.uid || existing.id}`, {
      base: 'api',
      body: payload
    });
    return existing.uid || existing.id;
  }

  const created = await requestPostman(
    'POST',
    `/monitors?workspace=${encodeURIComponent(workspaceId)}`,
    {
      base: 'api',
      body: payload
    }
  );
  return created.json.monitor.uid || created.json.monitor.id || '';
}

async function main() {
  const manifest = loadManifest();
  const specPath = path.resolve(manifest.spec_path);
  if (!fs.existsSync(specPath)) {
    fail(`Spec file not found: ${specPath}`);
  }

  const specContent = fs.readFileSync(specPath, 'utf8');
  const specFileName = path.posix.basename(normalizePosixPath(manifest.spec_path));
  const workspace = await resolveWorkspace(manifest);
  const specId = await upsertSpec(workspace.id, manifest, specContent, specFileName);
  const collections = await refreshCollections(workspace.id, manifest, specPath);
  const environmentUids = await upsertEnvironments(workspace.id, manifest);
  const monitorId = await maybeUpsertMonitor(
    workspace.id,
    manifest,
    collections.smokeCollectionUid || collections.fullCollectionUid,
    environmentUids
  );

  const summaryLines = [
    '## Postman Onboarding',
    '',
    `- Workspace: ${workspace.name} (${workspace.id})`,
    `- Spec Hub: ${specId}`,
    `- Collection: ${collections.fullCollectionUid}`,
    `- Smoke Collection: ${collections.smokeCollectionUid || 'not created'}`,
    `- Environments: ${JSON.stringify(environmentUids)}`,
    `- Monitor: ${monitorId || 'skipped'}`
  ];

  appendSummary(summaryLines);
  process.stdout.write(`${summaryLines.join('\n')}\n`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
