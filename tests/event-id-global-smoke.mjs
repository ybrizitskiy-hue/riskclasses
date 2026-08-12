import { readFileSync } from 'node:fs';
import { buildRuntimeIndex, classifyDeterministic } from '../functions/lib/deterministic.js';
import {
  ROUND_REVIEW_BASIS,
  ROUND_REVIEW_REASON,
  applyRoundReviewPolicy,
  decorateInputRows,
  filterGlobalInheritanceWarnings,
  hasExplicitRoundOrStage,
  parseCompetitionRows,
  providerFromCompetitionId,
  requiresRoundReview,
  resolveGlobalBrands,
} from '../functions/lib/input-contract.js';
import {
  RULES_KEY,
  baselineDeterministicRules,
  loadCurrentRulesBundle,
  migrateLegacyBundle,
  upgradeDeterministicRules,
  validateRulesBundle,
} from '../functions/lib/rules-bundle.js';

let checks = 0;

const parsed = parseCompetitionRows([
  'Sport\tCompetition\tCompetition ID',
  'Tennis\tATP Example. Men Singles\tU-31318',
  'Tennis\tWTA Example. Women Singles\tBG-31317',
  'Tennis\tChallenger Example. Men Singles\tDB-31316',
].join('\n'));
assert(parsed.length === 3, 'Three-column input must keep all rows');
assert(parsed[0].competitionId === 'U-31318', 'Betradar ID must be preserved exactly');
assert(parsed[1].competitionId === 'BG-31317', 'Betgenius ID must be preserved exactly');
assert(parsed[2].competitionId === 'DB-31316', 'Databet ID must be preserved exactly');

const decorated = decorateInputRows(parsed);
assert(decorated[0].dataProvider === 'Betradar', 'U prefix must map to Betradar');
assert(decorated[1].dataProvider === 'Betgenius', 'BG prefix must map to Betgenius');
assert(decorated[2].dataProvider === 'Databet', 'DB prefix must map to Databet');
assert(providerFromCompetitionId('bg123') === 'Betgenius', 'Provider mapping must be case-insensitive');
assert(providerFromCompetitionId(' db-2 ') === 'Databet', 'Provider mapping must trim whitespace');
assert(providerFromCompetitionId('X-1') === '', 'Unknown prefix must stay unresolved');


const screenshotRows = decorateInputRows(parseCompetitionRows([
  'Sport\tCompetition\tCompetition ID',
  'MMA\tONE Fight Night 46 - One Championship\tU-31318',
  'Counter Strike\tNODWIN Clutch Series 11 Play-In\tDB-31317',
  'Beach Volley\tEuropean Championship. Women\tDB-31316',
  'Golf\tFNB Eswatini Challenge 2026 - Men\tU-31315',
  'Tennis\tWT East Lansing. USA. Men Doubles\tDB-31314',
  'Tennis\tWT Campos do Jordao. Brazil. Women Doubles\tDB-31313',
  'Badminton\tMalaysia International, WD - International\tU-31312',
  'Counter Strike\tCCT Europe 2026 Series 7 Play-In\tDB-31311',
  'Tennis\tWT Warsaw. Poland. Men Doubles\tDB-31310',
  'Tennis\tWT Asuncion. Paraguay. Men Doubles\tDB-31309',
  'Tennis\tWT Malmo. Sweden. Men Doubles\tDB-31308',
  'Tennis\tWT Vigo. Spain. Women Doubles\tDB-31307',
].join('\n')));
assert(screenshotRows.length === 12, 'Screenshot-style three-column input must preserve every logical row');
assert(screenshotRows[0].competition === 'ONE Fight Night 46 - One Championship' && screenshotRows[0].competitionId === 'U-31318', 'Screenshot first row must remain exact');
assert(screenshotRows[1].dataProvider === 'Databet' && screenshotRows[3].dataProvider === 'Betradar', 'Screenshot IDs must map to the correct providers');
assert(screenshotRows[11].competition === 'WT Vigo. Spain. Women Doubles' && screenshotRows[11].competitionId === 'DB-31307', 'Screenshot last row must remain exact');

