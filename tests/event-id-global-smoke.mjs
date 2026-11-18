import { readFileSync, existsSync } from 'node:fs';
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

const inherited = resolveGlobalBrands({ global: 'Risk Class G', daznEs: '', daznDe: 'Same as Global', daznUk: '' });
assert(inherited.global === 'RC G', 'Global must normalize');
assert(inherited.daznEs === 'RC G' && inherited.daznDe === 'RC G' && inherited.daznUk === 'RC G', 'All unspecified DAZN brands must inherit Global');
assert(resolveGlobalBrands({global:'RC G', daznEs:'RC F', daznDe:'', daznUk:''}).daznEs === 'RC F', 'Explicit brand override must win');
assert(!/rec\./i.test(`${inherited.daznEs} ${inherited.daznDe} ${inherited.daznUk}`), 'Exact Global inheritance must not add rec.');
const recommended = resolveGlobalBrands({ global: 'RC G rec.', daznEs: '', daznDe: 'Same as Global', daznUk: 'Global' });
assert(recommended.daznEs === 'RC G rec.' && recommended.daznDe === 'RC G rec.' && recommended.daznUk === 'RC G rec.', 'A genuine recommended Global must propagate unchanged');
const missing = resolveGlobalBrands({ global: '', daznEs: '', daznDe: '—', daznUk: '' });
assert([missing.daznEs,missing.daznDe,missing.daznUk].every((v)=>v.includes('missing rule')), 'Missing Global and brand rules must remain missing');
const warnings = filterGlobalInheritanceWarnings([
  'No explicit DAZN ES override; Global applies.',
  'DAZN DE inherits the Global value because no separate override exists.',
  'Official tournament level could not be verified.',
]);
assert(warnings.length === 1 && warnings[0].startsWith('Official'), 'Inheritance-only warnings must be suppressed');

const empty = baselineDeterministicRules();
assert(Array.isArray(empty.rules) && empty.rules.length === 0, 'Application baseline must not contain sportsbook RC mappings');

const bundle = managedBundle();
const validation = validateRulesBundle(bundle);
assert(validation.valid, `Managed bundle should validate: ${validation.errors.join('; ')}`);
const index = buildRuntimeIndex(bundle);
const providerCases = [
  ['U-1', 'ATP Challenger Example', 'RC G'],
  ['BG-1', 'ATP Challenger Example Qualification', 'RC G'],
  ['BG-2', 'ATP Challenger Example', 'RC G'],
  ['DB-1', 'ATP Challenger Example', 'RC G'],
  ['U-2', 'WTA 125 Example', 'RC G'],
  ['BG-3', 'WTA 125 Example Qualifying', 'RC G'],
  ['BG-4', 'WTA 125 Example', 'RC G'],
  ['DB-2', 'WTA 125 Example', 'RC G'],
  ['U-3', 'ATP 250 Example', 'RC E'],
  ['BG-5', 'WTA 250 Example Q4', 'RC E'],
  ['BG-6', 'ATP 250 Example', 'RC D'],
  ['DB-3', 'WTA 250 Example', 'RC E'],
  ['U-4', 'ATP 500 Example', 'RC E'],
  ['BG-7', 'ATP Masters 1000 Example Qualifier', 'RC E'],
  ['BG-8', 'Wimbledon', 'RC C'],
  ['DB-4', 'U.S. Open', 'RC E'],
];
for (const [competitionId, competition, global] of providerCases) {
  const result = classifyDeterministic({ sport: 'Tennis', competition, competitionId }, index);
  assert(result, `No managed provider rule for ${competitionId} / ${competition}`);
  assert(result.global === global && result.daznEs === global && result.daznDe === global && result.daznUk === global, `Wrong managed classes for ${competitionId}`);
}

const changed = structuredClone(bundle);
const changedRule = changed.deterministicRules.rules.find((r) => r.id === 'tennis-bg-challenger-singles');
changedRule.daznEs = 'RC F';
const changedResult = classifyDeterministic({ sport:'Tennis', competition:'ATP Challenger Example', competitionId:'BG-2' }, buildRuntimeIndex(changed));
assert(changedResult.daznEs === 'RC F' && changedResult.daznDe === 'RC G' && changedResult.daznUk === 'RC G', 'Changing managed JSON must change only the selected brand without code change');

