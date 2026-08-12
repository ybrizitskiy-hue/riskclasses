import { readFileSync } from 'node:fs';
import { buildRuntimeIndex, classifyDeterministic } from '../functions/lib/deterministic.js';
import {
  decorateInputRows,
  filterGlobalInheritanceWarnings,
  parseCompetitionRows,
  providerFromCompetitionId,
  resolveGlobalBrands,
} from '../functions/lib/input-contract.js';
import { baselineDeterministicRules, validateRulesBundle } from '../functions/lib/rules-bundle.js';

let checks = 0;

const parsed = decorateInputRows(parseCompetitionRows([
  'Sport\tCompetition\tCompetition ID',
  'Tennis\tATP 250 Example. Men Singles\tU-31318',
  'Tennis\tWTA 125 Example. Women Singles\tBG-31317',
  'Tennis\tATP Challenger Example. Men Singles\tDB-31316',
].join('\n')));
assert(parsed.length === 3, 'Three-column input must keep all rows');
assert(parsed[0].competitionId === 'U-31318' && parsed[0].dataProvider === 'Betradar', 'U must map to Betradar');
assert(parsed[1].competitionId === 'BG-31317' && parsed[1].dataProvider === 'Betgenius', 'BG must map to Betgenius');
assert(parsed[2].competitionId === 'DB-31316' && parsed[2].dataProvider === 'Databet', 'DB must map to Databet');
assert(providerFromCompetitionId(' bg1 ') === 'Betgenius', 'Provider mapping must trim and ignore case');
assert(providerFromCompetitionId('X-1') === '', 'Unknown prefixes must stay unresolved');
assert(parseCompetitionRows('Sport;Competition;Event ID\nTennis;Example;BG-44')[0].competitionId === 'BG-44', 'Event ID header alias must work');
assert(parseCompetitionRows('Sport\tCompetition\nGolf\tPGA Tour')[0].competitionId === '', 'Legacy two-column input must remain supported');
assert(parseCompetitionRows('1\tTennis\tExample\tDB-9')[0].competitionId === 'DB-9', 'Row-number-prefixed input must retain ID');

const inherited = resolveGlobalBrands({ global: 'Risk Class G', dazn: '', quinnbet: 'Same as Global', nti: 'RC F' });
assert(inherited.global === 'RC G', 'Global must normalize');
assert(inherited.dazn === 'RC G' && inherited.quinnbet === 'RC G', 'Unspecified brands must inherit Global');
assert(inherited.nti === 'RC F', 'Explicit brand override must win');
assert(!/rec\./i.test(`${inherited.dazn} ${inherited.quinnbet}`), 'Exact Global inheritance must not add rec.');
const recommended = resolveGlobalBrands({ global: 'RC G rec.', dazn: '', quinnbet: 'Global', nti: 'RC F' });
assert(recommended.dazn === 'RC G rec.' && recommended.quinnbet === 'RC G rec.', 'A genuine recommended Global must propagate unchanged');
const missing = resolveGlobalBrands({ global: '', dazn: '', quinnbet: '—', nti: 'RC E' });
assert(missing.dazn.includes('missing rule') && missing.quinnbet.includes('missing rule'), 'Missing Global and brand rule must remain missing');
const warnings = filterGlobalInheritanceWarnings([
  'No explicit Quinnbet override; Global applies.',
  'NTI inherits the Global value because no separate override exists.',
  'Official tournament level could not be verified.',
]);
assert(warnings.length === 1 && warnings[0].startsWith('Official'), 'Inheritance-only warnings must be suppressed');