const eventHeader = parseCompetitionRows('Sport;Competition;Event ID\nTennis;Example Open;BG-44');
assert(eventHeader[0].competitionId === 'BG-44', 'Event ID header alias must be accepted');
const oldTwoColumn = parseCompetitionRows('Sport\tCompetition\nGolf\tPGA Tour Example');
assert(oldTwoColumn.length === 1 && oldTwoColumn[0].competitionId === '', 'Old two-column input must remain supported');
const numbered = parseCompetitionRows('1\tTennis\tExample Open\tDB-9');
assert(numbered[0].sport === 'Tennis' && numbered[0].competitionId === 'DB-9', 'Row-number-prefixed input must retain ID');

const inherited = resolveGlobalBrands({
  global: 'Risk Class G',
  dazn: '',
  quinnbet: 'Same as Global',
  nti: 'RC F',
});
assert(inherited.global === 'RC G', 'Global class must normalize to RC format');
assert(inherited.dazn === 'RC G', 'Blank DAZN must inherit Global');
assert(inherited.quinnbet === 'RC G', 'Same as Global must resolve to Global');
assert(inherited.nti === 'RC F', 'Explicit brand override must win');
assert(!/rec\./i.test(`${inherited.dazn} ${inherited.quinnbet}`), 'Exact Global inheritance must not add rec.');

const oldStyleModel = resolveGlobalBrands({
  global: 'RC E',
  dazn: 'RC E rec.',
  quinnbet: 'Manual check / missing rule',
  nti: 'RC G',
});
assert(oldStyleModel.dazn === 'RC E', 'An obsolete rec. equal to exact Global must normalize to Global');
assert(oldStyleModel.quinnbet === 'RC E', 'A missing brand result must inherit an available Global');

const recommendedGlobal = resolveGlobalBrands({
  global: 'RC G rec.',
  dazn: '',
  quinnbet: 'Same as Global',
  nti: 'RC F',
});
assert(recommendedGlobal.global === 'RC G rec.', 'A genuinely analogous Global recommendation must be preserved');
assert(recommendedGlobal.dazn === 'RC G rec.' && recommendedGlobal.quinnbet === 'RC G rec.', 'Recommended Global must propagate to unspecified brands');

const noGlobal = resolveGlobalBrands({ global: '', dazn: '', quinnbet: '—', nti: 'RC E' });
assert(noGlobal.dazn === 'Manual check / missing rule', 'No Global and no brand rule must remain missing');
assert(noGlobal.quinnbet === 'Manual check / missing rule', 'Blank marker without Global must remain missing');


assert(!hasExplicitRoundOrStage('ATP Challenger Example Qualification'), 'Qualification alone must not be mistaken for a match round');
assert(hasExplicitRoundOrStage('World Championship Quarterfinal'), 'Quarterfinal must count as an explicit round');
assert(hasExplicitRoundOrStage('UK Championship 1/8 Final'), 'Fractional Snooker round must count as explicit');
assert(!hasExplicitRoundOrStage('ATP Finals. Men Singles'), 'Tournament name Finals alone must not be misread as a final-round label');
assert(requiresRoundReview({ sport: 'Tennis', competition: 'ATP Challenger Example. Men Singles' }), 'Tennis without round must require review');
assert(requiresRoundReview({ sport: 'Snooker', competition: 'British Open' }), 'Snooker without round must require review');
assert(!requiresRoundReview({ sport: 'Golf', competition: 'PGA Tour Example' }), 'Other sports must not use the round-review exception');

const exactRoundReview = applyRoundReviewPolicy({
  dazn: 'RC G',
  quinnbet: 'RC F',
  nti: 'RC G',
  basis: 'Betradar Challenger Singles',
  confidence: 'Medium',
  manualCheck: false,
  needsEscalation: true,
  escalationReason: 'Round absent',
}, { sport: 'Tennis', competition: 'ATP Challenger Example. Men Singles' });
assert(exactRoundReview.confidence === 'High' && exactRoundReview.manualCheck === true, 'Exact Tennis classes without round must be High/Yes');
assert(exactRoundReview.basis.includes(ROUND_REVIEW_BASIS), 'Round-review Basis must explicitly explain the check');
assert(exactRoundReview.manualCheckReason === ROUND_REVIEW_REASON, 'Round-review reason must be machine-readable');
assert(exactRoundReview.needsEscalation === false && exactRoundReview.escalationReason === '', 'Missing round alone must not escalate exact classes');

