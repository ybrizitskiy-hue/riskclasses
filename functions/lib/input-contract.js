const MISSING_RULE = 'Manual check / missing rule';

const KNOWN_SPORTS = new Set([
  'american football', 'aussie rules', 'badminton', 'bandy', 'baseball', 'basketball', 'beach volley',
  'boxing', 'counter strike', 'cricket', 'darts', 'dota 2', 'football', 'futsal', 'golf', 'handball',
  'horse racing', 'ice hockey', 'league of legends', 'mma', 'rugby league', 'rugby union', 'snooker',
  'table tennis', 'tennis', 'valorant', 'volleyball', 'water polo',
]);

const COMPETITION_ID_HEADERS = new Set([
  'competition id',
  'competition identifier',
  'competitionid',
  'event id',
  'event identifier',
  'eventid',
]);

export function providerFromCompetitionId(value) {
  const id = String(value || '').trim().replace(/^\uFEFF/, '').toUpperCase();
  if (id.startsWith('BG')) return 'Betgenius';
  if (id.startsWith('DB')) return 'Databet';
  if (id.startsWith('U')) return 'Betradar';
  return '';
}

export function decorateInputRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row, inputIndex) => {
      const sport = String(row?.sport || '').trim();
      const competition = String(row?.competition || '').trim();
      const competitionId = String(
        row?.competitionId ?? row?.eventId ?? row?.competitionID ?? row?.eventID ?? '',
      ).trim();
      return {
        inputIndex,
        sport,
        competition,
        competitionId,
        dataProvider: providerFromCompetitionId(competitionId),
      };
    })
    .filter((row) => row.sport && row.competition);
}

export function parseCompetitionRows(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').filter((line) => line.trim());
  const output = [];
  let header = null;

  for (const raw of lines) {
    const parts = splitLine(raw);
    if (parts.length < 2) continue;

    const normalized = parts.map(normalizeHeader);
    const sportIndex = normalized.findIndex((value) => value === 'sport');
    const competitionIndex = normalized.findIndex((value) => value === 'competition' || value === 'competition name');
    const competitionIdIndex = normalized.findIndex((value) => COMPETITION_ID_HEADERS.has(value));
    if (sportIndex >= 0 && competitionIndex >= 0) {
      header = { sportIndex, competitionIndex, competitionIdIndex };
      continue;
    }

    let sport = '';
    let competition = '';
    let competitionId = '';

    if (header) {
      sport = parts[header.sportIndex] || '';
      competition = parts[header.competitionIndex] || '';
      competitionId = header.competitionIdIndex >= 0 ? (parts[header.competitionIdIndex] || '') : '';
    } else if (isKnownSport(parts[0])) {
      sport = parts[0];
      competition = parts[1];
      competitionId = parts[2] || '';
    } else if (parts.length >= 3 && isKnownSport(parts[1])) {
      sport = parts[1];
      competition = parts[2];
      competitionId = parts[3] || '';
    } else {
      sport = parts[0];
      competition = parts[1];
      competitionId = parts[2] || '';
    }

    sport = String(sport || '').trim();
    competition = String(competition || '').trim();
    competitionId = String(competitionId || '').trim();
    if (sport && competition && !(/^sport$/i.test(sport) && /^competition/i.test(competition))) {
      output.push({ sport, competition, competitionId });
    }
  }

  return output;
}

export function resolveGlobalBrands(row) {
  const global = normalizeRcWithRecommendation(row?.global);
  return {
    ...row,
    global,
    dazn: resolveBrand(row?.dazn, global),
    quinnbet: resolveBrand(row?.quinnbet, global),
    nti: resolveBrand(row?.nti, global),
  };
}

export function filterGlobalInheritanceWarnings(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter((warning) => warning && !isGlobalInheritanceOnlyWarning(warning));
}

function resolveBrand(value, global) {
  const text = String(value || '').trim();
  if (isGlobalInheritanceToken(text)) return global || MISSING_RULE;

  const normalized = normalizeRcWithRecommendation(text);
  // Old prompts sometimes added rec. only because a brand cell was blank. When an exact
  // Global value exists, the identical brand recommendation is inherited Global, not a rec.
  if (global && !/\brec\.$/i.test(global) && normalized === `${global} rec.`) return global;
  return normalized || text;
}

function isGlobalInheritanceToken(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ');
  return !normalized || [
    '-',
    'blank',
    'global',
    'same as global',
    'global rec.',
    'same as global rec.',
    'n/a',
    'na',
    'not specified',
    'missing rule',
    'manual check / missing rule',
  ].includes(normalized);
}

function isGlobalInheritanceOnlyWarning(value) {
  const text = String(value || '')
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text.includes('global')) return false;
  // Preserve genuine warnings that say Global itself could not be established.
  if (/\b(?:no|without)\s+(?:a\s+)?global(?:\s+(?:value|rule|class|classification))?\b/.test(text)) return false;
  if (/\b(?:could not|cannot|unable to)\s+(?:establish|determine|resolve|find)\s+(?:a\s+)?global\b/.test(text)) return false;
  if (/\bglobal(?:\s+(?:value|rule|class|classification))?\s+(?:is|was|remains)?\s*(?:missing|unavailable|unclear|unknown|unresolved)\b/.test(text)) return false;

  return [
    /global[- ]based recommendation[^.]*brand rule missing/,
    /\bno\b[^.]{0,80}\bbrand[- ]specific rule\b[^.]{0,120}(?:using|use|inherit|inheriting|default|fallback)[^.]{0,80}\bglobal\b/,
    /brand[- ]specific[^.]*(?:blank|missing|unspecified|not specified)[^.]*(?:inherit|appl|use|default|fallback)[^.]*global/,
    /(?:blank|missing|unspecified|not specified)[^.]*brand[^.]*(?:inherit|appl|use|default|fallback)[^.]*global/,
    /(?:inherit|appl|use|default|fallback)[^.]*global[^.]*(?:blank|missing|unspecified|not specified)[^.]*brand/,
    /global[^.]*(?:appl|default|fallback|fills?)[^.]*unspecified[^.]*(?:brand|dazn|quinnbet|nti)/,
    /(?:dazn|quinnbet|nti)[^.]*brand[- ]specific[^.]*(?:missing|blank|unspecified)[^.]*(?:global|inherit)/,
    /\b(?:no|without)\s+(?:an?\s+)?(?:explicit\s+)?(?:dazn|quinnbet|nti|brand)\s+(?:specific\s+)?(?:override|rule)[^.]*\bglobal\b/,
    /\b(?:dazn|quinnbet|nti|brand)[^.]*\binherits?\s+(?:the\s+)?global\b/,
    /\bglobal\b[^.]*(?:fills?|defaults?\s+to|applies?\s+(?:for|to))[^.]*(?:dazn|quinnbet|nti|unspecified\s+brands?)/,
  ].some((pattern) => pattern.test(text));
}

function normalizeRcWithRecommendation(value) {
  const match = String(value || '').trim().match(/^(?:RC|Risk Class)\s*([A-I])(\s+rec\.)?$/i);
  if (!match) return '';
  return `RC ${match[1].toUpperCase()}${match[2] ? ' rec.' : ''}`;
}

function splitLine(line) {
  if (line.includes('\t')) return line.split('\t').map((value) => value.trim());
  if (line.includes(';')) return line.split(';').map((value) => value.trim());
  return line.split(/\s{2,}/).map((value) => value.trim()).filter(Boolean);
}

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isKnownSport(value) {
  return KNOWN_SPORTS.has(normalizeHeader(value));
}
