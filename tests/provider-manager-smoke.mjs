import { webcrypto } from 'node:crypto';
import { createAdminSession } from '../functions/lib/admin.js';
import {
  PROVIDER_CONFIG_KEY,
  defaultProviderConfig,
  normalizeProviderConfig,
  validateProviderConfig,
} from '../functions/lib/provider-config.js';
import { callAiJson, profileEndpoint } from '../functions/lib/ai-client.js';
import { syncManagedCustomProviders } from '../functions/lib/cloudflare-provider-admin.js';
import { onRequestGet, onRequestPost, onRequestPut } from '../functions/api/providers.js';
import { onRequestPost as saveProviderKey } from '../functions/api/provider-key.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!globalThis.btoa) globalThis.btoa = (value) => Buffer.from(value, 'binary').toString('base64');
if (!globalThis.atob) globalThis.atob = (value) => Buffer.from(value, 'base64').toString('binary');

class MockKv {
  constructor(seed = {}) { this.map = new Map(Object.entries(seed)); }
  async get(key) { return this.map.has(key) ? this.map.get(key) : null; }
  async put(key, value) { this.map.set(key, String(value)); }
  async delete(key) { this.map.delete(key); }
}

const schema = {
  type: 'object', additionalProperties: false, required: ['status'],
  properties: { status: { type: 'string' } },
};

const direct = defaultProviderConfig({ OPENAI_API_KEY: 'test-only-openai-key-placeholder' });
let validation = validateProviderConfig(direct, { OPENAI_API_KEY: 'test-only-openai-key-placeholder' });
assert(validation.valid, `Default provider config must validate: ${validation.errors.join('; ')}`);
assert(direct.routes.auto.primary === 'openai-luna-direct' && direct.routes.auto.escalation === 'openai-terra-direct', 'Default Auto route must preserve Luna → Terra behavior');

const cfProfile = {
  id: 'cf-primary', label: 'Cloudflare primary', transport: 'cloudflare-rest', protocol: 'responses',
  model: 'openai/test-model', providerSlug: '', baseUrl:'', pathPrefix: '', byokAlias: 'production',
  capabilities: { vision:true, jsonSchema:true, reasoning:true, webSearch:false, promptCache:false, store:false },
  pricing: { input:1, cached:0.1, output:2, webSearch:null },
};
const cfConfig = {
  schemaVersion: 1, version: 'providers-cf-test', cloudflare: { accountId:'test-account-id', gatewayId:'test-gateway-id' },
  profiles: [cfProfile],
  routes: {
    economy:{ extraction:'cf-primary', primary:'cf-primary', research:null, escalation:null },
    auto:{ extraction:'cf-primary', primary:'cf-primary', research:null, escalation:null },
    quality:{ extraction:'cf-primary', primary:'cf-primary', research:null, escalation:null },
  },
};
// Non-secret fixture values; the provider requests below use stubbed fetch calls.
const cfEnv = { CF_AI_GATEWAY_TOKEN:'test-only-gateway-token-placeholder' };
validation = validateProviderConfig(cfConfig, cfEnv);
assert(validation.valid, `Cloudflare REST config must validate: ${validation.errors.join('; ')}`);
assert(profileEndpoint(cfConfig, cfProfile, cfEnv) === 'https://api.cloudflare.com/client/v4/accounts/test-account-id/ai/v1/responses', 'Cloudflare REST endpoint mismatch');

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
assert(captured.url.includes('/accounts/test-account-id/ai/v1/responses'), 'Cloudflare REST request URL is wrong');
assert(captured.init.headers.authorization === 'Bearer test-only-gateway-token-placeholder', 'Cloudflare REST must use the test-only gateway token placeholder in Authorization');
assert(captured.init.headers['cf-aig-gateway-id'] === 'test-gateway-id', 'Cloudflare REST must select the configured test gateway');
assert(captured.init.headers['cf-aig-byok-alias'] === 'production', 'Cloudflare REST must forward BYOK alias');
assert(!('store' in captured.body) && !('prompt_cache_key' in captured.body), 'Disabled compatibility fields must not be sent');