const stagedRound = applyRoundReviewPolicy({
  dazn: 'RC G', quinnbet: 'RC F', nti: 'RC G', basis: 'Qualification', confidence: 'High', manualCheck: false,
}, { sport: 'Tennis', competition: 'ATP Challenger Example. Men Singles Qualification' });
assert(stagedRound.confidence === 'High' && stagedRound.manualCheck === true && stagedRound.basis.includes(ROUND_REVIEW_BASIS), 'Qualification without Q1-Q4 must receive round review');

const recRoundReview = applyRoundReviewPolicy({
  dazn: 'RC F rec.', quinnbet: 'RC F rec.', nti: 'RC F rec.', basis: 'Analogy', confidence: 'Medium', manualCheck: true,
}, { sport: 'Tennis', competition: 'Analog Open Singles' });
assert(recRoundReview.confidence === 'Medium' && recRoundReview.manualCheck === true, 'Missing round must not promote recommended classes to High');
assert(recRoundReview.basis.includes(ROUND_REVIEW_BASIS), 'Recommended Tennis row must still state the missing-round review');

const exactAnalogyRoundReview = applyRoundReviewPolicy({
  dazn: 'RC F', quinnbet: 'RC F', nti: 'RC F', basis: 'Strong same-sport analogy', confidence: 'Medium', manualCheck: true,
}, { sport: 'Tennis', competition: 'Analog Open Singles' });
assert(exactAnalogyRoundReview.confidence === 'Medium' && exactAnalogyRoundReview.manualCheck === true, 'Exact-looking analogy values must not be promoted to High');
assert(exactAnalogyRoundReview.manualCheckReason !== ROUND_REVIEW_REASON, 'Analogy review must not be mislabeled as the approved High/Yes round exception');

const conflictingRoundReview = applyRoundReviewPolicy({
  dazn: 'RC D', quinnbet: 'RC D', nti: 'RC D', basis: 'Conflicting official sources', confidence: 'Low', manualCheck: true,
}, { sport: 'Snooker', competition: 'Mystery Championship' });
assert(conflictingRoundReview.confidence === 'Low' && conflictingRoundReview.manualCheck === true, 'Low-confidence exact-looking values must remain Low');

const cleanWarnings = filterGlobalInheritanceWarnings([
  'Global-based recommendation; brand rule missing for Quinnbet.',
  'No brand-specific rule, using Global for DAZN.',
  'No explicit Quinnbet override; Global applies.',
  'NTI inherits the Global value because no separate override exists.',
  'Global applies to unspecified brands.',
  'Official tournament level could not be verified.',
  'No Global or NTI rule could be established.',
]);
assert(cleanWarnings.length === 2 && cleanWarnings[0].startsWith('Official tournament') && cleanWarnings[1].startsWith('No Global'), 'Inheritance-only warnings must be removed without hiding research or genuinely missing-Global warnings');

const instructions = `High -> Manual check No normally. Tennis or Snooker without an explicit match round keeps exact classes High with Manual check Yes and Basis ${ROUND_REVIEW_BASIS}. Medium -> Yes. Low -> Yes. rec. can never be High. ${'Global fills every brand without an explicit override. '.repeat(30)}`;
const knowledge = `## 7. Explicit RC I Football Leagues\n\n1. Test League - Testland\n\n## 8. End\n\nTennis SRL / Simulated Reality operational exception. Tennis/Snooker missing-round review exception.\n${'Approved risk class knowledge. '.repeat(120)}`;
const canonicalBundle = {
  schemaVersion: 1,
  version: 'event-id-global-test',
  instructions,
  knowledge,
  deterministicRules: baselineDeterministicRules(),
};
const validation = validateRulesBundle(canonicalBundle);
assert(validation.valid, `Provider-aware baseline must validate: ${validation.errors.join('; ')}`);
assert(canonicalBundle.deterministicRules.engineVersion === 3, 'Provider-aware deterministic engine version must be 3');
for (const rule of canonicalBundle.deterministicRules.rules.filter((item) => item.providers?.length)) {
  const positivePatterns = [...(rule.match.any || []), ...(rule.match.all || [])].join(' ').toLowerCase();
  assert(rule.providers.every((provider) => positivePatterns.includes(provider.toLowerCase())), `${rule.id} must include a provider sentinel for safe pre-deploy imports`);
}

