(() => {
  let current = null;
  let pendingBundle = null;
  let pendingValidation = null;
  let pendingDiff = null;
  let busy = false;

  injectStylesheet();
  injectAdminButton();
  injectModal();

  function injectStylesheet() {
    if (document.querySelector('link[href="/rules-manager.css"]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/rules-manager.css';
    document.head.appendChild(link);
  }

  function injectAdminButton() {
    const actions = document.querySelector('#adminUnlockedActions .admin-modal-actions');
    if (!actions || document.getElementById('manageRulesBtn')) return;
    const button = document.createElement('button');
    button.id = 'manageRulesBtn';
    button.type = 'button';
    button.className = 'btn ghost small';
    button.textContent = 'Manage rules';
    button.addEventListener('click', openRulesManager);
    actions.insertBefore(button, actions.firstChild);
  }

  function injectModal() {
    if (document.getElementById('rulesManagerModal')) return;
    const overlay = document.createElement('div');
    overlay.id = 'rulesManagerModal';
    overlay.className = 'admin-modal-backdrop rules-manager-backdrop';
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="rules-manager-modal" role="dialog" aria-modal="true" aria-labelledby="rulesManagerTitle">
        <div class="rules-manager-head">
          <div>
            <span class="admin-modal-kicker">Rules Manager · admin</span>
            <h3 id="rulesManagerTitle">Canonical risk rules</h3>
            <p>Export one complete JSON bundle, edit it with any GPT, validate the result here, then publish it globally without touching GitHub or Cloudflare KV.</p>
          </div>
          <button id="rulesManagerClose" type="button" class="admin-modal-close" aria-label="Close">×</button>
        </div>

        <div id="rulesManagerState" class="rules-manager-state">Loading current rules…</div>

        <div class="rules-manager-grid">
          <section class="rules-panel">
            <div class="rules-panel-head"><span>1</span><div><strong>Export current source</strong><small>One portable file is the complete source of truth.</small></div></div>
            <div id="rulesCurrentMeta" class="rules-current-meta"></div>
            <div class="rules-actions">
              <button id="rulesExportBtn" type="button" class="btn ghost small" disabled>Download current JSON</button>
              <button id="rulesPromptBtn" type="button" class="btn ghost small" disabled>Copy GPT update prompt</button>
            </div>
          </section>

          <section class="rules-panel">
            <div class="rules-panel-head"><span>2</span><div><strong>Import updated source</strong><small>The file is checked before Publish becomes available.</small></div></div>
            <input id="rulesFileInput" type="file" accept="application/json,.json" hidden />
            <button id="rulesChooseBtn" type="button" class="rules-drop-btn" disabled>
              <strong>Choose updated JSON</strong><span>Use the complete file returned by GPT</span>
            </button>
            <div id="rulesImportMeta" class="rules-import-meta">No file selected.</div>
          </section>
        </div>

        <section id="rulesValidationPanel" class="rules-validation-panel" hidden>
          <div class="rules-validation-head">
            <div><span class="section-label">Pre-publish validation</span><h4 id="rulesValidationTitle">Waiting for file</h4></div>
            <span id="rulesValidationBadge" class="rules-validation-badge"></span>
          </div>
          <div id="rulesDiff" class="rules-diff"></div>
          <div id="rulesMessages" class="rules-messages"></div>
          <div class="rules-publish-row">
            <span id="rulesPublishHint">Nothing has been published.</span>
            <button id="rulesPublishBtn" type="button" class="btn primary small" disabled>Publish globally</button>
          </div>
        </section>

        <section class="rules-history-panel">
          <div class="rules-history-head"><div><span class="section-label">Version history</span><h4>Rollback</h4></div><small>Previous bundles are retained automatically.</small></div>
          <div id="rulesHistory" class="rules-history-list"><span class="rules-empty">No history yet.</span></div>
        </section>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeRulesManager(); });
    document.getElementById('rulesManagerClose').addEventListener('click', closeRulesManager);
    document.getElementById('rulesExportBtn').addEventListener('click', exportCurrent);
    document.getElementById('rulesPromptBtn').addEventListener('click', copyGptPrompt);
    document.getElementById('rulesChooseBtn').addEventListener('click', () => document.getElementById('rulesFileInput').click());
    document.getElementById('rulesFileInput').addEventListener('change', importFile);
    document.getElementById('rulesPublishBtn').addEventListener('click', publishPending);
  }

  async function openRulesManager() {
    if (!window.RISK_ROUTING?.admin) return window.RISK_ROUTING?.unlock?.();
    document.getElementById('adminModal').hidden = true;
    const modal = document.getElementById('rulesManagerModal');
    modal.hidden = false;
    document.body.classList.add('admin-modal-open');
    resetPending();
    await loadCurrent();
  }

  function closeRulesManager() {
    document.getElementById('rulesManagerModal').hidden = true;
    document.body.classList.remove('admin-modal-open');
  }

  async function loadCurrent() {
    setState('Loading current rules…', 'loading');
    setBusy(true);
    try {
      const response = await fetch('/api/rules', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.bundle) throw new Error(data.error || 'Could not load rules.');
      current = data;
      renderCurrent();
      renderHistory(data.history || []);
      setState(`Current rules ${data.bundle.version} are loaded and validated.`, data.validation?.valid ? 'ok' : 'warn');
    } catch (error) {
      current = null;
      setState(error.message || 'Could not load rules.', 'error');
    } finally {
      setBusy(false);
    }
  }

  function renderCurrent() {
    const meta = document.getElementById('rulesCurrentMeta');
    const stats = current?.validation?.stats || {};
    meta.innerHTML = `
      <span><small>Version</small><strong>${escapeHtml(current.bundle.version || '—')}</strong></span>
      <span><small>Deterministic rules</small><strong>${Number(stats.deterministicRuleCount || 0)}</strong></span>
      <span><small>Knowledge</small><strong>${formatNumber(stats.knowledgeChars || 0)} chars</strong></span>
      <span><small>Schema</small><strong>v${Number(stats.schemaVersion || 0)}</strong></span>
    `;
    document.getElementById('rulesExportBtn').disabled = false;
    document.getElementById('rulesPromptBtn').disabled = false;
    document.getElementById('rulesChooseBtn').disabled = false;
  }

  function exportCurrent() {
    if (!current?.bundle) return;
    const payload = {
      editorGuide: current.gptGuide,
      bundle: current.bundle,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `RISK_RULES_${safeFile(current.bundle.version || 'current')}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copyGptPrompt() {
    if (!current?.gptGuide) return;
    const button = document.getElementById('rulesPromptBtn');
    try {
      await navigator.clipboard.writeText(current.gptGuide);
      button.textContent = 'Prompt copied';
      setTimeout(() => { button.textContent = 'Copy GPT update prompt'; }, 1400);
    } catch {
      setState('Could not copy automatically. Download the JSON; its editorGuide field contains the prompt.', 'warn');
    }
  }

  async function importFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 1000000) return showImportError('Rules file is larger than 1 MB.');
    setBusy(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      pendingBundle = parsed?.bundle && typeof parsed.bundle === 'object' ? parsed.bundle : parsed;
      document.getElementById('rulesImportMeta').textContent = `${file.name} · ${formatNumber(file.size)} bytes`;
      await validatePending();
    } catch (error) {
      showImportError(error instanceof SyntaxError ? 'The selected file is not valid JSON.' : (error.message || 'Could not read the file.'));
    } finally {
      setBusy(false);
    }
  }

  async function validatePending() {
    if (!pendingBundle) return;
    const response = await fetch('/api/rules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bundle: pendingBundle }),
    });
    const data = await response.json().catch(() => ({}));
    pendingValidation = data.validation || null;
    pendingDiff = data.diff || null;
    renderValidation();
  }

  function renderValidation() {
    const panel = document.getElementById('rulesValidationPanel');
    panel.hidden = false;
    const valid = Boolean(pendingValidation?.valid);
    const changed = Boolean(pendingDiff?.changed);
    document.getElementById('rulesValidationTitle').textContent = valid
      ? (changed ? `Ready: ${pendingBundle.version || 'new version'}` : 'Valid, but no changes detected')
      : 'Validation failed';
    const badge = document.getElementById('rulesValidationBadge');
    badge.className = `rules-validation-badge ${valid ? (changed ? 'ok' : 'warn') : 'error'}`;
    badge.textContent = valid ? (changed ? 'Valid' : 'No changes') : 'Blocked';
    renderDiff();
    renderMessages();
    const publish = document.getElementById('rulesPublishBtn');
    publish.disabled = !valid || !changed || busy;
    document.getElementById('rulesPublishHint').textContent = valid && changed
      ? 'Publishing immediately changes the canonical rules used by all users.'
      : 'Fix validation errors before publishing.';
  }

  function renderDiff() {
    const diff = pendingDiff;
    if (!diff) return document.getElementById('rulesDiff').replaceChildren();
    const deterministic = diff.deterministic || { added: [], removed: [], changed: [] };
    document.getElementById('rulesDiff').innerHTML = `
      <span><small>Version</small><strong>${escapeHtml(diff.versionFrom || '—')} → ${escapeHtml(diff.versionTo || '—')}</strong></span>
      <span><small>Instructions</small><strong>${diff.instructionsChanged ? 'Changed' : 'Unchanged'}</strong></span>
      <span><small>Knowledge</small><strong>${diff.knowledgeChanged ? `Changed (${signed(diff.knowledgeCharDelta)})` : 'Unchanged'}</strong></span>
      <span><small>Deterministic</small><strong>+${deterministic.added.length} / −${deterministic.removed.length} / ~${deterministic.changed.length}</strong></span>
    `;
  }

  function renderMessages() {
    const messages = document.getElementById('rulesMessages');
    const errors = pendingValidation?.errors || [];
    const warnings = pendingValidation?.warnings || [];
    const deterministic = pendingDiff?.deterministic || {};
    const changedIds = [...(deterministic.changed || []), ...(deterministic.added || []), ...(deterministic.removed || [])];
    messages.innerHTML = [
      ...errors.map((text) => `<div class="rules-message error">${escapeHtml(text)}</div>`),
      ...warnings.map((text) => `<div class="rules-message warn">${escapeHtml(text)}</div>`),
      ...(changedIds.length ? [`<div class="rules-message info">Deterministic IDs changed: ${escapeHtml(changedIds.join(', '))}</div>`] : []),
    ].join('') || '<div class="rules-message ok">Structure and mandatory operational safeguards passed.</div>';
  }

  async function publishPending() {
    if (!pendingBundle || !pendingValidation?.valid || !pendingDiff?.changed || busy) return;
    setBusy(true);
    const button = document.getElementById('rulesPublishBtn');
    button.textContent = 'Publishing…';
    try {
      const response = await fetch('/api/rules', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'publish', bundle: pendingBundle }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Publish failed.');
      setState(`Published ${data.bundle.version}. All new analyses now use this rules version.`, 'ok');
      resetPending();
      await loadCurrent();
    } catch (error) {
      setState(error.message || 'Publish failed.', 'error');
    } finally {
      button.textContent = 'Publish globally';
      setBusy(false);
    }
  }

  function renderHistory(entries) {
    const root = document.getElementById('rulesHistory');
    if (!entries.length) {
      root.innerHTML = '<span class="rules-empty">No previous version has been archived yet.</span>';
      return;
    }
    root.innerHTML = entries.map((entry) => `
      <div class="rules-history-row">
        <div><strong>${escapeHtml(entry.version || 'Unversioned')}</strong><small>${escapeHtml(formatDate(entry.archivedAt))} · ${escapeHtml(entry.reason || 'publish')}</small></div>
        <button type="button" class="btn ghost small" data-history-key="${escapeHtml(entry.key)}">Rollback</button>
      </div>
    `).join('');
    root.querySelectorAll('[data-history-key]').forEach((button) => {
      button.addEventListener('click', () => rollback(button.dataset.historyKey, button));
    });
  }

  async function rollback(historyKey, button) {
    if (busy || !historyKey) return;
    if (!confirm('Rollback the canonical Risk Class rules to this snapshot? The current version will be archived first.')) return;
    setBusy(true);
    button.disabled = true;
    button.textContent = 'Restoring…';
    try {
      const response = await fetch('/api/rules', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'rollback', historyKey }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Rollback failed.');
      setState(`Restored ${data.bundle.version}. All new analyses now use the restored rules.`, 'ok');
      resetPending();
      await loadCurrent();
    } catch (error) {
      setState(error.message || 'Rollback failed.', 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Rollback';
      setBusy(false);
    }
  }

  function resetPending() {
    pendingBundle = null;
    pendingValidation = null;
    pendingDiff = null;
    const importMeta = document.getElementById('rulesImportMeta');
    if (importMeta) importMeta.textContent = 'No file selected.';
    const panel = document.getElementById('rulesValidationPanel');
    if (panel) panel.hidden = true;
  }

  function showImportError(message) {
    pendingBundle = null;
    pendingValidation = { valid: false, errors: [message], warnings: [] };
    pendingDiff = null;
    document.getElementById('rulesImportMeta').textContent = message;
    renderValidation();
  }

  function setBusy(value) {
    busy = Boolean(value);
    document.getElementById('rulesExportBtn').disabled = busy || !current;
    document.getElementById('rulesPromptBtn').disabled = busy || !current;
    document.getElementById('rulesChooseBtn').disabled = busy || !current;
    if (pendingValidation) document.getElementById('rulesPublishBtn').disabled = busy || !pendingValidation.valid || !pendingDiff?.changed;
  }

  function setState(text, kind) {
    const state = document.getElementById('rulesManagerState');
    state.textContent = text;
    state.className = `rules-manager-state ${kind || ''}`;
  }

  function safeFile(value) { return String(value).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'current'; }
  function formatNumber(value) { return Number(value || 0).toLocaleString(); }
  function signed(value) { const n = Number(value || 0); return `${n >= 0 ? '+' : ''}${n.toLocaleString()} chars`; }
  function formatDate(value) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? String(value || '') : date.toLocaleString(); }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[ch]));
  }
})();
