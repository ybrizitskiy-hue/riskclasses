const RC_ORDER = ['A','B','C','D','E','F','G','H','I'];

export function buildRuntimeIndex(knowledge = '') {
  const footballRcI = new Set();
  const marker = '## 7. Explicit RC I Football Leagues';
  const start = knowledge.indexOf(marker);
  if (start >= 0) {
    const tail = knowledge.slice(start + marker.length);
    const next = tail.search(/\n##\s+8\./);
    const section = next >= 0 ? tail.slice(0, next) : tail;
    for (const line of section.split('\n')) {
      const match = line.match(/^\s*\d+\.\s+(.+?)\s*$/);
      if (match) footballRcI.add(normalize(match[1]));
    }
  }
  return { footballRcI };
}

export function classifyDeterministic(row, index) {
  const sportRaw = String(row?.sport || '').trim();
  const competitionRaw = String(row?.competition || '').trim();
  if (!sportRaw || !competitionRaw) return null;

  const sport = normalize(sportRaw);
  const competition = normalize(competitionRaw);
  let result = null;

  if (sport === 'tennis') result = classifyTennis(competitionRaw, competition);
  else if (sport === 'golf') result = classifyGolf(competitionRaw, competition);
  else if (sport === 'table tennis') result = classifyTableTennis(competitionRaw, competition);
  else if (sport === 'badminton') result = classifyBadminton(competitionRaw, competition);
  else if (sport === 'mma') result = classifyMma(competitionRaw, competition);
  else if (sport === 'football' && index?.footballRcI?.has(competition)) {
    result = confirmed('RC I', 'RC I', 'RC I', 'Football RC I explicit list');
  }

  if (!result) return null;
  if (isOutrightText(competitionRaw)) return applyOutright(result);
  return { ...result, sport: sportRaw, competition: competitionRaw, route: 'deterministic' };
}

function classifyTennis(original, c) {
  if (/\b(srl|simulated reality|virtuals?|simulated)\b/.test(c)) {
    return confirmed('RC H', 'RC H', 'RC H', 'Operational exception: Tennis SRL / Simulated Reality not offered');
  }

  if (/\butr\b/.test(c)) {
    return confirmed('RC H', 'RC G', 'RC H', 'UTR / UTR PTT');
  }

  if (/\bchallenger\b/.test(c) && /\bdoubles?\b/.test(c)) {
    return confirmed('RC G', 'RC F', 'RC G', 'Challenger Doubles');
  }

  const itfContext = /\bitf\b/.test(c) || /^wt\b/.test(c) || /\bworld tennis tour\b/.test(c);
  if (!itfContext) return null;

  if (/\b(qualification|qualifier|qualifying|quals?)\b/.test(c)) {
    return confirmed('RC H', 'RC G', 'RC H', 'ITF Singles Qualification');
  }
  if (/\bdoubles?\b/.test(c)) {
    return confirmed('RC H', 'RC G', 'RC H', 'ITF / World Tennis Tour Doubles');
  }

  return confirmed('RC G', 'RC F', 'RC G', 'ITF / World Tennis Tour Singles Main Draw');
}

function classifyGolf(original, c) {
  if (/\bryder cup\b/.test(c) || /\bthe masters\b/.test(c) || /\bmasters tournament\b/.test(c) || /\bpga championship\b/.test(c) || /\bu\.?s\.? open\b/.test(c) || /\bthe open championship\b/.test(c)) {
    return confirmed('RC A', 'RC A', 'RC A', 'Golf Major / Ryder Cup');
  }
  if (/\bpga tour champions\b/.test(c) || /\bkorn ferry\b/.test(c) || /\blpga\b/.test(c) || /\bboeing classic\b/.test(c)) {
    return confirmed('RC C', 'RC C', 'RC C', /boeing classic|pga tour champions/.test(c) ? 'PGA Tour Champions / Golf other' : 'Korn Ferry / LPGA');
  }
  if (/\bpga tour\b/.test(c) || /\bdp world tour\b/.test(c) || /\bliv golf\b/.test(c) || /\bliv golf league\b/.test(c)) {
    return confirmed('RC B', 'RC B', 'RC B', 'PGA Tour / DP World Tour / LIV');
  }
  return null;
}

function classifyTableTennis(original, c) {
  if (/\bwtt feeder\b/.test(c)) return confirmed('RC D', 'RC D', 'RC D', 'Table Tennis all other comps — WTT Feeder');
  if (/\bwtt star contender\b/.test(c)) return confirmed('RC D', 'RC D', 'RC D', 'Table Tennis all other comps — WTT Star Contender');
  if (/\bsingapore smash\b/.test(c)) return confirmed('RC D', 'RC D', 'RC D', 'Table Tennis explicit RC D category');
  return null;
}

function classifyBadminton(original, c) {
  const doublesMarker = /\b(doubles?|mixed doubles|md|wd|xd)\b/.test(c);
  if (/\bworld championships?\b/.test(c) && doublesMarker) {
    return confirmed('RC C', 'RC C', 'RC C', 'Badminton World Championships Doubles / XD');
  }
  if (/\bsuper 750\b/.test(c)) return confirmed('RC C', 'RC C', 'RC C', 'Badminton Super 750');
  if (/\bworld championships?\b/.test(c) || /\bsuper 1000\b/.test(c) || /\btour finals\b/.test(c) || /\beuropean championship\b/.test(c)) {
    return confirmed('RC A', 'RC A', 'RC A', 'Badminton elite category');
  }
  if (/\bmalaysia international\b/.test(c)) return confirmed('RC D', 'RC D', 'RC D', 'Badminton all other leagues');
  return null;
}

function classifyMma(original, c) {
  if (/\bcontender series\b/.test(c)) return confirmed('RC D', 'RC D', 'RC D', 'MMA Contender Series');
  return null;
}

function confirmed(dazn, quinnbet, nti, basis) {
  return {
    dazn,
    quinnbet,
    nti,
    basis,
    confidence: 'High',
    sources: ['Risk Class guide'],
    manualCheck: false,
  };
}

function applyOutright(result) {
  return {
    ...result,
    dazn: shiftOutright(result.dazn),
    quinnbet: shiftOutright(result.quinnbet),
    nti: shiftOutright(result.nti),
    basis: `${result.basis}; outright +2 classes`,
  };
}

function shiftOutright(value) {
  const match = String(value || '').match(/RC\s+([A-I])/i);
  if (!match) return value;
  const index = RC_ORDER.indexOf(match[1].toUpperCase());
  if (index < 0) return value;
  const shifted = RC_ORDER[Math.max(0, index - 2)];
  return String(value).replace(/RC\s+[A-I]/i, `RC ${shifted}`);
}

function isOutrightText(value) {
  return /\boutright\b|\btournament winner\b|\bchampionship winner\b/i.test(String(value || ''));
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