const invalidProvider = structuredClone(canonicalBundle);
invalidProvider.deterministicRules.rules.find((rule) => rule.providers?.length).providers = ['UnknownFeed'];
const invalidValidation = validateRulesBundle(invalidProvider);
assert(!invalidValidation.valid && invalidValidation.errors.some((value) => value.includes('unsupported value')), 'Unknown provider names must fail Rules Manager validation');

const missingSentinel = structuredClone(canonicalBundle);
const missingSentinelRule = missingSentinel.deterministicRules.rules.find((rule) => rule.providers?.length);
missingSentinelRule.match.all = missingSentinelRule.match.all.filter((pattern) => !pattern.toLowerCase().includes(missingSentinelRule.providers[0].toLowerCase()));
const missingSentinelValidation = validateRulesBundle(missingSentinel);
assert(!missingSentinelValidation.valid && missingSentinelValidation.errors.some((value) => value.includes('provider sentinel')), 'Provider-aware rules without a legacy-safe sentinel must fail validation');
assert(legacyCompetitionOnlyMatch(missingSentinelRule, 'ATP Challenger 100 Example. Men Singles'), 'Without a sentinel, an older competition-only engine would accidentally match the provider rule');
const sentinelRule = canonicalBundle.deterministicRules.rules.find((rule) => rule.id === missingSentinelRule.id);
assert(!legacyCompetitionOnlyMatch(sentinelRule, 'ATP Challenger 100 Example. Men Singles'), 'Provider sentinel must keep a provider rule inert on a v1 competition-only engine');


const staleDeterministic = baselineDeterministicRules();
staleDeterministic.engineVersion = 1;
staleDeterministic.rules = staleDeterministic.rules.filter((rule) => !rule.providers?.length);
const customContender = staleDeterministic.rules.find((rule) => rule.id === 'mma-contender-series');
customContender.dazn = 'RC D';
customContender.quinnbet = 'RC D';
customContender.nti = 'RC D';
const staleManagedBundle = {
  ...canonicalBundle,
  version: 'stale-v3-without-provider-rules',
  deterministicRules: staleDeterministic,
};
const migratedStale = migrateLegacyBundle(staleManagedBundle);
assert(migratedStale && migratedStale.upgraded, 'Older managed bundles must receive the runtime provider-rule upgrade');
assert(migratedStale.addedRuleIds.length === 16, 'Runtime upgrade must add all 16 provider Tennis rules');
assert(migratedStale.bundle.deterministicRules.engineVersion === 3, 'Runtime upgrade must activate deterministic engine v3');
assert(migratedStale.bundle.deterministicRules.rules.find((rule) => rule.id === 'mma-contender-series').dazn === 'RC D', 'Runtime upgrade must preserve unrelated managed rule values');
const staleIndex = buildRuntimeIndex(migratedStale.bundle);
const staleBetradar = classifyDeterministic({
  sport: 'Tennis',
  competition: 'ATP Challenger Nonthaburi 4, Thailand Men Singles - Challenger',
  competitionId: 'U-12680',
}, staleIndex);
assert(staleBetradar?.dazn === 'RC G' && staleBetradar?.quinnbet === 'RC F' && staleBetradar?.nti === 'RC G', 'Older bundles must classify Betradar Challenger Singles as G/F/G at runtime');
const staleBetgenius = classifyDeterministic({
  sport: 'Tennis',
  competition: 'ATP Challenger Nonthaburi 4, Thailand Men Singles - Challenger',
  competitionId: 'BG-12680',
}, staleIndex);
assert(staleBetgenius?.dazn === 'RC E' && staleBetgenius?.quinnbet === 'RC E' && staleBetgenius?.nti === 'RC G', 'Betgenius non-qualifying Challenger must remain E/E/G');
const idempotentUpgrade = upgradeDeterministicRules(migratedStale.bundle.deterministicRules);
assert(!idempotentUpgrade.upgraded && idempotentUpgrade.addedRuleIds.length === 0, 'Provider-rule runtime upgrade must be idempotent');
let runtimePuts = 0;
const runtimeLoaded = await loadCurrentRulesBundle({
  async get(key) { return key === RULES_KEY ? JSON.stringify(staleManagedBundle) : null; },
  async put() { runtimePuts += 1; },
});
assert(runtimeLoaded?.deterministicRules?.rules?.some((rule) => rule.id === 'tennis-br-challenger-singles'), 'Normal rule loading must expose upgraded provider rules immediately');
assert(runtimePuts === 0, 'Runtime compatibility must not silently publish over a non-legacy managed bundle');
const managerLoaded = await loadCurrentRulesBundle({
  async get(key) { return key === RULES_KEY ? JSON.stringify(staleManagedBundle) : null; },
}, { runtimeUpgrade: false });
assert(!managerLoaded?.deterministicRules?.rules?.some((rule) => rule.id === 'tennis-br-challenger-singles'), 'Rules Manager reads must preserve the exact stored managed bundle for honest diff/history');

