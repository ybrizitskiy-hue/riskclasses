import { callAiJson, compactPromptCacheKey } from '../functions/lib/ai-client.js';

const longKey = `riskclasses-${'rules-version-'.repeat(8)}${'providers-version-'.repeat(5)}classifier`;
const compact = compactPromptCacheKey(longKey);
assert(longKey.length > 64, 'Fixture must exceed the upstream 64-character limit');
assert(compact.length <= 64, `Compacted key must be <=64 chars, got ${compact.length}`);
assert(compact === compactPromptCacheKey(longKey), 'Compaction must be deterministic');
assert(compact !== compactPromptCacheKey(`${longKey}-different`), 'Different long keys must keep distinct hashes');
assert(compactPromptCacheKey('short-cache-key') === 'short-cache-key', 'Short keys must remain unchanged');

const profile = {
  id: 'responses-cache-test',
  label: 'Responses cache test',
  transport: 'openai-direct',
  protocol: 'responses',
  model: 'test-model',
  capabilities: {
    vision: false,
    jsonSchema: true,
    reasoning: false,
    webSearch: false,
    promptCache: true,
    store: false,
  },
  pricing: { input: null, cached: null, output: null, webSearch: null },
};

let capturedBody = null;
globalThis.fetch = async (_url, init) => {
  capturedBody = JSON.parse(init.body);
  return new Response(JSON.stringify({
    model: 'test-model',
    usage: { input_tokens: 10, output_tokens: 2 },
    output: [{ type: 'message', content: [{ type: 'output_text', text: '{"status":"ok"}' }] }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};

const result = await callAiJson({
  env: { OPENAI_API_KEY: 'test-key' },
  config: {},
  profile,
  reasoning: 'low',
  stage: 'prompt-cache-test',
  input: [{ role: 'user', content: [{ type: 'input_text', text: 'Return ok.' }] }],
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['status'],
    properties: { status: { type: 'string' } },
  },
  schemaName: 'prompt_cache_test',
  useWeb: false,
  promptCacheKey: longKey,
});

assert(result.ok, 'Responses request with long logical cache key should succeed');
assert(typeof capturedBody?.prompt_cache_key === 'string', 'Prompt cache key should be sent when enabled');
assert(capturedBody.prompt_cache_key.length <= 64, `Sent prompt_cache_key must be <=64 chars, got ${capturedBody.prompt_cache_key.length}`);
assert(capturedBody.prompt_cache_key === compact, 'Request must send the deterministic compacted key');
assert(capturedBody.prompt_cache_retention === '24h', 'Prompt cache retention should remain unchanged');

console.log('prompt cache key smoke tests passed (10 checks)');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
