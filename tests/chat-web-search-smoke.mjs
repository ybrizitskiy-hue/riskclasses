import { callAiJson } from '../functions/lib/ai-client.js';
import { validateProviderConfig } from '../functions/lib/provider-config.js';

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['status'],
  properties: { status: { type: 'string' } },
};

const env = { CF_AI_GATEWAY_TOKEN: 'cf-run-token' };
const baseProfile = {
  id: 'custom-web',
  label: 'Custom Web',
  transport: 'cloudflare-provider',
  protocol: 'chat-completions',
  model: 'gpt-test',
  providerSlug: 'custom-web-provider',
  baseUrl: 'https://api.example.test',
  pathPrefix: 'v1',
  byokAlias: 'production',
  webSearchMode: 'chat-tools',
  capabilities: { vision: false, jsonSchema: true, reasoning: false, webSearch: true, promptCache: false, store: false },
  pricing: { input: null, cached: null, output: null, webSearch: null },
};

function makeConfig(profile) {
  return {
    schemaVersion: 1,
    version: 'providers-web-test',
    cloudflare: { accountId: 'abc123account', gatewayId: 'riskclasses' },
    profiles: [profile],
    routes: {
      economy: { extraction: profile.id, primary: profile.id, research: null, escalation: null },
      auto: { extraction: profile.id, primary: profile.id, research: null, escalation: null },
      quality: { extraction: profile.id, primary: profile.id, research: null, escalation: null },
    },
  };
}

function configFor(profile) {
  const copy = JSON.parse(JSON.stringify(profile));
  copy.capabilities.vision = true;
  return makeConfig(copy);
}

let captured = null;
globalThis.fetch = async (url, init) => {
  captured = { url, init, body: JSON.parse(init.body) };
  return new Response(JSON.stringify({
    model: 'gpt-test',
    usage: { prompt_tokens: 20, completion_tokens: 4 },
    choices: [{ message: { content: '{"status":"ok"}' } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};

const noWebSentence = 'No web-search tool is available in this stage. If the answer materially depends on a current external fact that is not established by the canonical rules, make the best cautious answer you can and set needsEscalation=true so a research-capable or stronger configured provider can review it.';
const input = [{ role: 'developer', content: [{ type: 'input_text', text: noWebSentence }] }, { role: 'user', content: [{ type: 'input_text', text: 'test' }] }];

let profile = { ...baseProfile, webSearchMode: 'chat-tools' };
let config = configFor(profile);
let validation = validateProviderConfig(config, env);
assert(validation.valid, `chat-tools config should validate: ${validation.errors.join('; ')}`);
assert(!validation.warnings.some((text) => /web search will be disabled/i.test(text)), 'Chat web search must not emit the old disabled warning');
let result = await callAiJson({ env, config, profile: config.profiles[0], input, schema, schemaName: 'test', useWeb: true, reasoning: 'low' });
assert(result.ok, 'chat-tools request should succeed');
assert(captured.body.tools?.[0]?.type === 'web_search', 'chat-tools must send the built-in web_search tool');
assert(captured.body.tool_choice === 'auto', 'chat-tools must set tool_choice auto');
assert(JSON.stringify(captured.body.messages).includes('A server-side web-search capability is available'), 'Chat web search must override the stale no-web prompt');
assert(!JSON.stringify(captured.body.messages).includes(noWebSentence), 'Stale no-web prompt must be removed for web-capable Chat providers');
assert(result.telemetry.webSearchMode === 'chat-tools', 'Telemetry must report chat-tools adapter');

for (const [mode, verify] of [
  ['chat-options', (body) => body.web_search_options?.search_context_size === 'low'],
  ['openrouter-plugin', (body) => body.plugins?.[0]?.id === 'web'],
  ['native', (body) => !body.tools && !body.web_search_options && !body.plugins],
]) {
  profile = { ...baseProfile, webSearchMode: mode };
  config = configFor(profile);
  validation = validateProviderConfig(config, env);
  assert(validation.valid, `${mode} config should validate: ${validation.errors.join('; ')}`);
  result = await callAiJson({ env, config, profile: config.profiles[0], input, schema, schemaName: 'test', useWeb: true, reasoning: 'low' });
  assert(result.ok, `${mode} request should succeed`);
  assert(verify(captured.body), `${mode} request shape is wrong`);
  assert(result.telemetry.webSearchMode === mode, `${mode} telemetry is wrong`);
}

profile = JSON.parse(JSON.stringify(baseProfile));
profile.capabilities.webSearch = false;
config = configFor(profile);
result = await callAiJson({ env, config, profile: config.profiles[0], input, schema, schemaName: 'test', useWeb: true, reasoning: 'low' });
assert(result.ok, 'Web-disabled request should still succeed');
assert(!captured.body.tools && !captured.body.web_search_options && !captured.body.plugins, 'Web-disabled profile must not receive search fields');

const badProfile = { ...baseProfile, protocol: 'responses', webSearchMode: 'chat-tools' };
const badConfig = configFor(badProfile);
validation = validateProviderConfig(badConfig, env);
assert(!validation.valid && validation.errors.some((text) => /Chat Completions web-search adapter/i.test(text)), 'Responses profile must reject Chat-only web search adapter');

console.log('chat web search smoke tests passed');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
