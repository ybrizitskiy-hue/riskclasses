import { isAdminRequest } from '../lib/admin.js';
import { getGlobalRoutingMode } from '../lib/runtime-config.js';

export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (url.pathname !== '/api/analyze' || context.request.method !== 'POST') {
    return context.next();
  }

  const admin = await isAdminRequest(context.request, context.env);
  const globalRoutingMode = await getGlobalRoutingMode(context.env);
  let request = context.request;

  try {
    const body = await context.request.clone().json();
    body.routingMode = globalRoutingMode;
    const headers = new Headers(context.request.headers);
    headers.set('content-type', 'application/json');
    headers.delete('content-length');
    request = new Request(context.request, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    // Let the route handler return its normal JSON validation error.
  }

  const response = await context.next(request);
  if (admin) return response;

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return response;

  try {
    const payload = await response.clone().json();
    if (payload && typeof payload === 'object') {
      delete payload.telemetry;
      delete payload.cost;
      delete payload.costTelemetry;
    }
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.set('content-type', 'application/json; charset=utf-8');
    headers.set('cache-control', 'no-store');
    return new Response(JSON.stringify(payload), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return response;
  }
}
