import { webcrypto } from 'node:crypto';
import { createAdminSession } from '../functions/lib/admin.js';
import { callAiJson } from '../functions/lib/ai-client.js';
import {
  REASONING_CONFIG_KEY,
  defaultReasoningConfig,
  effortFor,
  loadReasoningConfig,
  normalizeReasoningConfig,
  saveReasoningConfig,
  validateReasoningConfig,
} from '../functions/lib/reasoning-config.js';
import { onRequestGet, onRequestPost, onRequestPut } from '../functions/api/reasoning.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!globalThis.btoa) globalThis.btoa = (value) => Buffer.from(value, 'binary').toString('base64');
if (!globalThis.atob) globalThis.atob = (value) => Buffer.from(value, 'base64').toString('binary');

class MockKv {
  constructor(seed = {}) { this.map = new Map(Object.entries(seed)); }
  async get(key) { return this.map.has(key) ? this.map.get(key) : null; }
  async put(key, value) { this.map.set(key, String(value)); }
  async delete(key) { this.map.delete(key); }
}

const defaults = defaultReasoningConfig();
let validation = validateReasoningConfig(defaults);
assert(validation.valid, `Default reasoning config must validate: ${validation.errors.join('; ')}`);
for (const mode of ['economy','auto','quality']) {
  assert(defaults.modes[mode].extraction === 'low', `${mode} extraction must preserve the previous Low default`);
  for (const role of ['primary','research','escalation']) {
    assert(defaults.modes[mode][role] === 'medium', `${mode}.${role} must preserve the previous Medium default`);
  }
}
assert(effortFor(defaults, 'auto', 'primary') === 'medium', 'Configured Medium effort should resolve as medium');
defaults.modes.auto.primary = 'none';
assert(effortFor(defaults, 'auto', 'primary') === null, 'None must omit the reasoning parameter rather than send a provider-specific value');

const invalid = normalizeReasoningConfig(defaultReasoningConfig());
invalid.modes.quality.escalation = 'max';
validation = validateReasoningConfig(invalid);
assert(!validation.valid && validation.errors.some((text) => text.includes('quality.escalation')), 'Unsupported reasoning effort must fail validation');

const kv = new MockKv();
const env = { RISK_RULES: kv };
const fallback = await loadReasoningConfig(env);
assert(fallback.version === 'reasoning-v1' && !kv.map.has(REASONING_CONFIG_KEY), 'Missing KV config must use backwards-compatible defaults without an automatic write');

const custom = defaultReasoningConfig();
custom.version = 'reasoning-test';
custom.modes.economy.primary = 'low';
custom.modes.auto.escalation = 'high';
custom.modes.quality.primary = 'none';
const saved = await saveReasoningConfig(env, custom);
assert(saved.modes.economy.primary === 'low' && saved.modes.auto.escalation === 'high', 'Custom reasoning efforts must save to KV');
const stored = JSON.parse(await kv.get(REASONING_CONFIG_KEY));
assert(stored.modes.quality.primary === 'none', 'None effort must persist in the global KV config');

const schema = {
  type: 'object', additionalProperties: false, required: ['status'],
  properties: { status: { type: 'string' } },
};
const responsesProfile = {
  id:'reasoning-responses', label:'Reasoning Responses', transport:'openai-direct', protocol:'responses', model:'test-model',
  providerSlug:'openai', baseUrl:'', pathPrefix:'', byokAlias:'', webSearchMode:'responses',
  capabilities:{ vision:false, jsonSchema:true, reasoning:true, webSearch:false, promptCache:false, store:false },
  pricing:{ input:null, cached:null, output:null, webSearch:null },
};
const providerConfig = { cloudflare:{ accountId:'', gatewayId:'default' } };
let captured = null;
globalThis.fetch = async (url, init) => {
  captured = { url, body:JSON.parse(init.body) };
  return new Response(JSON.stringify({
    model:'test-model', usage:{ input_tokens:10, output_tokens:2 },
    output:[{ type:'message', content:[{ type:'output_text', text:'{"status":"ok"}' }] }],
  }), { status:200, headers:{'content-type':'application/json'} });
};
let result = await callAiJson({
  env:{ OPENAI_API_KEY:'test-key' }, config:providerConfig, profile:responsesProfile, reasoning:null, stage:'none-test',
  input:[{role:'user',content:[{type:'input_text',text:'test'}]}], schema, schemaName:'reasoning_test', useWeb:false,
});
assert(result.ok && !('reasoning' in captured.body), 'Responses request must omit reasoning when effort is None');
result = await callAiJson({
  env:{ OPENAI_API_KEY:'test-key' }, config:providerConfig, profile:responsesProfile, reasoning:'high', stage:'high-test',
  input:[{role:'user',content:[{type:'input_text',text:'test'}]}], schema, schemaName:'reasoning_test', useWeb:false,
});
assert(result.ok && captured.body.reasoning?.effort === 'high', 'Responses request must forward the selected High effort');

