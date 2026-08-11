(() => {
  const SESSION_DRAFT_KEY = 'risk-provider-manager-draft-v1';
  const SESSION_OPEN_KEY = 'risk-provider-manager-open-v1';
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
    if (document.querySelector('link[href="/provider-manager.css"]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/provider-manager.css';
    document.head.appendChild(link);
  }

  function injectAdminButton() {
    const actions = document.querySelector('#adminUnlockedActions .admin-modal-actions');
    if (!actions || document.getElementById('manageProvidersBtn')) return;
    const button = document.createElement('button');
    button.id = 'manageProvidersBtn';
    button.type = 'button';
    button.className = 'btn ghost small';
    button.textContent = 'AI providers';
    button.addEventListener('click', openManager);
    const done = document.getElementById('adminDoneBtn');
    actions.insertBefore(button, done || actions.firstChild);
  }

  function injectModal() {
    if (document.getElementById('providerManagerModal')) return;
    const overlay = document.createElement('div');
    overlay.id = 'providerManagerModal';
    overlay.className = 'admin-modal-backdrop provider-manager-backdrop';
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="provider-manager-modal" role="dialog" aria-modal="true" aria-labelledby="providerManagerTitle">
        <div class="provider-manager-head">
          <div>
            <span class="admin-modal-kicker">AI Providers · admin</span>
            <h3 id="providerManagerTitle">Provider routing & models</h3>
            <p>Configure the models behind Auto, Economy and Quality. Cloudflare AI Gateway/BYOK keeps provider API keys out of this website and KV.</p>
          </div>
          <button id="providerManagerClose" type="button" class="admin-modal-close" aria-label="Close">×</button>
        </div>
        <div id="providerState" class="provider-state">Loading provider configuration…</div>
        <div class="provider-note"><strong>Key security:</strong> this manager stores model names, routing, upstream base URLs, BYOK aliases and optional pricing only. Raw provider API keys stay in Cloudflare AI Gateway → Provider Keys / Secrets Store. For a custom OpenAI-compatible service, enter its HTTPS root in <b>Base URL</b>; the site can create/update the Cloudflare Custom Provider when the admin API token is configured.</div>

        <section class="provider-section">
          <div class="provider-section-head"><div><span class="section-label">Cloudflare AI Gateway</span><h4>Gateway address</h4></div><small>Used by Cloudflare REST and provider-native/custom profiles.</small></div>
          <div class="provider-grid">
            <div class="provider-field"><label for="providerAccountId">Account ID</label><input id="providerAccountId" placeholder="Cloudflare account ID" /></div>
            <div class="provider-field"><label for="providerGatewayId">Gateway ID</label><input id="providerGatewayId" placeholder="default" /></div>
          </div>
          <div id="providerEnv" class="provider-env"></div>
        </section>

        <section class="provider-section">
          <div class="provider-section-head">
            <div><span class="section-label">Provider profiles</span><h4>Models, address & compatibility</h4></div>
            <button id="providerAddBtn" type="button" class="btn ghost small">Add compatible provider</button>
          </div>
          <div id="providerProfiles" class="provider-profiles"></div>
        </section>

        <section class="provider-section">
          <div class="provider-section-head"><div><span class="section-label">Global routes</span><h4>Auto / Economy / Quality</h4></div><small>Research and escalation can be left disabled.</small></div>
          <div id="providerRoutes" class="provider-route-table"></div>
        </section>

        <div id="providerMessages" class="provider-errors"></div>
        <div class="provider-footer">
          <span id="providerVersion">—</span>
          <div class="provider-footer-actions">
            <button id="providerReloadBtn" type="button" class="btn ghost small">Discard changes</button>
            <button id="providerPublishBtn" type="button" class="btn primary small" disabled>Publish globally</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Do not close this long editing panel on backdrop clicks. Accidental clicks,
    // browser zoom/scroll interactions and touchpad gestures must not throw away work.
    document.getElementById('providerManagerClose').addEventListener('click', closeManager);
    document.getElementById('providerAddBtn').addEventListener('click', addProfile);
    document.getElementById('providerReloadBtn').addEventListener('click', () => {
      if (!current) return;
      draft = clone(current.config);
      dirty = false;
      clearSessionDraft();
      renderAll();
      scheduleValidate(0);
    });
    document.getElementById('providerPublishBtn').addEventListener('click', publish);
    document.getElementById('providerAccountId').addEventListener('input', (event) => updateCloudflare('accountId', event.target.value));
    document.getElementById('providerGatewayId').addEventListener('input', (event) => updateCloudflare('gatewayId', event.target.value));
    document.getElementById('providerProfiles').addEventListener('input', handleProfileEdit);
    document.getElementById('providerProfiles').addEventListener('change', handleProfileEdit);
    document.getElementById('providerProfiles').addEventListener('click', handleProfileAction);
    document.getElementById('providerRoutes').addEventListener('change', handleRouteEdit);
  }

  async function openManager() {
    if (!window.RISK_ROUTING?.admin) return window.RISK_ROUTING?.unlock?.();
    markManagerOpen(true);
    const adminModal = document.getElementById('adminModal');
    if (adminModal) adminModal.hidden = true;
    document.getElementById('providerManagerModal').hidden = false;
    document.body.classList.add('admin-modal-open');
    await loadCurrent({ restoreDraft: true });
  }

  function closeManager() {
    document.getElementById('providerManagerModal').hidden = true;
    document.body.classList.remove('admin-modal-open');
    markManagerOpen(false);
    clearSessionDraft();
  }

  async function loadCurrent({ restoreDraft = false } = {}) {
    setBusy(true);
    setState('Loading provider configuration…');
    try {
      const response = await fetch('/api/providers', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.config) throw new Error(data.error || 'Could not load provider configuration.');
      current = data;
      draft = clone(data.config);
      validation = data.validation || null;
      dirty = false;
      if (restoreDraft) restoreSessionDraft();
      renderAll();
      setState(
        dirty ? 'Recovered your unsaved provider edits after the page was reloaded.' : `Loaded ${draft.profiles.length} provider profile${draft.profiles.length === 1 ? '' : 's'}.`,
        validation?.valid ? 'ok' : 'error'
      );
      if (dirty) scheduleValidate(0);
    } catch (error) {
      current = null;
      draft = null;
      setState(error.message || 'Could not load provider configuration.', 'error');
    } finally {
      setBusy(false);
    }
  }

  function renderAll() {
    if (!draft) return;
    document.getElementById('providerAccountId').value = draft.cloudflare?.accountId || '';
    document.getElementById('providerGatewayId').value = draft.cloudflare?.gatewayId || 'default';
    renderEnvironment();
    renderProfiles();
    renderRoutes();
    renderValidation();
    document.getElementById('providerVersion').textContent = `Current provider config: ${current?.config?.version || draft.version || '—'}`;
  }

  function renderEnvironment() {
    const env = current?.environment || {};
    document.getElementById('providerEnv').innerHTML = [
      pill(`OpenAI direct key ${env.openAiKeyConfigured ? 'ready' : 'missing'}`, env.openAiKeyConfigured),
      pill(`Gateway run token ${env.cloudflareGatewayTokenConfigured ? 'ready' : 'missing'}`, env.cloudflareGatewayTokenConfigured),
      pill(`Gateway admin token ${env.cloudflareGatewayAdminTokenConfigured ? 'ready' : 'missing'}`, env.cloudflareGatewayAdminTokenConfigured),
      pill(`Admin signing secret ${env.adminSigningSecretConfigured ? 'ready' : 'fallback'}`, env.adminSigningSecretConfigured),
      pill(`Effective account ${escapeHtml(draft.cloudflare?.accountId || env.envAccountId || 'not set')}`, Boolean(draft.cloudflare?.accountId || env.envAccountId)),
      pill(`Gateway ${escapeHtml(draft.cloudflare?.gatewayId || env.effectiveGatewayId || 'default')}`, true),
    ].join('');
  }

  function renderProfiles() {
    const root = document.getElementById('providerProfiles');
    if (!draft.profiles.length) return root.innerHTML = '<span class="rules-empty">No profiles.</span>';
    root.innerHTML = draft.profiles.map((profile, index) => profileCard(profile, index)).join('');
  }

  function profileCard(profile, index) {
    const cap = profile.capabilities || {};
    const price = profile.pricing || {};
    const providerFields = profile.transport === 'cloudflare-provider';
    const managedCustom = providerFields && String(profile.providerSlug || '').startsWith('custom-');
    return `
      <div class="provider-card" data-card-index="${index}">
        <div class="provider-card-head">
          <div><strong>${escapeHtml(profile.label || profile.id || 'Provider')}</strong><small> · ${escapeHtml(profile.id || '')}</small></div>
          <div class="provider-card-actions">
            ${managedCustom && profile.baseUrl ? `<button type="button" class="btn ghost small" data-action="sync" data-index="${index}">Sync address</button>` : ''}
            <button type="button" class="btn ghost small" data-action="test" data-index="${index}">Test</button>
            <button type="button" class="btn danger small" data-action="remove" data-index="${index}">Remove</button>
          </div>
        </div>
        <div class="provider-profile-grid">
          ${field(index, 'label', 'Label', profile.label)}
          ${field(index, 'id', 'Profile ID', profile.id)}
          ${selectField(index, 'transport', 'Transport', profile.transport, [['openai-direct','Direct OpenAI'],['cloudflare-rest','Cloudflare REST / Unified'],['cloudflare-provider','Cloudflare provider/custom']])}
          ${selectField(index, 'protocol', 'Protocol', profile.protocol, [['responses','Responses'],['chat-completions','Chat Completions']])}
          ${field(index, 'model', 'Model', profile.model, 'provider/model or model-name', 'provider-span-2')}
          ${field(index, 'byokAlias', 'BYOK alias', profile.byokAlias, 'default / production')}
          ${field(index, 'providerSlug', 'Provider slug', profile.providerSlug, 'openai / groq / custom-myprovider', '', !providerFields)}
          ${field(index, 'baseUrl', 'Base URL', profile.baseUrl, 'https://api.example.com', 'provider-span-2', !managedCustom)}
          ${field(index, 'pathPrefix', 'Provider path prefix', profile.pathPrefix, 'v1', '', !providerFields)}
        </div>
        <div class="provider-capabilities">
          ${capBox(index,'vision','Vision',cap.vision)}${capBox(index,'jsonSchema','JSON schema',cap.jsonSchema)}${capBox(index,'reasoning','Reasoning',cap.reasoning)}${capBox(index,'webSearch','Web search',cap.webSearch)}${capBox(index,'promptCache','Prompt cache',cap.promptCache)}${capBox(index,'store','store:false',cap.store)}
        </div>
        <div class="provider-pricing">
          ${priceField(index,'input','Input $ / 1M',price.input)}${priceField(index,'cached','Cached $ / 1M',price.cached)}${priceField(index,'output','Output $ / 1M',price.output)}${priceField(index,'webSearch','Search $ / call',price.webSearch)}
        </div>
        <div id="providerTest${index}" class="provider-test-result">Endpoint: ${escapeHtml(endpointPreview(profile))}${managedCustom && profile.baseUrl ? ` · Upstream: ${escapeHtml(profile.baseUrl)}` : ''}</div>
      </div>
    `;
  }

  function renderRoutes() {
    const root = document.getElementById('providerRoutes');
    const options = (allowNone) => `${allowNone ? '<option value="">Disabled</option>' : ''}${draft.profiles.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.label || p.id)}</option>`).join('')}`;
    root.innerHTML = ['economy','auto','quality'].map((mode) => {
      const route = draft.routes?.[mode] || {};
      return `<div class="provider-route-row"><strong>${capitalize(mode)}</strong>${routeSelect(mode,'extraction','Extraction',route.extraction,options(false))}${routeSelect(mode,'primary','Primary',route.primary,options(false))}${routeSelect(mode,'research','Research',route.research,options(true))}${routeSelect(mode,'escalation','Escalation',route.escalation,options(true))}</div>`;
    }).join('');
    root.querySelectorAll('select').forEach((select) => { select.value = select.dataset.value || ''; });
  }

  function routeSelect(mode, role, label, value, options) {
    return `<div class="provider-field"><label>${label}</label><select data-route-mode="${mode}" data-route-role="${role}" data-value="${escapeHtml(value || '')}">${options}</select></div>`;
  }

  function field(index, path, label, value, placeholder = '', extraClass = '', disabled = false) {
    return `<div class="provider-field ${extraClass}"><label>${label}</label><input data-index="${index}" data-path="${path}" value="${escapeHtml(value || '')}" placeholder="${escapeHtml(placeholder)}" ${disabled ? 'disabled' : ''}/></div>`;
  }

  function selectField(index, path, label, value, choices) {
    return `<div class="provider-field"><label>${label}</label><select data-index="${index}" data-path="${path}">${choices.map(([key,text]) => `<option value="${key}" ${value === key ? 'selected' : ''}>${text}</option>`).join('')}</select></div>`;
  }

  function priceField(index, key, label, value) {
    return `<div class="provider-field"><label>${label}</label><input type="number" min="0" step="0.0001" data-index="${index}" data-price="${key}" value="${value == null ? '' : escapeHtml(value)}" placeholder="optional" /></div>`;
  }

  function capBox(index, key, label, checked) {
    return `<label><input type="checkbox" data-index="${index}" data-cap="${key}" ${checked ? 'checked' : ''}/> ${label}</label>`;
  }

  function handleProfileEdit(event) {
    if (!draft) return;
    const index = Number(event.target.dataset.index);
    if (!Number.isInteger(index) || !draft.profiles[index]) return;
    const profile = draft.profiles[index];
    const path = event.target.dataset.path || '';
    if (event.target.dataset.cap) profile.capabilities[event.target.dataset.cap] = Boolean(event.target.checked);
    else if (event.target.dataset.price) profile.pricing[event.target.dataset.price] = event.target.value === '' ? null : Number(event.target.value);
    else if (path) profile[path] = event.target.value;
    else return;
    dirty = true;
    persistSessionDraft();

    // Avoid rebuilding unrelated parts of the modal on every keystroke. Full card
    // rebuilds are only needed when a select/provider slug changes field visibility.
    if (event.type === 'change' && ['transport','providerSlug'].includes(path)) {
      renderProfiles();
      renderRoutes();
    } else if (event.type === 'change' && ['id','label'].includes(path)) {
      renderRoutes();
    }
    scheduleValidate();
  }

  async function handleProfileAction(event) {
    const button = event.target.closest('[data-action]');
    if (!button || !draft) return;
    const index = Number(button.dataset.index);
    if (!draft.profiles[index]) return;
    if (button.dataset.action === 'remove') {
      const id = draft.profiles[index].id;
      draft.profiles.splice(index, 1);
      for (const route of Object.values(draft.routes || {})) {
        for (const key of ['extraction','primary','research','escalation']) if (route[key] === id) route[key] = null;
      }
      dirty = true;
      persistSessionDraft();
      renderAll();
      scheduleValidate(0);
      return;
    }
    if (button.dataset.action === 'test') await testProfile(index, button);
    if (button.dataset.action === 'sync') await syncProfile(index, button);
  }

  function handleRouteEdit(event) {
    const mode = event.target.dataset.routeMode;
    const role = event.target.dataset.routeRole;
    if (!mode || !role || !draft?.routes?.[mode]) return;
    draft.routes[mode][role] = event.target.value || null;
    dirty = true;
    persistSessionDraft();
    scheduleValidate();
  }

  function updateCloudflare(key, value) {
    if (!draft) return;
    draft.cloudflare = draft.cloudflare || {};
    draft.cloudflare[key] = value;
    dirty = true;
    persistSessionDraft();
    renderEnvironment();
    scheduleValidate();
  }

  function addProfile() {
    if (!draft || draft.profiles.length >= 16) return;
    let n = draft.profiles.length + 1;
    let id = `compatible-${n}`;
    const used = new Set(draft.profiles.map((p) => p.id));
    while (used.has(id)) id = `compatible-${++n}`;
    draft.profiles.push({
      id,
      label: `Compatible provider ${n}`,
      transport: 'cloudflare-provider',
      protocol: 'responses',
      model: '',
      providerSlug: `custom-provider-${n}`,
      baseUrl: '',
      pathPrefix: 'v1',
      byokAlias: 'default',
      capabilities: { vision:false, jsonSchema:true, reasoning:false, webSearch:false, promptCache:false, store:false },
      pricing: { input:null, cached:null, output:null, webSearch:null },
    });
    dirty = true;
    persistSessionDraft();
    renderProfiles();
    renderRoutes();
    scheduleValidate(0);
  }

  async function syncProfile(index, button) {
    if (!draft || busy) return;
    const result = document.getElementById(`providerTest${index}`);
    setBusy(true);
    button.textContent = 'Syncing…';
    result.textContent = 'Synchronizing the HTTPS Base URL with Cloudflare Custom Providers…';
    try {
      const response = await fetch('/api/providers', {
        method:'POST', headers:{'content-type':'application/json'},
        body:JSON.stringify({ action:'sync', profileId:draft.profiles[index].id, config:draft }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Address sync failed.');
      const action = data.sync?.results?.[0]?.action || 'synchronized';
      result.textContent = `✓ Cloudflare Custom Provider address ${action}: ${draft.profiles[index].baseUrl}`;
    } catch (error) {
      result.textContent = `✕ ${error.message || 'Address sync failed.'}`;
    } finally {
      button.textContent = 'Sync address';
      setBusy(false);
    }
  }

  async function testProfile(index, button) {
    if (!draft || busy) return;
    setBusy(true);
    const result = document.getElementById(`providerTest${index}`);
    button.textContent = 'Testing…';
    result.textContent = 'Running a small structured-output request…';
    try {
      const response = await fetch('/api/providers', {
        method:'POST', headers:{'content-type':'application/json'},
        body:JSON.stringify({ action:'test', profileId:draft.profiles[index].id, config:draft }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Provider test failed.');
      const syncText = data.sync?.changed ? ' · address synchronized' : '';
      result.textContent = `✓ Connection + JSON output passed${syncText} · ${data.endpoint || endpointPreview(draft.profiles[index])}`;
    } catch (error) {
      result.textContent = `✕ ${error.message || 'Provider test failed.'}`;
    } finally {
      button.textContent = 'Test';
      setBusy(false);
    }
  }

  function scheduleValidate(delay = 700) {
    clearTimeout(validateTimer);
    validateTimer = setTimeout(validateDraft, delay);
  }

  async function validateDraft() {
    if (!draft) return;
    try {
      const response = await fetch('/api/providers', {
        method:'POST', headers:{'content-type':'application/json'},
        body:JSON.stringify({ action:'validate', config:draft }),
      });
      const data = await response.json().catch(() => ({}));
      validation = data.validation || { valid:false, errors:[data.error || 'Validation failed.'], warnings:[] };
    } catch (error) {
      validation = { valid:false, errors:[error.message || 'Validation failed.'], warnings:[] };
    }
    renderValidation();
  }

  function renderValidation() {
    const root = document.getElementById('providerMessages');
    const errors = validation?.errors || [];
    const warnings = validation?.warnings || [];
    root.innerHTML = [
      ...errors.map((text) => `<div class="provider-message error">${escapeHtml(text)}</div>`),
      ...warnings.map((text) => `<div class="provider-message warn">${escapeHtml(text)}</div>`),
    ].join('') || '<div class="provider-message ok">Provider structure and route references are valid.</div>';
    document.getElementById('providerPublishBtn').disabled = busy || !dirty || !validation?.valid;
  }

  async function publish() {
    if (!draft || busy || !dirty || !validation?.valid) return;
    if (!confirm('Publish this AI provider configuration globally? New analyses will use these routes after KV propagation.')) return;
    setBusy(true);
    const button = document.getElementById('providerPublishBtn');
    button.textContent = 'Publishing…';
    try {
      const response = await fetch('/api/providers', {
        method:'PUT', headers:{'content-type':'application/json'},
        body:JSON.stringify({ action:'publish', config:draft }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Could not publish provider configuration.');
      current = data;
      draft = clone(data.config);
      validation = data.validation;
      dirty = false;
      clearSessionDraft();
      renderAll();
      const syncCount = (data.sync?.results || []).filter((item) => item.action !== 'unchanged').length;
      setState(`Published ${draft.version}. New analyses use this routing globally.${syncCount ? ` ${syncCount} custom provider address${syncCount === 1 ? '' : 'es'} synchronized.` : ''}`, 'ok');
      window.dispatchEvent(new CustomEvent('risk-provider-config-updated', { detail: data }));
      window.RISK_PROVIDER_BADGE?.refresh?.();
    } catch (error) {
      setState(error.message || 'Could not publish provider configuration.', 'error');
    } finally {
      button.textContent = 'Publish globally';
      setBusy(false);
      renderValidation();
    }
  }

  function endpointPreview(profile) {
    if (!profile) return '—';
    const protocolPath = profile.protocol === 'chat-completions' ? 'chat/completions' : 'responses';
    if (profile.transport === 'openai-direct') return `https://api.openai.com/v1/${protocolPath}`;
    const account = draft?.cloudflare?.accountId || current?.environment?.envAccountId || '{account_id}';
    const gateway = draft?.cloudflare?.gatewayId || 'default';
    if (profile.transport === 'cloudflare-rest') return `https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1/${protocolPath}`;
    const prefix = String(profile.pathPrefix || '').replace(/^\/+|\/+$/g,'');
    return `https://gateway.ai.cloudflare.com/v1/${account}/${gateway}/${profile.providerSlug || '{provider}'}/${prefix ? `${prefix}/` : ''}${protocolPath}`;
  }

  function setState(text, kind = '') {
    const el = document.getElementById('providerState');
    el.textContent = text;
    el.className = `provider-state ${kind}`.trim();
  }

  function setBusy(value) {
    busy = Boolean(value);
    const add = document.getElementById('providerAddBtn');
    if (add) add.disabled = busy;
    const reload = document.getElementById('providerReloadBtn');
    if (reload) reload.disabled = busy || !current;
    const publish = document.getElementById('providerPublishBtn');
    if (publish) publish.disabled = busy || !dirty || !validation?.valid;
  }

  function persistSessionDraft() {
    if (!draft || !current?.config) return;
    try {
      sessionStorage.setItem(SESSION_DRAFT_KEY, JSON.stringify({
        baseVersion: current.config.version || '',
        savedAt: Date.now(),
        draft,
      }));
    } catch {
      // Session persistence is a convenience only; editing must keep working without it.
    }
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

  function pill(text, ok) { return `<span class="${ok ? 'ok' : 'warn'}">${text}</span>`; }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function capitalize(value) { const text=String(value||''); return text ? text[0].toUpperCase()+text.slice(1) : text; }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#039;'}[ch])); }

  window.RISK_PROVIDERS = { open: openManager, reload: loadCurrent };
})();