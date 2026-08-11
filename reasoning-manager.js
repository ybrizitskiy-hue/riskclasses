(() => {
  const SESSION_DRAFT_KEY = 'risk-reasoning-manager-draft-v1';
  const SESSION_OPEN_KEY = 'risk-reasoning-manager-open-v1';
  const MODES = ['economy', 'auto', 'quality'];
  const ROLES = ['extraction', 'primary', 'research', 'escalation'];
  const EFFORTS = [['none','None'],['low','Low'],['medium','Medium'],['high','High']];

  let current = null;
  let draft = null;
  let validation = null;
  let busy = false;
  let dirty = false;
  let validateTimer = null;

  injectStylesheet();
  injectAdminButton();
  injectModal();
  reopenAfterReload();

  function injectStylesheet() {
    if (document.querySelector('link[href="/reasoning-manager.css"]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/reasoning-manager.css';
    document.head.appendChild(link);
  }

  function injectAdminButton() {
    const actions = document.querySelector('#adminUnlockedActions .admin-modal-actions');
    if (!actions || document.getElementById('manageReasoningBtn')) return;
    const button = document.createElement('button');
    button.id = 'manageReasoningBtn';
    button.type = 'button';
    button.className = 'btn ghost small';
    button.textContent = 'AI reasoning';
    button.addEventListener('click', openManager);
    const done = document.getElementById('adminDoneBtn');
    actions.insertBefore(button, done || actions.firstChild);
  }

  function injectModal() {
    if (document.getElementById('reasoningManagerModal')) return;
    const overlay = document.createElement('div');
    overlay.id = 'reasoningManagerModal';
    overlay.className = 'admin-modal-backdrop reasoning-manager-backdrop';
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="reasoning-manager-modal" role="dialog" aria-modal="true" aria-labelledby="reasoningManagerTitle">
        <div class="reasoning-manager-head">
          <div>
            <span class="admin-modal-kicker">AI Reasoning · admin</span>
            <h3 id="reasoningManagerTitle">Reasoning effort by routing mode</h3>
            <p>Choose the effort sent for Extraction, Primary, Research and Escalation in Economy, Auto and Quality. Changes are global for every user.</p>
          </div>
          <button id="reasoningManagerClose" type="button" class="admin-modal-close" aria-label="Close">×</button>
        </div>
        <div id="reasoningState" class="reasoning-state">Loading reasoning configuration…</div>
        <div class="reasoning-note"><strong>None</strong> omits the reasoning parameter completely. A provider with its <b>Reasoning</b> capability disabled also receives no reasoning parameter, regardless of the selected effort. Defaults preserve the previous behavior: Extraction Low; all classification stages Medium.</div>
        <div id="reasoningModes" class="reasoning-modes"></div>
        <div id="reasoningMessages" class="reasoning-errors"></div>
        <div class="reasoning-footer">
          <span id="reasoningVersion">—</span>
          <div class="reasoning-footer-actions">
            <button id="reasoningReloadBtn" type="button" class="btn ghost small">Discard changes</button>
            <button id="reasoningPublishBtn" type="button" class="btn primary small" disabled>Publish globally</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('reasoningManagerClose').addEventListener('click', closeManager);
    document.getElementById('reasoningReloadBtn').addEventListener('click', discardChanges);
    document.getElementById('reasoningPublishBtn').addEventListener('click', publish);
    document.getElementById('reasoningModes').addEventListener('change', handleEffortChange);
  }

  async function openManager() {
    if (!window.RISK_ROUTING?.admin) return window.RISK_ROUTING?.unlock?.();
    markManagerOpen(true);
    const adminModal = document.getElementById('adminModal');
    if (adminModal) adminModal.hidden = true;
    document.getElementById('reasoningManagerModal').hidden = false;
    document.body.classList.add('admin-modal-open');
    await loadCurrent({ restoreDraft: true });
  }

  function closeManager() {
    document.getElementById('reasoningManagerModal').hidden = true;
    document.body.classList.remove('admin-modal-open');
    markManagerOpen(false);
    clearSessionDraft();
  }

  async function loadCurrent({ restoreDraft = false } = {}) {
    setBusy(true);
    setState('Loading reasoning configuration…');
    try {
      const response = await fetch('/api/reasoning', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.config) throw new Error(data.error || 'Could not load reasoning configuration.');
      current = data;
      draft = clone(data.config);
      validation = data.validation || null;
      dirty = false;
      if (restoreDraft) restoreSessionDraft();
      render();
      setState(
        dirty ? 'Recovered your unsaved reasoning changes after the page was reloaded.' : 'Loaded global reasoning efforts.',
        validation?.valid ? 'ok' : 'error'
      );
      if (dirty) scheduleValidate(0);
    } catch (error) {
      current = null;
      draft = null;
      setState(error.message || 'Could not load reasoning configuration.', 'error');
    } finally {
      setBusy(false);
    }
  }

  function render() {
    if (!draft) return;
    const root = document.getElementById('reasoningModes');
    root.innerHTML = MODES.map((mode) => `
      <section class="reasoning-mode-card">
        <div class="reasoning-mode-head">
          <strong>${capitalize(mode)}</strong>
          <small>${modeDescription(mode)}</small>
        </div>
        <div class="reasoning-role-grid">
          ${ROLES.map((role) => effortField(mode, role, draft.modes?.[mode]?.[role] || defaultEffort(role))).join('')}
        </div>
      </section>
    `).join('');
    document.getElementById('reasoningVersion').textContent = `Current reasoning config: ${current?.config?.version || draft.version || '—'}`;
    renderValidation();
  }

  function effortField(mode, role, value) {
    const options = EFFORTS.map(([key, label]) => `<option value="${key}" ${value === key ? 'selected' : ''}>${label}</option>`).join('');
    return `<div class="reasoning-field"><label>${capitalize(role)}</label><select data-reasoning-mode="${mode}" data-reasoning-role="${role}">${options}</select></div>`;
  }

  function handleEffortChange(event) {
    const mode = event.target.dataset.reasoningMode;
    const role = event.target.dataset.reasoningRole;
    if (!mode || !role || !draft?.modes?.[mode]) return;
    draft.modes[mode][role] = event.target.value;
    dirty = true;
    persistSessionDraft();
    scheduleValidate();
    renderValidation();
  }

  function discardChanges() {
    if (!current?.config) return;
    draft = clone(current.config);
    validation = current.validation || null;
    dirty = false;
    clearSessionDraft();
    render();
    setState('Discarded unsaved reasoning changes.');
  }

  function scheduleValidate(delay = 350) {
    clearTimeout(validateTimer);
    validateTimer = setTimeout(validateDraft, delay);
  }

  async function validateDraft() {
    if (!draft) return;
    try {
      const response = await fetch('/api/reasoning', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'validate', config: draft }),
      });
      const data = await response.json().catch(() => ({}));
      validation = data.validation || { valid: false, errors: [data.error || 'Validation failed.'], warnings: [] };
    } catch (error) {
      validation = { valid: false, errors: [error.message || 'Validation failed.'], warnings: [] };
    }
    renderValidation();
  }

  function renderValidation() {
    const root = document.getElementById('reasoningMessages');
    const errors = validation?.errors || [];
    const warnings = validation?.warnings || [];
    root.innerHTML = [
      ...errors.map((text) => `<div class="reasoning-message error">${escapeHtml(text)}</div>`),
      ...warnings.map((text) => `<div class="reasoning-message warn">${escapeHtml(text)}</div>`),
    ].join('') || '<div class="reasoning-message ok">Reasoning settings are valid.</div>';
    const publish = document.getElementById('reasoningPublishBtn');
    if (publish) publish.disabled = busy || !dirty || !validation?.valid;
  }

  async function publish() {
    if (!draft || busy || !dirty || !validation?.valid) return;
    if (!confirm('Publish these reasoning efforts globally? New analyses will use them after KV propagation.')) return;
    setBusy(true);
    const button = document.getElementById('reasoningPublishBtn');
    button.textContent = 'Publishing…';
    try {
      const response = await fetch('/api/reasoning', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'publish', config: draft }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Could not publish reasoning configuration.');
      current = data;
      draft = clone(data.config);
      validation = data.validation;
      dirty = false;
      clearSessionDraft();
      render();
      setState(`Published ${draft.version}. New analyses use these reasoning efforts globally.`, 'ok');
    } catch (error) {
      setState(error.message || 'Could not publish reasoning configuration.', 'error');
    } finally {
      button.textContent = 'Publish globally';
      setBusy(false);
      renderValidation();
    }
  }

  function setBusy(value) {
    busy = Boolean(value);
    const reload = document.getElementById('reasoningReloadBtn');
    if (reload) reload.disabled = busy || !current;
    const publish = document.getElementById('reasoningPublishBtn');
    if (publish) publish.disabled = busy || !dirty || !validation?.valid;
    document.querySelectorAll('#reasoningModes select').forEach((select) => { select.disabled = busy; });
  }

  function setState(text, kind = '') {
    const el = document.getElementById('reasoningState');
    el.textContent = text;
    el.className = `reasoning-state ${kind}`.trim();
  }

  function persistSessionDraft() {
    if (!draft || !current?.config) return;
    try {
      sessionStorage.setItem(SESSION_DRAFT_KEY, JSON.stringify({
        baseVersion: current.config.version || '',
        savedAt: Date.now(),
        draft,
      }));
    } catch { /* convenience only */ }
  }

  function restoreSessionDraft() {
    try {
      const raw = sessionStorage.getItem(SESSION_DRAFT_KEY);
      if (!raw || !current?.config) return false;
      const saved = JSON.parse(raw);
      if (!saved?.draft || saved.baseVersion !== (current.config.version || '')) return false;
      draft = clone(saved.draft);
      dirty = true;
      return true;
    } catch {
      return false;
    }
  }

  function clearSessionDraft() {
    try { sessionStorage.removeItem(SESSION_DRAFT_KEY); } catch { /* non-fatal */ }
  }

  function markManagerOpen(value) {
    try {
      if (value) sessionStorage.setItem(SESSION_OPEN_KEY, '1');
      else sessionStorage.removeItem(SESSION_OPEN_KEY);
    } catch { /* non-fatal */ }
  }

  function reopenAfterReload() {
    let shouldReopen = false;
    try { shouldReopen = sessionStorage.getItem(SESSION_OPEN_KEY) === '1'; } catch { /* non-fatal */ }
    if (!shouldReopen) return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (window.RISK_ROUTING?.admin) {
        clearInterval(timer);
        openManager();
      } else if (attempts >= 20) {
        clearInterval(timer);
      }
    }, 250);
  }

  function defaultEffort(role) { return role === 'extraction' ? 'low' : 'medium'; }
  function modeDescription(mode) {
    if (mode === 'economy') return 'Cheapest global route';
    if (mode === 'quality') return 'Quality-first global route';
    return 'Balanced route with optional review stages';
  }
  function capitalize(value) { const text = String(value || ''); return text ? text[0].toUpperCase() + text.slice(1) : text; }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[ch])); }

  window.RISK_REASONING = { open: openManager, reload: loadCurrent };
})();
