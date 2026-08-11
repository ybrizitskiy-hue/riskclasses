import {
  effectiveCloudflareAccountId,
  effectiveGatewayId,
  profileRuntimeStatus,
} from './provider-config.js';

const RETRY_DELAYS_MS = [700, 1800];
const MAX_RETRY_AFTER_MS = 5000;
const MAX_PROMPT_CACHE_KEY_LENGTH = 64;

export async function callAiJson({
  env,
  config,
  profile,
  reasoning = 'medium',
  stage = 'ai',
  input,
  schema,
  schemaName,
  useWeb = false,
  promptCacheKey = '',
}) {
  const runtime = profileRuntimeStatus(env, config, profile);
  if (!runtime.ready) return { ok: false, status: 503, error: `${profile?.label || 'Provider'}: ${runtime.reason}` };
  if (containsImage(input) && !profile.capabilities?.vision) {
    return { ok: false, status: 400, error: `${profile.label} is not configured for vision/image input.` };
  }

  const endpoint = profileEndpoint(config, profile, env);
  if (!endpoint) return { ok: false, status: 500, error: `Could not resolve endpoint for ${profile.label}.` };
  const headers = buildHeaders(env, config, profile);
  const actualWeb = Boolean(useWeb && profile.capabilities?.webSearch);
  const effectiveInput = actualWeb && profile.protocol === 'chat-completions'
    ? withWebAvailablePrompt(input)
    : input;
  const requestBody = profile.protocol === 'chat-completions'
    ? buildChatRequest({ profile, reasoning, input: effectiveInput, schema, schemaName, actualWeb })
    : buildResponsesRequest({ profile, reasoning, input: effectiveInput, schema, schemaName, actualWeb, promptCacheKey });

  const fetchResult = await fetchWithRetries(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
  });
  if (!fetchResult.response) {
    return {
      ok: false,
      status: 502,
      error: `Could not reach ${profile.label} after ${fetchResult.attempts} attempts: ${fetchResult.error?.message || String(fetchResult.error || 'network error')}`,
      attempts: fetchResult.attempts,
    };
  }

  const upstream = fetchResult.response;
  const received = await upstream.json().catch(() => ({}));
  const data = unwrapCloudflare(received);
  const telemetry = callTelemetry(data, profile, {
    reasoning,
    stage,
    useWeb: actualWeb,
    webSearchMode: actualWeb ? webSearchMode(profile) : 'disabled',
    endpoint,
    attempts: fetchResult.attempts,
  });

  if (!upstream.ok || received?.success === false) {
    const suffix = fetchResult.attempts > 1 ? ` after ${fetchResult.attempts} attempts` : '';
    return {
      ok: false,
      status: upstream.status >= 500 ? 502 : upstream.status,
      error: `${upstreamError(received, data, upstream.status, profile.label)}${suffix}`,
      telemetry,
      attempts: fetchResult.attempts,
    };
  }

  const outputText = profile.protocol === 'chat-completions'
    ? extractChatOutputText(data)
    : extractResponsesOutputText(data);
  if (!outputText) return { ok: false, status: 502, error: `${profile.label} returned no structured output during ${stage}.`, telemetry, attempts: fetchResult.attempts };

  try {
    return { ok: true, result: JSON.parse(outputText), telemetry, rawModel: data?.model || profile.model, attempts: fetchResult.attempts };
  } catch {
    return { ok: false, status: 502, error: `${profile.label} returned invalid JSON during ${stage}.`, telemetry, attempts: fetchResult.attempts };
  }
}

