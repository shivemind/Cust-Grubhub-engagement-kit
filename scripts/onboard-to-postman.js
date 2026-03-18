const https = require('https');
const fs = require('fs');
const yaml = require('js-yaml');

const API_KEY = process.env.POSTMAN_API_KEY;
const WORKSPACE_ID = process.env.POSTMAN_WORKSPACE_ID || '549c9382-ffb6-4f79-b7b7-2354db906862';

if (!API_KEY) {
  console.error('POSTMAN_API_KEY is required');
  process.exit(1);
}

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.getpostman.com',
      path,
      method,
      headers: {
        'X-Api-Key': API_KEY,
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d ? JSON.parse(d) : {} }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function resolveRef(spec, ref) {
  const parts = ref.replace('#/', '').split('/');
  let node = spec;
  for (const p of parts) node = node[p];
  return node;
}

function resolveSchema(spec, schema) {
  if (!schema) return null;
  if (schema.$ref) return resolveSchema(spec, resolveRef(spec, schema.$ref));
  if (schema.allOf) {
    const merged = { type: 'object', properties: {} };
    schema.allOf.forEach(s => {
      const resolved = resolveSchema(spec, s);
      if (resolved?.properties) Object.assign(merged.properties, resolved.properties);
    });
    return merged;
  }
  const result = { ...schema };
  if (result.properties) {
    const resolved = {};
    for (const [k, v] of Object.entries(result.properties)) resolved[k] = resolveSchema(spec, v);
    result.properties = resolved;
  }
  if (result.items) result.items = resolveSchema(spec, result.items);
  return result;
}

function normalizeUrl(raw) {
  return raw.replace(/\{\{baseUrl\}\}/g, '').replace(/\?.*$/, '').replace(/:(\w+)/g, '{$1}').replace(/\/+/g, '/').replace(/\/$/, '');
}

function findOperation(spec, method, url) {
  const norm = normalizeUrl(url);
  for (const [pathKey, pathObj] of Object.entries(spec.paths)) {
    if (pathKey.replace(/\/+/g, '/').replace(/\/$/, '') === norm && pathObj[method.toLowerCase()])
      return pathObj[method.toLowerCase()];
  }
  return null;
}

function getSuccessResponse(spec, op) {
  for (const code of ['200', '201']) {
    const resp = op.responses?.[code];
    if (resp) {
      const actual = resp.$ref ? resolveRef(spec, resp.$ref) : resp;
      const schema = actual?.content?.['application/json']?.schema;
      return { code, schema: schema ? resolveSchema(spec, schema) : null };
    }
  }
  return { code: '200', schema: null };
}

function generatePropertyTests(schema, accessor, prefix) {
  const lines = [];
  if (!schema?.properties) return lines;
  for (const [prop, def] of Object.entries(schema.properties)) {
    const path = prefix ? `${prefix}.${prop}` : prop;
    const val = `${accessor}.${prop}`;
    lines.push(`  pm.test("${path} exists", function () { pm.expect(${accessor}).to.have.property("${prop}"); });`);
    if (def.type === 'string') {
      lines.push(`  if (${val} !== undefined && ${val} !== null) {`);
      lines.push(`    pm.test("${path} is a string", function () { pm.expect(typeof ${val}).to.eql("string"); });`);
      if (def.enum) lines.push(`    pm.test("${path} is valid enum", function () { pm.expect(${JSON.stringify(def.enum)}).to.include(${val}); });`);
      if (def.format === 'date-time') lines.push(`    pm.test("${path} is ISO date", function () { pm.expect(new Date(${val}).toISOString()).to.be.a("string"); });`);
      lines.push(`  }`);
    } else if (def.type === 'number' || def.type === 'integer') {
      lines.push(`  if (${val} !== undefined && ${val} !== null) {`);
      lines.push(`    pm.test("${path} is a number", function () { pm.expect(typeof ${val}).to.eql("number"); });`);
      if (def.minimum !== undefined) lines.push(`    pm.test("${path} >= ${def.minimum}", function () { pm.expect(${val}).to.be.at.least(${def.minimum}); });`);
      if (def.maximum !== undefined) lines.push(`    pm.test("${path} <= ${def.maximum}", function () { pm.expect(${val}).to.be.at.most(${def.maximum}); });`);
      lines.push(`  }`);
    } else if (def.type === 'boolean') {
      lines.push(`  if (${val} !== undefined && ${val} !== null) { pm.test("${path} is boolean", function () { pm.expect(typeof ${val}).to.eql("boolean"); }); }`);
    } else if (def.type === 'array') {
      lines.push(`  if (${val} !== undefined && ${val} !== null) { pm.test("${path} is array", function () { pm.expect(${val}).to.be.an("array"); }); }`);
    } else if (def.type === 'object') {
      lines.push(`  if (${val} !== undefined && ${val} !== null) { pm.test("${path} is object", function () { pm.expect(${val}).to.be.an("object"); }); }`);
    }
  }
  return lines;
}

