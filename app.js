const form = document.getElementById('classifyForm');
const submitBtn = document.getElementById('submitBtn');
const clearBtn = document.getElementById('clearBtn');
const resultPanel = document.getElementById('resultPanel');
const bulkInput = document.getElementById('bulkInput');
const resultTitle = document.getElementById('resultTitle');
const resultsBody = document.getElementById('resultsBody');
const copyResultsBtn = document.getElementById('copyResultsBtn');

const API_SETTINGS_KEY = 'riskClassifierApiBaseUrl';
let lastResults = [];

function cleanApiBase(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

function getApiBase() {
  const saved = cleanApiBase(localStorage.getItem(API_SETTINGS_KEY));
  const configured = cleanApiBase(window.RISK_CLASSIFIER_API_URL || '');
  return saved || configured;
}

async function apiFetch(path, options = {}) {
  const base = getApiBase();
  const url = base ? `${base}${path}` : path;
  return fetch(url, options);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function showApiUrlHelper(message) {
  const panel = document.createElement('div');
  panel.className = 'api-helper panel';
  panel.innerHTML = `
    <h2>Connect the website to your Worker</h2>
    <p>${escapeHtml(message || 'Paste your Cloudflare Worker URL below. This is saved only in this browser. For permanent setup, paste the same URL into config.js in GitHub.')}</p>
    <label>Worker API URL
      <input id="apiBaseUrlInput" placeholder="https://risk-classifier-api.YOUR-SUBDOMAIN.workers.dev" value="${escapeHtml(getApiBase())}" />
    </label>
    <button type="button" id="saveApiBaseUrl">Save API URL</button>
  `;
  const existing = document.querySelector('.api-helper');
  if (existing) existing.remove();
  document.querySelector('.shell').prepend(panel);
  document.getElementById('saveApiBaseUrl').addEventListener('click', () => {
    const value = cleanApiBase(document.getElementById('apiBaseUrlInput').value);
    if (value) localStorage.setItem(API_SETTINGS_KEY, value);
    else localStorage.removeItem(API_SETTINGS_KEY);
    window.location.reload();
  });
}

function splitPastedLine(line) {
  // Excel/Google Sheets normally paste rows as tab-separated text. Keep empty cells;
  // do not filter them out, because exported tables may contain blank Event/Event ID columns.
  if (line.includes('\t')) return line.split('\t').map((x) => x.trim());
  if (line.includes(';')) return line.split(';').map((x) => x.trim());
  // Only use comma split when there are several commas. Competition names may contain commas,
  // so tab-separated paste is preferred.
  if ((line.match(/,/g) || []).length >= 2) return line.split(',').map((x) => x.trim());
  return line.split(/\s{2,}/).map((x) => x.trim());
}

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const KNOWN_SPORTS = new Set([
  'american football', 'aussie rules', 'badminton', 'bandy', 'baseball', 'basketball',
  'boxing', 'cricket', 'darts', 'esports', 'e sports', 'football', 'futsal', 'golf',
  'handball', 'ice hockey', 'mma', 'motorsport', 'rugby league', 'rugby union',
  'snooker', 'soccer', 'table tennis', 'tennis', 'volleyball', 'water polo'
]);

function isKnownSport(value) {
  return KNOWN_SPORTS.has(normalizeHeader(value));
}

function findHeaderIndexes(parts) {
  const headers = parts.map(normalizeHeader);
  const sportIndex = headers.findIndex((h) => h === 'sport');
  const competitionIndex = headers.findIndex((h) => h === 'competition' || h === 'competition name');
  const operatorIndex = headers.findIndex((h) => h === 'operator' || h === 'operator brand' || h === 'brand' || h === 'trs id');
  if (sportIndex >= 0 && competitionIndex >= 0) {
    return { sportIndex, competitionIndex, operatorIndex };
  }
  return null;
}

function parsePastedRows(text) {
  const rows = [];
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  let detectedHeader = null;

  for (const rawLine of lines) {
    if (!rawLine.trim()) continue;
    const parts = splitPastedLine(rawLine);
    if (parts.length < 2) continue;

    const headerIndexes = findHeaderIndexes(parts);
    if (headerIndexes) {
      detectedHeader = headerIndexes;
      continue;
    }

    let sport = '';
    let competition = '';
    let operator = 'Global';

    if (detectedHeader) {
      sport = parts[detectedHeader.sportIndex] || '';
      competition = parts[detectedHeader.competitionIndex] || '';
      if (detectedHeader.operatorIndex >= 0 && parts[detectedHeader.operatorIndex]) {
        operator = /^global$/i.test(parts[detectedHeader.operatorIndex]) ? 'Global' : parts[detectedHeader.operatorIndex];
      }
    } else if (parts.length >= 3 && isKnownSport(parts[1])) {
      // Handles rows copied without the header from exports like:
      // global<TAB>Golf<TAB>Interwetten Open 2026 - Men<TAB>U-29771...
      operator = /^global$/i.test(parts[0]) ? 'Global' : parts[0];
      sport = parts[1];
      competition = parts[2];
    } else {
      // Simple old format: Sport<TAB>Competition
      sport = parts[0];
      competition = parts[1];
    }

    sport = String(sport || '').trim();
    competition = String(competition || '').trim();
    if (!sport || !competition) continue;

    rows.push({ sport, competition, operator });
  }
  return rows;
}

function confidenceClass(label) {
  return String(label || '').toLowerCase();
}

function explanationText(result) {
  const lines = Array.isArray(result.explanation) ? result.explanation : [];
  return lines.join(' ');
}

function renderResults(results) {
  lastResults = results || [];
  resultPanel.classList.remove('hidden');
  resultTitle.textContent = `${lastResults.length} classified row${lastResults.length === 1 ? '' : 's'}`;
  resultsBody.innerHTML = '';

  for (const item of lastResults) {
    const result = item.result || item;
    const tr = document.createElement('tr');
    const confidencePct = Math.round(Number(result.confidence || 0) * 100);
    const confidenceLabel = result.confidenceLabel || 'Low';
    tr.innerHTML = `
      <td>${item.index ?? ''}</td>
      <td>${escapeHtml(item.input?.sport || result.input?.sport || '')}</td>
      <td>${escapeHtml(item.input?.competition || result.input?.competition || '')}</td>
      <td><strong>${escapeHtml(result.riskClass || 'Error')}</strong></td>
      <td><span class="confidence mini ${confidenceClass(confidenceLabel)}">${confidencePct}% · ${escapeHtml(confidenceLabel)}</span></td>
      <td>${result.needsManualReview ? 'Yes' : 'No'}</td>
      <td>${escapeHtml(explanationText(result) || result.error || '—')}</td>
    `;
    resultsBody.appendChild(tr);
  }
}

function resultsToTsv(results) {
  const header = ['Sport', 'Competition', 'Risk class', 'Confidence', 'Confidence label', 'Manual review', 'Explanation'];
  const rows = [header];
  for (const item of results || []) {
    const result = item.result || item;
    rows.push([
      item.input?.sport || result.input?.sport || '',
      item.input?.competition || result.input?.competition || '',
      result.riskClass || '',
      `${Math.round(Number(result.confidence || 0) * 100)}%`,
      result.confidenceLabel || '',
      result.needsManualReview ? 'Yes' : 'No',
      explanationText(result) || result.error || '',
    ]);
  }
  return rows.map((row) => row.map((cell) => String(cell).replace(/\t/g, ' ').replace(/\r?\n/g, ' ')).join('\t')).join('\n');
}

async function checkApiConnection() {
  try {
    const res = await apiFetch('/api/meta');
    if (!res.ok) throw new Error(`API returned HTTP ${res.status}`);
  } catch (error) {
    showApiUrlHelper(error.message || 'The website could not reach the Worker API.');
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const rows = parsePastedRows(bulkInput.value);
  if (!rows.length) {
    renderResults([{ index: 1, input: { sport: '', competition: '' }, result: { riskClass: 'Error', confidence: 0, confidenceLabel: 'Low', needsManualReview: true, explanation: ['Paste rows with two columns: Sport and Competition.'] } }]);
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = `Classifying ${rows.length} row${rows.length === 1 ? '' : 's'}…`;

  try {
    const res = await apiFetch('/api/classify-batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        items: rows,
        operator: 'Global',
        isOutright: false,
        useExternalLookup: true,
        aiFallbackEnabled: true,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Batch classification failed');
    renderResults(data.results || []);
  } catch (error) {
    renderResults(rows.map((row, idx) => ({
      index: idx + 1,
      input: row,
      result: { riskClass: 'Error', confidence: 0, confidenceLabel: 'Low', needsManualReview: true, explanation: [error.message] },
    })));
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Classify pasted rows';
  }
});

clearBtn.addEventListener('click', () => {
  bulkInput.value = '';
  resultsBody.innerHTML = '';
  resultPanel.classList.add('hidden');
  lastResults = [];
});

copyResultsBtn.addEventListener('click', async () => {
  const tsv = resultsToTsv(lastResults);
  try {
    await navigator.clipboard.writeText(tsv);
    copyResultsBtn.textContent = 'Copied';
    setTimeout(() => { copyResultsBtn.textContent = 'Copy results'; }, 1200);
  } catch (_) {
    const area = document.createElement('textarea');
    area.value = tsv;
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
});

checkApiConnection();