export function profileEndpoint(config, profile, env = {}) {
  if (!profile) return '';
  const suffix = profile.protocol === 'chat-completions' ? 'chat/completions' : 'responses';
  if (profile.transport === 'openai-direct') return `https://api.openai.com/v1/${suffix}`;

  const accountId = effectiveCloudflareAccountId(config, env);
  if (!accountId) return '';
  if (profile.transport === 'cloudflare-rest') {
    return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/v1/${suffix}`;
  }
  if (profile.transport === 'cloudflare-provider') {
    const gatewayId = effectiveGatewayId(config, env);
    const provider = String(profile.providerSlug || '').trim();
    const prefix = String(profile.pathPrefix || '').trim().replace(/^\/+|\/+$/g, '');
    const path = [prefix, suffix].filter(Boolean).map((part) => part.split('/').map(encodeURIComponent).join('/')).join('/');
    return `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(accountId)}/${encodeURIComponent(gatewayId)}/${encodeURIComponent(provider)}/${path}`;
  }
  return '';
}

export function publicProfileStatus(env, config, profile) {
  const runtime = profileRuntimeStatus(env, config, profile);
  return {
    id: profile?.id || '',
    ready: runtime.ready,
    reason: runtime.reason || '',
    endpoint: profileEndpoint(config, profile, env),
    credential: runtime.credential || '',
  };
}

export function compactPromptCacheKey(value) {
  const text = String(value || '');
  if (text.length <= MAX_PROMPT_CACHE_KEY_LENGTH) return text;
  const hash = stableKeyHash(text);
  const prefixLength = MAX_PROMPT_CACHE_KEY_LENGTH - hash.length - 1;
  return `${text.slice(0, prefixLength)}-${hash}`;
}

async function fetchWithRetries(endpoint, init) {
  let lastError = null;
  const maxAttempts = RETRY_DELAYS_MS.length + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(endpoint, init);
      if (!isRetryableStatus(response.status) || attempt === maxAttempts) {
        return { response, attempts: attempt, error: null };
      }
      await sleep(retryDelay(response, attempt));
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) return { response: null, attempts: attempt, error: lastError };
      await sleep(RETRY_DELAYS_MS[attempt - 1]);
    }
  }
  return { response: null, attempts: maxAttempts, error: lastError };
}

function isRetryableStatus(status) {
  const code = Number(status || 0);
  return code === 408 || code === 409 || code === 425 || code === 429 || code >= 500;
}

function retryDelay(response, attempt) {
  const retryAfter = parseRetryAfter(response?.headers?.get?.('retry-after'));
  if (retryAfter != null) return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, retryAfter));
  return RETRY_DELAYS_MS[Math.max(0, attempt - 1)] ?? RETRY_DELAYS_MS.at(-1) ?? 0;
}

function parseRetryAfter(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const seconds = Number(text);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const at = Date.parse(text);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, at - Date.now());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function stableKeyHash(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, '0');
}

function buildHeaders(env, config, profile) {
  const headers = { 'content-type': 'application/json' };
  if (profile.transport === 'openai-direct') {
    headers.authorization = `Bearer ${env.OPENAI_API_KEY}`;
  } else if (profile.transport === 'cloudflare-rest') {
    headers.authorization = `Bearer ${env.CF_AI_GATEWAY_TOKEN}`;
    const gatewayId = effectiveGatewayId(config, env);
    if (gatewayId) headers['cf-aig-gateway-id'] = gatewayId;
    if (profile.byokAlias) headers['cf-aig-byok-alias'] = profile.byokAlias;
  } else if (profile.transport === 'cloudflare-provider') {
    headers['cf-aig-authorization'] = `Bearer ${env.CF_AI_GATEWAY_TOKEN}`;
    if (profile.byokAlias) headers['cf-aig-byok-alias'] = profile.byokAlias;
  }
  return headers;
}

function buildResponsesRequest({ profile, reasoning, input, schema, schemaName, actualWeb, promptCacheKey }) {
  const requestInput = profile.capabilities?.jsonSchema ? input : appendSchemaPrompt(input, schema);
  const body = { model: profile.model, input: requestInput };
  if (profile.capabilities?.store) body.store = false;
  if (profile.capabilities?.reasoning && reasoning) body.reasoning = { effort: reasoning };
  if (profile.capabilities?.jsonSchema) {
    body.text = { format: { type: 'json_schema', name: schemaName, strict: true, schema } };
  }
  if (profile.capabilities?.promptCache && promptCacheKey) {
    body.prompt_cache_key = compactPromptCacheKey(promptCacheKey);
    body.prompt_cache_retention = '24h';
  }
  if (actualWeb && webSearchMode(profile) !== 'native') {
    body.tools = [{ type: 'web_search', search_context_size: 'low' }];
    body.tool_choice = 'auto';
    body.max_tool_calls = 3;
  }
  return body;
}

function buildChatRequest({ profile, reasoning, input, schema, schemaName, actualWeb }) {
  const prepared = profile.capabilities?.jsonSchema ? input : appendSchemaPrompt(input, schema);
  const body = { model: profile.model, messages: toChatMessages(prepared) };
  if (profile.capabilities?.reasoning && reasoning) body.reasoning_effort = reasoning;
  if (profile.capabilities?.jsonSchema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: schemaName, strict: true, schema },
    };
  }
  if (actualWeb) applyChatWebSearch(body, webSearchMode(profile));
  return body;
}

function applyChatWebSearch(body, mode) {
  if (mode === 'chat-options') {
    body.web_search_options = { search_context_size: 'low' };
    return;
  }
  if (mode === 'openrouter-plugin') {
    body.plugins = [{ id: 'web', max_results: 3 }];
    return;
  }
  if (mode === 'native') return;
  // Compatible gateways that expose a server-side OpenAI-style built-in tool
  // through /chat/completions can opt into this shape.
  body.tools = [{ type: 'web_search' }];
  body.tool_choice = 'auto';
}

function webSearchMode(profile) {
  const explicit = String(profile?.webSearchMode || '').trim();
  if (explicit) return explicit;
  return profile?.protocol === 'chat-completions' ? 'chat-tools' : 'responses';
}

function withWebAvailablePrompt(input) {
  const cloned = JSON.parse(JSON.stringify(input || []));
  const unavailable = 'No web-search tool is available in this stage. If the answer materially depends on a current external fact that is not established by the canonical rules, make the best cautious answer you can and set needsEscalation=true so a research-capable or stronger configured provider can review it.';
  const available = 'A server-side web-search capability is available in this stage. Use it only when current facts such as tournament tier, tour, division, qualifier status, participant level or esports tier are genuinely needed. Do not browse merely to confirm an exact rule.';
  let replaced = false;
  for (const item of cloned) {
    if (typeof item?.content === 'string' && item.content.includes(unavailable)) {
      item.content = item.content.replace(unavailable, available);
      replaced = true;
      continue;
    }
    if (!Array.isArray(item?.content)) continue;
    for (const part of item.content) {
      if (typeof part?.text === 'string' && part.text.includes(unavailable)) {
        part.text = part.text.replace(unavailable, available);
        replaced = true;
      }
    }
  }
  if (!replaced) cloned.unshift({ role: 'developer', content: [{ type: 'input_text', text: available }] });
  return cloned;
}

function appendSchemaPrompt(input, schema) {
  const cloned = JSON.parse(JSON.stringify(input || []));
  const suffix = `\n\nReturn ONLY valid JSON matching this JSON Schema exactly:\n${JSON.stringify(schema)}`;
  const developer = cloned.find((item) => item?.role === 'developer' || item?.role === 'system');
  if (developer) {
    if (typeof developer.content === 'string') developer.content += suffix;
    else if (Array.isArray(developer.content)) developer.content.push({ type: 'input_text', text: suffix });
  } else {
    cloned.unshift({ role: 'developer', content: [{ type: 'input_text', text: suffix }] });
  }
  return cloned;
}

function toChatMessages(input) {
  return (input || []).map((item) => {
    const role = item?.role === 'developer' ? 'system' : (item?.role || 'user');
    if (typeof item?.content === 'string') return { role, content: item.content };
    const content = [];
    for (const part of item?.content || []) {
      if (part?.type === 'input_text') content.push({ type: 'text', text: String(part.text || '') });
      if (part?.type === 'input_image') {
        content.push({
          type: 'image_url',
          image_url: {
            url: part.image_url,
            detail: part.detail === 'original' ? 'auto' : (part.detail || 'auto'),
          },
        });
      }
    }
    if (content.length === 1 && content[0].type === 'text') return { role, content: content[0].text };
    return { role, content };
  });
}

function containsImage(input) {
  return (input || []).some((item) => Array.isArray(item?.content) && item.content.some((part) => part?.type === 'input_image'));
}

function unwrapCloudflare(data) {
  if (data && data.success === true && data.result && typeof data.result === 'object') return data.result;
  return data;
}

function upstreamError(received, data, status, label) {
  const messages = [];
  if (data?.error?.message) messages.push(data.error.message);
  if (typeof data?.error === 'string') messages.push(data.error);
  for (const error of received?.errors || []) if (error?.message) messages.push(error.message);
  return messages[0] || `${label} returned HTTP ${status}.`;
}

function extractResponsesOutputText(response) {
  if (typeof response?.output_text === 'string' && response.output_text) return response.output_text;
  for (const item of response?.output || []) {
    if (item?.type !== 'message') continue;
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') return content.text;
      if (content?.type === 'text' && typeof content.text === 'string') return content.text;
    }
  }
  return '';
}

function extractChatOutputText(response) {
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => typeof part === 'string' ? part : (part?.text || '')).join('');
  }
  return '';
}

function callTelemetry(response, profile, { reasoning, stage, useWeb, webSearchMode: searchMode, endpoint, attempts = 1 }) {
  const usage = response?.usage || {};
  const inputTokens = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0);
  const cachedInputTokens = Number(usage.input_tokens_details?.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0);
  const outputTokens = Number(usage.output_tokens ?? usage.completion_tokens ?? 0);
  const reasoningTokens = Number(usage.output_tokens_details?.reasoning_tokens ?? usage.completion_tokens_details?.reasoning_tokens ?? 0);
  const webSearchCalls = useWeb ? countWebSearchCalls(response) : 0;
  const price = profile?.pricing || {};
  const uncachedInput = Math.max(0, inputTokens - cachedInputTokens);
  const priced = [price.input, price.cached, price.output].every((value) => value != null && Number.isFinite(Number(value)));
  let estimatedUsd = null;
  if (priced) {
    estimatedUsd = (
      uncachedInput * Number(price.input) +
      cachedInputTokens * Number(price.cached) +
      outputTokens * Number(price.output)
    ) / 1_000_000;
    if (price.webSearch != null) estimatedUsd += webSearchCalls * Number(price.webSearch);
  }
  return {
    stage,
    profileId: profile?.id || '',
    providerLabel: profile?.label || '',
    transport: profile?.transport || '',
    protocol: profile?.protocol || '',
    model: response?.model || profile?.model || '',
    reasoning,
    webSearchMode: searchMode,
    attempts,
    retries: Math.max(0, Number(attempts || 1) - 1),
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningTokens,
    webSearchCalls,
    estimatedUsd,
    endpoint,
  };
}

function countWebSearchCalls(response) {
  let count = 0;
  for (const item of response?.output || []) if (item?.type === 'web_search_call') count += 1;
  if (Array.isArray(response?.web_search_calls)) count += response.web_search_calls.length;
  for (const choice of response?.choices || []) {
    const message = choice?.message || {};
    for (const call of message.tool_calls || []) {
      if (call?.type === 'web_search' || call?.function?.name === 'web_search') count += 1;
    }
    if (!count && Array.isArray(message.annotations) && message.annotations.some((item) => item?.type === 'url_citation')) count = 1;
  }
  return count;
}