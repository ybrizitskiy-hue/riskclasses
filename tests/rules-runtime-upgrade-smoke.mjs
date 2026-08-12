import { webcrypto } from 'node:crypto';
import { createAdminSession } from '../functions/lib/admin.js';
import { buildRuntimeIndex, classifyDeterministic } from '../functions/lib/deterministic.js';
import { RULES_KEY, baselineDeterministicRules, loadCurrentRulesBundle } from '../functions/lib/rules-bundle.js';
import { onRequestGet, onRequestPost, onRequestPut } from '../functions/api/rules.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!globalThis.btoa) globalThis.btoa = (value) => Buffer.from(value, 'binary').toString('base64');
if (!globalThis.atob) globalThis.atob = (value) => Buffer.from(value, 'base64').toString('binary');

let checks = 0;

class MockKv {
  constructor(seed = {}) { this.map = new Map(Object.entries(seed)); }
  async get(key) { return this.map.has(key) ? this.map.get(key) : null; }
  async put(key, value) { this.map.set(key, String(value)); }
  async delete(key) { this.map.delete(key); }
}

const instructions = `High -> Manual check No normally. Tennis or Snooker without an explicit match round keeps exact classes High with Manual check Yes and Basis Round not provided — manual check required. ${'Preserve approved operational rules and exact brand mappings. '.repeat(30)}`;
const knowledge = `## 7. Explicit RC I Football Leagues\n\n1. Test League - Testland\n\n## 8. End\n\nTennis SRL / Simulated Reality operational exception. ${'Canonical knowledge line. '.repeat(150)}`;
const staleRules = baselineDeterministicRules();
staleRules.engineVersion = 1;
staleRules.rules = staleRules.rules.filter((rule) => !rule.providers?.length);
const staleBundle = {
  schemaVersion: 1,
  version: 'stale-provider-rules',
  instructions,
  knowledge,
  deterministicRules: staleRules,
};
const candidate = {
  schemaVersion: 1,
  version: 'provider-round-candidate',
  instructions,
  knowledge,
  deterministicRules: baselineDeterministicRules(),
};


const wrongV2Rules = baselineDeterministicRules();
wrongV2Rules.engineVersion = 2;
const wrongBetradar = wrongV2Rules.rules.find((rule) => rule.id === 'tennis-br-challenger-singles');
wrongBetradar.dazn = 'RC E';
wrongBetradar.quinnbet = 'RC E';
wrongBetradar.nti = 'RC G';
wrongBetradar.match.all.push('\\bsingles?\\b');
const wrongV2Bundle = {
  schemaVersion: 1,
  version: 'wrong-v2-betradar-challenger',
  instructions,
  knowledge,
  deterministicRules: wrongV2Rules,
};
const upgradedRuntime = await loadCurrentRulesBundle({
  async get(key) { return key === RULES_KEY ? JSON.stringify(wrongV2Bundle) : null; },
});
assert(upgradedRuntime.deterministicRules.engineVersion === 3, 'Runtime must upgrade an engine-v2 provider bundle to v3');
const correctedBetradar = classifyDeterministic({
  sport: 'Tennis',
  competition: 'ATP Challenger Nonthaburi 4, Thailand Men Singles - Challenger',
  competitionId: 'U-12680',
}, buildRuntimeIndex(upgradedRuntime));
assert(correctedBetradar?.dazn === 'RC G' && correctedBetradar?.quinnbet === 'RC F' && correctedBetradar?.nti === 'RC G', 'Runtime upgrade must replace an incorrect Betradar Challenger E/E/G rule with G/F/G');

const kv = new MockKv({ [RULES_KEY]: JSON.stringify(staleBundle) });
const env = { RISK_ADMIN_PIN: '2468', OPENAI_API_KEY: 'test-openai-secret', RISK_RULES: kv };
const token = await createAdminSession(env);
const cookie = `rc_admin=${token}`;

let response = await onRequestGet(context('GET', null, cookie));
let data = await response.json();
assert(response.status === 200 && data.ok, 'Rules GET must succeed');
assert(data.bundle.deterministicRules.engineVersion === 1, 'Rules GET must expose the exact stored engine version');
assert(!hasProviderRule(data.bundle), 'Rules GET must not inject runtime-only provider rules');
assert(data.gptGuide.includes('Tennis or Snooker with no explicit match round'), 'Rules GPT guide must include the High/Yes round exception');
assert(data.gptGuide.includes('Round not provided — manual check required'), 'Rules GPT guide must include the exact Basis wording');

response = await onRequestPost(context('POST', { bundle: candidate }, cookie));
data = await response.json();
assert(response.status === 200 && data.ok && data.validation.valid, 'Candidate validation must succeed');
assert(data.diff.deterministic.added.length === 16, 'Rules diff must show all 16 provider Tennis rules as additions');
assert(data.diff.deterministic.added.includes('tennis-br-challenger-singles'), 'Rules diff must include the Betradar Challenger rule');

response = await onRequestPut(context('PUT', { action: 'publish', bundle: candidate }, cookie));
data = await response.json();
assert(response.status === 200 && data.ok, 'Candidate publish must succeed');
assert(data.history.length === 1, 'Publish must archive one exact prior snapshot');
const historyKey = data.history[0].key;
const archived = JSON.parse(await kv.get(historyKey));
assert(archived.deterministicRules.engineVersion === 1, 'Archived snapshot must retain the actual prior engine version');
assert(!hasProviderRule(archived), 'Archived snapshot must not contain runtime-only provider rules');
assert(hasProviderRule(JSON.parse(await kv.get(RULES_KEY))), 'Published bundle must contain the provider rules');

response = await onRequestPut(context('PUT', { action: 'rollback', historyKey }, cookie));
data = await response.json();
assert(response.status === 200 && data.ok && data.action === 'rollback', 'Rollback must succeed');
const rolledBack = JSON.parse(await kv.get(RULES_KEY));
assert(rolledBack.version === staleBundle.version && !hasProviderRule(rolledBack), 'Rollback must restore the exact stored stale bundle');

console.log(`rules runtime-upgrade smoke tests passed (${checks} checks)`);

function hasProviderRule(bundle) {
  return Boolean(bundle?.deterministicRules?.rules?.some((rule) => rule.id === 'tennis-br-challenger-singles'));
}

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

function assert(condition, message) {
  checks += 1;
  if (!condition) throw new Error(message);
}
