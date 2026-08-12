export const RULES_KEY = 'custom-gpt-v2';
export const HISTORY_INDEX_KEY = 'rules-history-index-v1';
export const RULES_SCHEMA_VERSION = 1;
const MAX_HISTORY = 20;
const MAX_BUNDLE_CHARS = 750000;
const VALID_RC = /^RC\s+[A-I]$/;
const VALID_DATA_PROVIDERS = new Set(['Betradar', 'Betgenius', 'Databet']);

export function baselineDeterministicRules() {
  const singles = '\\bsingles?\\b';
  const doubles = '\\b(doubles?|mixed doubles|md|wd|xd)\\b';
  const qualification = '\\b(qualification|qualifier|qualifying|quals?|q[1-3])\\b';
  const legacyDoubles = '\\bdoubles?\\b';
  const legacyQualification = '\\b(qualification|qualifier|qualifying|quals?)\\b';
  const challenger = '\\bchallengers?\\b';
  const wta125 = '\\bwta\\s*125(?:k)?\\b|\\b125k\\b';
  const tour250 = '\\b(?:atp|wta)\\s*250\\b';
  const tour500Plus = '\\b(?:atp|wta)\\s*(?:500|1000)\\b|\\bmasters?\\s*1000\\b|\\bgrand\\s*slams?\\b|\\baustralian\\s*open\\b|\\bfrench\\s*open\\b|\\broland\\s*garros\\b|\\bwimbledon\\b|\\bu\\s*s\\s*open\\b|\\bus\\s*open\\b';
  const junior = '\\b(juniors?|boys?|girls?|wheelchair)\\b';

  return {
    engineVersion: 2,
    footballRcI: {
      enabled: true,
      dazn: 'RC I',
      quinnbet: 'RC I',
      nti: 'RC I',
      basis: 'Football RC I explicit list',
    },
    rules: [
      rule('tennis-srl', 'tennis', ['\\b(srl|simulated reality|virtuals?|simulated)\\b'], [], [], 'RC H', 'RC H', 'RC H', 'Operational exception: Tennis SRL / Simulated Reality not offered'),
      rule('tennis-utr', 'tennis', ['\\butr\\b'], [], [], 'RC H', 'RC G', 'RC H', 'UTR / UTR PTT'),
      rule('tennis-challenger-doubles', 'tennis', [], ['\\bchallenger\\b', legacyDoubles], [], 'RC G', 'RC F', 'RC G', 'Challenger Doubles'),

      rule('tennis-br-challenger-singles', 'tennis', [], [challenger, singles], [doubles], 'RC G', 'RC F', 'RC G', 'Betradar Challenger Singles; Global G, Quinnbet F, NTI G', ['Betradar']),
      rule('tennis-bg-challenger-qual-singles', 'tennis', [], [challenger, singles, qualification], [doubles], 'RC G', 'RC F', 'RC G', 'Betgenius Challenger Qual Singles; Global G, Quinnbet F, NTI G', ['Betgenius']),
      rule('tennis-bg-challenger-singles', 'tennis', [], [challenger, singles], [qualification, doubles], 'RC E', 'RC E', 'RC G', 'Betgenius Challenger Singles; Global E, NTI G', ['Betgenius']),
      rule('tennis-db-challenger-singles', 'tennis', [], [challenger, singles], [doubles], 'RC G', 'RC F', 'RC G', 'Databet Challenger Singles; Global G, Quinnbet F, NTI G', ['Databet']),

      rule('tennis-br-wta125-singles', 'tennis', [], [wta125, singles], [doubles], 'RC G', 'RC F', 'RC G', 'Betradar WTA 125 Singles; Global G, Quinnbet F, NTI G', ['Betradar']),
      rule('tennis-bg-wta125-qual-singles', 'tennis', [], [wta125, singles, qualification], [doubles], 'RC G', 'RC F', 'RC G', 'Betgenius WTA 125 Qual Singles; Global G, Quinnbet F, NTI G', ['Betgenius']),
      rule('tennis-bg-wta125-singles', 'tennis', [], [wta125, singles], [qualification, doubles], 'RC E', 'RC E', 'RC G', 'Betgenius WTA 125 Singles; Global E, NTI G', ['Betgenius']),
      rule('tennis-db-wta125-singles', 'tennis', [], [wta125, singles], [doubles], 'RC G', 'RC F', 'RC G', 'Databet WTA 125 Singles; Global G, Quinnbet F, NTI G', ['Databet']),

      rule('tennis-br-250-singles', 'tennis', [], [tour250, singles], [doubles], 'RC E', 'RC E', 'RC G', 'Betradar ATP/WTA 250 Singles; Global E, NTI G', ['Betradar']),
      rule('tennis-bg-250-qual-singles', 'tennis', [], [tour250, singles, qualification], [doubles], 'RC E', 'RC E', 'RC G', 'Betgenius ATP/WTA 250 Qual Singles; Global E, NTI G', ['Betgenius']),
      rule('tennis-bg-250-singles', 'tennis', [], [tour250, singles], [qualification, doubles], 'RC D', 'RC D', 'RC E', 'Betgenius ATP/WTA 250 Singles; Global D, NTI E', ['Betgenius']),
      rule('tennis-db-250-singles', 'tennis', [], [tour250, singles], [doubles], 'RC E', 'RC E', 'RC G', 'Databet ATP/WTA 250 Singles; Global E, NTI G', ['Databet']),

      rule('tennis-br-500plus-singles', 'tennis', [], [tour500Plus, singles], [doubles, junior], 'RC E', 'RC E', 'RC E', 'Betradar ATP/WTA 500/1000/Grand Slam Singles; Global E, NTI E', ['Betradar']),
      rule('tennis-bg-500plus-qual-singles', 'tennis', [], [tour500Plus, singles, qualification], [doubles, junior], 'RC E', 'RC E', 'RC E', 'Betgenius ATP/WTA 500/1000/Grand Slam Qual Singles; Global E', ['Betgenius']),
      rule('tennis-bg-500plus-singles', 'tennis', [], [tour500Plus, singles], [qualification, doubles, junior], 'RC C', 'RC C', 'RC E', 'Betgenius ATP/WTA 500/1000/Grand Slam Singles; Global C, NTI E', ['Betgenius']),
      rule('tennis-db-500plus-singles', 'tennis', [], [tour500Plus, singles], [doubles, junior], 'RC E', 'RC E', 'RC E', 'Databet ATP/WTA 500/1000/Grand Slam Singles; Global E, NTI E', ['Databet']),

      rule('tennis-itf-qualification', 'tennis', [], ['(?:\\bitf\\b|^wt\\b|\\bworld tennis tour\\b)', legacyQualification], [], 'RC H', 'RC G', 'RC H', 'ITF Singles Qualification'),
      rule('tennis-itf-doubles', 'tennis', [], ['(?:\\bitf\\b|^wt\\b|\\bworld tennis tour\\b)', legacyDoubles], [legacyQualification], 'RC H', 'RC G', 'RC H', 'ITF / World Tennis Tour Doubles'),
      rule('tennis-itf-main', 'tennis', ['(?:\\bitf\\b|^wt\\b|\\bworld tennis tour\\b)'], [], [legacyQualification, legacyDoubles], 'RC G', 'RC F', 'RC G', 'ITF / World Tennis Tour Singles Main Draw'),

      rule('golf-major-ryder', 'golf', ['\\bryder cup\\b|\\bthe masters\\b|\\bmasters tournament\\b|\\bpga championship\\b|\\bu\\.?s\\.? open\\b|\\bthe open championship\\b'], [], [], 'RC A', 'RC A', 'RC A', 'Golf Major / Ryder Cup'),
      rule('golf-pga-tour-champions', 'golf', ['\\bpga tour champions\\b|\\bboeing classic\\b'], [], [], 'RC C', 'RC C', 'RC C', 'PGA Tour Champions / Golf other'),
      rule('golf-korn-ferry-lpga', 'golf', ['\\bkorn ferry\\b|\\blpga\\b'], [], [], 'RC C', 'RC C', 'RC C', 'Korn Ferry / LPGA'),
      rule('golf-pga-dp-liv', 'golf', ['\\bpga tour\\b|\\bdp world tour\\b|\\bliv golf\\b|\\bliv golf league\\b'], [], [], 'RC B', 'RC B', 'RC B', 'PGA Tour / DP World Tour / LIV'),

      rule('tt-wtt-feeder', 'table tennis', ['\\bwtt feeder\\b'], [], [], 'RC D', 'RC D', 'RC D', 'Table Tennis all other comps — WTT Feeder'),
      rule('tt-wtt-star-contender', 'table tennis', ['\\bwtt star contender\\b'], [], [], 'RC D', 'RC D', 'RC D', 'Table Tennis all other comps — WTT Star Contender'),
      rule('tt-singapore-smash', 'table tennis', ['\\bsingapore smash\\b'], [], [], 'RC D', 'RC D', 'RC D', 'Table Tennis explicit RC D category'),

      rule('badminton-world-champs-doubles', 'badminton', [], ['\\bworld championships?\\b', '\\b(doubles?|mixed doubles|md|wd|xd)\\b'], [], 'RC C', 'RC C', 'RC C', 'Badminton World Championships Doubles / XD'),
      rule('badminton-super-750', 'badminton', ['\\bsuper 750\\b'], [], [], 'RC C', 'RC C', 'RC C', 'Badminton Super 750'),
      rule('badminton-elite', 'badminton', ['\\bworld championships?\\b|\\bsuper 1000\\b|\\btour finals\\b|\\beuropean championship\\b'], [], [], 'RC A', 'RC A', 'RC A', 'Badminton elite category'),
      rule('badminton-malaysia-international', 'badminton', ['\\bmalaysia international\\b'], [], [], 'RC D', 'RC D', 'RC D', 'Badminton all other leagues'),

      rule('mma-contender-series', 'mma', ['\\bcontender series\\b'], [], [], 'RC E', 'RC E', 'RC E', 'MMA Contender Series / all-others RC E'),
    ],
  };
}

