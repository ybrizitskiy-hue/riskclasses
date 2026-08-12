import { readFileSync } from 'node:fs';
import { buildRuntimeIndex, classifyDeterministic } from '../functions/lib/deterministic.js';
import {
  PROVIDER_TENNIS_RULES_VERSION,
  requiredProviderTennisRules,
} from '../functions/lib/provider-tennis-rules.js';
import {
  ROUND_REVIEW_REASON,
  enforceResultPolicy,
  hasExplicitRoundContext,
  needsRoundReview,
} from '../functions/lib/result-policy.js';

let checks = 0;

// Simulate the stale managed KV bundle that was live before the provider rules were
// imported. The runtime overlay must still apply all 16 corrected mappings.
const staleRules = {
  engineVersion: 1,
  footballRcI: {
    enabled: true,
    dazn: 'RC I',
    quinnbet: 'RC I',
    nti: 'RC I',
    basis: 'Football RC I explicit list',
  },
  rules: [
    rule('tennis-srl', 'tennis', ['\\b(srl|simulated reality|virtuals?|simulated)\\b'], [], [], 'RC H', 'RC H', 'RC H', 'Tennis SRL'),
    rule('tennis-challenger-doubles', 'tennis', [], ['\\bchallenger\\b', '\\bdoubles?\\b'], [], 'RC G', 'RC F', 'RC G', 'Challenger Doubles'),
    rule('old-generic-challenger-main', 'tennis', ['\\bchallenger\\b'], [], ['\\bdoubles?\\b', '\\bqualification\\b'], 'RC E', 'RC E', 'RC G', 'Old generic Challenger main draw'),
  ],
};

const index = buildRuntimeIndex({ deterministicRules: staleRules });
const required = requiredProviderTennisRules();
assert(PROVIDER_TENNIS_RULES_VERSION === 3, 'Provider Tennis rules marker changed unexpectedly');
assert(required.length === 16, 'Exactly 16 hard provider Tennis mappings must exist');

const managedAuthorityRules = {
  ...staleRules,
  providerTennisRulesVersion: PROVIDER_TENNIS_RULES_VERSION,
  rules: required.map((rule) => rule.id === 'tennis-br-challenger-singles'
    ? { ...rule, dazn: 'RC F', quinnbet: 'RC F', nti: 'RC F', basis: 'Managed future override test' }
    : rule),
};
const managedAuthority = classifyDeterministic(
  { sport: 'Tennis', competition: 'ATP Challenger Managed Example', competitionId: 'U-777' },
  buildRuntimeIndex({ deterministicRules: managedAuthorityRules }),
);
assert(managedAuthority?.dazn === 'RC F' && managedAuthority?.nti === 'RC F', 'Published marker must return authority to managed Rules Manager data');


// Version 2 contained the rejected G/G/G interpretation for Betgenius main
// Challenger and WTA 125. Version 3 must replace those same-ID managed rows
// at runtime so the corrected E/E/G matrix is effective before KV v8 is published.
const staleVersionTwoRules = {
  ...staleRules,
  providerTennisRulesVersion: 2,
  rules: required.map((item) => {
    if (item.id === 'tennis-bg-challenger-singles' || item.id === 'tennis-bg-wta125-singles') {
      return { ...item, dazn: 'RC G', quinnbet: 'RC G', nti: 'RC G', basis: 'Rejected v2 G/G/G interpretation' };
    }
    return item;
  }),
};
const upgradedBgChallenger = classifyDeterministic(
  { sport: 'Tennis', competition: 'ATP Challenger Version Two Example', competitionId: 'BG-778' },
  buildRuntimeIndex({ deterministicRules: staleVersionTwoRules }),
);
assert(
  upgradedBgChallenger?.dazn === 'RC E' && upgradedBgChallenger?.quinnbet === 'RC E' && upgradedBgChallenger?.nti === 'RC G',
  'Runtime v3 must replace the rejected v2 Betgenius Challenger main mapping with E/E/G',
);
const upgradedBgWta125 = classifyDeterministic(
  { sport: 'Tennis', competition: 'WTA 125 Version Two Example', competitionId: 'BG-779' },
  buildRuntimeIndex({ deterministicRules: staleVersionTwoRules }),
);
assert(
  upgradedBgWta125?.dazn === 'RC E' && upgradedBgWta125?.quinnbet === 'RC E' && upgradedBgWta125?.nti === 'RC G',
  'Runtime v3 must replace the rejected v2 Betgenius WTA 125 main mapping with E/E/G',
);

