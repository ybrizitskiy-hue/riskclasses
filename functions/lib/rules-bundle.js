export const RULES_KEY = 'custom-gpt-v2';
export const HISTORY_INDEX_KEY = 'rules-history-index-v1';
export const RULES_SCHEMA_VERSION = 1;
const MAX_HISTORY = 20;
const MAX_BUNDLE_CHARS = 750000;
const VALID_RC = /^RC\s+[A-I]$/;
const VALID_DATA_PROVIDERS = new Set(['Betradar', 'Betgenius', 'Databet']);

// Backward-compatible export name for old callers/tests. It intentionally contains
// no sportsbook mappings. The managed JSON is the only source of RC rules.
export function baselineDeterministicRules() {
  return { engineVersion: 2, rules: [] };
}

export function migrateLegacyBundle(value) {
  const source = unwrapBundle(value);
  if (!source || typeof source !== 'object') return null;
  const legacy = !source.schemaVersion && !source.deterministicRules;
  const bundle = {
    ...source,
    schemaVersion: Number(source.schemaVersion || RULES_SCHEMA_VERSION),
    version: String(source.version || 'unversioned').trim(),
    instructions: String(source.instructions || ''),
    knowledge: String(source.knowledge || ''),
    deterministicRules: source.deterministicRules || baselineDeterministicRules(),
    resultPolicies: Array.isArray(source.resultPolicies) ? source.resultPolicies : [],
    resultTransforms: Array.isArray(source.resultTransforms) ? source.resultTransforms : [],
  };
  return { bundle, legacy };
}

export function unwrapBundle(value) {
  if (value && typeof value === 'object' && value.bundle && typeof value.bundle === 'object') return value.bundle;
  return value;
}

export function validateRulesBundle(value) {
  const errors = [];
  const warnings = [];
  const source = unwrapBundle(value);
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return { valid: false, errors: ['Rules file must contain a JSON object.'], warnings, stats: emptyStats() };
  }

  const serializedLength = safeJsonLength(source);
  if (serializedLength > MAX_BUNDLE_CHARS) errors.push(`Rules bundle is too large (${serializedLength} characters; max ${MAX_BUNDLE_CHARS}).`);
  if (Number(source.schemaVersion) !== RULES_SCHEMA_VERSION) errors.push(`schemaVersion must be ${RULES_SCHEMA_VERSION}.`);
  if (!String(source.version || '').trim()) errors.push('version is required.');
  if (typeof source.instructions !== 'string' || source.instructions.trim().length < 500) errors.push('instructions must be a substantial non-empty string.');
  if (typeof source.knowledge !== 'string' || source.knowledge.trim().length < 2000) errors.push('knowledge must be a substantial non-empty string.');

  const deterministic = source.deterministicRules;
  if (!deterministic || typeof deterministic !== 'object') errors.push('deterministicRules is required.');
  const rules = Array.isArray(deterministic?.rules) ? deterministic.rules : [];
  if (!rules.length) errors.push('deterministicRules.rules must contain at least one rule. Import a complete managed JSON bundle; code does not supply fallback RC mappings.');

  const ids = new Set();
  for (let index = 0; index < rules.length; index += 1) {
    const item = rules[index] || {};
    const prefix = `deterministicRules.rules[${index}]`;
    const id = String(item.id || '').trim();
    if (!id) errors.push(`${prefix}.id is required.`);
    else if (ids.has(id)) errors.push(`Duplicate deterministic rule id: ${id}.`);
    else ids.add(id);
    if (!String(item.sport || '').trim()) errors.push(`${prefix}.sport is required.`);
    validateRc(item.dazn, `${prefix}.dazn`, errors);
    validateRc(item.quinnbet, `${prefix}.quinnbet`, errors);
    validateRc(item.nti, `${prefix}.nti`, errors);
    if (!String(item.basis || '').trim()) errors.push(`${prefix}.basis is required.`);
    if (item.confidence != null && !['High', 'Medium', 'Low'].includes(item.confidence)) errors.push(`${prefix}.confidence must be High, Medium or Low when supplied.`);
    if (item.manualCheckType != null && typeof item.manualCheckType !== 'string') errors.push(`${prefix}.manualCheckType must be a string when supplied.`);
    if (item.manualCheckReason != null && typeof item.manualCheckReason !== 'string') errors.push(`${prefix}.manualCheckReason must be a string when supplied.`);

    validateProviders(item.providers, `${prefix}.providers`, errors);

    const match = item.match;
    if (!match || typeof match !== 'object') {
      errors.push(`${prefix}.match is required.`);
      continue;
    }
    let matcherCount = 0;
    const exact = match.exact;
    if (exact != null) {
      if (!Array.isArray(exact)) errors.push(`${prefix}.match.exact must be an array.`);
      else {
        matcherCount += exact.length;
        for (const value of exact) if (typeof value !== 'string' || !value.trim()) errors.push(`${prefix}.match.exact contains an empty/non-string value.`);
      }
    }
    for (const key of ['any', 'all', 'none']) {
      const patterns = match[key];
      if (patterns == null) continue;
      if (!Array.isArray(patterns)) {
        errors.push(`${prefix}.match.${key} must be an array.`);
        continue;
      }
      matcherCount += key === 'none' ? 0 : patterns.length;
      validateRegexList(patterns, `${prefix}.match.${key}`, errors);
    }
    if (!matcherCount) errors.push(`${prefix}.match must contain at least one positive exact/any/all matcher.`);

    // Provider sentinels keep a provider rule inert if an old engine that ignores the
    // providers field ever reads the same managed JSON. This is structural safety only.
    if (Array.isArray(item.providers) && item.providers.length) {
      const positivePatterns = [
        ...(Array.isArray(match.any) ? match.any : []),
        ...(Array.isArray(match.all) ? match.all : []),
      ].join(' ').toLowerCase();
      for (const provider of item.providers) {
        if (VALID_DATA_PROVIDERS.has(provider) && !positivePatterns.includes(provider.toLowerCase())) {
          errors.push(`${prefix}.match must include a provider sentinel regex for ${provider}.`);
        }
      }
    }
  }

  validateResultPolicies(source.resultPolicies, errors);
  validateResultTransforms(source.resultTransforms, errors);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: {
      schemaVersion: Number(source.schemaVersion || 0),
      version: String(source.version || ''),
      deterministicRuleCount: rules.length,
      resultPolicyCount: Array.isArray(source.resultPolicies) ? source.resultPolicies.length : 0,
      resultTransformCount: Array.isArray(source.resultTransforms) ? source.resultTransforms.length : 0,
      knowledgeChars: typeof source.knowledge === 'string' ? source.knowledge.length : 0,
      instructionChars: typeof source.instructions === 'string' ? source.instructions.length : 0,
      bundleChars: serializedLength,
    },
  };
}

