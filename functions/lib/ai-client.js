import {
  effectiveCloudflareAccountId,
  effectiveGatewayId,
  profileRuntimeStatus,
} from './provider-config.js';

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
  const actualWeb = Boolean(useWeb && profile.capabilities?.webSearch && profile.protocol === 'responses');
  const requestBody = profile.protocol === 'chat-completions'
    ? buildChatRequest({ profile, reasoning, input, schema, schemaName })
    : buildResponsesRequest({ profile, reasoning, input, schema, schemaName, actualWeb, promptCacheKey });

  let upstream;
  try {
    upstream = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });
  } catch (error) {
    return { ok: false, status: 502, error: `Could not reach ${profile.label}: ${error?.message || String(error)}` };
  }

  const received = await upstream.json().catch(() => ({}));
  const data = unwrapCloudflare(received);
  const telemetry = callTelemetry(data, profile, { reasoning, stage, useWeb: actualWeb, endpoint });

  if (!upstream.ok || received?.success === false) {
    return {
      ok: false,
      status: upstream.status >= 500 ? 502 : upstream.status,
      error: upstreamError(received, data, upstream.status, profile.label),
      telemetry,
    };
  }

  const outputText = profile.protocol === 'chat-completions'
    ? extractChatOutputText(data)
    : extractResponsesOutputText(data);
  if (!outputText) return { ok: false, status: 502, error: `${profile.label} returned no structured output during ${stage}.`, telemetry };

  try {
    return { ok: true, result: JSON.parse(outputText), telemetry, rawModel: data?.model || profile.model };
  } catch {
    return { ok: false, status: 502, error: `${profile.label} returned invalid JSON during ${stage}.`, telemetry };
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
    body.prompt_cache_key = promptCacheKey;
    body.prompt_cache_retention = '24h';
  }
  if (actualWeb) {
    body.tools = [{ type: 'web_search', search_context_size: 'low' }];
    body.tool_choice = 'auto';
    body.max_tool_calls = 3;
  }
  return body;
}

function buildChatRequest({ profile, reasoning, input, schema, schemaName }) {
  const prepared = profile.capabilities?.jsonSchema ? input : appendSchemaPrompt(input, schema);
  const body = { model: profile.model, messages: toChatMessages(prepared) };
  if (profile.capabilities?.reasoning && reasoning) body.reasoning_effort = reasoning;
  if (profile.capabilities?.jsonSchema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: schemaName, strict: true, schema },
    };
  }
  return body;
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

function callTelemetry(response, profile, { reasoning, stage, useWeb, endpoint }) {
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
  return count;
}
