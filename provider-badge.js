(() => {
  let lastMeta = null;

  async function refresh() {
    try {
      const response = await fetch('/api/meta', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (data?.routing) {
        lastMeta = data;
        updateBadge();
      }
    } catch {
      // Keep the existing badge if metadata is unavailable.
    }
  }

  function updateBadge() {
    const routing = lastMeta?.routing;
    if (!routing) return;
    const mode = window.RISK_ROUTING?.mode || routing.globalMode || 'auto';
    const label = routing.labels?.[mode] || routing.primary?.profile || 'managed';
    const pill = document.getElementById('routingModelPill') || document.querySelector('.model-pill');
    if (pill) pill.textContent = `${capitalize(mode)} · ${label} · managed`;
    const description = document.getElementById('routingDescription');
    if (description && window.RISK_ROUTING?.admin) {
      description.textContent = `${label}. This route is enforced globally for all users.`;
    }
  }

  function patchTelemetryCost() {
    const telemetry = window.RISK_ROUTING?.telemetry;
    if (!telemetry || !telemetry.unpricedCalls) return;
    const panel = document.getElementById('routingTelemetry');
    if (!panel) return;
    for (const metric of panel.querySelectorAll('.telemetry-metrics > span')) {
      const label = metric.querySelector('small')?.textContent?.trim();
      if (label === 'Est. cost') {
        const strong = metric.querySelector('strong');
        if (strong) strong.textContent = 'Unavailable';
        metric.title = 'At least one provider profile has no complete pricing configured.';
      }
    }
  }

  const observer = new MutationObserver(() => {
    updateBadge();
    patchTelemetryCost();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('risk-provider-config-updated', refresh);
  window.addEventListener('focus', refresh);
  setTimeout(refresh, 50);

  function capitalize(value) {
    const text = String(value || '');
    return text ? text[0].toUpperCase() + text.slice(1) : text;
  }

  window.RISK_PROVIDER_BADGE = { refresh };
})();