function validateResultPolicies(value, errors) {
  if (value == null) return;
  if (!Array.isArray(value)) {
    errors.push('resultPolicies must be an array when supplied.');
    return;
  }
  const ids = new Set();
  value.forEach((policy, index) => {
    const prefix = `resultPolicies[${index}]`;
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
      errors.push(`${prefix} must be an object.`);
      return;
    }
    const id = String(policy.id || '').trim();
    if (!id) errors.push(`${prefix}.id is required.`);
    else if (ids.has(id)) errors.push(`Duplicate result policy id: ${id}.`);
    else ids.add(id);
    if (policy.confidences != null && (!Array.isArray(policy.confidences) || policy.confidences.some((v) => !['High', 'Medium', 'Low'].includes(v)))) errors.push(`${prefix}.confidences must be an array containing only High, Medium or Low.`);
    if (policy.sports != null && (!Array.isArray(policy.sports) || policy.sports.some((v) => typeof v !== 'string' || !v.trim()))) errors.push(`${prefix}.sports must be an array of non-empty strings.`);
    validateProviders(policy.providers, `${prefix}.providers`, errors);
    if (policy.field != null && (typeof policy.field !== 'string' || !policy.field.trim())) errors.push(`${prefix}.field must be a non-empty string when supplied.`);
    validateRegexList(policy.whenMissingPatterns, `${prefix}.whenMissingPatterns`, errors, true);
    validateRegexList(policy.requirePatterns, `${prefix}.requirePatterns`, errors, true);
    validateRegexList(policy.excludePatterns, `${prefix}.excludePatterns`, errors, true);
    if (![policy.whenMissingPatterns, policy.requirePatterns, policy.excludePatterns].some((list) => Array.isArray(list) && list.length) && !(Array.isArray(policy.confidences) && policy.confidences.length) && !(Array.isArray(policy.sports) && policy.sports.length) && !(Array.isArray(policy.providers) && policy.providers.length)) {
      errors.push(`${prefix} must contain at least one match condition.`);
    }
    if (policy.manualCheck != null && typeof policy.manualCheck !== 'boolean') errors.push(`${prefix}.manualCheck must be boolean when supplied.`);
    if (policy.manualCheckType != null && (typeof policy.manualCheckType !== 'string' || !policy.manualCheckType.trim())) errors.push(`${prefix}.manualCheckType must be a non-empty string when supplied.`);
    if (policy.reason != null && typeof policy.reason !== 'string') errors.push(`${prefix}.reason must be a string when supplied.`);
    if (policy.suppressEscalationWhenHigh != null && typeof policy.suppressEscalationWhenHigh !== 'boolean') errors.push(`${prefix}.suppressEscalationWhenHigh must be boolean when supplied.`);
  });
}

