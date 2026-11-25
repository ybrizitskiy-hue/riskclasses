import { providerFromCompetitionId, resolveGlobalBrands } from './input-contract.js';

export function buildRuntimeIndex(source = '') {
  const bundle = source && typeof source === 'object' && !Array.isArray(source) ? source : null;
  const deterministicRules = bundle?.deterministicRules && typeof bundle.deterministicRules === 'object'
    ? bundle.deterministicRules
    : null;


  return {
    deterministicRules,
    compiledRules: compileRules(deterministicRules?.rules),
    compiledTransforms: compileTransforms(bundle?.resultTransforms),
  };
}

export function classifyDeterministic(row, index) {
  const sportRaw = String(row?.sport || '').trim();
  const competitionRaw = String(row?.competition || '').trim();
  if (!sportRaw || !competitionRaw) return null;

  const sport = normalize(sportRaw);
  const competition = normalize(competitionRaw);
  const competitionId = normalizeCompetitionId(
    row?.competitionId ?? row?.eventId ?? row?.competitionID ?? row?.eventID ?? '',
  );
  const inferredProvider = row?.dataProvider || providerFromCompetitionId(competitionId);
  const dataProvider = normalize(inferredProvider);
  if (!index?.compiledRules?.length) return null;

  let result = null;
  for (const compiled of index?.compiledRules || []) {
      if (compiled.sport !== sport) continue;
      if (compiled.providers.length && !compiled.providers.includes(dataProvider)) continue;
      if (!matches(compiled, competition, dataProvider, competitionId)) continue;
      result = confirmed(compiled);
      break;
    }

  if (!result) return null;
  result = applyTransforms(result, { ...row, sport: sportRaw, competition: competitionRaw, dataProvider: inferredProvider }, index?.compiledTransforms || []);
  return { ...result, sport: sportRaw, competition: competitionRaw, route: 'deterministic' };
}

function compileRules(rules) {
  if (!Array.isArray(rules)) return [];
  const output = [];
  for (const item of rules) {
    if (!item || typeof item !== 'object') continue;
    const sport = normalize(item.sport || '');
    if (!sport) continue;
    const match = item.match || {};
    try {
      output.push({
        id: String(item.id || ''),
        sport,
        providers: compileProviders(item.providers),
        exact: compileExact(match.exact),
        competitionIds: new Set((match.competitionIds || []).map(normalizeCompetitionId)),
        any: compileList(match.any),
        all: compileList(match.all),
        none: compileList(match.none),
        global: String(item.global || ''),
        daznEs: String(item.daznEs || ''),
        daznDe: String(item.daznDe || ''),
        daznUk: String(item.daznUk || ''),
        basis: String(item.basis || ''),
        source: String(item.source || 'Risk Class guide'),
        confidence: String(item.confidence || 'High'),
        manualCheck: Boolean(item.manualCheck),
        manualCheckType: String(item.manualCheckType || ''),
        manualCheckReason: String(item.manualCheckReason || ''),
        needsEscalation: Boolean(item.needsEscalation),
        escalationReason: String(item.escalationReason || ''),
      });
    } catch {
      // Invalid regexes are rejected by Rules Manager validation. Skip here defensively.
    }
  }
  return output;
}

function compileTransforms(transforms) {
  if (!Array.isArray(transforms)) return [];
  const output = [];
  for (const item of transforms) {
    if (!item || typeof item !== 'object') continue;
    try {
      output.push({
        id: String(item.id || ''),
        sports: (Array.isArray(item.sports) ? item.sports : []).map(normalize).filter(Boolean),
        providers: compileProviders(item.providers),
        field: String(item.field || 'competition'),
        any: compileList(item.match?.any),
        all: compileList(item.match?.all),
        none: compileList(item.match?.none),
        brandMap: normalizeBrandMap(item.brandMap),
        basisSuffix: String(item.basisSuffix || ''),
      });
    } catch {
      // Validation catches malformed regexes. Skip defensively at runtime.
    }
  }
  return output;
}

