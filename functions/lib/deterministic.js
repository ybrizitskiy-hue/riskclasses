const RC_ORDER = ['A','B','C','D','E','F','G','H','I'];

export function buildRuntimeIndex(source = '') {
  const bundle = source && typeof source === 'object' && !Array.isArray(source) ? source : null;
  const knowledge = bundle ? String(bundle.knowledge || '') : String(source || '');
  const deterministicRules = bundle?.deterministicRules && typeof bundle.deterministicRules === 'object'
    ? bundle.deterministicRules
    : null;

  const footballRcI = new Set();
  const marker = '## 7. Explicit RC I Football Leagues';
  const start = knowledge.indexOf(marker);
  if (start >= 0) {
    const tail = knowledge.slice(start + marker.length);
    const next = tail.search(/\n##\s+8\./);
    const section = next >= 0 ? tail.slice(0, next) : tail;
    for (const line of section.split('\n')) {
      const match = line.match(/^\s*\d+\.\s+(.+?)\s*$/);
      if (match) footballRcI.add(normalize(match[1]));
    }
  }

  return {
    footballRcI,
    deterministicRules,
    compiledRules: compileRules(deterministicRules?.rules),
  };
}

export function classifyDeterministic(row, index) {
  const sportRaw = String(row?.sport || '').trim();
  const competitionRaw = String(row?.competition || '').trim();
  if (!sportRaw || !competitionRaw) return null;

  const sport = normalize(sportRaw);
  const competition = normalize(competitionRaw);
  const config = index?.deterministicRules;
  if (!config) return null;

  let result = null;
  const football = config.footballRcI;
  if (
    sport === 'football' &&
    football?.enabled &&
    index?.footballRcI?.has(competition)
  ) {
    result = confirmed(football.dazn, football.quinnbet, football.nti, football.basis || 'Football RC I explicit list', 'Risk Class guide');
  }

  if (!result) {
    for (const compiled of index?.compiledRules || []) {
      if (compiled.sport !== sport) continue;
      if (!matches(compiled, competition)) continue;
      result = confirmed(
        compiled.dazn,
        compiled.quinnbet,
        compiled.nti,
        compiled.basis,
        compiled.source || 'Risk Class guide',
      );
      break;
    }
  }

  if (!result) return null;
  if (isOutrightText(competitionRaw)) result = applyOutright(result);
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
        any: compileList(match.any),
        all: compileList(match.all),
        none: compileList(match.none),
        dazn: String(item.dazn || ''),
        quinnbet: String(item.quinnbet || ''),
        nti: String(item.nti || ''),
        basis: String(item.basis || ''),
        source: String(item.source || 'Risk Class guide'),
      });
    } catch {
      // Invalid regexes are rejected by Rules Manager validation. Skip here defensively.
    }
  }
  return output;
}

function compileList(values) {
  return (Array.isArray(values) ? values : [])
    .filter((value) => typeof value === 'string' && value)
    .map((value) => new RegExp(value, 'i'));
}

function matches(rule, competition) {
  if (rule.any.length && !rule.any.some((pattern) => pattern.test(competition))) return false;
  if (rule.all.length && !rule.all.every((pattern) => pattern.test(competition))) return false;
  if (rule.none.some((pattern) => pattern.test(competition))) return false;
  return rule.any.length > 0 || rule.all.length > 0;
}

function confirmed(dazn, quinnbet, nti, basis, source) {
  return {
    dazn,
    quinnbet,
    nti,
    basis,
    confidence: 'High',
    sources: [source || 'Risk Class guide'],
    manualCheck: false,
  };
}

function applyOutright(result) {
  return {
    ...result,
    dazn: shiftOutright(result.dazn),
    quinnbet: shiftOutright(result.quinnbet),
    nti: shiftOutright(result.nti),
    basis: `${result.basis}; outright +2 classes`,
  };
}

function shiftOutright(value) {
  const match = String(value || '').match(/RC\s+([A-I])/i);
  if (!match) return value;
  const index = RC_ORDER.indexOf(match[1].toUpperCase());
  if (index < 0) return value;
  const shifted = RC_ORDER[Math.max(0, index - 2)];
  return String(value).replace(/RC\s+[A-I]/i, `RC ${shifted}`);
}

function isOutrightText(value) {
  return /\boutright\b|\btournament winner\b|\bchampionship winner\b/i.test(String(value || ''));
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