function validateResultTransforms(value, errors) {
  if (value == null) return;
  if (!Array.isArray(value)) {
    errors.push('resultTransforms must be an array when supplied.');
    return;
  }
  const ids = new Set();
  value.forEach((transform, index) => {
    const prefix = `resultTransforms[${index}]`;
    if (!transform || typeof transform !== 'object' || Array.isArray(transform)) {
      errors.push(`${prefix} must be an object.`);
      return;
    }
    const id = String(transform.id || '').trim();
    if (!id) errors.push(`${prefix}.id is required.`);
    else if (ids.has(id)) errors.push(`Duplicate result transform id: ${id}.`);
    else ids.add(id);
    if (transform.sports != null && (!Array.isArray(transform.sports) || transform.sports.some((v) => typeof v !== 'string' || !v.trim()))) errors.push(`${prefix}.sports must be an array of non-empty strings.`);
    validateProviders(transform.providers, `${prefix}.providers`, errors);
    if (transform.field != null && (typeof transform.field !== 'string' || !transform.field.trim())) errors.push(`${prefix}.field must be a non-empty string when supplied.`);
    const match = transform.match;
    if (!match || typeof match !== 'object' || Array.isArray(match)) errors.push(`${prefix}.match is required.`);
    else {
      validateRegexList(match.any, `${prefix}.match.any`, errors, true);
      validateRegexList(match.all, `${prefix}.match.all`, errors, true);
      validateRegexList(match.none, `${prefix}.match.none`, errors, true);
      if (![match.any, match.all].some((list) => Array.isArray(list) && list.length)) errors.push(`${prefix}.match must contain at least one positive any/all regex.`);
    }
    if (!transform.brandMap || typeof transform.brandMap !== 'object' || Array.isArray(transform.brandMap) || !Object.keys(transform.brandMap).length) errors.push(`${prefix}.brandMap must be a non-empty object.`);
    else for (const [from, to] of Object.entries(transform.brandMap)) {
      validateRc(from, `${prefix}.brandMap key ${from}`, errors);
      validateRc(to, `${prefix}.brandMap.${from}`, errors);
    }
    if (transform.basisSuffix != null && typeof transform.basisSuffix !== 'string') errors.push(`${prefix}.basisSuffix must be a string when supplied.`);
  });
}

function validateProviders(value, path, errors) {
  if (value == null) return;
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array when supplied.`);
    return;
  }
  const seen = new Set();
  for (const provider of value) {
    if (!VALID_DATA_PROVIDERS.has(provider)) errors.push(`${path} contains unsupported value: ${String(provider)}.`);
    else if (seen.has(provider)) errors.push(`${path} contains duplicate value: ${provider}.`);
    seen.add(provider);
  }
}

function validateRegexList(value, path, errors, optional = false) {
  if (value == null && optional) return;
  if (value == null) return;
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array.`);
    return;
  }
  for (const pattern of value) {
    if (typeof pattern !== 'string' || !pattern) errors.push(`${path} contains an empty/non-string regex.`);
    else {
      try { new RegExp(pattern, 'i'); } catch { errors.push(`${path} contains invalid regex: ${pattern}`); }
    }
  }
}

function validateRc(value, path, errors) {
  if (!VALID_RC.test(String(value || '').trim())) errors.push(`${path} must be one of RC A through RC I.`);
}

function safeJsonLength(value) {
  try { return JSON.stringify(value).length; } catch { return Number.MAX_SAFE_INTEGER; }
}

function emptyStats() {
  return { schemaVersion: 0, version: '', deterministicRuleCount: 0, resultPolicyCount: 0, resultTransformCount: 0, knowledgeChars: 0, instructionChars: 0, bundleChars: 0 };
}

