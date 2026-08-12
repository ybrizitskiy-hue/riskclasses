const DOUBLES = '\\b(doubles?|mixed doubles|md|wd|xd)\\b';
const QUALIFICATION = '\\b(qualification|qualifier|qualifying|quals?|q[1-4])\\b';
const CHALLENGER = '\\bchallengers?\\b';
const WTA_125 = '\\bwta\\s*125(?:k)?\\b|\\b125k\\b';
const TOUR_250 = '\\b(?:atp|wta)\\s*250\\b';
const TOUR_500_PLUS = '\\b(?:atp|wta)\\s*(?:500|1000)\\b|\\bmasters?\\s*1000\\b|\\bgrand\\s*slams?\\b|\\baustralian\\s*open\\b|\\bfrench\\s*open\\b|\\broland\\s*garros\\b|\\bwimbledon\\b|\\bu\\s*s\\s*open\\b|\\bus\\s*open\\b';
const NON_STANDARD_SINGLES = '\\b(juniors?|boys?|girls?|wheelchair)\\b';
const OPERATIONAL_EXCLUSIONS = '\\b(srl|simulated reality|virtuals?|simulated|utr)\\b';

export const PROVIDER_TENNIS_RULES_VERSION = 3;

const REQUIRED_RULES = [
  providerRule('tennis-br-challenger-singles', 'Betradar', [CHALLENGER], [DOUBLES, NON_STANDARD_SINGLES], 'RC G', 'RC F', 'RC G', 'Betradar Challenger Singles; Global G, Quinnbet F, NTI G'),
  providerRule('tennis-bg-challenger-qual-singles', 'Betgenius', [CHALLENGER, QUALIFICATION], [DOUBLES, NON_STANDARD_SINGLES], 'RC G', 'RC F', 'RC G', 'Betgenius Challenger Qual Singles; Global G, Quinnbet F, NTI G'),
  providerRule('tennis-bg-challenger-singles', 'Betgenius', [CHALLENGER], [QUALIFICATION, DOUBLES, NON_STANDARD_SINGLES], 'RC E', 'RC E', 'RC G', 'Betgenius Challenger Singles; Global E, NTI G'),
  providerRule('tennis-db-challenger-singles', 'Databet', [CHALLENGER], [DOUBLES, NON_STANDARD_SINGLES], 'RC G', 'RC F', 'RC G', 'Databet Challenger Singles; Global G, Quinnbet F, NTI G'),

  providerRule('tennis-br-wta125-singles', 'Betradar', [WTA_125], [DOUBLES, NON_STANDARD_SINGLES], 'RC G', 'RC F', 'RC G', 'Betradar WTA 125 Singles; Global G, Quinnbet F, NTI G'),
  providerRule('tennis-bg-wta125-qual-singles', 'Betgenius', [WTA_125, QUALIFICATION], [DOUBLES, NON_STANDARD_SINGLES], 'RC G', 'RC F', 'RC G', 'Betgenius WTA 125 Qual Singles; Global G, Quinnbet F, NTI G'),
  providerRule('tennis-bg-wta125-singles', 'Betgenius', [WTA_125], [QUALIFICATION, DOUBLES, NON_STANDARD_SINGLES], 'RC E', 'RC E', 'RC G', 'Betgenius WTA 125 Singles; Global E, NTI G'),
  providerRule('tennis-db-wta125-singles', 'Databet', [WTA_125], [DOUBLES, NON_STANDARD_SINGLES], 'RC G', 'RC F', 'RC G', 'Databet WTA 125 Singles; Global G, Quinnbet F, NTI G'),

  providerRule('tennis-br-250-singles', 'Betradar', [TOUR_250], [DOUBLES, NON_STANDARD_SINGLES], 'RC E', 'RC E', 'RC G', 'Betradar ATP/WTA 250 Singles; Global E, NTI G'),
  providerRule('tennis-bg-250-qual-singles', 'Betgenius', [TOUR_250, QUALIFICATION], [DOUBLES, NON_STANDARD_SINGLES], 'RC E', 'RC E', 'RC G', 'Betgenius ATP/WTA 250 Qual Singles; Global E, NTI G'),
  providerRule('tennis-bg-250-singles', 'Betgenius', [TOUR_250], [QUALIFICATION, DOUBLES, NON_STANDARD_SINGLES], 'RC D', 'RC D', 'RC E', 'Betgenius ATP/WTA 250 Singles; Global D, NTI E'),
  providerRule('tennis-db-250-singles', 'Databet', [TOUR_250], [DOUBLES, NON_STANDARD_SINGLES], 'RC E', 'RC E', 'RC G', 'Databet ATP/WTA 250 Singles; Global E, NTI G'),

  providerRule('tennis-br-500plus-singles', 'Betradar', [TOUR_500_PLUS], [DOUBLES, NON_STANDARD_SINGLES], 'RC E', 'RC E', 'RC E', 'Betradar ATP/WTA 500/1000/Grand Slam Singles; Global E, NTI E'),
  providerRule('tennis-bg-500plus-qual-singles', 'Betgenius', [TOUR_500_PLUS, QUALIFICATION], [DOUBLES, NON_STANDARD_SINGLES], 'RC E', 'RC E', 'RC E', 'Betgenius ATP/WTA 500/1000/Grand Slam Qual Singles; Global E'),
  providerRule('tennis-bg-500plus-singles', 'Betgenius', [TOUR_500_PLUS], [QUALIFICATION, DOUBLES, NON_STANDARD_SINGLES], 'RC C', 'RC C', 'RC E', 'Betgenius ATP/WTA 500/1000/Grand Slam Singles; Global C, NTI E'),
  providerRule('tennis-db-500plus-singles', 'Databet', [TOUR_500_PLUS], [DOUBLES, NON_STANDARD_SINGLES], 'RC E', 'RC E', 'RC E', 'Databet ATP/WTA 500/1000/Grand Slam Singles; Global E, NTI E'),
];