const index = buildRuntimeIndex(canonicalBundle);
const providerCases = [
  ['U-1', 'ATP Challenger 100 Example. Men Singles', 'RC G', 'RC F', 'RC G'],
  ['BG-1', 'ATP Challenger 100 Example. Men Singles Qualification', 'RC G', 'RC F', 'RC G'],
  ['BG-2', 'ATP Challenger 100 Example. Men Singles', 'RC E', 'RC E', 'RC G'],
  ['DB-1', 'ATP Challenger 100 Example. Men Singles', 'RC G', 'RC F', 'RC G'],

  ['U-2', 'WTA 125 Example. Women Singles', 'RC G', 'RC F', 'RC G'],
  ['BG-3', 'WTA 125 Example. Women Singles Qualifying', 'RC G', 'RC F', 'RC G'],
  ['BG-4', 'WTA 125 Example. Women Singles', 'RC E', 'RC E', 'RC G'],
  ['DB-2', 'WTA 125 Example. Women Singles', 'RC G', 'RC F', 'RC G'],

  ['U-3', 'ATP 250 Example. Men Singles', 'RC E', 'RC E', 'RC G'],
  ['BG-5', 'WTA 250 Example. Women Singles Q1', 'RC E', 'RC E', 'RC G'],
  ['BG-6', 'ATP 250 Example. Men Singles', 'RC D', 'RC D', 'RC E'],
  ['DB-3', 'WTA 250 Example. Women Singles', 'RC E', 'RC E', 'RC G'],

  ['U-4', 'ATP 500 Example. Men Singles', 'RC E', 'RC E', 'RC E'],
  ['BG-7', 'ATP Masters 1000 Example. Men Singles Qualifier', 'RC E', 'RC E', 'RC E'],
  ['BG-8', 'Wimbledon. Women Singles', 'RC C', 'RC C', 'RC E'],
  ['DB-4', 'U.S. Open. Men Singles', 'RC E', 'RC E', 'RC E'],
];
for (const [competitionId, competition, dazn, quinnbet, nti] of providerCases) {
  const result = classifyDeterministic({ sport: 'Tennis', competition, competitionId }, index);
  assert(result, `No provider-specific deterministic result for ${competitionId} / ${competition}`);
  assert(
    result.dazn === dazn && result.quinnbet === quinnbet && result.nti === nti,
    `Wrong provider-specific classes for ${competitionId} / ${competition}`,
  );
  assert(result.confidence === 'High' && result.manualCheck === false, `Raw deterministic provider rule must be High/No before final round-review policy for ${competition}`);
}

assert(
  classifyDeterministic({ sport: 'Tennis', competition: 'ATP 250 Example. Men Singles' }, index) === null,
  'Provider-specific singles rule must not run without a recognized event ID/provider',
);
assert(
  classifyDeterministic({ sport: 'Tennis', competition: 'ATP 250 Example. Men Singles', competitionId: 'X-9' }, index) === null,
  'Unknown event-ID prefix must not select a provider rule',
);
const explicitProvider = classifyDeterministic({
  sport: 'Tennis',
  competition: 'ATP 250 Example. Men Singles',
  dataProvider: 'Betgenius',
}, index);
assert(explicitProvider?.dazn === 'RC D' && explicitProvider?.nti === 'RC E', 'Explicit canonical dataProvider context must also be supported');

