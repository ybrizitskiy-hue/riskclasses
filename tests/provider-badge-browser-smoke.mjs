import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../provider-badge.js', import.meta.url), 'utf8');
const timeouts = [];
const listeners = new Map();
let observerConstructed = false;
let textWrites = 0;

function textNode(initial = '') {
  let value = initial;
  return {
    get textContent() { return value; },
    set textContent(next) { value = String(next); textWrites += 1; },
  };
}

const modelPill = textNode('Auto · optimized');
const routingDescription = textNode('');
const costStrong = textNode('$0.0042');
const costSmall = textNode('Est. cost');
const costMetric = {
  title: '',
  querySelector(selector) {
    if (selector === 'small') return costSmall;
    if (selector === 'strong') return costStrong;
    return null;
  },
};
const telemetryPanel = {
  querySelectorAll(selector) {
    return selector === '.telemetry-metrics > span' ? [costMetric] : [];
  },
};

const routingState = {
  mode: 'auto',
  admin: true,
  telemetry: { unpricedCalls: 1 },
};

const context = {
  console,
  document: {
    getElementById(id) {
      if (id === 'routingModelPill') return modelPill;
      if (id === 'routingDescription') return routingDescription;
      if (id === 'routingTelemetry') return telemetryPanel;
      return null;
    },
    querySelector(selector) {
      return selector === '.model-pill' ? modelPill : null;
    },
  },
  RISK_ROUTING: routingState,
  addEventListener(name, handler) {
    const handlers = listeners.get(name) || [];
    handlers.push(handler);
    listeners.set(name, handlers);
  },
  dispatchEvent(event) {
    for (const handler of listeners.get(event.type) || []) handler(event);
  },
  setTimeout(handler) {
    timeouts.push(handler);
    return timeouts.length;
  },
  clearTimeout() {},
  MutationObserver: class {
    constructor() {
      observerConstructed = true;
      throw new Error('provider-badge.js must not create a document MutationObserver');
    }
  },
};
context.window = context;
context.fetch = async (input) => {
  const url = typeof input === 'string' ? input : input?.url || '';
  if (url.includes('/api/meta')) {
    return {
      ok: true,
      async json() {
        return {
          routing: {
            globalMode: 'auto',
            primary: { profile: 'OpenAI Luna' },
            labels: {
              auto: 'Alt Primary → OpenAI Terra',
              economy: 'Alt Primary',
              quality: 'OpenAI Terra',
            },
          },
        };
      },
    };
  }
  return { ok: true, async json() { return {}; } };
};

vm.createContext(context);
vm.runInContext(source, context, { filename: 'provider-badge.js' });
assert(!observerConstructed, 'Provider badge must initialize without MutationObserver');

await drainTimers();
assert(modelPill.textContent === 'Auto · Alt Primary → OpenAI Terra · managed', 'Initial provider badge should use /api/meta labels');
assert(costStrong.textContent === 'Unavailable', 'Unpriced telemetry should display Unavailable');
assert(timeouts.length === 0, 'Initialization must settle without recurring DOM/timer work');

routingState.mode = 'quality';
await context.fetch('/api/admin', { method: 'PUT' });
await drainTimers();
assert(modelPill.textContent === 'Quality · OpenAI Terra · managed', 'Admin routing change should resync the provider badge');
assert(timeouts.length === 0, 'Routing resync must settle');

routingState.mode = 'economy';
context.dispatchEvent({ type: 'risk-routing-updated' });
assert(modelPill.textContent === 'Economy · Alt Primary · managed', 'Explicit routing event should update the badge');
assert(textWrites < 20, `Unexpected repeated DOM writes detected: ${textWrites}`);

console.log('provider badge browser smoke tests passed (8 checks)');

async function drainTimers(limit = 20) {
  let count = 0;
  while (timeouts.length) {
    if (++count > limit) throw new Error('Timer queue did not settle; possible UI feedback loop');
    const handler = timeouts.shift();
    await handler();
    await Promise.resolve();
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