const screenshotCases = [
  ['BG-25755', 'ATP Brisbane 3 Challenger Qualification - Australia', 'RC G', 'RC F', 'RC G'],
  ['BG-17060', 'ATP Oeiras 5 Challenger Doubles - Portugal', 'RC G', 'RC F', 'RC G'],
  ['U-12680', 'ATP Challenger Nonthaburi 4, Thailand Men Singles - Challenger', 'RC G', 'RC F', 'RC G'],
  ['BG-14550', 'ATP Noumea Challenger Qualification - New Caledonia', 'RC G', 'RC F', 'RC G'],
  ['BG-14551', 'ATP Canberra Challenger Qualification - Australia', 'RC G', 'RC F', 'RC G'],
];

for (const [competitionId, competition, dazn, quinnbet, nti] of screenshotCases) {
  const result = classifyDeterministic({ sport: 'Tennis', competition, competitionId }, index);
  assert(result, `No deterministic result for ${competitionId} / ${competition}`);
  assert(
    result.dazn === dazn && result.quinnbet === quinnbet && result.nti === nti,
    `Wrong mapping for ${competitionId}: ${result?.dazn}/${result?.quinnbet}/${result?.nti}`,
  );
  const final = enforceResultPolicy(result, { sport: 'Tennis', competition, competitionId });
  assert(final.confidence === 'High', `Screenshot row ${competitionId} must retain High confidence`);
  assert(final.manualCheck === true, `Screenshot row ${competitionId} must require a round check`);
  assert(final.manualCheckReason === ROUND_REVIEW_REASON, `Screenshot row ${competitionId} needs the explicit round reason`);
  assert(final.basis.includes(ROUND_REVIEW_REASON), `Screenshot row ${competitionId} must mention round review in Basis`);
  assert(final.needsEscalation === false && final.escalationReason === '', `Round-only review for ${competitionId} must not escalate`);
}

const providerCases = [
  ['U-1', 'ATP Challenger Example', 'RC G', 'RC F', 'RC G'],
  ['BG-1', 'ATP Challenger Example Qualification', 'RC G', 'RC F', 'RC G'],
  ['BG-2', 'ATP Challenger Example', 'RC E', 'RC E', 'RC G'],
  ['DB-1', 'ATP Challenger Example', 'RC G', 'RC F', 'RC G'],

  ['U-2', 'WTA 125 Example', 'RC G', 'RC F', 'RC G'],
  ['BG-3', 'WTA 125 Example Q4', 'RC G', 'RC F', 'RC G'],
  ['BG-4', 'WTA 125 Example', 'RC E', 'RC E', 'RC G'],
  ['DB-2', 'WTA 125 Example', 'RC G', 'RC F', 'RC G'],

  ['U-3', 'ATP 250 Example', 'RC E', 'RC E', 'RC G'],
  ['BG-5', 'WTA 250 Example Qualifying', 'RC E', 'RC E', 'RC G'],
  ['BG-6', 'ATP 250 Example', 'RC D', 'RC D', 'RC E'],
  ['DB-3', 'WTA 250 Example', 'RC E', 'RC E', 'RC G'],

  ['U-4', 'ATP 500 Example', 'RC E', 'RC E', 'RC E'],
  ['BG-7', 'ATP Masters 1000 Example Qualifier', 'RC E', 'RC E', 'RC E'],
  ['BG-8', 'Wimbledon', 'RC C', 'RC C', 'RC E'],
  ['DB-4', 'U.S. Open', 'RC E', 'RC E', 'RC E'],
];

