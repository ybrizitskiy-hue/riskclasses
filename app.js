const state = {
  mode: 'image',
  files: [],
  results: [],
  warnings: [],
  busy: false,
  progressTimer: null,
  startedAt: 0,
};

const els = {
  apiStatus: document.getElementById('apiStatus'),
  imageMode: document.getElementById('imageMode'),
  textMode: document.getElementById('textMode'),
  fileInput: document.getElementById('fileInput'),
  dropZone: document.getElementById('dropZone'),
  previewGrid: document.getElementById('previewGrid'),
  bulkInput: document.getElementById('bulkInput'),
  analyzeBtn: document.getElementById('analyzeBtn'),
  clearBtn: document.getElementById('clearBtn'),
  progressCard: document.getElementById('progressCard'),
  progressLabel: document.getElementById('progressLabel'),
  progressElapsed: document.getElementById('progressElapsed'),
  progressBar: document.getElementById('progressBar'),
  resultsCard: document.getElementById('resultsCard'),
  resultCount: document.getElementById('resultCount'),
  resultsBody: document.getElementById('resultsBody'),
  summaryStrip: document.getElementById('summaryStrip'),
  warnings: document.getElementById('warnings'),
  copyBtn: document.getElementById('copyBtn'),
  csvBtn: document.getElementById('csvBtn'),
};

const MAX_FILES = 4;
const MAX_FILE_BYTES = 15 * 1024 * 1024;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[ch]));
}

