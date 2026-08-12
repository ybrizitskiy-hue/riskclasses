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
assert(PROVIDER_TENNIS_RULES_VERSION === 4, 'Provider Tennis rules marker changed unexpectedly');
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


// A stale v3 bundle may contain the rejected E/E/G Betgenius main-draw mapping.
// Runtime v4 must override it with the approved G/G/G mapping until KV is republished.
const staleVersionThreeRules = {
  ...staleRules,
  providerTennisRulesVersion: 3,
  rules: required.map((item) => item.id === 'tennis-bg-challenger-singles'
    ? { ...item, dazn: 'RC E', quinnbet: 'RC E', nti: 'RC G', basis: 'Rejected stale v3 E/E/G mapping' }
    : item),
};
const upgradedBgChallenger = classifyDeterministic(
  { sport: 'Tennis', competition: 'ATP Challenger Stale V3 Example', competitionId: 'BG-778' },
  buildRuntimeIndex({ deterministicRules: staleVersionThreeRules }),
);
assert(upgradedBgChallenger?.dazn === 'RC G' && upgradedBgChallenger?.quinnbet === 'RC G' && upgradedBgChallenger?.nti === 'RC G', 'Runtime v4 must override stale v3 Betgenius Challenger main with G/G/G');

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
  assert(!final.basis.includes(ROUND_REVIEW_REASON), `Screenshot row ${competitionId} must keep Basis compact`);
  assert(final.needsEscalation === false && final.escalationReason === '', `Round-only review for ${competitionId} must not escalate`);
}

const providerCases = [
  ['U-1', 'ATP Challenger Example', 'RC G', 'RC F', 'RC G'],
  ['BG-1', 'ATP Challenger Example Qualification', 'RC G', 'RC F', 'RC G'],
  ['BG-2', 'ATP Challenger Example', 'RC G', 'RC G', 'RC G'],
  ['DB-1', 'ATP Challenger Example', 'RC G', 'RC F', 'RC G'],

  ['U-2', 'WTA 125 Example', 'RC G', 'RC F', 'RC G'],
  ['BG-3', 'WTA 125 Example Q4', 'RC G', 'RC F', 'RC G'],
  ['BG-4', 'WTA 125 Example', 'RC G', 'RC G', 'RC G'],
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