const chatProfile = { ...responsesProfile, id:'reasoning-chat', label:'Reasoning Chat', protocol:'chat-completions', webSearchMode:'chat-tools' };
globalThis.fetch = async (url, init) => {
  captured = { url, body:JSON.parse(init.body) };
  return new Response(JSON.stringify({
    model:'test-model', usage:{ prompt_tokens:10, completion_tokens:2 },
    choices:[{ message:{ content:'{"status":"ok"}' } }],
  }), { status:200, headers:{'content-type':'application/json'} });
};
result = await callAiJson({
  env:{ OPENAI_API_KEY:'test-key' }, config:providerConfig, profile:chatProfile, reasoning:null, stage:'chat-none-test',
  input:[{role:'user',content:[{type:'input_text',text:'test'}]}], schema, schemaName:'reasoning_test', useWeb:false,
});
assert(result.ok && !('reasoning_effort' in captured.body), 'Chat request must omit reasoning_effort when effort is None');
result = await callAiJson({
  env:{ OPENAI_API_KEY:'test-key' }, config:providerConfig, profile:chatProfile, reasoning:'low', stage:'chat-low-test',
  input:[{role:'user',content:[{type:'input_text',text:'test'}]}], schema, schemaName:'reasoning_test', useWeb:false,
});
assert(result.ok && captured.body.reasoning_effort === 'low', 'Chat request must forward the selected Low effort');

const adminKv = new MockKv({ [REASONING_CONFIG_KEY]: JSON.stringify(saved) });
const adminEnv = {
  RISK_ADMIN_PIN:'1703',
  RISK_ADMIN_SIGNING_SECRET:'test-signing-secret-with-enough-entropy',
  RISK_RULES:adminKv,
};
let response = await onRequestGet(context('GET', null, '', adminEnv));
assert(response.status === 401, 'Reasoning API must require an admin session');
const token = await createAdminSession(adminEnv);
const cookie = `rc_admin=${token}`;
response = await onRequestGet(context('GET', null, cookie, adminEnv));
let data = await response.json();
assert(response.status === 200 && data.config?.version === saved.version, 'Admin must be able to load reasoning config');

const publishCandidate = JSON.parse(JSON.stringify(saved));
publishCandidate.modes.quality.primary = 'high';
response = await onRequestPost(context('POST', { action:'validate', config:publishCandidate }, cookie, adminEnv));
data = await response.json();
assert(response.status === 200 && data.validation?.valid, 'Admin validation must accept a valid reasoning draft');
response = await onRequestPut(context('PUT', { action:'publish', config:publishCandidate }, cookie, adminEnv));
data = await response.json();
assert(response.status === 200 && data.ok && data.config.modes.quality.primary === 'high', 'Admin must publish reasoning settings globally');
const published = JSON.parse(await adminKv.get(REASONING_CONFIG_KEY));
assert(published.modes.quality.primary === 'high', 'Published reasoning config must persist to KV');

console.log('reasoning configuration smoke tests passed (27 checks)');

function context(method, body, cookieValue, targetEnv) {
  const headers = {};
  if (body != null) headers['content-type'] = 'application/json';
  if (cookieValue) headers.cookie = cookieValue;
  return { env:targetEnv, request:new Request('https://example.test/api/reasoning', { method, headers, body:body == null ? undefined : JSON.stringify(body) }) };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
