import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../provider-manager.js', import.meta.url), 'utf8');

assert(!/overlay\.addEventListener\(['"]click['"][\s\S]{0,160}closeManager/.test(source), 'Provider Manager must not close from backdrop clicks');
assert(source.includes("const SESSION_DRAFT_KEY = 'risk-provider-manager-draft-v1'"), 'Provider Manager must persist unsaved draft state in the session');
assert(source.includes("const SESSION_OPEN_KEY = 'risk-provider-manager-open-v1'"), 'Provider Manager must remember that it was open across an accidental reload');
assert(source.includes('restoreSessionDraft()'), 'Provider Manager must restore a saved draft');
assert(source.includes('reopenAfterReload()'), 'Provider Manager must reopen after an accidental page reload when the admin session survives');
assert(source.includes("function scheduleValidate(delay = 700)"), 'Provider validation must stay debounced while the admin is typing');

const editStart = source.indexOf('function handleProfileEdit(event)');
const editEnd = source.indexOf('async function handleProfileAction', editStart);
assert(editStart >= 0 && editEnd > editStart, 'Could not inspect profile edit handler');
const editBlock = source.slice(editStart, editEnd);
assert(!editBlock.includes('renderEnvironment();'), 'Profile keystrokes must not rebuild the environment section');
assert(!/renderRoutes\(\);\s*renderEnvironment\(\);/.test(editBlock), 'Profile keystrokes must not rebuild multiple unrelated UI sections');

console.log('provider panel stability smoke tests passed (8 checks)');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
