import { webcrypto } from 'node:crypto';
import { createAdminSession } from '../functions/lib/admin.js';
import { buildRuntimeIndex, classifyDeterministic } from '../functions/lib/deterministic.js';
import {
  RULES_KEY,
  baselineDeterministicRules,
  validateRulesBundle,
} from '../functions/lib/rules-bundle.js';
import {
  onRequestGet,
  onRequestPost,
  onRequestPut,
} from '../functions/api/rules.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!globalThis.btoa) globalThis.btoa = (value) => Buffer.from(value, 'binary').toString('base64');
if (!globalThis.atob) globalThis.atob = (value) => Buffer.from(value, 'base64').toString('binary');

const instructions = `High -> Manual check No. Medium -> Yes. Low -> Yes. rec. can never be High. ${'Preserve approved operational rules and exact brand mappings. '.repeat(30)}`;
const knowledge = `## 7. Explicit RC I Football Leagues\n\n1. Test League - Testland\n\n## 8. End\n\nTennis SRL / Simulated Reality operational exception.\n${'Canonical knowledge line. '.repeat(150)}`;
const bundle = {
  schemaVersion: 1,
  version: 'rules-v1',
  instructions,
  knowledge,
  deterministicRules: baselineDeterministicRules(),
};

let validation = validateRulesBundle(bundle);
assert(validation.valid, `Baseline bundle should validate: ${validation.errors.join('; ')}`);

const changed = clone(bundle);
changed.version = 'rules-v2';
const golfRule = changed.deterministicRules.rules.find((item) => item.id === 'golf-pga-dp-liv');
golfRule.dazn = 'RC C';
golfRule.quinnbet = 'RC C';
golfRule.nti = 'RC C';
validation = validateRulesBundle(changed);
assert(validation.valid, 'A valid data-only Golf rule change should pass validation');
let result = classifyDeterministic({ sport:'Golf', competition:'PGA Tour 2026 - 3M Open' }, buildRuntimeIndex(changed));
assert(result?.dazn === 'RC C' && result?.quinnbet === 'RC C' && result?.nti === 'RC C', 'Deterministic engine must read updated values from bundle data');

const invalidSrl = clone(bundle);
invalidSrl.deterministicRules.rules.find((item) => item.id === 'tennis-srl').dazn = 'RC G';
validation = validateRulesBundle(invalidSrl);
assert(!validation.valid && validation.errors.some((text) => text.includes('tennis-srl')), 'SRL H/H/H safeguard must block invalid publish');

const legacy = { version:'legacy-v0', instructions, knowledge };
const kv = new MockKv({ [RULES_KEY]: JSON.stringify(legacy) });
const env = { RISK_ADMIN_PIN:'2468', OPENAI_API_KEY:'test-openai-secret', RISK_RULES:kv };
const token = await createAdminSession(env);
const cookie = `rc_admin=${token}`;

let response = await onRequestGet(context('GET', null, cookie));
let data = await response.json();
assert(response.status === 200 && data.bundle?.deterministicRules?.rules?.length > 0, 'Rules GET should auto-migrate legacy bundle to managed schema');
const migratedStored = JSON.parse(await kv.get(RULES_KEY));
assert(migratedStored.schemaVersion === 1 && migratedStored.deterministicRules, 'Legacy migration must persist the structured deterministic source in KV');

const proposed = clone(data.bundle);
proposed.version = 'rules-v2';
const proposedGolf = proposed.deterministicRules.rules.find((item) => item.id === 'golf-pga-dp-liv');
proposedGolf.dazn = 'RC C';
proposedGolf.quinnbet = 'RC C';
proposedGolf.nti = 'RC C';

response = await onRequestPost(context('POST', { bundle: proposed }, cookie));
data = await response.json();
assert(response.status === 200 && data.validation.valid && data.diff?.deterministic?.changed?.includes('golf-pga-dp-liv'), 'Validate endpoint must report deterministic rule diff');

response = await onRequestPut(context('PUT', { action:'publish', bundle:proposed }, cookie));
data = await response.json();
assert(response.status === 200 && data.ok && data.bundle.version === 'rules-v2', 'Publish should write new global canonical bundle');
assert((data.history || []).length === 1, 'Publish should archive the previous version');
const historyKey = data.history[0].key;
const storedPublished = JSON.parse(await kv.get(RULES_KEY));
result = classifyDeterministic({ sport:'Golf', competition:'PGA Tour 2026 - 3M Open' }, buildRuntimeIndex(storedPublished));
assert(result?.dazn === 'RC C', 'Published structured rule must drive deterministic classification without code change');

response = await onRequestPut(context('PUT', { action:'rollback', historyKey }, cookie));
data = await response.json();
assert(response.status === 200 && data.ok && data.action === 'rollback', 'Rollback should succeed for archived snapshot');
const rolledBack = JSON.parse(await kv.get(RULES_KEY));
result = classifyDeterministic({ sport:'Golf', competition:'PGA Tour 2026 - 3M Open' }, buildRuntimeIndex(rolledBack));
assert(result?.dazn === 'RC B', 'Rollback must restore prior deterministic behavior');

response = await onRequestGet(context('GET'));
assert(response.status === 401, 'Rules Manager API must require admin session');

console.log('rules manager smoke tests passed (10 checks)');

function context(method, body, cookieValue = '') {
  const headers = {};
  if (body != null) headers['content-type'] = 'application/json';
  if (cookieValue) headers.cookie = cookieValue;
  return {
    env,
    request: new Request('https://example.test/api/rules', {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
    }),
  };
}

class MockKv {
  constructor(seed = {}) { this.map = new Map(Object.entries(seed)); }
  async get(key) { return this.map.has(key) ? this.map.get(key) : null; }
  async put(key, value) { this.map.set(key, String(value)); }
  async delete(key) { this.map.delete(key); }
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function assert(condition, message) { if (!condition) throw new Error(message); }
