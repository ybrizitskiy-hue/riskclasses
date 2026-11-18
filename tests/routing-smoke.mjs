import { buildRuntimeIndex, classifyDeterministic } from '../functions/lib/deterministic.js';
import { validateRulesBundle } from '../functions/lib/rules-bundle.js';
let checks=0;
const bundle={schemaVersion:1,version:'routing-test',instructions:`Managed JSON authority. ${'Keep rules data driven. '.repeat(40)}`,knowledge:`Knowledge. ${'Managed risk knowledge. '.repeat(150)}`,deterministicRules:{engineVersion:2,rules:[
 {id:'exact',sport:'golf',match:{exact:['PGA Tour'],any:[],all:[],none:[]},global:'RC B',daznEs:'',daznDe:'Same as Global',daznUk:'',basis:'exact',source:'Managed JSON'},
 {id:'provider',sport:'tennis',providers:['Databet'],match:{any:[],all:['\\bchallenger\\b','\\bdatabet\\b'],none:['\\bdoubles?\\b']},global:'RC G',daznEs:'',daznDe:'Same as Global',daznUk:'',basis:'provider',source:'Managed JSON'},
]},resultPolicies:[],resultTransforms:[{id:'winner',field:'competition',match:{any:['\\btournament winner\\b'],all:[],none:[]},brandMap:{'RC B':'RC A','RC G':'RC E','RC F':'RC D'},basisSuffix:'; winner transform'}]};
assert(validateRulesBundle(bundle).valid,'Generic routing bundle must validate');
const idx=buildRuntimeIndex(bundle);
let r=classifyDeterministic({sport:'Golf',competition:'PGA Tour'},idx); assert(r?.global==='RC B'&&r?.daznEs==='RC B'&&r?.daznDe==='RC B'&&r?.daznUk==='RC B','Exact managed rule must classify all three brands');
r=classifyDeterministic({sport:'Tennis',competition:'ATP Challenger Example',competitionId:'DB-1'},idx); assert(r?.global==='RC G'&&r?.daznEs==='RC G'&&r?.daznDe==='RC G'&&r?.daznUk==='RC G','Provider filter must use ID-derived provider');
assert(classifyDeterministic({sport:'Tennis',competition:'ATP Challenger Example',competitionId:'U-1'},idx)===null,'Wrong provider must not match');
r=classifyDeterministic({sport:'Golf',competition:'PGA Tour Tournament Winner'},idx); assert(r===null,'Exact rule should not broaden to winner text');
console.log(`routing smoke tests passed (${checks} checks)`);
function assert(v,m){checks++;if(!v)throw new Error(m);}
