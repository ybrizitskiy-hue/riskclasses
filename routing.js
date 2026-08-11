(() => {
  const STORAGE_KEY = 'riskClassRoutingMode';
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

  let mode = localStorage.getItem(STORAGE_KEY);
  if (!MODES[mode]) mode = 'auto';
  let lastTelemetry = null;

  injectStylesheet();
  injectRoutingControl();
  updateModeUi();
  patchFetch();

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
    control.className = 'routing-control';
    control.innerHTML = `
      <div class="routing-copy">
        <span class="routing-label">AI routing</span>
        <span id="routingDescription" class="routing-description"></span>
      </div>
      <div class="routing-segmented" role="radiogroup" aria-label="AI routing mode">
        ${Object.entries(MODES).map(([key, config]) => `
          <button type="button" class="routing-btn" data-routing="${key}" role="radio" aria-checked="false">${config.label}</button>
        `).join('')}
      </div>
    `;

    footer.parentNode.insertBefore(control, footer);
    control.querySelectorAll('.routing-btn').forEach((button) => {
      button.addEventListener('click', () => {
        mode = button.dataset.routing;
        localStorage.setItem(STORAGE_KEY, mode);
        updateModeUi();
      });
    });

    if (statusCluster) {
      const modelPill = statusCluster.querySelector('.model-pill');
      if (modelPill) modelPill.id = 'routingModelPill';
    }
  }

  function updateModeUi() {
    const config = MODES[mode];
    document.querySelectorAll('.routing-btn').forEach((button) => {
      const active = button.dataset.routing === mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-checked', active ? 'true' : 'false');
    });
    const description = document.getElementById('routingDescription');
    if (description) description.textContent = config.description;
    const pill = document.getElementById('routingModelPill') || document.querySelector('.model-pill');
    if (pill) pill.textContent = config.badge;
  }

  function patchFetch() {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      let nextInit = init;

      if (/\/api\/analyze(?:\?|$)/.test(url) && String(init.method || 'GET').toUpperCase() === 'POST' && typeof init.body === 'string') {
        try {
          const parsed = JSON.parse(init.body);
          parsed.routingMode = mode;
          nextInit = { ...init, body: JSON.stringify(parsed) };
        } catch (_) {
          // Keep original request if the body is not JSON.
        }
      }

      const response = await nativeFetch(input, nextInit);
      if (/\/api\/analyze(?:\?|$)/.test(url)) {
        response.clone().json().then((payload) => {
          if (payload?.telemetry) {
            lastTelemetry = payload.telemetry;
            renderTelemetry(lastTelemetry);
          }
        }).catch(() => {});
      }
      return response;
    };
  }

  function renderTelemetry(telemetry) {
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
        <span class="telemetry-kicker">Cost routing</span>
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
    get telemetry() { return lastTelemetry; },
  };
})();