const chatProfile = {
  id:'custom-chat', label:'Custom Chat', transport:'cloudflare-provider', protocol:'chat-completions',
  model:'alt-model', providerSlug:'custom-alt', baseUrl:'https://api.alt.test', pathPrefix:'v1', byokAlias:'default', sessionHeader:'x-opencode-session',
  capabilities:{ vision:true, jsonSchema:true, reasoning:false, webSearch:false, promptCache:false, store:false },
  pricing:{ input:null, cached:null, output:null, webSearch:null },
};
const chatConfig = JSON.parse(JSON.stringify(cfConfig));
chatConfig.profiles = [chatProfile];
for (const mode of ['auto','economy','quality']) chatConfig.routes[mode] = { extraction:'custom-chat', primary:'custom-chat', research:null, escalation:null };
validation = validateProviderConfig(chatConfig, { ...cfEnv, CF_AI_GATEWAY_ADMIN_TOKEN:'test-only-admin-token-placeholder' });
assert(validation.valid, `Custom Chat config must validate: ${validation.errors.join('; ')}`);

globalThis.fetch = async (url, init) => {
  captured = { url, init, body: JSON.parse(init.body) };
  return chatOkResponse();
};
result = await callAiJson({
  env:cfEnv, config:chatConfig, profile:chatProfile, reasoning:'low', stage:'chat-test',
  input:[{role:'developer',content:[{type:'input_text',text:'system'}]},{role:'user',content:[{type:'input_text',text:'test'}]}],
  schema, schemaName:'test_schema', useWeb:true,
});
assert(result.ok, 'Custom Chat Completions request should parse');
assert(captured.url === 'https://gateway.ai.cloudflare.com/v1/test-account-id/test-gateway-id/custom-alt/v1/chat/completions', 'Custom provider endpoint mismatch');
assert(captured.init.headers['cf-aig-authorization'] === 'Bearer test-only-gateway-token-placeholder', 'Provider-native gateway must use the test-only gateway token placeholder');
assert(/^ses_/.test(captured.init.headers['x-opencode-session']), 'Custom provider must send a generated x-opencode-session header');
assert(captured.body.response_format?.type === 'json_schema', 'Chat compatibility must use JSON schema response_format');
assert(!captured.body.tools, 'Generic Chat Completions must not receive Responses web_search tool');

captured = null;
result = await callAiJson({
  env:cfEnv, config:chatConfig, profile:chatProfile, reasoning:'low', stage:'session-id-test',
  input:[{role:'user',content:[{type:'input_text',text:'test'}]}], schema, schemaName:'test_schema', useWeb:false,
  sessionId:'ses_fixed123',
});
assert(result.ok && captured.init.headers['x-opencode-session'] === 'ses_fixed123', 'Explicit session IDs must be forwarded unchanged');

const normalizedCustom = normalizeProviderConfig({ ...chatConfig, profiles: [{ ...chatProfile, sessionHeader: undefined }] }, cfEnv);
assert(normalizedCustom.profiles[0].sessionHeader === 'x-opencode-session', 'Existing custom provider profiles without a session setting keep the legacy default');
const noSessionHeader = normalizeProviderConfig({ ...chatConfig, profiles: [{ ...chatProfile, sessionHeader: '' }] }, cfEnv);
assert(noSessionHeader.profiles[0].sessionHeader === '', 'An explicitly blank session header must stay disabled');

