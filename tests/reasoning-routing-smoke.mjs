import { readFile } from 'node:fs/promises';

const analyze = await readFile(new URL('../functions/api/analyze-core.js', import.meta.url), 'utf8');
const manager = await readFile(new URL('../reasoning-manager.js', import.meta.url), 'utf8');
const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');

assert(analyze.includes("import { effortFor, loadReasoningConfig } from '../lib/reasoning-config.js';"), 'Analyzer must load the managed reasoning configuration');
assert(analyze.includes("effortFor(reasoningConfig, routingMode, 'extraction')"), 'Extraction must use the mode-specific configured effort');
assert(analyze.includes("effortFor(reasoningConfig, routingMode, 'primary')"), 'Primary classification must use the configured effort');
assert(analyze.includes("effortFor(reasoningConfig, routingMode, 'research')"), 'Research must use the configured effort');
assert(analyze.includes("effortFor(reasoningConfig, routingMode, 'escalation')"), 'Escalation must use the configured effort');
assert(!analyze.includes("reasoning: routingMode === 'quality' ? 'medium' : 'medium'"), 'Old hardcoded primary reasoning must not remain');
assert(!/reasoning:\s*'medium',\s*stage:\s*`\$\{routingMode\}-(?:research|escalation)`/.test(analyze), 'Old hardcoded review-stage reasoning must not remain');
assert(analyze.includes('reasoningConfigVersion'), 'Analysis telemetry must record the reasoning configuration version');

assert(index.includes('<script src="/reasoning-manager.js"></script>'), 'The reasoning manager must load on the website');
assert(manager.includes("const EFFORTS = [['none','None'],['low','Low'],['medium','Medium'],['high','High']]"), 'Admin UI must expose None, Low, Medium and High');
assert(manager.includes("button.textContent = 'AI reasoning'"), 'Admin must expose the reasoning manager button');
assert(manager.includes("fetch('/api/reasoning'"), 'Reasoning manager must use the protected reasoning API');
assert(manager.includes('Publish globally'), 'Reasoning manager must publish one global configuration');
assert(!/overlay\.addEventListener\(['"]click['"][\s\S]{0,160}closeManager/.test(manager), 'Reasoning manager must not close from backdrop clicks');
assert(manager.includes("const SESSION_DRAFT_KEY = 'risk-reasoning-manager-draft-v1'"), 'Reasoning manager must preserve unsaved edits across an accidental reload');
assert(manager.includes('reopenAfterReload()'), 'Reasoning manager must reopen after a reload when the admin session survives');

console.log('reasoning routing smoke tests passed (16 checks)');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
