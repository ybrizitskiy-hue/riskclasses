import { webcrypto } from 'node:crypto';
import { createAdminSession } from '../functions/lib/admin.js';
import {
  PROVIDER_CONFIG_KEY,
  defaultProviderConfig,
  validateProviderConfig,
} from '../functions/lib/provider-config.js';
import { callAiJson, profileEndpoint } from '../functions/lib/ai-client.js';
import { onRequestGet, onRequestPost, onRequestPut } from '../functions/api/providers.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!globalThis.btoa) globalThis.btoa = (value) => Buffer.from(value, 'binary').toString('base64');
if (!globalThis.atob) globalThis.atob = (value) => Buffer.from(value, 'base64').toString('binary');

const schema = {
  type: 'object', additionalProperties: false, required: ['status'],
  properties: { status: { type: 'string' } },
};

const direct = defaultProviderConfig({ OPENAI_API_KEY: 'openai-test' });
let validation = validateProviderConfig(direct, { OPENAI_API_KEY: 'openai-test' });
assert(validation.valid, `Default provider config must validate: ${validation.errors.join('; ')}`);
assert(direct.routes.auto.primary === 'openai-luna-direct' && direct.routes.auto.escalation === 'openai-terra-direct', 'Default Auto route must preserve Luna → Terra behavior');

const cfProfile = {
  id: 'cf-primary', label: 'Cloudflare primary', transport: 'cloudflare-rest', protocol: 'responses',
  model: 'openai/test-model', providerSlug: '', pathPrefix: '', byokAlias: 'production',
  capabilities: { vision:true, jsonSchema:true, reasoning:true, webSearch:false, promptCache:false, store:false },
  pricing: { input:1, cached:0.1, output:2, webSearch:null },
};
const cfConfig = {
  schemaVersion: 1, version: 'providers-cf-test', cloudflare: { accountId:'abc123account', gatewayId:'riskclasses' },
  profiles: [cfProfile],
  routes: {
    economy:{ extraction:'cf-primary', primary:'cf-primary', research:null, escalation:null },
    auto:{ extraction:'cf-primary', primary:'cf-primary', research:null, escalation:null },
    quality:{ extraction:'cf-primary', primary:'cf-primary', research:null, escalation:null },
  },
};
const cfEnv = { CF_AI_GATEWAY_TOKEN:'cf-run-token' };
validation = validateProviderConfig(cfConfig, cfEnv);
assert(validation.valid, `Cloudflare REST config must validate: ${validation.errors.join('; ')}`);
assert(profileEndpoint(cfConfig, cfProfile, cfEnv) === 'https://api.cloudflare.com/client/v4/accounts/abc123account/ai/v1/responses', 'Cloudflare REST endpoint mismatch');

let captured = null;
globalThis.fetch = async (url, init) => {
  captured = { url, init, body: JSON.parse(init.body) };
  return new Response(JSON.stringify({
    model:'openai/test-model',
    usage:{ input_tokens:100, input_tokens_details:{cached_tokens:20}, output_tokens:10, output_tokens_details:{reasoning_tokens:2} },
    output:[{ type:'message', content:[{ type:'output_text', text:'{"status":"ok"}' }] }],
  }), { status:200, headers:{'content-type':'application/json'} });
};
let result = await callAiJson({
  env:cfEnv, config:cfConfig, profile:cfProfile, reasoning:'low', stage:'test',
  input:[{role:'user',content:[{type:'input_text',text:'test'}]}], schema, schemaName:'test_schema', useWeb:false,
});
assert(result.ok && result.result.status === 'ok', 'Cloudflare REST Responses request should parse');
assert(captured.url.includes('/accounts/abc123account/ai/v1/responses'), 'Cloudflare REST request URL is wrong');
assert(captured.init.headers.authorization === 'Bearer cf-run-token', 'Cloudflare REST must use CF token in Authorization');
assert(captured.init.headers['cf-aig-gateway-id'] === 'riskclasses', 'Cloudflare REST must select configured gateway');
assert(captured.init.headers['cf-aig-byok-alias'] === 'production', 'Cloudflare REST must forward BYOK alias');
assert(!('store' in captured.body) && !('prompt_cache_key' in captured.body), 'Disabled compatibility fields must not be sent');