const productionFiles = [
  '../functions/lib/deterministic.js',
  '../functions/lib/rules-bundle.js',
  '../functions/api/analyze-core.js',
];
for (const rel of productionFiles) {
  const source = readFileSync(new URL(rel, import.meta.url), 'utf8');
  assert(!source.includes('Betgenius Challenger Singles; Global'), `${rel} must not contain provider Tennis RC mapping text`);
  assert(!source.includes('Tennis Virtuals/SRL/Simulated Reality are RC H'), `${rel} must not hard-code the SRL RC result`);
}
assert(!existsSync(new URL('../functions/lib/provider-tennis-rules.js', import.meta.url)), 'Hard-coded provider-tennis-rules.js must be removed');

console.log(`event ID, Global inheritance and JSON-authority smoke tests passed (${checks} checks)`);

function managedBundle() {
  const provider = (id, providerName, all, none, global) => ({
    id, sport:'tennis', providers:[providerName],
    match:{ any:[], all:[...all, `\\b(?:${providerName.toLowerCase()})\\b`], none },
    global, daznEs:'', daznDe:'Same as Global', daznUk:'', basis:id, source:'Risk Class guide',
  });
  const challenger='\\bchallengers?\\b';
  const wta125='\\bwta\\s*125(?:k)?\\b|\\b125k\\b';
  const t250='\\b(?:atp|wta)\\s*250\\b';
  const t500='\\b(?:atp|wta)\\s*(?:500|1000)\\b|\\bmasters?\\s*1000\\b|\\bwimbledon\\b|\\bu\\s*s\\s*open\\b';
  const qual='\\b(qualification|qualifier|qualifying|quals?|q[1-4])\\b';
  const dbl='\\b(doubles?|mixed doubles|md|wd|xd)\\b';
  const rules=[
    provider('tennis-br-challenger-singles','Betradar',[challenger],[dbl],'RC G'),
    provider('tennis-bg-challenger-qual-singles','Betgenius',[challenger,qual],[dbl],'RC G'),
    provider('tennis-bg-challenger-singles','Betgenius',[challenger],[qual,dbl],'RC G'),
    provider('tennis-db-challenger-singles','Databet',[challenger],[dbl],'RC G'),
    provider('tennis-br-wta125-singles','Betradar',[wta125],[dbl],'RC G'),
    provider('tennis-bg-wta125-qual-singles','Betgenius',[wta125,qual],[dbl],'RC G'),
    provider('tennis-bg-wta125-singles','Betgenius',[wta125],[qual,dbl],'RC G'),
    provider('tennis-db-wta125-singles','Databet',[wta125],[dbl],'RC G'),
    provider('tennis-br-250-singles','Betradar',[t250],[dbl],'RC E'),
    provider('tennis-bg-250-qual-singles','Betgenius',[t250,qual],[dbl],'RC E'),
    provider('tennis-bg-250-singles','Betgenius',[t250],[qual,dbl],'RC D'),
    provider('tennis-db-250-singles','Databet',[t250],[dbl],'RC E'),
    provider('tennis-br-500plus-singles','Betradar',[t500],[dbl],'RC E'),
    provider('tennis-bg-500plus-qual-singles','Betgenius',[t500,qual],[dbl],'RC E'),
    provider('tennis-bg-500plus-singles','Betgenius',[t500],[qual,dbl],'RC C'),
    provider('tennis-db-500plus-singles','Databet',[t500],[dbl],'RC E'),
  ];
  return {
    schemaVersion:1, version:'json-authority-test',
    instructions:`Managed JSON is the sole rule source. ${'Preserve managed mappings and policy data. '.repeat(30)}`,
    knowledge:`Managed JSON knowledge. ${'Approved managed knowledge text. '.repeat(120)}`,
    deterministicRules:{ engineVersion:2, rules }, resultPolicies:[], resultTransforms:[],
  };
}

function assert(condition, message) { checks += 1; if (!condition) throw new Error(message); }