export const PROVIDER_TENNIS_RULES_PROMPT = `--- REQUIRED PROVIDER-SPECIFIC TENNIS NEW-COMPETITION RULES (HARD OVERRIDE) ---
Competition ID identifies the provider: U... = Betradar, BG... = Betgenius, DB... = Databet. These mappings override older generic Tennis rows for new competitions.

Challenger Singles:
- Betradar: Global RC G; Quinnbet RC F; NTI RC G. Therefore DAZN/QB/NTI = G/F/G. Never apply Betgenius main-draw RC E to a Betradar Challenger.
- Betgenius qualification/qualifying/quals/Q1-Q4: Global RC G; Quinnbet RC F; NTI RC G. Therefore G/F/G.
- Betgenius main draw/non-qualification: Global RC E; NTI RC G. Therefore E/E/G.
- Databet: Global RC G; Quinnbet RC F; NTI RC G. Therefore G/F/G.

WTA 125 Singles:
- Betradar: Global RC G; Quinnbet RC F; NTI RC G. Therefore G/F/G.
- Betgenius qualification/qualifying/quals/Q1-Q4: Global RC G; Quinnbet RC F; NTI RC G. Therefore G/F/G.
- Betgenius main draw/non-qualification: Global RC E; NTI RC G. Therefore E/E/G.
- Databet: Global RC G; Quinnbet RC F; NTI RC G. Therefore G/F/G.

ATP/WTA 250 Singles:
- Betradar: Global RC E; NTI RC G. Therefore E/E/G.
- Betgenius qualification/qualifying/quals/Q1-Q4: Global RC E; NTI RC G. Therefore E/E/G.
- Betgenius main draw/non-qualification: Global RC D; NTI RC E. Therefore D/D/E.
- Databet: Global RC E; NTI RC G. Therefore E/E/G.

ATP/WTA 500, ATP/WTA 1000 and Grand Slam Singles:
- Betradar: Global RC E; NTI RC E. Therefore E/E/E.
- Betgenius qualification/qualifying/quals/Q1-Q4: Global RC E. Therefore E/E/E.
- Betgenius main draw/non-qualification: Global RC C; NTI RC E. Therefore C/C/E.
- Databet: Global RC E; NTI RC E. Therefore E/E/E.

For these rules, a Tennis row is Singles whenever it is not explicitly Doubles/Mixed Doubles and not Junior/Boys/Girls/Wheelchair. The word "Singles" is not required in the input. Global fills every brand without an explicit override and does not create a warning or rec. marker.`;

export function requiredProviderTennisRules() {
  return REQUIRED_RULES.map(cloneRule);
}

export function mergeRequiredProviderTennisRules(managedRules, { rulesVersion = 0 } = {}) {
  const managed = Array.isArray(managedRules) ? managedRules.filter(Boolean) : [];
  if (Number(rulesVersion) >= PROVIDER_TENNIS_RULES_VERSION) return managed;

  const requiredIds = new Set(REQUIRED_RULES.map((rule) => rule.id));

  // Backwards-compatible runtime fallback for stale KV bundles. It runs before generic
  // Tennis rules and replaces old same-ID rows that required the literal word Singles.
  // Once the managed bundle publishes providerTennisRulesVersion, Rules Manager becomes
  // authoritative again so later approved data-only edits do not require another deploy.
  return [
    ...REQUIRED_RULES.map(cloneRule),
    ...managed.filter((rule) => !requiredIds.has(String(rule?.id || ''))),
  ];
}

export function requiredProviderTennisRuleIds() {
  return REQUIRED_RULES.map((rule) => rule.id);
}

function providerRule(id, provider, all, none, dazn, quinnbet, nti, basis) {
  const providerSentinel = `\\b(?:${provider.toLowerCase()})\\b`;
  return {
    id,
    sport: 'tennis',
    providers: [provider],
    match: { any: [], all: [...all, providerSentinel], none: [...none, OPERATIONAL_EXCLUSIONS] },
    dazn,
    quinnbet,
    nti,
    basis,
    source: 'Risk Class guide',
  };
}

function cloneRule(rule) {
  return {
    ...rule,
    providers: Array.isArray(rule?.providers) ? [...rule.providers] : undefined,
    match: {
      any: [...(rule?.match?.any || [])],
      all: [...(rule?.match?.all || [])],
      none: [...(rule?.match?.none || [])],
    },
  };
}
