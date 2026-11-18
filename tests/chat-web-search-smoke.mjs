import { callAiJson } from '../functions/lib/ai-client.js';
import { validateProviderConfig } from '../functions/lib/provider-config.js';
import { buildDeveloperPrompt, profileHasWebSearch } from '../functions/api/analyze-core.js';

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['status'],
  properties: { status: { type: 'string' } },
};

// Non-secret fixture values; requests are intercepted by this test's fetch stub.
const env = { CF_AI_GATEWAY_TOKEN: 'test-only-gateway-token-placeholder' };
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
    cloudflare: { accountId: 'test-account-id', gatewayId: 'test-gateway-id' },
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
    choices: [{ message: { content: '{"status":"ok"}', annotations: [{ type: 'url_citation', url: 'https://liquipedia.net/dota2/Portal:Statistics/Tournament_prize_pools', title: 'Liquipedia' }] } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};

const noWebSentence = 'No web-search tool is available in this stage. If the answer materially depends on a current external fact that is not established by the canonical rules, make the best cautious answer you can and set needsEscalation=true so a research-capable or stronger configured provider can review it.';
const input = [{ role: 'developer', content: [{ type: 'input_text', text: noWebSentence }] }, { role: 'user', content: [{ type: 'input_text', text: 'test' }] }];

const promptRules = {
  version: 'web-search-prompt-test',
  instructions: 'For each esports event, verify the exact event and year on Liquipedia statistics, then cite the page used.',
  knowledge: 'Liquipedia is the only permitted esports tier source.',
  deterministicRules: { rules: [] },
  resultPolicies: [],
  resultTransforms: [],
};
const nativeSearchProfile = { ...baseProfile, webSearchMode: 'native' };
assert(profileHasWebSearch(nativeSearchProfile), 'Chat Completions native search must be available to the classifier prompt');
const nativeSearchPrompt = buildDeveloperPrompt(promptRules, { webAvailable: profileHasWebSearch(nativeSearchProfile) });
assert(nativeSearchPrompt.includes('A web-search tool is available in this stage'), 'Native search prompt must describe the configured web-search capability');
assert(nativeSearchPrompt.includes('Liquipedia'), 'Native search prompt must retain the exact esports source requirement');
assert(!nativeSearchPrompt.includes('No web-search tool is available'), 'Native search prompt must not tell the model search is unavailable');
assert(!profileHasWebSearch({ ...nativeSearchProfile, capabilities: { ...nativeSearchProfile.capabilities, webSearch: false } }), 'Disabled Chat search must remain unavailable to the classifier prompt');

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
assert(result.telemetry.webSearchSources?.[0]?.url === 'https://liquipedia.net/dota2/Portal:Statistics/Tournament_prize_pools', 'Chat Completions citation annotations must be retained as search evidence');

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


const request = { env, config, profile: config.profiles[0], input, schema, schemaName: 'test', stage: 'auto-primary' };
const savedTimeout = AbortSignal.timeout;
const savedFetch = globalThis.fetch;
const savedSetTimeout = globalThis.setTimeout;
const savedClearTimeout = globalThis.clearTimeout;
try {
  globalThis.setTimeout = (callback) => { queueMicrotask(callback); return 0; };
  globalThis.clearTimeout = () => {};

  for (const timeoutStep of ['headers', 'body']) {
    const deadlines = [];
    AbortSignal.timeout = (ms) => {
      assert(ms === 30_000, 'Each model attempt should have a 30-second deadline');
      const deadline = new AbortController();
      deadlines.push(deadline);
      return deadline.signal;
    };
    let calls = 0;
    globalThis.fetch = async (url, { signal }) => {
      calls++;
      const deadline = deadlines[calls - 1];
      const stall = () => new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        queueMicrotask(() => deadline.abort(new DOMException('Model deadline exceeded', 'TimeoutError')));
      });
      if (timeoutStep === 'headers') return stall();
      return { json: stall };
    };
    const timeout = await callAiJson(request);
    assert(timeout.status === 504 && timeout.attempts === 4, timeoutStep + ' timeout must exhaust four attempts');
    assert(timeout.error.includes('timed out during auto-primary after 4 attempts (3 retries)'), 'Final timeout must report that all three retries were used');
    assert(calls === 4, 'A stalled provider call must be retried three times after its initial attempt');
  }

  const retryDeadlines = [];
  AbortSignal.timeout = (ms) => {
    assert(ms === 30_000, 'Each model attempt should have a 30-second deadline');
    const deadline = new AbortController();
    retryDeadlines.push(deadline);
    return deadline.signal;
  };
  let retryCalls = 0;
  globalThis.fetch = async (url, { signal }) => {
    retryCalls++;
    if (retryCalls === 1) {
      const deadline = retryDeadlines[0];
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        queueMicrotask(() => deadline.abort(new DOMException('Model deadline exceeded', 'TimeoutError')));
      });
    }
    return new Response(JSON.stringify({
      model: 'gpt-test',
      usage: { prompt_tokens: 20, completion_tokens: 4 },
      choices: [{ message: { content: '{"status":"ok"}' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const recovered = await callAiJson(request);
  assert(recovered.ok && recovered.attempts === 2, 'A successful second attempt must recover from the first timeout');
  assert(recovered.telemetry.attempts === 2 && retryCalls === 2, 'Retry telemetry must count both provider attempts');

  const cancelledController = new AbortController();
  cancelledController.abort(new DOMException('Request cancelled', 'AbortError'));
  retryCalls = 0;
  const cancelled = await callAiJson({ ...request, signal: cancelledController.signal });
  assert(cancelled.status === 504 && cancelled.attempts === 0 && retryCalls === 0, 'A cancelled analysis must not start or retry provider calls');
} finally {
  AbortSignal.timeout = savedTimeout;
  globalThis.fetch = savedFetch;
  globalThis.setTimeout = savedSetTimeout;
  globalThis.clearTimeout = savedClearTimeout;
}

console.log('chat web search smoke tests passed');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