const srl = classifyDeterministic({
  sport: 'Tennis',
  competition: 'SRL Summer Invitational. Men Singles',
  competitionId: 'BG-100',
}, index);
assert(srl?.dazn === 'RC H' && srl?.quinnbet === 'RC H' && srl?.nti === 'RC H', 'SRL operational H/H/H must override provider Singles rules');
const contender = classifyDeterministic({ sport: 'MMA', competition: 'Dana Whites Contender Series: Season 10' }, index);
assert(contender?.dazn === 'RC E' && contender?.quinnbet === 'RC E' && contender?.nti === 'RC E', 'MMA Contender Series v3 E/E/E regression must remain preserved');
const challengerDoubles = classifyDeterministic({
  sport: 'Tennis',
  competition: 'ATP Challenger Example. Men Doubles',
  competitionId: 'BG-101',
}, index);
assert(challengerDoubles?.dazn === 'RC G' && challengerDoubles?.quinnbet === 'RC F' && challengerDoubles?.nti === 'RC G', 'Existing Challenger Doubles behavior must remain unchanged');
const outright = classifyDeterministic({
  sport: 'Tennis',
  competition: 'ATP 250 Example. Men Singles Tournament Winner',
  competitionId: 'BG-102',
}, index);
assert(outright?.dazn === 'RC B' && outright?.quinnbet === 'RC B' && outright?.nti === 'RC C', 'Existing outright +2 behavior must apply after provider rule resolution');

const analyzeSource = readFileSync(new URL('../functions/api/analyze-core.js', import.meta.url), 'utf8');
assert(analyzeSource.includes("required: ['sport', 'competition', 'competitionId']"), 'Extraction schema must require competitionId');
assert(analyzeSource.includes("'global', 'dazn', 'quinnbet', 'nti'"), 'Classifier schema must carry Global');
assert(analyzeSource.includes('official ATP Tour or WTA tournament calendar/page'), 'Tennis research contract must prefer official ATP/WTA sources');
assert(analyzeSource.includes('resolveGlobalBrands(row)'), 'Server consistency must apply Global inheritance');
assert(analyzeSource.includes("promptCacheKey: 'riskclasses-row-extraction-v3'"), 'Extraction cache key must be versioned for the new schema');
assert(analyzeSource.includes('filterGlobalInheritanceWarnings'), 'Classifier warnings must pass through the Global-warning filter');
assert(analyzeSource.includes("'RC I rec.'"), 'Classifier Global schema must allow genuine recommended Global values');
assert(analyzeSource.includes('A U/Betradar Challenger Singles row is always'), 'Classifier prompt must explicitly separate Betradar Challenger from Betgenius');
assert(analyzeSource.includes('applyRoundReviewPolicy'), 'Analysis pipeline must apply the final Tennis/Snooker round-review policy');

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert(html.includes('<th>Competition ID</th>'), 'Results table must display Competition ID');
assert(html.includes('Global fills brands without an override'), 'UI doctrine must describe Global inheritance');
assert(html.includes('Tennis/Snooker without match round = High + manual check'), 'UI doctrine must display the missing-round exception');
const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
assert(appSource.includes("['Sport','Competition','Competition ID','DAZN'"), 'Copy/CSV exports must include Competition ID');
assert(appSource.includes('row.competitionId'), 'Rendered rows must include Competition ID');
assert(appSource.includes('approved High/Yes round exception'), 'Client consistency guard must preserve the approved High/Yes exception');
const rulesApiSource = readFileSync(new URL('../functions/api/rules.js', import.meta.url), 'utf8');
assert((rulesApiSource.match(/runtimeUpgrade: false/g) || []).length === 3, 'Rules Manager must read the exact stored bundle for GET, diff and history');
assert(rulesApiSource.includes('Tennis or Snooker with no explicit match round'), 'Rules Manager GPT guide must preserve the approved round-review exception');

console.log(`event ID, provider Tennis and Global inheritance smoke tests passed (${checks} checks)`);


function legacyCompetitionOnlyMatch(rule, competition) {
  const normalized = String(competition || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const any = (rule.match.any || []).map((pattern) => new RegExp(pattern, 'i'));
  const all = (rule.match.all || []).map((pattern) => new RegExp(pattern, 'i'));
  const none = (rule.match.none || []).map((pattern) => new RegExp(pattern, 'i'));
  if (any.length && !any.some((pattern) => pattern.test(normalized))) return false;
  if (all.length && !all.every((pattern) => pattern.test(normalized))) return false;
  if (none.some((pattern) => pattern.test(normalized))) return false;
  return any.length > 0 || all.length > 0;
}

function assert(condition, message) {
  checks += 1;
  if (!condition) throw new Error(message);
}