function rule(id, sport, any, all, none, dazn, quinnbet, nti, basis, providers = []) {
  const match = {
    any: [...any],
    all: [...all],
    none: [...none],
  };
  const output = { id, sport, match, dazn, quinnbet, nti, basis, source: 'Risk Class guide' };
  if (providers.length) {
    output.providers = [...providers];
    // Keep managed provider rules inert on older deterministic engines that do not
    // understand the providers field. Engine v2 also tests these sentinels against
    // normalized provider context, while v1 tests competition text only.
    match.all.push(`\\b(?:${providers.map((provider) => regexEscape(provider.toLowerCase())).join('|')})\\b`);
  }
  return output;
}

function regexEscape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  if (!rules.length) errors.push('deterministicRules.rules must contain at least one rule.');

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

    if (item.providers != null) {
      if (!Array.isArray(item.providers)) {
        errors.push(`${prefix}.providers must be an array when supplied.`);
      } else {
        const seenProviders = new Set();
        for (const provider of item.providers) {
          if (!VALID_DATA_PROVIDERS.has(provider)) {
            errors.push(`${prefix}.providers contains unsupported value: ${String(provider)}.`);
          } else if (seenProviders.has(provider)) {
            errors.push(`${prefix}.providers contains duplicate value: ${provider}.`);
          }
          seenProviders.add(provider);
        }
      }
    }

    const match = item.match;
    if (!match || typeof match !== 'object') {
      errors.push(`${prefix}.match is required.`);
      continue;
    }
    let matcherCount = 0;
    for (const key of ['any', 'all', 'none']) {
      const patterns = match[key];
      if (patterns == null) continue;
      if (!Array.isArray(patterns)) {
        errors.push(`${prefix}.match.${key} must be an array.`);
        continue;
      }
      matcherCount += key === 'none' ? 0 : patterns.length;
      for (const pattern of patterns) {
        if (typeof pattern !== 'string' || !pattern) errors.push(`${prefix}.match.${key} contains an empty/non-string regex.`);
        else {
          try { new RegExp(pattern, 'i'); } catch { errors.push(`${prefix}.match.${key} contains invalid regex: ${pattern}`); }
        }
      }
    }
    if (!matcherCount) errors.push(`${prefix}.match must contain at least one positive any/all regex.`);

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

  if (deterministic?.footballRcI?.enabled) {
    validateRc(deterministic.footballRcI.dazn, 'deterministicRules.footballRcI.dazn', errors);
    validateRc(deterministic.footballRcI.quinnbet, 'deterministicRules.footballRcI.quinnbet', errors);
    validateRc(deterministic.footballRcI.nti, 'deterministicRules.footballRcI.nti', errors);
  }

  const srl = rules.find((item) => item?.id === 'tennis-srl');
  if (!srl) errors.push('Required operational override `tennis-srl` is missing.');
  else if (![srl.dazn, srl.quinnbet, srl.nti].every((value) => value === 'RC H')) {
    errors.push('Required operational override `tennis-srl` must remain RC H / RC H / RC H while Tennis SRL is not offered.');
  }

  if (!/High\s*(?:→|->|=).*No/i.test(source.instructions || '') && !/High[^\n]{0,80}Manual check[^\n]{0,30}No/i.test(source.instructions || '')) {
    warnings.push('Could not automatically confirm the High → Manual check No doctrine in instructions. Review before publishing.');
  }
  if (!/Simulated Reality|Tennis SRL/i.test(source.knowledge || '')) warnings.push('Knowledge text does not visibly mention the Tennis SRL / Simulated Reality exception.');
  if (/blank\s+(?:brand\s+)?cell\s+(?:is\s+)?not\s+(?:the\s+)?same\s+as\s+global/i.test(`${source.instructions || ''}\n${source.knowledge || ''}`)) {
    warnings.push('Rules text still contains the obsolete blank-brand-not-Global doctrine. Review Global inheritance before publishing.');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: {
      schemaVersion: Number(source.schemaVersion || 0),
      version: String(source.version || ''),
      deterministicRuleCount: rules.length,
      knowledgeChars: typeof source.knowledge === 'string' ? source.knowledge.length : 0,
      instructionChars: typeof source.instructions === 'string' ? source.instructions.length : 0,
      bundleChars: serializedLength,
    },
  };
}