function updateAnalyzeState() {
  const hasInput = state.mode === 'image' ? state.files.length > 0 : els.bulkInput.value.trim().length > 0;
  els.analyzeBtn.disabled = state.busy || !hasInput;
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('.segmented-btn').forEach((btn) => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  els.imageMode.classList.toggle('active', mode === 'image');
  els.textMode.classList.toggle('active', mode === 'text');
  updateAnalyzeState();
}

document.querySelectorAll('.segmented-btn').forEach((btn) => btn.addEventListener('click', () => setMode(btn.dataset.mode)));

function addFiles(fileList) {
  const candidates = [...fileList].filter((file) => /^image\/(png|jpeg|webp)$/i.test(file.type));
  for (const file of candidates) {
    if (state.files.length >= MAX_FILES) break;
    if (file.size > MAX_FILE_BYTES) {
      showLocalWarning(`${file.name} is larger than 15 MB and was skipped.`);
      continue;
    }
    const duplicate = state.files.some((existing) => existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified);
    if (!duplicate) state.files.push(file);
  }
  renderPreviews();
  updateAnalyzeState();
}

function renderPreviews() {
  els.previewGrid.innerHTML = '';
  els.previewGrid.classList.toggle('hidden', state.files.length === 0);
  state.files.forEach((file, index) => {
    const card = document.createElement('div');
    card.className = 'preview-card';
    const img = document.createElement('img');
    img.alt = `Screenshot ${index + 1}`;
    const url = URL.createObjectURL(file);
    img.src = url;
    img.onload = () => URL.revokeObjectURL(url);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove screenshot ${index + 1}`);
    remove.textContent = '×';
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      state.files.splice(index, 1);
      renderPreviews();
      updateAnalyzeState();
    });
    card.append(img, remove);
    els.previewGrid.appendChild(card);
  });
}

els.dropZone.addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', () => {
  addFiles(els.fileInput.files);
  els.fileInput.value = '';
});
['dragenter', 'dragover'].forEach((name) => els.dropZone.addEventListener(name, (event) => {
  event.preventDefault();
  els.dropZone.classList.add('dragging');
}));
['dragleave', 'drop'].forEach((name) => els.dropZone.addEventListener(name, (event) => {
  event.preventDefault();
  els.dropZone.classList.remove('dragging');
}));
els.dropZone.addEventListener('drop', (event) => addFiles(event.dataTransfer.files));

document.addEventListener('paste', (event) => {
  if (state.mode !== 'image' || state.busy) return;
  const imageFiles = [...(event.clipboardData?.files || [])].filter((file) => file.type.startsWith('image/'));
  if (imageFiles.length) {
    event.preventDefault();
    addFiles(imageFiles);
  }
});
els.bulkInput.addEventListener('input', updateAnalyzeState);

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function clearAll() {
  state.files = [];
  state.results = [];
  state.warnings = [];
  els.bulkInput.value = '';
  els.resultsBody.innerHTML = '';
  els.resultsCard.classList.add('hidden');
  els.progressCard.classList.add('hidden');
  renderPreviews();
  updateAnalyzeState();
}
els.clearBtn.addEventListener('click', clearAll);

function startProgress() {
  state.startedAt = Date.now();
  els.progressCard.classList.remove('hidden');
  els.progressBar.style.width = '7%';
  const stages = [
    { at: 0, width: 20, label: 'Reading input…', active: 0 },
    { at: 2500, width: 43, label: 'Applying approved risk rules…', active: 1 },
    { at: 6500, width: 68, label: 'Researching uncertain rows only…', active: 2 },
    { at: 11000, width: 86, label: 'Validating brand confidence…', active: 3 },
  ];
  const tick = () => {
    const elapsed = Date.now() - state.startedAt;
    els.progressElapsed.textContent = `${Math.floor(elapsed / 1000)}s`;
    const current = [...stages].reverse().find((stage) => elapsed >= stage.at) || stages[0];
    els.progressLabel.textContent = current.label;
    els.progressBar.style.width = `${current.width}%`;
    [...els.progressCard.querySelectorAll('.progress-stages span')].forEach((el, idx) => el.classList.toggle('active', idx <= current.active));
  };
  tick();
  state.progressTimer = setInterval(tick, 500);
}

function stopProgress(success = true) {
  clearInterval(state.progressTimer);
  state.progressTimer = null;
  els.progressBar.style.width = success ? '100%' : '15%';
  els.progressLabel.textContent = success ? 'Complete' : 'Analysis failed';
  setTimeout(() => els.progressCard.classList.add('hidden'), success ? 600 : 1800);
}

function normalizeResultRow(row) {
  const confidence = ['High', 'Medium', 'Low'].includes(row.confidence) ? row.confidence : 'Low';
  const manualCheckReason = String(row.manualCheckReason || '').trim();
  const brandValues = [row.dazn, row.quinnbet, row.nti].map((x) => String(x || ''));
  const hasRec = brandValues.some((x) => /\brec\./i.test(x));
  const hasMissing = brandValues.some((x) => /missing rule|manual check/i.test(x));

  // Client guardrail only enforces generic confidence consistency. Review labels
  // such as Stage come from the managed rules JSON through the API response.
  let finalConfidence = confidence;
  if (hasMissing) finalConfidence = 'Low';
  else if (hasRec && finalConfidence === 'High') finalConfidence = 'Medium';
  const manualCheck = Boolean(row.manualCheck) || finalConfidence !== 'High' || hasRec || hasMissing;
  let manualCheckType = String(row.manualCheckType || '').trim();
  if (!manualCheck) manualCheckType = 'No';
  else if (!manualCheckType || manualCheckType === 'No') manualCheckType = 'Yes';

  return { ...row, confidence: finalConfidence, manualCheck, manualCheckReason, manualCheckType };
}

function sourceChips(sources) {
  const items = Array.isArray(sources) ? sources : [sources].filter(Boolean);
  if (!items.length) return '<span class="source-chip">—</span>';
  return `<div class="source-list">${items.map((source) => `<span class="source-chip" title="${escapeHtml(source)}">${escapeHtml(source)}</span>`).join('')}</div>`;
}

function renderResults(payload) {
  state.results = (payload.rows || []).map(normalizeResultRow);
  state.warnings = payload.warnings || [];
  els.resultsBody.innerHTML = '';

  for (const row of state.results) {
    const tr = document.createElement('tr');
    const confClass = row.confidence.toLowerCase();
    tr.innerHTML = `
      <td>${escapeHtml(row.sport)}</td>
      <td>${escapeHtml(row.competition)}</td>
      <td>${escapeHtml(row.competitionId)}</td>
      <td>${escapeHtml(row.dazn)}</td>
      <td>${escapeHtml(row.quinnbet)}</td>
      <td>${escapeHtml(row.nti)}</td>
      <td>${escapeHtml(row.basis)}</td>
      <td><span class="confidence-pill ${confClass}">${escapeHtml(row.confidence)}</span></td>
      <td>${sourceChips(row.sources)}</td>
      <td><span class="manual-pill ${row.manualCheckType === 'Stage' ? 'stage' : (row.manualCheck ? 'yes' : 'no')}" title="${escapeHtml(row.manualCheckReason || '')}">${escapeHtml(row.manualCheckType)}</span></td>
    `;
    els.resultsBody.appendChild(tr);
  }

  const high = state.results.filter((r) => r.confidence === 'High').length;
  const medium = state.results.filter((r) => r.confidence === 'Medium').length;
  const low = state.results.filter((r) => r.confidence === 'Low').length;
  const checks = state.results.filter((r) => r.manualCheck).length;
  els.summaryStrip.innerHTML = [
    `<span class="summary-item"><strong>${high}</strong> High</span>`,
    `<span class="summary-item"><strong>${medium}</strong> Medium</span>`,
    `<span class="summary-item"><strong>${low}</strong> Low</span>`,
    `<span class="summary-item"><strong>${checks}</strong> manual check${checks === 1 ? '' : 's'}</span>`,
  ].join('');
  els.resultCount.textContent = `${state.results.length} row${state.results.length === 1 ? '' : 's'}`;

  if (state.warnings.length) {
    els.warnings.classList.remove('hidden');
    els.warnings.innerHTML = state.warnings.map((warning) => `• ${escapeHtml(warning)}`).join('<br>');
  } else {
    els.warnings.classList.add('hidden');
    els.warnings.innerHTML = '';
  }
  els.resultsCard.classList.remove('hidden');
  els.resultsCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function showLocalWarning(message) {
  els.warnings.classList.remove('hidden');
  els.warnings.textContent = message;
  els.resultsCard.classList.remove('hidden');
}

async function analyze() {
  if (state.busy) return;
  state.busy = true;
  updateAnalyzeState();
  els.analyzeBtn.classList.add('loading');
  els.analyzeBtn.querySelector('.btn-label').textContent = 'Analyzing…';
  startProgress();
  try {
    const images = state.mode === 'image' ? await Promise.all(state.files.map(fileToDataUrl)) : [];
    const body = {
      mode: state.mode,
      images,
      text: state.mode === 'text' ? els.bulkInput.value : '',
    };
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `API returned HTTP ${response.status}`);
    stopProgress(true);
    renderResults(payload);
  } catch (error) {
    stopProgress(false);
    showLocalWarning(error.message || 'Analysis failed.');
  } finally {
    state.busy = false;
    els.analyzeBtn.classList.remove('loading');
    els.analyzeBtn.querySelector('.btn-label').textContent = 'Analyze risk classes';
    updateAnalyzeState();
  }
}
els.analyzeBtn.addEventListener('click', analyze);

function tsv() {
  const rows = [['Sport','Competition','Competition ID','DAZN','Quinnbet','NTI','Basis','Confidence','Sources','Manual check','Manual check reason']];
  for (const r of state.results) rows.push([r.sport,r.competition,r.competitionId,r.dazn,r.quinnbet,r.nti,r.basis,r.confidence,(r.sources||[]).join(' | '),r.manualCheckType,r.manualCheckReason||'']);
  return rows.map((row) => row.map((cell) => String(cell ?? '').replace(/\t/g,' ').replace(/\r?\n/g,' ')).join('\t')).join('\n');
}

els.copyBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(tsv());
  const old = els.copyBtn.textContent;
  els.copyBtn.textContent = 'Copied';
  setTimeout(() => { els.copyBtn.textContent = old; }, 1200);
});

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g,'""')}"` : text;
}
els.csvBtn.addEventListener('click', () => {
  const rows = [['Sport','Competition','Competition ID','DAZN','Quinnbet','NTI','Basis','Confidence','Sources','Manual check','Manual check reason']];
  for (const r of state.results) rows.push([r.sport,r.competition,r.competitionId,r.dazn,r.quinnbet,r.nti,r.basis,r.confidence,(r.sources||[]).join(' | '),r.manualCheckType,r.manualCheckReason||'']);
  const blob = new Blob([rows.map((row) => row.map(csvEscape).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `risk-classes-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

async function checkApi() {
  try {
    const response = await fetch('/api/meta', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'API unavailable');
    els.apiStatus.className = 'status-pill ok';
    els.apiStatus.innerHTML = '<span class="status-dot"></span>API ready';
  } catch (_) {
    els.apiStatus.className = 'status-pill error';
    els.apiStatus.innerHTML = '<span class="status-dot"></span>API setup required';
  }
}
checkApi();