export function diffRulesBundles(currentValue, nextValue) {
  const current = unwrapBundle(currentValue) || {};
  const next = unwrapBundle(nextValue) || {};
  const currentRules = mapById(current?.deterministicRules?.rules);
  const nextRules = mapById(next?.deterministicRules?.rules);
  const added = [];
  const removed = [];
  const changed = [];

  for (const [id, value] of nextRules) {
    if (!currentRules.has(id)) added.push(id);
    else if (stable(value) !== stable(currentRules.get(id))) changed.push(id);
  }
  for (const id of currentRules.keys()) if (!nextRules.has(id)) removed.push(id);

  const resultPoliciesChanged = stable(current.resultPolicies || []) !== stable(next.resultPolicies || []);
  const resultTransformsChanged = stable(current.resultTransforms || []) !== stable(next.resultTransforms || []);
  return {
    versionFrom: String(current.version || ''),
    versionTo: String(next.version || ''),
    instructionsChanged: String(current.instructions || '') !== String(next.instructions || ''),
    knowledgeChanged: String(current.knowledge || '') !== String(next.knowledge || ''),
    resultPoliciesChanged,
    resultTransformsChanged,
    instructionCharDelta: String(next.instructions || '').length - String(current.instructions || '').length,
    knowledgeCharDelta: String(next.knowledge || '').length - String(current.knowledge || '').length,
    deterministic: { added, removed, changed },
    changed: Boolean(
      String(current.version || '') !== String(next.version || '') ||
      String(current.instructions || '') !== String(next.instructions || '') ||
      String(current.knowledge || '') !== String(next.knowledge || '') ||
      resultPoliciesChanged || resultTransformsChanged ||
      added.length || removed.length || changed.length
    ),
  };
}

function mapById(rules) {
  return new Map((Array.isArray(rules) ? rules : []).filter(Boolean).map((item) => [String(item.id || ''), item]));
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export async function loadCurrentRulesBundle(kv, { migrateLegacy = true } = {}) {
  const raw = await kv.get(RULES_KEY);
  if (!raw) return null;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return null; }
  const migrated = migrateLegacyBundle(parsed);
  if (!migrated) return null;
  if (migrated.legacy && migrateLegacy && typeof kv.put === 'function') {
    const next = {
      ...migrated.bundle,
      migratedAt: new Date().toISOString(),
      migrationNote: 'Added schemaVersion only. No sportsbook RC mappings are supplied by application code; import a complete managed JSON bundle.',
    };
    const validation = validateRulesBundle(next);
    if (validation.valid) {
      await kv.put(RULES_KEY, JSON.stringify(next));
      return next;
    }
  }
  return migrated.bundle;
}

export async function listRulesHistory(kv) {
  try {
    const raw = await kv.get(HISTORY_INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

export async function archiveRulesBundle(kv, bundle, reason = 'publish') {
  if (!kv || typeof kv.put !== 'function' || !bundle) return null;
  const timestamp = new Date().toISOString();
  const key = `rules-history:${Date.now()}:${safeKey(bundle.version || 'rules')}`;
  await kv.put(key, JSON.stringify(bundle));
  const entries = await listRulesHistory(kv);
  entries.unshift({ key, version: String(bundle.version || ''), archivedAt: timestamp, reason });
  const keep = entries.slice(0, MAX_HISTORY);
  await kv.put(HISTORY_INDEX_KEY, JSON.stringify({ entries: keep }));
  if (typeof kv.delete === 'function') {
    for (const old of entries.slice(MAX_HISTORY)) {
      if (old?.key) await kv.delete(old.key).catch(() => {});
    }
  }
  return key;
}

export async function loadHistoryBundle(kv, key) {
  if (!/^rules-history:[0-9]+:[a-z0-9._-]+$/i.test(String(key || ''))) return null;
  try {
    const raw = await kv.get(String(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return unwrapBundle(parsed);
  } catch {
    return null;
  }
}

export function preparePublishedBundle(candidateValue, currentBundle) {
  const candidate = structuredCloneSafe(unwrapBundle(candidateValue));
  if (!candidate) return null;
  candidate.schemaVersion = RULES_SCHEMA_VERSION;
  candidate.version = String(candidate.version || '').trim();
  if (currentBundle && candidate.version === String(currentBundle.version || '')) {
    candidate.version = `${candidate.version || 'rules'}-r${compactTimestamp()}`;
  }
  candidate.updatedAt = new Date().toISOString();
  delete candidate.migratedAt;
  delete candidate.migrationNote;
  return candidate;
}

function structuredCloneSafe(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch { return null; }
}

function compactTimestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function safeKey(value) {
  return String(value || 'rules').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'rules';
}