function buildTestScript(spec, method, url, op) {
  const { code, schema } = getSuccessResponse(spec, op);
  const lines = [
    `// Auto-generated from OpenAPI spec: ${op.operationId || op.summary}`,
    `pm.test("Status code is ${code}", function () { pm.response.to.have.status(${code}); });`,
    'pm.test("Content-Type is JSON", function () { pm.expect(pm.response.headers.get("Content-Type")).to.include("application/json"); });',
    'pm.test("Response time < 2000ms", function () { pm.expect(pm.response.responseTime).to.be.below(2000); });',
  ];
  if (schema) {
    lines.push('const jsonData = pm.response.json();');
    lines.push(...generatePropertyTests(schema, 'jsonData', ''));
    if (schema.properties) {
      const listProp = Object.entries(schema.properties).find(([, v]) => v.type === 'array' && v.items?.properties);
      if (listProp) {
        const [arrName, arrDef] = listProp;
        lines.push(`if (jsonData.${arrName} && jsonData.${arrName}.length > 0) {`);
        lines.push(`  const firstItem = jsonData.${arrName}[0];`);
        lines.push(...generatePropertyTests(arrDef.items, 'firstItem', `${arrName}[0]`));
        lines.push('}');
      }
    }
  }
  return lines.join('\n');
}

function injectTests(spec, items) {
  let count = 0;
  for (const item of items) {
    if (item.item) { count += injectTests(spec, item.item); continue; }
    if (!item.request) continue;
    const method = item.request.method;
    const raw = typeof item.request.url === 'string' ? item.request.url : (item.request.url?.raw || '');
    const op = findOperation(spec, method, raw);
    if (!op) continue;
    const script = buildTestScript(spec, method, raw, op);
    item.event = (item.event || []).filter(e => e.listen !== 'test');
    item.event.push({ listen: 'test', script: { type: 'text/javascript', exec: script.split('\n') } });
    console.log(`  Test: ${method} ${raw} -> ${op.operationId}`);
    count++;
  }
  return count;
}

const SPEC_NAME = 'GrubHub Partner Restaurant API';
const COLLECTION_NAME = 'GrubHub Partner Restaurant API';
const ENV_NAME = 'GrubHub Local Dev';
const MONITOR_NAME = 'GrubHub API Health Monitor';

async function findExisting(type, nameField) {
  const resp = await api('GET', `/${type}?workspace=${WORKSPACE_ID}`);
  const items = resp.body[type] || [];
  return items.find(i => i.name === nameField) || null;
}