const chatProfile = {
  id:'custom-chat', label:'Custom Chat', transport:'cloudflare-provider', protocol:'chat-completions',
  model:'alt-model', providerSlug:'custom-alt', pathPrefix:'v1', byokAlias:'default',
  capabilities:{ vision:true, jsonSchema:true, reasoning:false, webSearch:false, promptCache:false, store:false },
  pricing:{ input:null, cached:null, output:null, webSearch:null },
};
const chatConfig = JSON.parse(JSON.stringify(cfConfig));
chatConfig.profiles = [chatProfile];
for (const mode of ['auto','economy','quality']) chatConfig.routes[mode] = { extraction:'custom-chat', primary:'custom-chat', research:null, escalation:null };
validation = validateProviderConfig(chatConfig, cfEnv);
assert(validation.valid, `Custom Chat config must validate: ${validation.errors.join('; ')}`);

globalThis.fetch = async (url, init) => {
  captured = { url, init, body: JSON.parse(init.body) };
  return new Response(JSON.stringify({
    model:'alt-model', usage:{ prompt_tokens:50, completion_tokens:5 },
    choices:[{ message:{ content:'{"status":"ok"}' } }],
  }), { status:200, headers:{'content-type':'application/json'} });
};
result = await callAiJson({
  env:cfEnv, config:chatConfig, profile:chatProfile, reasoning:'low', stage:'chat-test',
  input:[{role:'developer',content:[{type:'input_text',text:'system'}]},{role:'user',content:[{type:'input_text',text:'test'}]}],
  schema, schemaName:'test_schema', useWeb:true,
});
assert(result.ok, 'Custom Chat Completions request should parse');
assert(captured.url === 'https://gateway.ai.cloudflare.com/v1/abc123account/riskclasses/custom-alt/v1/chat/completions', 'Custom provider endpoint mismatch');
assert(captured.init.headers['cf-aig-authorization'] === 'Bearer cf-run-token', 'Provider-native gateway must use cf-aig-authorization');
assert(captured.body.response_format?.type === 'json_schema', 'Chat compatibility must use JSON schema response_format');
assert(!captured.body.tools, 'Generic Chat Completions must not receive Responses web_search tool');

const kv = new MockKv({ [PROVIDER_CONFIG_KEY]: JSON.stringify(cfConfig) });
const adminEnv = {
  RISK_ADMIN_PIN:'1703', RISK_ADMIN_SIGNING_SECRET:'test-signing-secret-with-enough-entropy',
  CF_AI_GATEWAY_TOKEN:'cf-run-token', RISK_RULES:kv,
};
let response = await onRequestGet(context('GET', null, '', adminEnv));
assert(response.status === 401, 'Provider API must require admin session');
const token = await createAdminSession(adminEnv);
const cookie = `rc_admin=${token}`;
response = await onRequestGet(context('GET', null, cookie, adminEnv));
let data = await response.json();
assert(response.status === 200 && data.config?.version === 'providers-cf-test', 'Admin should load provider config');
assert(data.environment.cloudflareGatewayTokenConfigured === true, 'Provider API must report CF token readiness without exposing it');

const published = JSON.parse(JSON.stringify(cfConfig));
published.cloudflare.gatewayId = 'new-gateway';
response = await onRequestPut(context('PUT', { action:'publish', config:published }, cookie, adminEnv));
data = await response.json();
assert(response.status === 200 && data.ok && data.config.cloudflare.gatewayId === 'new-gateway', 'Admin should publish provider config globally');
const stored = JSON.parse(await kv.get(PROVIDER_CONFIG_KEY));
assert(stored.cloudflare.gatewayId === 'new-gateway', 'Published provider config must persist to KV');

console.log('provider manager smoke tests passed (18 checks)');

function context(method, body, cookieValue, env) {
  const headers = {};
  if (body != null) headers['content-type'] = 'application/json';
  if (cookieValue) headers.cookie = cookieValue;
  return {
    env,
    request:new Request('https://example.test/api/providers', {
      method, headers, body:body == null ? undefined : JSON.stringify(body),
    }),
  };
}

class MockKv {
  constructor(seed = {}) { this.map = new Map(Object.entries(seed)); }
  async get(key) { return this.map.has(key) ? this.map.get(key) : null; }
  async put(key, value) { this.map.set(key, String(value)); }
  async delete(key) { this.map.delete(key); }
}

function assert(condition, message) { if (!condition) throw new Error(message); }