function normalizeBrandMap(value) {
  const map = new Map();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return map;
  for (const [from, to] of Object.entries(value)) {
    const fromRc = normalizeRc(from);
    const toRc = normalizeRc(to);
    if (fromRc && toRc) map.set(fromRc, toRc);
  }
  return map;
}

function compileProviders(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => normalize(value))
    .filter(Boolean);
}

function compileExact(values) {
  return new Set((Array.isArray(values) ? values : []).map(normalize).filter(Boolean));
}

function compileList(values) {
  return (Array.isArray(values) ? values : [])
    .filter((value) => typeof value === 'string' && value)
    .map((value) => new RegExp(value, 'i'));
}

function normalizeCompetitionId(value) {
  return String(value ?? '').trim().toUpperCase();
}

function matches(rule, competition, dataProvider, competitionId) {
  if (rule.competitionIds.size) return rule.competitionIds.has(competitionId);
  if (rule.exact.size && !rule.exact.has(competition)) return false;
  const test = (pattern) => pattern.test(competition) || Boolean(dataProvider && pattern.test(dataProvider));
  if (rule.any.length && !rule.any.some(test)) return false;
  if (rule.all.length && !rule.all.every(test)) return false;
  if (rule.none.some(test)) return false;
  return rule.exact.size > 0 || rule.any.length > 0 || rule.all.length > 0;
}

function confirmed(rule) {
  const brands = resolveGlobalBrands({
    global: rule.global,
    daznEs: rule.daznEs,
    daznDe: rule.daznDe,
    daznUk: rule.daznUk,
  });
  return {
    ...brands,
    basis: rule.basis,
    confidence: ['High', 'Medium', 'Low'].includes(rule.confidence) ? rule.confidence : 'High',
    sources: [rule.source || 'Risk Class guide'],
    manualCheck: Boolean(rule.manualCheck),
    manualCheckType: rule.manualCheckType || '',
    manualCheckReason: rule.manualCheckReason || '',
    needsEscalation: Boolean(rule.needsEscalation),
    escalationReason: rule.escalationReason || '',
  };
}

function applyTransforms(result, row, transforms) {
  let current = { ...result };
  for (const transform of transforms) {
    if (!transformMatches(transform, row)) continue;
    current = {
      ...current,
      global: mapRc(current.global, transform.brandMap),
      daznEs: mapRc(current.daznEs, transform.brandMap),
      daznDe: mapRc(current.daznDe, transform.brandMap),
      daznUk: mapRc(current.daznUk, transform.brandMap),
      basis: transform.basisSuffix
        ? `${String(current.basis || '').trim()}${transform.basisSuffix}`
        : current.basis,
    };
  }
  return current;
}

function transformMatches(transform, row) {
  const sport = normalize(row?.sport || '');
  const provider = normalize(row?.dataProvider || providerFromCompetitionId(row?.competitionId || ''));
  if (transform.sports.length && !transform.sports.includes(sport)) return false;
  if (transform.providers.length && !transform.providers.includes(provider)) return false;
  const raw = String(row?.[transform.field] ?? '');
  const value = normalize(raw);
  if (transform.any.length && !transform.any.some((pattern) => pattern.test(value))) return false;
  if (transform.all.length && !transform.all.every((pattern) => pattern.test(value))) return false;
  if (transform.none.some((pattern) => pattern.test(value))) return false;
  return transform.any.length > 0 || transform.all.length > 0;
}

function mapRc(value, brandMap) {
  const text = String(value || '');
  const match = text.match(/^\s*(RC\s+[A-I])(\s+rec\.)?\s*$/i);
  if (!match) return value;
  const mapped = brandMap.get(normalizeRc(match[1]));
  if (!mapped) return value;
  return `${mapped}${match[2] ? ' rec.' : ''}`;
}

function normalizeRc(value) {
  const match = String(value || '').trim().match(/^RC\s+([A-I])$/i);
  return match ? `RC ${match[1].toUpperCase()}` : '';
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