async function main() {
  const specContent = fs.readFileSync('spec/grubhub-partner-api.yaml', 'utf8');
  const spec = yaml.load(specContent);
  const specJson = JSON.parse(fs.readFileSync('spec/grubhub-partner-api.json', 'utf8'));

  // Step 1: Spec Hub — create or update
  console.log('\n1. Pushing spec to Spec Hub...');
  const existingSpecs = await api('GET', `/specs?workspaceId=${WORKSPACE_ID}`);
  let specId;
  const existingSpec = (existingSpecs.body.specs || []).find(s => s.name === SPEC_NAME);
  if (existingSpec) {
    specId = existingSpec.id;
    console.log(`   Spec exists (${specId}), updating...`);
    const upd = await api('PUT', `/specs/${specId}`, { files: [{ path: 'grubhub-partner-api.yaml', content: specContent }] });
    console.log(`   Update status: ${upd.status}`);
  } else {
    const create = await api('POST', `/specs?workspaceId=${WORKSPACE_ID}`, {
      name: SPEC_NAME,
      type: 'OPENAPI:3.0',
      files: [{ path: 'grubhub-partner-api.yaml', content: specContent }]
    });
    specId = create.body.id;
    console.log(`   Created spec: ${specId} (status: ${create.status})`);
  }

  // Step 2: Collection — find existing or import new
  console.log('\n2. Resolving collection...');
  const existingCol = await findExisting('collections', COLLECTION_NAME);
  let collectionUid;
  if (existingCol) {
    collectionUid = existingCol.uid;
    console.log(`   Collection exists: ${collectionUid}, will update tests in place`);
  } else {
    const importResp = await api('POST', `/import/openapi?workspace=${WORKSPACE_ID}`, {
      type: 'json',
      input: specJson,
      options: { folderStrategy: 'Tags', requestParameterGeneration: 'Example' }
    });
    if (importResp.status !== 200 || !importResp.body.collections?.length) {
      console.error('   Import failed:', importResp.status, JSON.stringify(importResp.body));
      process.exit(1);
    }
    collectionUid = importResp.body.collections[0].uid;
    console.log(`   Collection created: ${collectionUid}`);
  }

  // Step 3: Inject/refresh test scripts
  console.log('\n3. Injecting spec-derived test scripts...');
  const colResp = await api('GET', `/collections/${collectionUid}`);
  const collection = colResp.body.collection;
  const testCount = injectTests(spec, collection.item);
  console.log(`   Generated tests for ${testCount} requests`);

  const putResp = await api('PUT', `/collections/${collectionUid}`, { collection });
  console.log(`   Collection updated: ${putResp.status}`);

  // Step 4: Environment — find existing or create
  console.log('\n4. Resolving environment...');
  const existingEnv = await findExisting('environments', ENV_NAME);
  let envUid;
  if (existingEnv) {
    envUid = existingEnv.uid;
    console.log(`   Environment exists: ${envUid}, updating values...`);
    await api('PUT', `/environments/${envUid}`, {
      environment: {
        name: ENV_NAME,
        values: [
          { key: 'baseUrl', value: 'http://localhost:3000/api/v1', type: 'default', enabled: true },
          { key: 'apiKey', value: 'grubhub-demo-key-2026', type: 'secret', enabled: true },
          { key: 'restaurantId', value: 'rest-001', type: 'default', enabled: true },
          { key: 'orderId', value: 'order-001', type: 'default', enabled: true }
        ]
      }
    });
    console.log(`   Environment updated`);
  } else {
    const envResp = await api('POST', `/environments?workspace=${WORKSPACE_ID}`, {
      environment: {
        name: ENV_NAME,
        values: [
          { key: 'baseUrl', value: 'http://localhost:3000/api/v1', type: 'default', enabled: true },
          { key: 'apiKey', value: 'grubhub-demo-key-2026', type: 'secret', enabled: true },
          { key: 'restaurantId', value: 'rest-001', type: 'default', enabled: true },
          { key: 'orderId', value: 'order-001', type: 'default', enabled: true }
        ]
      }
    });
    envUid = envResp.body.environment.uid;
    console.log(`   Environment created: ${envUid}`);
  }

  // Step 5: Monitor — find existing or create
  console.log('\n5. Resolving monitor...');
  const existingMon = await findExisting('monitors', MONITOR_NAME);
  let monUid;
  if (existingMon) {
    monUid = existingMon.uid;
    console.log(`   Monitor exists: ${monUid}, updating...`);
    await api('PUT', `/monitors/${monUid}`, {
      monitor: {
        name: MONITOR_NAME,
        collection: collectionUid,
        environment: envUid,
        schedule: { cron: '0 0 * * *', timezone: 'America/Chicago' }
      }
    });
    console.log(`   Monitor updated`);
  } else {
    const monResp = await api('POST', `/monitors?workspace=${WORKSPACE_ID}`, {
      monitor: {
        name: MONITOR_NAME,
        collection: collectionUid,
        environment: envUid,
        schedule: { cron: '0 0 * * *', timezone: 'America/Chicago' }
      }
    });
    monUid = monResp.body.monitor?.uid;
    console.log(`   Monitor created: ${monUid} (status: ${monResp.status})`);
  }

  // Summary
  console.log('\n=== ONBOARDING COMPLETE ===');
  console.log(`Spec Hub:     ${specId}`);
  console.log(`Collection:   ${collectionUid} (${testCount} tests)`);
  console.log(`Environment:  ${envUid}`);
  console.log(`Monitor:      ${monUid}`);
  console.log(`Workspace:    ${WORKSPACE_ID}`);
}

main().catch(err => { console.error('FAILED:', err.message); process.exit(1); });