function validateRc(value, path, errors) {
  if (!VALID_RC.test(String(value || '').trim())) errors.push(`${path} must be one of RC A through RC I.`);
}

function safeJsonLength(value) {
  try { return JSON.stringify(value).length; } catch { return Number.MAX_SAFE_INTEGER; }
}

function emptyStats() {
  return { schemaVersion: 0, version: '', deterministicRuleCount: 0, knowledgeChars: 0, instructionChars: 0, bundleChars: 0 };
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

  return {
    versionFrom: String(current.version || ''),
    versionTo: String(next.version || ''),
    instructionsChanged: String(current.instructions || '') !== String(next.instructions || ''),
    knowledgeChanged: String(current.knowledge || '') !== String(next.knowledge || ''),
    instructionCharDelta: String(next.instructions || '').length - String(current.instructions || '').length,
    knowledgeCharDelta: String(next.knowledge || '').length - String(current.knowledge || '').length,
    deterministic: { added, removed, changed },
    changed: Boolean(
      String(current.version || '') !== String(next.version || '') ||
      String(current.instructions || '') !== String(next.instructions || '') ||
      String(current.knowledge || '') !== String(next.knowledge || '') ||
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
      migrationNote: 'Added schemaVersion and deterministicRules so the managed KV bundle becomes the single rule source.',
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