let retryCalls = 0;
globalThis.fetch = async () => {
  retryCalls += 1;
  if (retryCalls < 3) {
    return new Response(JSON.stringify({ error:{ message:'temporary outage' } }), {
      status:503, headers:{'content-type':'application/json','retry-after':'0'},
    });
  }
  return chatOkResponse();
};
result = await callAiJson({
  env:cfEnv, config:chatConfig, profile:chatProfile, reasoning:'low', stage:'retry-http-test',
  input:[{role:'user',content:[{type:'input_text',text:'test'}]}], schema, schemaName:'test_schema', useWeb:false,
});
assert(result.ok && retryCalls === 3, 'Retryable HTTP failures should retry twice and then succeed');
assert(result.attempts === 3 && result.telemetry?.retries === 2, 'Retry count must be exposed in provider telemetry');

let networkCalls = 0;
globalThis.fetch = async () => {
  networkCalls += 1;
  if (networkCalls === 1) throw new Error('temporary connection reset');
  return chatOkResponse();
};
result = await callAiJson({
  env:cfEnv, config:chatConfig, profile:chatProfile, reasoning:'low', stage:'retry-network-test',
  input:[{role:'user',content:[{type:'input_text',text:'test'}]}], schema, schemaName:'test_schema', useWeb:false,
});
assert(result.ok && networkCalls === 2 && result.attempts === 2, 'Transient network errors should retry automatically');

let authCalls = 0;
globalThis.fetch = async () => {
  authCalls += 1;
  return new Response(JSON.stringify({ error:{ message:'bad key' } }), { status:401, headers:{'content-type':'application/json'} });
};
result = await callAiJson({
  env:cfEnv, config:chatConfig, profile:chatProfile, reasoning:'low', stage:'no-retry-auth-test',
  input:[{role:'user',content:[{type:'input_text',text:'test'}]}], schema, schemaName:'test_schema', useWeb:false,
});
assert(!result.ok && result.status === 401 && authCalls === 1, 'Authentication failures must not be retried');

const syncEnv = { CF_AI_GATEWAY_ADMIN_TOKEN:'test-only-admin-token-placeholder' };
const syncCalls = [];
globalThis.fetch = async (url, init = {}) => {
  syncCalls.push({ url, method:init.method, headers:init.headers, body:init.body ? JSON.parse(init.body) : null });
  if (init.method === 'GET') return cfResponse([]);
  if (init.method === 'POST') return cfResponse({ id:'provider-1', slug:'alt', base_url:'https://api.alt.test', name:'Custom Chat', enable:true });
  throw new Error(`Unexpected sync method ${init.method}`);
};
let sync = await syncManagedCustomProviders(syncEnv, chatConfig);
assert(sync.ok && sync.results[0]?.action === 'created', 'Managed custom provider should be created when missing');
assert(syncCalls[1].url.endsWith('/ai-gateway/custom-providers'), 'Custom provider create endpoint mismatch');
assert(syncCalls[1].headers.authorization === 'Bearer test-only-admin-token-placeholder', 'Custom provider admin API must use its dedicated test-only placeholder');
assert(syncCalls[1].body.base_url === 'https://api.alt.test' && syncCalls[1].body.slug === 'alt', 'Custom provider create body mismatch');

const changedChatConfig = JSON.parse(JSON.stringify(chatConfig));
changedChatConfig.profiles[0].baseUrl = 'https://new.alt.test';
syncCalls.length = 0;
globalThis.fetch = async (url, init = {}) => {
  syncCalls.push({ url, method:init.method, headers:init.headers, body:init.body ? JSON.parse(init.body) : null });
  if (init.method === 'GET') return cfResponse([{ id:'provider-1', slug:'alt', base_url:'https://api.alt.test', name:'Custom Chat', enable:true }]);
  if (init.method === 'PATCH') return cfResponse({ id:'provider-1', slug:'alt', base_url:'https://new.alt.test', name:'Custom Chat', enable:true });
  throw new Error(`Unexpected sync method ${init.method}`);
};
sync = await syncManagedCustomProviders(syncEnv, changedChatConfig);
assert(sync.ok && sync.results[0]?.action === 'updated', 'Changed managed Base URL should update Cloudflare Custom Provider');
assert(syncCalls[1].method === 'PATCH' && syncCalls[1].body.base_url === 'https://new.alt.test', 'Custom provider address update mismatch');

