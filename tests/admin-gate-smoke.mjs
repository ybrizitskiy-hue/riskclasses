import { webcrypto } from 'node:crypto';
import { createAdminSession, verifyAdminPin } from '../functions/lib/admin.js';
import { onRequest as adminGate } from '../functions/api/_middleware.js';
import { onRequestPost as adminLogin } from '../functions/api/admin.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!globalThis.btoa) globalThis.btoa = (value) => Buffer.from(value, 'binary').toString('base64');
if (!globalThis.atob) globalThis.atob = (value) => Buffer.from(value, 'base64').toString('binary');

const env = {
  RISK_ADMIN_PIN: '2468',
  OPENAI_API_KEY: 'test-openai-secret-for-session-signing',
};

assert(verifyAdminPin('2468', env), 'Correct admin PIN should verify');
assert(!verifyAdminPin('0000', env), 'Wrong admin PIN must fail');

let forwardedMode = null;
const nonAdminRequest = analyzeRequest('quality');
let response = await adminGate({
  env,
  request: nonAdminRequest,
  next: async (request) => {
    forwardedMode = (await request.json()).routingMode;
    return Response.json({ rows: [], warnings: [], telemetry: { estimatedUsd: 1.23 } });
  },
});
let payload = await response.json();
assert(forwardedMode === 'auto', 'Non-admin analyze request must be forced to Auto');
assert(!('telemetry' in payload), 'Non-admin response must not expose cost telemetry');

const token = await createAdminSession(env);
forwardedMode = null;
response = await adminGate({
  env,
  request: analyzeRequest('quality', token),
  next: async (request) => {
    forwardedMode = (await request.json()).routingMode;
    return Response.json({ rows: [], warnings: [], telemetry: { estimatedUsd: 1.23 } });
  },
});
payload = await response.json();
assert(forwardedMode === 'quality', 'Admin analyze request should retain selected routing mode');
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
const setCookie = response.headers.get('set-cookie') || '';
assert(/rc_admin=/.test(setCookie) && /HttpOnly/i.test(setCookie) && /Secure/i.test(setCookie), 'Admin cookie must be HttpOnly and Secure');

console.log('admin gate smoke tests passed (8 checks)');

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
