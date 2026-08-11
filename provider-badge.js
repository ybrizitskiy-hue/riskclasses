(() => {
  let lastMeta = null;
  let refreshPromise = null;

  function refresh() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      try {
        const response = await fetch('/api/meta', { cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (data?.routing) {
          lastMeta = data;
          syncUi();
        }
      } catch {
        // Keep the existing badge if metadata is unavailable.
      } finally {
        refreshPromise = null;
      }
    })();
    return refreshPromise;
  }

  function syncUi() {
    updateBadge();
    patchTelemetryCost();
  }

  function updateBadge() {
    const routing = lastMeta?.routing;
    if (!routing) return;
    const mode = window.RISK_ROUTING?.mode || routing.globalMode || 'auto';
    const label = routing.labels?.[mode] || routing.primary?.profile || 'managed';
    const pill = document.getElementById('routingModelPill') || document.querySelector('.model-pill');
    const nextPill = `${capitalize(mode)} · ${label} · managed`;
    if (pill && pill.textContent !== nextPill) pill.textContent = nextPill;

    const description = document.getElementById('routingDescription');
    const nextDescription = `${label}. This route is enforced globally for all users.`;
    if (description && window.RISK_ROUTING?.admin && description.textContent !== nextDescription) {
      description.textContent = nextDescription;
    }
  }

  function patchTelemetryCost() {
    const telemetry = window.RISK_ROUTING?.telemetry;
    if (!telemetry || !telemetry.unpricedCalls) return;
    const panel = document.getElementById('routingTelemetry');
    if (!panel) return;
    for (const metric of panel.querySelectorAll('.telemetry-metrics > span')) {
      const label = metric.querySelector('small')?.textContent?.trim();
      if (label !== 'Est. cost') continue;
      const strong = metric.querySelector('strong');
      if (strong && strong.textContent !== 'Unavailable') strong.textContent = 'Unavailable';
      const title = 'At least one provider profile has no complete pricing configured.';
      if (metric.title !== title) metric.title = title;
    }
  }

  // Deliberately event-driven. A document-wide MutationObserver here can observe
  // this script's own textContent writes and create an endless microtask loop.
  window.addEventListener('risk-provider-config-updated', refresh);
  window.addEventListener('risk-routing-updated', syncUi);
  window.addEventListener('risk-telemetry-updated', syncUi);
  window.addEventListener('focus', refresh);
  setTimeout(refresh, 50);

  function capitalize(value) {
    const text = String(value || '');
    return text ? text[0].toUpperCase() + text.slice(1) : text;
  }

  window.RISK_PROVIDER_BADGE = { refresh, sync: syncUi };
})();
