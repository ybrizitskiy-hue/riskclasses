(() => {
  const MODES = {
    auto: {
      label: 'Auto',
      badge: 'Auto · Luna → Terra',
      description: 'Luna Medium for uncertain rows, Terra Medium only when Luna flags material classification uncertainty.',
    },
    economy: {
      label: 'Economy',
      badge: 'Economy · Luna',
      description: 'Luna Medium only. Lowest cost; no automatic Terra escalation.',
    },
    quality: {
      label: 'Quality',
      badge: 'Quality · Terra',
      description: 'Terra Medium for every non-deterministic row. Highest consistency, higher cost.',
    },
  };

  let mode = 'auto';
  let lastTelemetry = null;
  let admin = false;
  let adminConfigured = false;
  let adminChecked = false;
  let savingMode = false;

  injectStylesheet();
  injectRoutingControl();
  injectAdminUi();
  patchFetch();
  updateAdminUi();
  checkAdmin();

  function injectStylesheet() {
    if (document.querySelector('link[href="/routing.css"]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/routing.css';
    document.head.appendChild(link);
  }

  function injectRoutingControl() {
    const footer = document.querySelector('.composer-footer');
    const statusCluster = document.querySelector('.status-cluster');
    if (!footer || document.getElementById('routingControl')) return;

    const control = document.createElement('div');
    control.id = 'routingControl';
    control.className = 'routing-control admin-gated';
    control.hidden = true;
    control.innerHTML = `
      <div class="routing-copy">
        <span class="routing-label">Global AI routing · admin</span>
        <span id="routingDescription" class="routing-description"></span>
      </div>
      <div class="routing-segmented" role="radiogroup" aria-label="Global AI routing mode">
        ${Object.entries(MODES).map(([key, config]) => `
          <button type="button" class="routing-btn" data-routing="${key}" role="radio" aria-checked="false">${config.label}</button>
        `).join('')}
      </div>
    `;

    footer.parentNode.insertBefore(control, footer);
    control.querySelectorAll('.routing-btn').forEach((button) => {
      button.addEventListener('click', () => {
        if (!admin) return openAdminModal();
        saveGlobalMode(button.dataset.routing);
      });
    });

    if (statusCluster) {
      const modelPill = statusCluster.querySelector('.model-pill');
      if (modelPill) modelPill.id = 'routingModelPill';
    }
  }

  function injectAdminUi() {
    const statusCluster = document.querySelector('.status-cluster');
    if (statusCluster && !document.getElementById('adminUnlockBtn')) {
      const button = document.createElement('button');
      button.id = 'adminUnlockBtn';
      button.type = 'button';
      button.className = 'admin-unlock-btn';
      button.disabled = true;
      button.addEventListener('click', openAdminModal);
      statusCluster.appendChild(button);
    }

    if (document.getElementById('adminModal')) return;
    const overlay = document.createElement('div');
    overlay.id = 'adminModal';
    overlay.className = 'admin-modal-backdrop';
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="admin-modal" role="dialog" aria-modal="true" aria-labelledby="adminModalTitle">
        <button id="adminModalClose" type="button" class="admin-modal-close" aria-label="Close">×</button>
        <span class="admin-modal-kicker">Admin controls</span>
        <h3 id="adminModalTitle">Unlock global routing & cost</h3>
        <p id="adminModalCopy">Enter the admin PIN to set the AI routing mode used by everyone and view cost telemetry.</p>
        <form id="adminPinForm" autocomplete="off">
          <label for="adminPinInput">PIN</label>
          <input id="adminPinInput" type="password" inputmode="numeric" autocomplete="one-time-code" maxlength="12" placeholder="••••" />
          <div id="adminPinError" class="admin-pin-error" aria-live="polite"></div>
          <div class="admin-modal-actions">
            <button id="adminCancelBtn" type="button" class="btn ghost small">Cancel</button>
            <button id="adminSubmitBtn" type="submit" class="btn primary small">Unlock</button>
          </div>
        </form>
        <div id="adminUnlockedActions" class="admin-unlocked-actions" hidden>
          <div class="admin-unlocked-state"><span></span>Admin controls are unlocked. Routing changes apply to everyone.</div>
          <div class="admin-modal-actions">
            <button id="adminDoneBtn" type="button" class="btn ghost small">Done</button>
            <button id="adminLockBtn" type="button" class="btn danger small">Lock admin</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) closeAdminModal();
    });
    document.getElementById('adminModalClose').addEventListener('click', closeAdminModal);
    document.getElementById('adminCancelBtn').addEventListener('click', closeAdminModal);
    document.getElementById('adminDoneBtn').addEventListener('click', closeAdminModal);
    document.getElementById('adminLockBtn').addEventListener('click', lockAdmin);
    document.getElementById('adminPinForm').addEventListener('submit', unlockAdmin);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !overlay.hidden) closeAdminModal();
    });
  }

  async function checkAdmin() {
    try {
      const response = await fetch('/api/admin', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      adminConfigured = Boolean(data.configured);
      admin = Boolean(response.ok && data.admin);
      mode = MODES[data.globalRoutingMode] ? data.globalRoutingMode : 'auto';
    } catch {
      adminConfigured = false;
      admin = false;
      mode = 'auto';
    } finally {
      adminChecked = true;
      updateAdminUi();
    }
  }

  function updateAdminUi() {
    const button = document.getElementById('adminUnlockBtn');
    const control = document.getElementById('routingControl');
    if (button) {
      button.disabled = !adminChecked;
      button.classList.toggle('unlocked', admin);
      button.innerHTML = admin
        ? '<span class="admin-lock-icon">◆</span> Admin unlocked'
        : '<span class="admin-lock-icon">◇</span> Admin';
      button.title = admin
        ? 'Global routing and cost telemetry are unlocked'
        : 'Enter admin PIN to control routing for everyone and view cost telemetry';
    }
    if (control) control.hidden = !admin;
    if (!admin) removeTelemetry();
    updateModeUi();
  }

  function updateModeUi(message = '') {
    const config = MODES[mode] || MODES.auto;
    document.querySelectorAll('.routing-btn').forEach((button) => {
      const active = button.dataset.routing === mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-checked', active ? 'true' : 'false');
      button.disabled = savingMode;
    });
    const description = document.getElementById('routingDescription');
    if (description) description.textContent = message || `${config.description} This mode is enforced globally for all users.`;
    const pill = document.getElementById('routingModelPill') || document.querySelector('.model-pill');
    if (pill) pill.textContent = `${config.badge} · managed`;
  }

  async function saveGlobalMode(nextMode) {
    if (!admin || !MODES[nextMode] || savingMode || nextMode === mode) return;
    const previous = mode;
    savingMode = true;
    updateModeUi('Saving global routing mode…');
    try {
      const response = await fetch('/api/admin', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ routingMode: nextMode }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !MODES[data.globalRoutingMode]) {
        throw new Error(data.error || 'Could not save global routing mode.');
      }
      mode = data.globalRoutingMode;
      updateModeUi(`${MODES[mode].description} Saved globally for everyone.`);
    } catch (error) {
      mode = previous;
      updateModeUi(error?.message || 'Could not save global routing mode.');
    } finally {
      savingMode = false;
      updateModeUi();
    }
  }

  function openAdminModal() {
    const modal = document.getElementById('adminModal');
    if (!modal) return;
    const form = document.getElementById('adminPinForm');
    const unlocked = document.getElementById('adminUnlockedActions');
    const copy = document.getElementById('adminModalCopy');
    const title = document.getElementById('adminModalTitle');
    const error = document.getElementById('adminPinError');
    error.textContent = '';

    if (admin) {
      title.textContent = 'Global admin controls unlocked';
      copy.textContent = `Current global mode: ${MODES[mode].label}. Changes to the selector apply to every user.`;
      form.hidden = true;
      unlocked.hidden = false;
    } else {
      title.textContent = 'Unlock global routing & cost';
      copy.textContent = adminConfigured
        ? 'Enter the admin PIN to set the AI routing mode used by everyone and view cost telemetry.'
        : 'Admin PIN is not configured yet. Add the RISK_ADMIN_PIN secret in Cloudflare and redeploy.';
      form.hidden = false;
      unlocked.hidden = true;
      const input = document.getElementById('adminPinInput');
      input.value = '';
      input.disabled = !adminConfigured;
      document.getElementById('adminSubmitBtn').disabled = !adminConfigured;
      setTimeout(() => { if (adminConfigured) input.focus(); }, 30);
    }
    modal.hidden = false;
    document.body.classList.add('admin-modal-open');
  }

  function closeAdminModal() {
    const modal = document.getElementById('adminModal');
    if (modal) modal.hidden = true;
    document.body.classList.remove('admin-modal-open');
  }

  async function unlockAdmin(event) {
    event.preventDefault();
    const input = document.getElementById('adminPinInput');
    const submit = document.getElementById('adminSubmitBtn');
    const error = document.getElementById('adminPinError');
    const pin = input.value.trim();
    if (!pin) {
      error.textContent = 'Enter the PIN.';
      return;
    }

    submit.disabled = true;
    submit.textContent = 'Unlocking…';
    error.textContent = '';
    try {
      const response = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.admin) throw new Error(data.error || 'Could not unlock admin controls.');
      admin = true;
      adminConfigured = true;
      mode = MODES[data.globalRoutingMode] ? data.globalRoutingMode : mode;
      updateAdminUi();
      closeAdminModal();
    } catch (unlockError) {
      error.textContent = unlockError.message || 'Incorrect PIN.';
      input.select();
    } finally {
      submit.disabled = false;
      submit.textContent = 'Unlock';
    }
  }

  async function lockAdmin() {
    const button = document.getElementById('adminLockBtn');
    button.disabled = true;
    try {
      await fetch('/api/admin', { method: 'DELETE' });
    } catch {
      // Lock locally even if the request fails; the cookie will expire server-side.
    }
    admin = false;
    lastTelemetry = null;
    updateAdminUi();
    closeAdminModal();
    button.disabled = false;
  }

  function patchFetch() {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      const response = await nativeFetch(input, init);
      if (/\/api\/analyze(?:\?|$)/.test(url)) {
        response.clone().json().then((payload) => {
          if (admin && payload?.telemetry) {
            lastTelemetry = payload.telemetry;
            if (MODES[payload.telemetry.routingMode]) mode = payload.telemetry.routingMode;
            updateModeUi();
            renderTelemetry(lastTelemetry);
          } else {
            lastTelemetry = null;
            removeTelemetry();
          }
        }).catch(() => {});
      }
      return response;
    };
  }

  function renderTelemetry(telemetry) {
    if (!admin) return removeTelemetry();
    const resultsCard = document.getElementById('resultsCard');
    const summaryStrip = document.getElementById('summaryStrip');
    if (!resultsCard || !summaryStrip) return;

    let panel = document.getElementById('routingTelemetry');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'routingTelemetry';
      panel.className = 'routing-telemetry';
      summaryStrip.insertAdjacentElement('afterend', panel);
    }

    const estimated = Number(telemetry.estimatedUsd || 0);
    const ceiling = Number(telemetry.cacheWriteCeilingUsd || estimated);
    const cached = Number(telemetry.cachedInputTokens || 0);
    const input = Number(telemetry.inputTokens || 0);
    const cachePct = input > 0 ? Math.round((cached / input) * 100) : 0;
    const modelText = Array.isArray(telemetry.models) && telemetry.models.length
      ? telemetry.models.map(shortModel).join(' + ')
      : 'No AI classification call';

    panel.innerHTML = `
      <div class="telemetry-main">
        <span class="telemetry-kicker">Cost routing · admin</span>
        <strong>${escapeHtml(capitalize(telemetry.routingMode || mode))}</strong>
        <span>${telemetry.deterministicCount || 0}/${telemetry.totalRows || 0} rows resolved without classification AI</span>
      </div>
      <div class="telemetry-metrics">
        <span><small>Models</small><strong>${escapeHtml(modelText)}</strong></span>
        <span><small>Escalated</small><strong>${Number(telemetry.escalatedCount || 0)}</strong></span>
        <span><small>Prompt cache</small><strong>${cachePct}%</strong></span>
        <span><small>Web searches</small><strong>${Number(telemetry.webSearchCalls || 0)}</strong></span>
        <span title="Approximate OpenAI token + web-search cost. First uncached cache write can be slightly higher."><small>Est. cost</small><strong>${formatUsd(estimated)}${ceiling > estimated * 1.02 ? `–${formatUsd(ceiling)}` : ''}</strong></span>
      </div>
    `;
  }

  function removeTelemetry() {
    document.getElementById('routingTelemetry')?.remove();
  }

  function shortModel(value) {
    return String(value || '')
      .replace('gpt-5.6-luna', 'Luna')
      .replace('gpt-5.6-terra', 'Terra')
      .replace('gpt-5.6-sol', 'Sol');
  }

  function formatUsd(value) {
    const number = Number(value || 0);
    if (number === 0) return '$0';
    if (number < 0.001) return '<$0.001';
    if (number < 0.01) return `$${number.toFixed(4)}`;
    return `$${number.toFixed(3)}`;
  }

  function capitalize(value) {
    const text = String(value || '');
    return text ? text[0].toUpperCase() + text.slice(1) : text;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[ch]));
  }

  window.RISK_ROUTING = {
    get mode() { return mode; },
    get admin() { return admin; },
    get telemetry() { return admin ? lastTelemetry : null; },
    unlock: openAdminModal,
  };
})();
