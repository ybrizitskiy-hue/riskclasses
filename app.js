const form = document.getElementById('classifyForm');
const submitBtn = document.getElementById('submitBtn');
const resultPanel = document.getElementById('resultPanel');
const sportsList = document.getElementById('sportsList');
const operatorSelect = document.getElementById('operator');
const enableAiFallback = document.getElementById('enableAiFallback');
const openaiApiKey = document.getElementById('openaiApiKey');
const openaiModel = document.getElementById('openaiModel');
const aiThreshold = document.getElementById('aiThreshold');
const rememberAiSettings = document.getElementById('rememberAiSettings');
const aiSettings = document.getElementById('aiSettings');

const SETTINGS_KEY = 'riskClassifierAiSettings';

const API_SETTINGS_KEY = 'riskClassifierApiBaseUrl';

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


function setText(id, value) {
  document.getElementById(id).textContent = value ?? '—';
}

function confidenceClass(label) {
  return String(label || '').toLowerCase();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function loadLocalAiSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (!saved) return;
    if (typeof saved.enabled === 'boolean') enableAiFallback.checked = saved.enabled;
    if (saved.model) openaiModel.value = saved.model;
    if (saved.threshold) aiThreshold.value = saved.threshold;
    if (saved.apiKey) openaiApiKey.value = saved.apiKey;
    rememberAiSettings.checked = true;
    if (saved.enabled || saved.apiKey) aiSettings.open = true;
  } catch (_) {
    // Ignore invalid local settings.
  }
}

function persistLocalAiSettings() {
  if (!rememberAiSettings.checked) {
    localStorage.removeItem(SETTINGS_KEY);
    return;
  }
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    enabled: enableAiFallback.checked,
    apiKey: openaiApiKey.value,
    model: openaiModel.value,
    threshold: aiThreshold.value,
  }));
}

async function loadMeta() {
  try {
    const res = await apiFetch('/api/meta');
    if (!res.ok) throw new Error(`API returned HTTP ${res.status}`);
    const data = await res.json();
    setText('sourceFile', data.metadata?.sourceFile || 'Uploaded workbook');
    setText('sourceMeta', `${data.metadata?.guidelineRows || 0} guideline rows · ${data.metadata?.footballRcICompetitions || 0} RC I football entries`);
    const tsdb = data.integrations?.theSportsDB;
    const openAI = data.integrations?.openAI;
    setText('integrationMeta', `TheSportsDB: ${tsdb?.apiKeySource || 'default_free_key_123'} · GPT env key: ${openAI?.envKeyConfigured ? 'configured' : 'not configured'}`);
    sportsList.innerHTML = (data.sports || []).map((s) => `<option value="${escapeHtml(s)}"></option>`).join('');
    operatorSelect.innerHTML = (data.operators || ['Global']).map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
    document.getElementById('sport').value = 'Football';
    if (openAI?.defaultModel) openaiModel.value = openAI.defaultModel;
    if (Number.isFinite(openAI?.defaultThreshold)) aiThreshold.value = openAI.defaultThreshold;
    enableAiFallback.checked = Boolean(openAI?.fallbackDefaultEnabled);
    if (enableAiFallback.checked || openAI?.envKeyConfigured) aiSettings.open = true;
    loadLocalAiSettings();
  } catch (error) {
    setText('sourceFile', 'Worker API not connected');
    setText('sourceMeta', 'Open the connection panel above.');
    setText('integrationMeta', error.message || 'API connection failed');
    operatorSelect.innerHTML = '<option value="Global">Global</option>';
    document.getElementById('sport').value = 'Football';
    showApiUrlHelper(error.message || 'The website could not reach the Worker API.');
    loadLocalAiSettings();
  }
}
function renderResult(data) {
  resultPanel.classList.remove('hidden');
  setText('riskClass', data.riskClass || 'No result');
  const conf = document.getElementById('confidenceBadge');
  conf.textContent = `${Math.round((data.confidence || 0) * 100)}% · ${data.confidenceLabel || 'Low'}`;
  conf.className = `confidence ${confidenceClass(data.confidenceLabel)}`;
  setText('source', data.source);
  setText('matchType', data.matchType);
  setText('matched', data.matchedCompetition || data.matchedRuleText || data.matchedTerm || data.operatorRule || '—');
  setText('manualReview', data.needsManualReview ? 'Yes' : 'No');
  const explanation = document.getElementById('explanation');
  explanation.innerHTML = '';
  for (const line of data.explanation || []) {
    const li = document.createElement('li');
    li.textContent = line;
    explanation.appendChild(li);
  }
  const extra = [];
  if (data.externalEnrichment?.provider) {
    const status = data.externalEnrichment.status;
    const best = data.externalEnrichment.bestMatch?.league;
    extra.push(`TheSportsDB ${status}${best ? `: ${best}` : ''}`);
  }
  if (data.aiFallback?.status) {
    extra.push(`GPT fallback: ${data.aiFallback.status}${data.aiFallback.model ? ` (${data.aiFallback.model})` : ''}`);
  }
  for (const line of extra) {
    const li = document.createElement('li');
    li.textContent = line;
    explanation.appendChild(li);
  }
  setText('jsonOut', JSON.stringify(data, null, 2));
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  persistLocalAiSettings();
  submitBtn.disabled = true;
  submitBtn.textContent = 'Classifying…';
  const payload = {
    sport: form.sport.value,
    competition: form.competition.value,
    operator: form.operator.value,
    isOutright: form.isOutright.checked,
    useExternalLookup: form.useExternalLookup.checked,
    aiFallbackEnabled: enableAiFallback.checked,
    openaiModel: openaiModel.value || 'gpt-4.1-mini',
    aiFallbackConfidenceThreshold: Number(aiThreshold.value || 0.75),
  };
  if (openaiApiKey.value.trim()) payload.openaiApiKey = openaiApiKey.value.trim();
  try {
    const res = await apiFetch('/api/classify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Classification failed');
    renderResult(data);
  } catch (error) {
    renderResult({ riskClass: 'Error', confidence: 0, confidenceLabel: 'Low', source: 'client', matchType: 'error', needsManualReview: true, explanation: [error.message] });
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Classify competition';
  }
});

for (const el of [enableAiFallback, openaiApiKey, openaiModel, aiThreshold, rememberAiSettings]) {
  el.addEventListener('change', persistLocalAiSettings);
}

loadMeta();