const kv = new MockKv({ [PROVIDER_CONFIG_KEY]: JSON.stringify(cfConfig) });
const adminEnv = {
  RISK_ADMIN_PIN:'1703', RISK_ADMIN_SIGNING_SECRET:'test-signing-secret-with-enough-entropy',
  CF_AI_GATEWAY_TOKEN:'test-only-gateway-token-placeholder', RISK_RULES:kv,
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

const webTestConfig = JSON.parse(JSON.stringify(chatConfig));
webTestConfig.profiles[0].capabilities.webSearch = true;
webTestConfig.profiles[0].webSearchMode = 'native';
globalThis.fetch = async () => chatOkResponse();
response = await onRequestPost(context('POST', { action:'test', profileId:'custom-chat', config:webTestConfig }, cookie, adminEnv));
data = await response.json();
assert(response.status === 502 && !data.ok && data.webSearchVerified === false, 'Structured output without an actual Liquipedia citation must fail the web-search test');

globalThis.fetch = async () => chatSearchResponse('https://www.google.com/search?q=liquipedia');
response = await onRequestPost(context('POST', { action:'test', profileId:'custom-chat', config:webTestConfig }, cookie, adminEnv));
data = await response.json();
assert(response.status === 502 && !data.ok, 'A citation from a non-Liquipedia host must not pass the web-search test');

globalThis.fetch = async () => chatSearchResponse('http://liquipedia.net/dota2/Portal:Statistics/Tournament_prize_pools');
response = await onRequestPost(context('POST', { action:'test', profileId:'custom-chat', config:webTestConfig }, cookie, adminEnv));
data = await response.json();
assert(response.status === 502 && !data.ok, 'A non-HTTPS Liquipedia citation must not pass the web-search test');

globalThis.fetch = async () => chatSearchResponse('', 'unavailable');
response = await onRequestPost(context('POST', { action:'test', profileId:'custom-chat', config:webTestConfig }, cookie, adminEnv));
data = await response.json();
assert(response.status === 502 && !data.ok && data.webSearchVerified === false && /not verified/i.test(data.error), 'Explicit unavailable status must fail with a clear unverified result');

globalThis.fetch = async () => chatSearchResponse('https://liquipedia.net/dota2/Portal:Statistics/Tournament_prize_pools');
response = await onRequestPost(context('POST', { action:'test', profileId:'custom-chat', config:webTestConfig }, cookie, adminEnv));
data = await response.json();
assert(response.status === 200 && data.ok && data.webSearchVerified, 'A returned HTTPS Liquipedia citation must verify provider web search');
assert(data.webSearchSources[0]?.url === 'https://liquipedia.net/dota2/Portal:Statistics/Tournament_prize_pools', 'Verified test must return the cited Liquipedia URL');

const externalConfig = structuredClone(webTestConfig);
externalConfig.profiles[0].id = 'compatible-4';
const normalizedExternalProfile = normalizeProviderConfig(externalConfig, adminEnv).profiles[0];
assert(normalizedExternalProfile.capabilities.webSearch === false, 'Provider 4 must disable its native search capability in normalized settings');
externalConfig.profiles[0] = normalizedExternalProfile;
for (const route of Object.values(externalConfig.routes)) {
  for (const key of Object.keys(route)) if (route[key] === 'custom-chat') route[key] = 'compatible-4';
}
const externalRequest = env => onRequestPost(context('POST', {
  action: 'test', profileId: 'compatible-4', config: externalConfig,
}, cookie, env));
response = await externalRequest(adminEnv);
assert(response.status === 503 && /TAVILY_API_KEY/.test((await response.json()).error), 'A missing search key must fail explicitly');

const trustedUrl = 'https://liquipedia.net/dota2/Portal:Statistics/Tournament_prize_pools';
const otherUrl = 'https://liquipedia.net/dota2/Unretrieved';
for (const cite of [trustedUrl, otherUrl]) {
  globalThis.fetch = async function (url, options) {
    if (url === 'https://api.tavily.com/search') assert(this === globalThis, 'Cloudflare fetch must retain the global receiver');
    const body = JSON.parse(options.body);
    if (url === 'https://api.tavily.com/search') {
      assert(body.search_depth === 'basic' && body.include_domains[0] === 'liquipedia.net', 'Search must stay on the supported free tier and requested domain');
      return Response.json({ results: [
        { url: 'https://liquipedia.net.example.com/spoof', title: 'Spoof', content: 'spoof' },
        { url: trustedUrl, title: 'Dota 2 prize pools', content: 'Tournament prize pool statistics.' },
      ] });
    }
    assert(!body.tools && body.messages.some(message => JSON.stringify(message).includes(trustedUrl)), 'DeepSeek must receive retrieved evidence without a native search tool');
    assert(!JSON.stringify(body).includes('net.example.com'), 'Search evidence must exclude lookalike hosts');
    return Response.json({ choices: [{ message: { content: JSON.stringify({ sourceUrl: cite }) } }] });
  };
  response = await externalRequest({ ...adminEnv, TAVILY_API_KEY: 'test-only-tavily-key-placeholder' });
  data = await response.json();
  assert(cite === trustedUrl
    ? response.status === 200 && data.webSearchVerified && data.webSearchSources[0]?.url === trustedUrl
    : response.status === 502 && !data.webSearchVerified,
  'Provider 4 live-test contract must accept only a retrieved source');
}

const keyEnv = { ...adminEnv, ...syncEnv, CF_AI_GATEWAY_KEYS_TOKEN: 'test-only-keys-token-placeholder' };
const keyConfig = structuredClone(chatConfig);
keyConfig.cloudflare.gatewayId = stored.cloudflare.gatewayId;
keyConfig.profiles[0].byokAlias = 'test-alt-key';
const fakeKey = 'test-only-upstream-key-placeholder';
let attemptedStore = 0;
let existingKey = false;
let failStore = false;
let wrongAddress = false;
let customMissing = false;
let customCreated = false;
globalThis.fetch = async (url, init) => {
  const endpoint = new URL(url);
  if (endpoint.pathname.endsWith('/custom-providers')) {
    if (init.method === 'POST' && customMissing) {
      const body = JSON.parse(init.body);
      assert(body.base_url === 'https://api.alt.test' && !init.body.includes(fakeKey), 'New custom providers are registered without disclosing their key to the address API');
      customCreated = true;
      customMissing = false;
      return cfResponse({ id: 'new-provider' });
    }
    assert(init.method === 'GET', 'Key entry must preserve existing custom addresses');
    return cfResponse(customMissing ? [] : [{ id: 'existing', slug: 'alt', enable: true, base_url: wrongAddress ? 'https://other.test' : 'https://api.alt.test' }]);
  }
  assert(endpoint.hostname === 'api.cloudflare.com' && endpoint.pathname.endsWith('/gateways/new-gateway/provider_configs'), 'Keys must go to the published gateway over Cloudflare HTTPS');
  assert(init.headers.authorization === 'Bearer test-only-keys-token-placeholder' && init.redirect === 'error', 'Storage must use the dedicated token and reject redirects');
  const key = { provider_slug: 'alt', alias: 'test-alt-key', secret_preview: fakeKey };
  if (init.method !== 'POST') return cfResponse(existingKey ? [key] : []);
  attemptedStore++;
  const body = JSON.parse(init.body);
  assert(body.secret === fakeKey && body.alias === key.alias && body.provider_slug === 'alt' && body.default_config === false, 'Cloudflare key storage must use the unprefixed custom provider slug and a non-default alias');
  if (failStore) return Response.json({ success: false, errors: [{ message: fakeKey }] }, { status: 403 });
  existingKey = true;
  return cfResponse(key);
};
const keyRequest = ({ auth = cookie, origin = 'https://example.test', env = keyEnv, config = keyConfig, apiKey = fakeKey } = {}) =>
  saveProviderKey({ env, request: new Request('https://example.test/api/provider-key', {
    method: 'POST', headers: { cookie: auth, origin, 'content-type': 'application/json' },
    body: JSON.stringify({ apiKey, config, profileId: 'custom-chat' }),
  }) });
assert((await keyRequest({ auth: '' })).status === 401, 'Only signed-in admins can add keys');
assert((await keyRequest({ origin: 'https://elsewhere.test' })).status === 403, 'Reject cross-origin key changes');
assert((await keyRequest({ env: adminEnv })).status === 503, 'Key storage requires its own credential');
assert((await keyRequest({ apiKey: 'invalid key' })).status === 400, 'Reject malformed keys');
assert((await keyRequest({ config: chatConfig })).status === 400 && attemptedStore === 0, 'Reject a draft addressing an unpublished gateway');
wrongAddress = true;
assert((await keyRequest()).status === 409 && attemptedStore === 0, 'An existing custom address is preserved when creating a key');
wrongAddress = false;
failStore = true;
response = await keyRequest();
assert(response.status === 503 && !(await response.text()).includes(fakeKey), 'Cloudflare error text must never echo the key');
failStore = false;
customMissing = true;
response = await keyRequest();
data = await response.json();
assert(response.status === 201 && customCreated && Object.keys(data).join(',') === 'ok,alias' && data.alias === 'test-alt-key', 'New custom providers and keys are created from one request, with only the alias in the response');
assert((await keyRequest()).status === 409 && attemptedStore === 2, 'A duplicate alias must not overwrite a live key or send the secret again');
assert(!JSON.stringify([...kv.map]).includes(fakeKey), 'The key must never enter provider KV');

const visionRequest = () => onRequestPost(context('POST', { action:'test-vision', profileId:'custom-chat', config:chatConfig }, cookie, adminEnv));
for (const digits of ['7462', '1234']) {
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    assert(body.messages[0].content.some(part => part.type === 'image_url' && part.image_url.url.startsWith('data:image/png;base64,')), 'The vision test must send a real image');
    assert(!JSON.stringify(body).includes('7462'), 'The provider must recover the answer from pixels');
    return Response.json({ choices: [{ message: { content: JSON.stringify({ digits }) } }] });
  };
  response = await visionRequest();
  data = await response.json();
  assert(digits === '7462' ? response.status === 200 && data.visionVerified : response.status === 502, 'Vision passes only when the model reads the shown digits');
}

console.log('provider manager smoke tests passed');

function context(method, body, cookieValue, env) {
  const headers = {};
  if (body != null) headers['content-type'] = 'application/json';
  if (cookieValue) headers.cookie = cookieValue;
  return { env, request:new Request('https://example.test/api/providers', { method, headers, body:body == null ? undefined : JSON.stringify(body) }) };
}
function cfResponse(result) {
  return new Response(JSON.stringify({ success:true, result }), { status:200, headers:{'content-type':'application/json'} });
}
function chatOkResponse() {
  return new Response(JSON.stringify({
    model:'alt-model', usage:{ prompt_tokens:50, completion_tokens:5 },
    choices:[{ message:{ content:'{"status":"ok"}' } }],
  }), { status:200, headers:{'content-type':'application/json'} });
}
function chatSearchResponse(url, status = 'ok') {
  return new Response(JSON.stringify({
    model:'alt-model', usage:{ prompt_tokens:50, completion_tokens:5 },
    choices:[{ message:{ content:JSON.stringify({ status }), annotations:url ? [{ type:'url_citation', url, title:'Liquipedia result' }] : [] } }],
  }), { status:200, headers:{'content-type':'application/json'} });
}
function assert(condition, message) { if (!condition) throw new Error(message); }
