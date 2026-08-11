import { webcrypto } from 'node:crypto';
import { createAdminSession, verifyAdminPin } from '../functions/lib/admin.js';
import { onRequest as adminGate } from '../functions/api/_middleware.js';
import { onRequestPost as adminLogin, onRequestPut as adminUpdate } from '../functions/api/admin.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!globalThis.btoa) globalThis.btoa = (value) => Buffer.from(value, 'binary').toString('base64');
if (!globalThis.atob) globalThis.atob = (value) => Buffer.from(value, 'base64').toString('binary');

const kv = new Map();
const env = {
  RISK_ADMIN_PIN: '2468',
  OPENAI_API_KEY: 'test-openai-secret-for-session-signing',
  RISK_RULES: {
    async get(key) { return kv.get(key) || null; },
    async put(key, value) { kv.set(key, value); },
  },
};

assert(verifyAdminPin('2468', env), 'Correct admin PIN should verify');
assert(!verifyAdminPin('0000', env), 'Wrong admin PIN must fail');

let forwardedMode = null;
let response = await adminGate({
  env,
  request: analyzeRequest('quality'),
  next: async (request) => {
    forwardedMode = (await request.json()).routingMode;
    return Response.json({ rows: [], warnings: [], telemetry: { estimatedUsd: 1.23, routingMode: forwardedMode } });
  },
});
let payload = await response.json();
assert(forwardedMode === 'auto', 'Default global mode must be Auto for non-admin requests');
assert(!('telemetry' in payload), 'Non-admin response must not expose cost telemetry');

const token = await createAdminSession(env);
forwardedMode = null;
response = await adminGate({
  env,
  request: analyzeRequest('quality', token),
  next: async (request) => {
    forwardedMode = (await request.json()).routingMode;
    return Response.json({ rows: [], warnings: [], telemetry: { estimatedUsd: 1.23, routingMode: forwardedMode } });
  },
});
payload = await response.json();
assert(forwardedMode === 'auto', 'Admin requests must also use the globally configured mode');
assert(payload.telemetry?.estimatedUsd === 1.23, 'Admin response should retain cost telemetry');

response = await adminLogin({
  env,
  request: new Request('https://example.test/api/admin', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pin: '0000' }),
  }),
});
assert(response.status === 401, 'Wrong PIN login must return 401');

response = await adminLogin({
  env,
  request: new Request('https://example.test/api/admin', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pin: '2468' }),
  }),
});
payload = await response.json();
assert(response.status === 200 && payload.admin === true, 'Correct PIN login must unlock admin');
assert(payload.globalRoutingMode === 'auto', 'Login should report current global mode');
const setCookie = response.headers.get('set-cookie') || '';
assert(/rc_admin=/.test(setCookie) && /HttpOnly/i.test(setCookie) && /Secure/i.test(setCookie), 'Admin cookie must be HttpOnly and Secure');

response = await adminUpdate({
  env,
  request: new Request('https://example.test/api/admin', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie: `rc_admin=${token}` },
    body: JSON.stringify({ routingMode: 'quality' }),
  }),
});
payload = await response.json();
assert(response.status === 200 && payload.globalRoutingMode === 'quality', 'Admin should be able to set Quality globally');

forwardedMode = null;
response = await adminGate({
  env,
  request: analyzeRequest('economy'),
  next: async (request) => {
    forwardedMode = (await request.json()).routingMode;
    return Response.json({ rows: [], warnings: [], telemetry: { estimatedUsd: 2.34, routingMode: forwardedMode } });
  },
});
payload = await response.json();
assert(forwardedMode === 'quality', 'Global Quality must override every non-admin client request');
assert(!('telemetry' in payload), 'Global routing must not expose telemetry to non-admin users');

console.log('admin gate smoke tests passed (12 checks)');

function analyzeRequest(routingMode, token = '') {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.cookie = `rc_admin=${token}`;
  return new Request('https://example.test/api/analyze', {
    method: 'POST',
    headers,
    body: JSON.stringify({ mode: 'text', routingMode, text: 'Sport\tCompetition\nTennis\tExample' }),
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
