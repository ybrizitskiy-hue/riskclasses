const SEARCH_ENDPOINT = 'https://api.tavily.com/search';
export const LIQUIPEDIA_TEST_QUERY = 'Liquipedia Dota 2 tournament prize pool statistics';
const ESPORT = /^(?:e[- ]?sports?(?:\s*[-:/]\s*.+)?|dota\s*2|counter[- ]?strike(?:\s*2)?|cs2|league of legends|valorant|rainbow six(?: siege)?|rocket league|overwatch(?:\s*2)?|starcraft(?:\s*2)?|pubg(?: mobile)?|mobile legends(?: bang bang)?)$/i;

export function usesExternalSearch(profile) {
  return profile?.id === 'compatible-4'
    && profile.protocol === 'chat-completions'
    && profile.webSearchMode === 'native'
    && profile.capabilities?.webSearch === true;
}

export async function searchLiquipedia(env, query) {
  const key = String(env?.TAVILY_API_KEY || '').trim();
  if (!key) return { sources: [], error: 'TAVILY_API_KEY is not configured.' };
  try {
    const response = await globalThis.fetch(SEARCH_ENDPOINT, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
      headers: { 'authorization': `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        query: String(query).trim().slice(0, 300),
        search_depth: 'basic',
        include_domains: ['liquipedia.net'],
        include_domains_mode: 'restrict',
        auto_parameters: false,
        max_results: 3,
      }),
    });
    if (!response.ok) return { sources: [], error: `Liquipedia search returned HTTP ${response.status}.` };
    const data = await response.json().catch(() => null);
    if (!Array.isArray(data?.results)) return { sources: [], error: 'Tavily returned an invalid search response.' };
    const sources = [];
    for (const item of data.results.slice(0, 3)) {
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

export async function collectEsportsEvidence(env, rows) {
  const lookups = new Map();
  for (const row of rows) {
    const sport = String(row.sport || '').trim();
    const competition = String(row.competition || '').trim();
    if (!ESPORT.test(sport) || !competition || competition.length > 180) continue;
    const query = `${sport} ${competition} tournament tier`;
    if (!lookups.has(query) && lookups.size >= 3) continue;
    if (!lookups.has(query)) lookups.set(query, { indexes: [], result: searchLiquipedia(env, query) });
    lookups.get(query).indexes.push(row.inputIndex);
  }
  const evidence = [];
  for (const { indexes, result } of lookups.values()) {
    const { sources } = await result;
    if (sources.length) evidence.push({ inputIndexes: indexes, sources });
  }
  return evidence;
}
