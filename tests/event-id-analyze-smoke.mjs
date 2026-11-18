import { strict as assertLive } from 'node:assert';
import { onRequestPost } from '../functions/api/analyze-core.js';
import { collectEsportsEvidence } from '../functions/lib/liquipedia-search.js';
import { readFileSync } from 'node:fs';
import { decorateInputRows, parseCompetitionRows } from '../functions/lib/input-contract.js';
let checks=0;
const rows=decorateInputRows(parseCompetitionRows('Sport\tCompetition\tCompetition ID\nTennis\tATP Challenger Example\tBG-42\nSnooker\tWorld Championship\tU-99'));
assert(rows.length===2,'Pipeline parser must keep both rows');
assert(rows[0].competitionId==='BG-42'&&rows[0].dataProvider==='Betgenius','BG ID must decorate as Betgenius');
assert(rows[1].competitionId==='U-99'&&rows[1].dataProvider==='Betradar','U ID must decorate as Betradar');
const src=readFileSync(new URL('../functions/api/analyze-core.js',import.meta.url),'utf8');
assert(src.includes("required: ['sport', 'competition', 'competitionId']"),'Extraction schema must require Competition ID');
assert(src.includes("'manualCheckType'"),'Classifier schema must carry managed review label');
assert(src.includes('rulesPayload.resultPolicies'),'Analysis must pass managed resultPolicies to policy evaluator');
assert(src.includes('resultTransforms: Array.isArray(rules.resultTransforms)'),'AI prompt must receive managed transforms');
assert(src.includes('managed JSON above is the sole sportsbook rule authority'),'AI routing contract must state JSON authority');
assert(src.includes('newAiSessionId') && src.includes('sessionId: aiSessionId'),'Analysis must pass a stable session id to every AI call');
assert(!src.includes('PROVIDER_TENNIS_RULES_PROMPT'),'Analyze core must not import hard-coded provider Tennis rules');
assert(!/Betradar: Global RC|Betgenius main draw\/non-qualification: Global RC/.test(src),'Analyze core must not embed provider Tennis RC matrix');
console.log(`event ID analysis contract smoke tests passed (${checks} checks)`);
function assert(v,m){checks++;if(!v)throw new Error(m);}

const url = 'https://liquipedia.net/dota2/PGL/Wallachia/8';
const tournament = 'PGL Wallachia Season 8';
const bundle = {
  version: 'esports-test', schemaVersion: 1,
  instructions: 'Use the managed rules and verified tournament evidence. '.repeat(35),
  knowledge: 'Managed sportsbook knowledge. '.repeat(140),
  deterministicRules: { engineVersion: 3, rules: [{ id: 'test-football', sport: 'football', match: { any: ['World Cup'] }, global: 'RC A', daznEs: '', daznDe: '', daznUk: '', basis: 'test' }] },
  resultPolicies: [], resultTransforms: [],
};
let searches = 0;
let classifications = 0;
let citation = url;
let searchTitle = tournament;
const env = {
  OPENAI_API_KEY: 'test-model-key', TAVILY_API_KEY: 'test-search-key',
  RISK_RULES: { get: async key => key === 'custom-gpt-v2' ? JSON.stringify(bundle) : null },
};
const fetchBefore = globalThis.fetch;
try {
  globalThis.fetch = async (target, options) => {
    if (target === 'https://api.tavily.com/search') {
      searches++;
      return Response.json({ results: [{ url, title: searchTitle + ' - Liquipedia Dota 2 Wiki', content: 'Liquipedia Tier: Tier 1.' }] });
    }
    classifications++;
    assertLive.equal(searches, classifications, 'Each run must search before asking for even a confident classification');
    assertLive.ok(options.body.includes('Liquipedia Tier: Tier 1.'));
    return Response.json({ output_text: JSON.stringify({ rows: [{
      inputIndex: 0, sport: 'Dota 2', competition: tournament, global: 'RC C',
      daznEs: 'RC C', daznDe: 'RC C', daznUk: 'RC C', basis: 'Tier 1',
      confidence: 'High', sources: [citation], manualCheck: false, manualCheckType: 'No',
      manualCheckReason: '', needsEscalation: false, escalationReason: '',
    }], warnings: [] }) });
  };
  const analyze = async () => {
    const response = await onRequestPost({
      env, request: new Request('https://example.test/api/analyze', {
        method: 'POST', body: JSON.stringify({ mode: 'text', routingMode: 'economy', text: 'Dota 2\t' + tournament }),
      }),
    });
    assertLive.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    return response.json();
  };
  let result = await analyze();
  assertLive.equal(result.telemetry.webSearchCalls, 1);
  assertLive.deepEqual(result.rows[0].sources, [url]);
  assertLive.deepEqual(['daznEs', 'daznDe', 'daznUk'].map(key => result.rows[0][key]), ['RC C', 'RC C', 'RC C']);

  citation = 'https://liquipedia.net/dota2/PGL/Wallachia/9';
  result = await analyze();
  assertLive.equal(result.rows[0].manualCheck, true);
  assertLive.match(result.rows[0].daznEs, /Manual check/);

  searchTitle = 'PGL Wallachia Season 9';
  result = await analyze();
  assertLive.equal(result.rows[0].manualCheck, true);
  assertLive.equal(classifications, 2, 'A wrong tournament from search must not reach classification');
  assertLive.equal(searches, 3);
} finally {
  globalThis.fetch = fetchBefore;
}
console.log('esports source enforcement passed');

assertLive.equal(parseCompetitionRows('Feed\tRocket League\tRLCS 2026\tDB123')[0].sport, 'Rocket League');
let batchSearches = 0;
try {
  globalThis.fetch = async (target, options) => {
    assertLive.equal(target, 'https://api.tavily.com/search');
    const { query } = JSON.parse(options.body);
    const edition = query.match(/Season (\d+)/)[1];
    batchSearches++;
    return Response.json({ results: [{
      url: 'https://liquipedia.net/dota2/PGL/Wallachia/' + edition,
      title: 'PGL Wallachia Season ' + edition + ' - Liquipedia Dota 2 Wiki',
      content: 'Liquipedia Tier: Tier 1.',
    }] });
  };
  const tournaments = [8, 9, 10, 11, 12, 8].map((edition, inputIndex) => ({
    sport: 'Dota 2', competition: 'PGL Wallachia Season ' + edition, inputIndex,
  }));
  const batch = await collectEsportsEvidence(env, tournaments);
  assertLive.equal(batchSearches, 5, 'Search every unique tournament, even beyond the first three');
  assertLive.equal(batch.searches, 5);
  assertLive.equal(batch.evidence.length, 5);
  assertLive.deepEqual(batch.evidence[0].inputIndexes, [0, 5], 'Share one lookup for duplicate rows');
} finally {
  globalThis.fetch = fetchBefore;
}

const savedSetTimeout = globalThis.setTimeout;
try {
  globalThis.setTimeout = (callback, ms, ...args) =>
    savedSetTimeout(callback, ms === 60_000 ? 0 : ms, ...args);
  const stalledKv = { get: () => new Promise(() => {}) };
  const timeout = await onRequestPost({
    env: { RISK_RULES: stalledKv },
    request: new Request('https://example.test/api/analyze', {
      method: 'POST', body: JSON.stringify({ mode: 'text', text: 'Dota 2\t' + tournament }),
    }),
  });
  assertLive.equal(timeout.status, 504, 'A stalled KV read must still hit the overall deadline');
  assertLive.match((await timeout.json()).error, /timed out after 60 seconds/);
} finally {
  globalThis.setTimeout = savedSetTimeout;
}