for (const [competitionId, competition, dazn, quinnbet, nti] of providerCases) {
  const result = classifyDeterministic({ sport: 'Tennis', competition, competitionId }, index);
  assert(result, `No provider mapping for ${competitionId} / ${competition}`);
  assert(
    result.dazn === dazn && result.quinnbet === quinnbet && result.nti === nti,
    `Wrong provider mapping for ${competitionId} / ${competition}`,
  );
}

const noProvider = classifyDeterministic({ sport: 'Tennis', competition: 'ATP Challenger Example' }, index);
assert(noProvider?.dazn === 'RC E', 'No provider ID must not trigger the hard provider overlay');

const srl = classifyDeterministic({
  sport: 'Tennis',
  competition: 'SRL Challenger Simulated Reality',
  competitionId: 'U-99',
}, index);
assert(srl?.dazn === 'RC H' && srl?.quinnbet === 'RC H' && srl?.nti === 'RC H', 'SRL H/H/H must retain precedence');

const tennisNoRound = enforceResultPolicy(
  confirmed('Tennis', 'ATP Challenger Example', 'RC G', 'RC F', 'RC G'),
  { sport: 'Tennis', competition: 'ATP Challenger Example' },
);
assert(tennisNoRound.confidence === 'High', 'Missing Tennis round must not lower confirmed confidence');
assert(tennisNoRound.manualCheck === true, 'Missing Tennis round must require manual check');
assert(tennisNoRound.manualCheckReason === ROUND_REVIEW_REASON, 'Tennis round review reason must be explicit');
assert(tennisNoRound.basis.includes(ROUND_REVIEW_REASON), 'Tennis round review reason must be visible in Basis');

const tennisQual = enforceResultPolicy(
  confirmed('Tennis', 'ATP Challenger Example Qualification', 'RC G', 'RC F', 'RC G'),
  { sport: 'Tennis', competition: 'ATP Challenger Example Qualification' },
);
assert(tennisQual.confidence === 'High' && tennisQual.manualCheck === true, 'Generic Tennis qualification must remain High/Yes because the exact qualifying round is absent');
assert(tennisQual.manualCheckReason === ROUND_REVIEW_REASON, 'Generic qualification must show the exact round-review reason');

const tennisQ2 = enforceResultPolicy(
  confirmed('Tennis', 'ATP Challenger Example Qualification Q2', 'RC G', 'RC F', 'RC G'),
  { sport: 'Tennis', competition: 'ATP Challenger Example Qualification Q2' },
);
assert(tennisQ2.confidence === 'High' && tennisQ2.manualCheck === false, 'Explicit Tennis Q2 must be High/No');

const tennisFinal = enforceResultPolicy(
  confirmed('Tennis', 'Wimbledon - Final', 'RC C', 'RC C', 'RC E'),
  { sport: 'Tennis', competition: 'Wimbledon - Final' },
);
assert(tennisFinal.confidence === 'High' && tennisFinal.manualCheck === false, 'Explicit Tennis final must not create a round review');

const tennisSrl = enforceResultPolicy(
  confirmed('Tennis', 'SRL Challenger Simulated Reality', 'RC H', 'RC H', 'RC H'),
  { sport: 'Tennis', competition: 'SRL Challenger Simulated Reality' },
);
assert(tennisSrl.confidence === 'High' && tennisSrl.manualCheck === false, 'Tennis SRL must be exempt from round review');

const tennisOutright = enforceResultPolicy(
  confirmed('Tennis', 'ATP 250 Example Tournament Winner', 'RC B', 'RC B', 'RC C'),
  { sport: 'Tennis', competition: 'ATP 250 Example Tournament Winner' },
);
assert(tennisOutright.confidence === 'High' && tennisOutright.manualCheck === false, 'Tennis outright/winner markets must be exempt from round review');

const snookerNoRound = enforceResultPolicy(
  confirmed('Snooker', 'World Championship', 'RC A', 'RC A', 'RC A'),
  { sport: 'Snooker', competition: 'World Championship' },
);
assert(snookerNoRound.confidence === 'High' && snookerNoRound.manualCheck === true, 'Missing Snooker round must be High/Yes');
assert(snookerNoRound.manualCheckReason === ROUND_REVIEW_REASON, 'Snooker round review reason must be explicit');