const rules = baselineDeterministicRules();
const validation = validateRulesBundle({
  schemaVersion: 1,
  version: 'event-id-global-test',
  instructions: `High -> Manual check No. Medium -> Yes. Low -> Yes. rec. can never be High. ${'Global fills every unspecified brand. '.repeat(30)}`,
  knowledge: `## 7. Explicit RC I Football Leagues\n\n1. Test League - Testland\n\n## 8. End\n\n${'Approved risk class knowledge. '.repeat(120)}`,
  deterministicRules: rules,
});
assert(validation.valid, `Provider-aware baseline must validate: ${validation.errors.join('; ')}`);
assert(rules.engineVersion === 2, 'Provider-aware deterministic engine must be version 2');
const providerRules = rules.rules.filter((rule) => rule.providers?.length);
assert(providerRules.length === 16, 'Exactly 16 requested provider Tennis mappings must exist');
for (const rule of providerRules) {
  const patterns = [...(rule.match.any || []), ...(rule.match.all || [])].join(' ').toLowerCase();
  assert(rule.providers.every((provider) => patterns.includes(provider.toLowerCase())), `${rule.id} must include a legacy-safe provider sentinel`);
}

const index = buildRuntimeIndex({ deterministicRules: rules });
const cases = [
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
for (const [competitionId, competition, dazn, quinnbet, nti] of cases) {
  const result = classifyDeterministic({ sport: 'Tennis', competition, competitionId }, index);
  assert(result, `No provider result for ${competitionId} / ${competition}`);
  assert(result.dazn === dazn && result.quinnbet === quinnbet && result.nti === nti, `Wrong classes for ${competitionId} / ${competition}`);
  assert(result.confidence === 'High' && result.manualCheck === false, `Exact provider rule must be High/No for ${competition}`);
}
assert(classifyDeterministic({ sport: 'Tennis', competition: 'ATP 250 Example. Men Singles' }, index) === null, 'Provider rules must not run without a recognized ID/provider');
assert(classifyDeterministic({ sport: 'Tennis', competition: 'ATP 250 Example. Men Singles', competitionId: 'X-9' }, index) === null, 'Unknown ID prefixes must not select a provider rule');
const srl = classifyDeterministic({ sport: 'Tennis', competition: 'SRL Summer Invitational. Men Singles', competitionId: 'BG-100' }, index);
assert(srl?.dazn === 'RC H' && srl?.quinnbet === 'RC H' && srl?.nti === 'RC H', 'Tennis SRL H/H/H must override provider rules');
const doubles = classifyDeterministic({ sport: 'Tennis', competition: 'ATP Challenger Example. Men Doubles', competitionId: 'BG-101' }, index);
assert(doubles?.dazn === 'RC G' && doubles?.quinnbet === 'RC F' && doubles?.nti === 'RC G', 'Existing Challenger Doubles behavior must remain unchanged');
const contender = classifyDeterministic({ sport: 'MMA', competition: 'Dana Whites Contender Series: Season 10' }, index);
assert(contender?.dazn === 'RC E' && contender?.quinnbet === 'RC E' && contender?.nti === 'RC E', 'MMA Contender Series v3 E/E/E must remain unchanged');

const analyzeSource = readFileSync(new URL('../functions/api/analyze-core.js', import.meta.url), 'utf8');
assert(analyzeSource.includes("required: ['sport', 'competition', 'competitionId']"), 'Extraction schema must require Competition ID');
assert(analyzeSource.includes("'global', 'dazn', 'quinnbet', 'nti'"), 'Classifier schema must include Global');
assert(analyzeSource.includes('official ATP Tour or WTA tournament calendar/page'), 'Research contract must prefer official ATP/WTA sources');
assert(analyzeSource.includes('resolveGlobalBrands(row)'), 'Server consistency must apply Global inheritance');
assert(analyzeSource.includes("promptCacheKey: 'riskclasses-row-extraction-v3'"), 'Extraction cache key must be versioned for the new schema');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert(html.includes('<th>Competition ID</th>'), 'Results table must display Competition ID');
assert(html.includes('Global fills brands without an override'), 'UI must explain Global inheritance');
const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
assert(appSource.includes("['Sport','Competition','Competition ID','DAZN'"), 'Copy/CSV exports must include Competition ID');
assert(appSource.includes('row.competitionId'), 'Rendered result rows must include Competition ID');

console.log(`event ID, provider Tennis and Global inheritance smoke tests passed (${checks} checks)`);

function assert(condition, message) {
  checks += 1;
  if (!condition) throw new Error(message);
}
