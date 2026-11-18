const SEARCH_ENDPOINT = 'https://api.tavily.com/search';
export const LIQUIPEDIA_TEST_QUERY = 'Liquipedia Dota 2 tournament prize pool statistics';
const ESPORT = /^(?:e[- ]?sports?(?:\s*(?:[-:/]\s*.+|\(.+\)))?|dota\s*2|counter[- ]?strike(?:\s*(?:2|:\s*global offensive))?|cs2|cs:?go|league of legends|valorant|rainbow six(?: siege)?|rocket league|overwatch(?:\s*2)?|starcraft(?:\s*2)?|pubg(?: mobile)?|mobile legends(?: bang bang)?)$/i;

export function usesExternalSearch(profile) {
  return profile?.id === 'compatible-4'
    && profile.protocol === 'chat-completions'
    && profile.webSearchMode === 'native';
}

export async function searchLiquipedia(env, query, signal) {
  const key = String(env?.TAVILY_API_KEY || '').trim();
  if (!key) return { sources: [], error: 'TAVILY_API_KEY is not configured.' };
  const deadline = AbortSignal.timeout(5000);
  try {
    const response = await globalThis.fetch(SEARCH_ENDPOINT, {
      method: 'POST',
      redirect: 'manual',
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      headers: { 'authorization': `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        query: String(query).trim().slice(0, 300),
        search_depth: 'basic',
        include_domains: ['liquipedia.net'],
        include_domains_mode: 'restrict',
        auto_parameters: false,
        max_results: 5,
      }),
    });
    if (!response.ok) return { sources: [], error: `Liquipedia search returned HTTP ${response.status}.` };
    const data = await response.json().catch(() => null);
    if (!Array.isArray(data?.results)) return { sources: [], error: 'Tavily returned an invalid search response.' };
    const sources = [];
    for (const item of data.results.slice(0, 5)) {
      let url;
      try { url = new URL(item?.url); } catch { continue; }
      if (url.origin !== 'https://liquipedia.net' || url.username || url.password || url.pathname === '/') continue;
      if (typeof item?.content !== 'string' || !item.content.trim() || sources.some(source => source.url === url.href)) continue;
      sources.push({ url: url.href, title: String(item.title || '').slice(0, 160), snippet: item.content.trim().slice(0, 800) });
    }
    return { sources, error: sources.length ? '' : 'No HTTPS Liquipedia result with source text was returned.' };
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return { sources: [], error: timedOut ? 'Tavily search timed out.' : 'Cloudflare could not complete the Tavily request.' };
  }
}

export function isEsportsSport(sport) {
  return ESPORT.test(String(sport || '').trim());
}

const GENERIC_TOURNAMENT_WORDS = new Set(['division']);

function tournamentIdentity(value) {
  return value
    .replace(/\s*[-–|]\s*Liquipedia.*$/i, '')
    .toLowerCase()
    .match(/[a-z0-9]+/g)
    ?.filter(word => !GENERIC_TOURNAMENT_WORDS.has(word)) || [];
}

function sameTournamentIdentity(left, right) {
  const leftIdentity = tournamentIdentity(left).sort();
  const rightIdentity = tournamentIdentity(right).sort();
  return leftIdentity.length > 0
    && leftIdentity.length === rightIdentity.length
    && leftIdentity.every((word, index) => word === rightIdentity[index]);
}

function snippetNamesTournament(snippet, competition) {
  const expected = tournamentIdentity(competition).sort();
  const found = tournamentIdentity(snippet);
  if (!expected.length || found.length < expected.length) return false;

  for (let start = 0; start <= found.length - expected.length; start += 1) {
    const candidate = found.slice(start, start + expected.length).sort();
    if (expected.every((word, index) => word === candidate[index])) return true;
  }
  return false;
}

function sourceNamesTournament(source, competition) {
  return sameTournamentIdentity(source.title, competition)
    || snippetNamesTournament(source.snippet, competition);
}

export async function collectEsportsEvidence(env, rows, signal) {
  if (!String(env?.TAVILY_API_KEY || '').trim()) return { evidence: [], searches: 0 };

  const lookups = new Map();
  for (const row of rows) {
    const sport = String(row.sport || '').trim();
    const competition = String(row.competition || '').trim();
    if (!isEsportsSport(sport) || !competition) continue;
    const query = `${sport} ${competition} tournament tier`;
    const key = query.toLowerCase().replace(/\s+/g, ' ');
    if (!lookups.has(key)) lookups.set(key, { indexes: [], sport, competition, query });
    lookups.get(key).indexes.push(row.inputIndex);
  }

  const evidence = [];
  const pending = [...lookups.values()];
  const parallelSearches = 3;
  let searches = 0;
  for (let offset = 0; offset < pending.length; offset += parallelSearches) {
    signal?.throwIfAborted();
    const batch = pending.slice(offset, offset + parallelSearches);
    const results = await Promise.all(batch.map(async lookup => {
      searches += 1;
      const initial = await searchLiquipedia(env, lookup.query, signal);
      const exact = initial.sources.filter(source => sourceNamesTournament(source, lookup.competition));
      if (exact.length) return exact;

      signal?.throwIfAborted();
      searches += 1;
      const fallbackQuery = `${lookup.competition} ${lookup.sport} Liquipedia tournament tier`;
      const fallback = await searchLiquipedia(env, fallbackQuery, signal);
      return fallback.sources.filter(source => sourceNamesTournament(source, lookup.competition));
    }));
    for (const [index, sources] of results.entries()) {
      if (sources.length) evidence.push({ inputIndexes: batch[index].indexes, sources });
    }
  }
  return { evidence, searches };
}