const snookerR16 = enforceResultPolicy(
  confirmed('Snooker', 'World Championship Round of 16', 'RC A', 'RC A', 'RC A'),
  { sport: 'Snooker', competition: 'World Championship Round of 16' },
);
assert(snookerR16.confidence === 'High' && snookerR16.manualCheck === false, 'Explicit Snooker R16 must be High/No');

const football = enforceResultPolicy(
  confirmed('Football', 'Premier League', 'RC A', 'RC A', 'RC E'),
  { sport: 'Football', competition: 'Premier League' },
);
assert(football.confidence === 'High' && football.manualCheck === false, 'Other sports must keep existing High/No policy');

const recommendation = enforceResultPolicy({
  sport: 'Tennis',
  competition: 'Unknown Open Qualification',
  global: 'RC F rec.',
  dazn: '',
  quinnbet: '',
  nti: '',
  basis: 'Analogy',
  confidence: 'High',
  sources: ['Risk Class guide'],
  manualCheck: false,
});
assert(recommendation.confidence === 'Medium' && recommendation.manualCheck === true, 'rec. must remain Medium/Yes');

assert(needsRoundReview({ sport: 'Tennis', competition: 'ATP 250 Example' }), 'Tennis without round must need review');
assert(needsRoundReview({ sport: 'Tennis', competition: 'ATP 250 Example Qualification' }), 'Generic Qualification must still need an exact round review');
assert(!needsRoundReview({ sport: 'Tennis', competition: 'ATP 250 Example Qualification Q4' }), 'Tennis Q4 must count as exact round context');
assert(!needsRoundReview({ sport: 'Tennis', competition: 'ATP 250 Example QF' }), 'Tennis QF must count as round context');
assert(!hasExplicitRoundContext('ATP 250 Example Qualification'), 'Generic qualification is category context, not exact round context');
assert(hasExplicitRoundContext('World Championship Final'), 'Singular Final must count as round context');
assert(!hasExplicitRoundContext('WTA Finals'), 'Tournament name WTA Finals must not be mistaken for a final round');

const analyzeSource = readFileSync(new URL('../functions/api/analyze-core.js', import.meta.url), 'utf8');
assert(analyzeSource.includes('PROVIDER_TENNIS_RULES_PROMPT'), 'AI prompt must include the hard provider mapping');
assert(analyzeSource.includes('enforceResultPolicy'), 'Backend must apply the High/Yes round exception');
assert(analyzeSource.includes('manualCheckReason'), 'Backend output must return an explicit review reason');
assert(analyzeSource.includes('Generic Qualification/Qualifying/Qualifier wording identifies a qualifying category but does not state the exact round'), 'AI prompt must keep generic qualification under round review');
assert(analyzeSource.includes(ROUND_REVIEW_REASON), 'AI prompt must use the approved explicit round-review wording');

const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
assert(appSource.includes("'Manual check reason'"), 'Copy/CSV exports must include manual check reason');
assert(appSource.includes("row.manualCheckReason || '—'"), 'Results table must render manual check reason');
assert(!appSource.includes("if (finalConfidence === 'High') manualCheck = false"), 'Client must not erase approved High/Yes round checks');

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert(html.includes('<th>Manual check reason</th>'), 'UI must display the manual check reason column');
assert(html.includes('Missing Tennis/Snooker exact round = High + manual check with reason'), 'UI policy must explicitly describe the exception');

console.log(`provider Tennis and round-review smoke tests passed (${checks} checks)`);

function rule(id, sport, any, all, none, dazn, quinnbet, nti, basis) {
  return { id, sport, match: { any, all, none }, dazn, quinnbet, nti, basis, source: 'Risk Class guide' };
}

function confirmed(sport, competition, dazn, quinnbet, nti) {
  return {
    sport,
    competition,
    global: '',
    dazn,
    quinnbet,
    nti,
    basis: 'Exact approved rule',
    confidence: 'High',
    sources: ['Risk Class guide'],
    manualCheck: false,
  };
}

function assert(condition, message) {
  checks += 1;
  if (!condition) throw new Error(message);
}
