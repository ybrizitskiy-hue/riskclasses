const COOKIE_NAME = 'rc_admin';
const SESSION_SECONDS = 8 * 60 * 60;
const encoder = new TextEncoder();

export function isAdminConfigured(env) {
  return Boolean(String(env?.RISK_ADMIN_PIN || '').trim() && signingSecret(env));
}

export function verifyAdminPin(pin, env) {
  if (!isAdminConfigured(env)) return false;
  return constantTimeEqual(String(pin ?? ''), String(env.RISK_ADMIN_PIN));
}

export async function createAdminSession(env, nowMs = Date.now()) {
  if (!isAdminConfigured(env)) throw new Error('Admin PIN is not configured.');
  const expiresAt = Math.floor(nowMs / 1000) + SESSION_SECONDS;
  const payload = `v1.${expiresAt}`;
  const signature = await sign(payload, env);
  return `${payload}.${toBase64Url(signature)}`;
}

export async function isAdminRequest(request, env, nowMs = Date.now()) {
  if (!isAdminConfigured(env)) return false;
  const token = readCookie(request?.headers?.get('cookie') || '', COOKIE_NAME);
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return false;
  const expiresAt = Number(parts[1]);
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(nowMs / 1000)) return false;

  let signature;
  try {
    signature = fromBase64Url(parts[2]);
  } catch {
    return false;
  }
  return verifySignature(`v1.${parts[1]}`, signature, env);
}

export function adminCookie(token) {
  return `${COOKIE_NAME}=${token}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearAdminCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

export function adminSessionSeconds() {
  return SESSION_SECONDS;
}

async function sign(message, env) {
  const key = await importHmacKey(env);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

async function verifySignature(message, signature, env) {
  try {
    const key = await importHmacKey(env);
    return await crypto.subtle.verify('HMAC', key, signature, encoder.encode(message));
  } catch {
    return false;
  }
}

async function importHmacKey(env) {
  // Prefer a dedicated signing secret so admin access is independent of any AI provider.
  // Existing deployments remain compatible by falling back to the OpenAI or AI Gateway secret.
  const material = `${env.RISK_ADMIN_PIN}\n${signingSecret(env)}\nriskclasses-admin-v1`;
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(material),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function signingSecret(env) {
  return String(
    env?.RISK_ADMIN_SIGNING_SECRET ||
    env?.OPENAI_API_KEY ||
    env?.CF_AI_GATEWAY_TOKEN ||
    ''
  ).trim();
}

function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (key === name) return part.slice(index + 1).trim();
  }
  return '';
}

function constantTimeEqual(left, right) {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const length = Math.max(a.length, b.length, 1);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i += 1) {
    diff |= (a[i % Math.max(a.length, 1)] || 0) ^ (b[i % Math.max(b.length, 1)] || 0);
  }
  return diff === 0;
}

function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
