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
    if (document.querySelector('link[href^="/provider-manager.css"]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/provider-manager.css?v=provider-setup-1';
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
    const overlay = document.createElement('dialog');
    overlay.id = 'providerManagerModal';
    overlay.className = 'admin-modal-backdrop provider-manager-backdrop';
    overlay.setAttribute('aria-labelledby', 'providerManagerTitle');
    overlay.innerHTML = `
      <div class="provider-manager-modal">
        <div class="provider-manager-head">
          <div>
            <h3 id="providerManagerTitle">AI providers</h3>
          </div>
          <button id="providerManagerClose" type="button" class="admin-modal-close" aria-label="Close">×</button>
        </div>
        <div id="providerState" class="provider-state" role="status"></div>

        <section class="provider-section">
          <div class="provider-section-head">
            <h4>Providers</h4>
            <button id="providerAddBtn" type="button" class="btn ghost small">Add provider</button>
          </div>
          <div id="providerProfiles" class="provider-profiles"></div>
        </section>

        <section class="provider-section">
          <div class="provider-section-head"><h4>Routing</h4><small>Screenshot extraction requires vision. Esports searches Liquipedia separately.</small></div>
          <div id="providerRoutes" class="provider-route-table"></div>
        </section>

        <details class="provider-section provider-advanced">
          <summary>Gateway settings</summary>
          <div class="provider-grid">
            <div class="provider-field"><label for="providerAccountId">Account ID</label><input id="providerAccountId" /></div>
            <div class="provider-field"><label for="providerGatewayId">Gateway ID</label><input id="providerGatewayId" /></div>
          </div>
          <div id="providerEnv" class="provider-env"></div>
        </details>

        <div id="providerMessages" class="provider-errors" role="status"></div>
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
    overlay.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeManager();
    });
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
    document.getElementById('providerProfiles').addEventListener('submit', saveProfileKey);
    document.getElementById('providerRoutes').addEventListener('change', handleRouteEdit);
  }

  async function openManager() {
    if (!window.RISK_ROUTING?.admin) return window.RISK_ROUTING?.unlock?.();
    markManagerOpen(true);
    const adminModal = document.getElementById('adminModal');
    if (adminModal) adminModal.hidden = true;
    const modal = document.getElementById('providerManagerModal');
    if (!modal.open) modal.showModal();
    document.body.classList.add('admin-modal-open');
    await loadCurrent({ restoreDraft: true });
  }

  function closeManager() {
    if (busy) return;
    const modal = document.getElementById('providerManagerModal');
    modal.querySelectorAll('input[type="password"]').forEach(input => { input.value = ''; });
    modal.close();
    document.body.classList.remove('admin-modal-open');
    markManagerOpen(false);
    clearSessionDraft();
    const adminModal = document.getElementById('adminModal');
    if (adminModal) {
      adminModal.hidden = false;
      document.body.classList.add('admin-modal-open');
      document.getElementById('manageProvidersBtn')?.focus();
    }
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
        dirty ? 'Recovered your unpublished changes.' : '',
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
  }

  function renderEnvironment() {
    const env = current?.environment || {};
    document.getElementById('providerEnv').innerHTML = [
      pill(`OpenAI direct key ${env.openAiKeyConfigured ? 'ready' : 'missing'}`, env.openAiKeyConfigured),
      pill(`Gateway run token ${env.cloudflareGatewayTokenConfigured ? 'ready' : 'missing'}`, env.cloudflareGatewayTokenConfigured),
      pill(`Gateway admin token ${env.cloudflareGatewayAdminTokenConfigured ? 'ready' : 'missing'}`, env.cloudflareGatewayAdminTokenConfigured),
      pill(`In-app key storage ${env.cloudflareGatewayKeysTokenConfigured ? 'ready' : 'disabled'}`, env.cloudflareGatewayKeysTokenConfigured),
      pill(`Admin signing secret ${env.adminSigningSecretConfigured ? 'ready' : 'fallback'}`, env.adminSigningSecretConfigured),
      pill(`Effective account ${escapeHtml(draft.cloudflare?.accountId || env.envAccountId || 'not set')}`, Boolean(draft.cloudflare?.accountId || env.envAccountId)),
      pill(`Gateway ${escapeHtml(draft.cloudflare?.gatewayId || env.effectiveGatewayId || 'default')}`, true),
    ].join('');
  }

  function renderProfiles(openIndex) {
    const root = document.getElementById('providerProfiles');
    const expanded = new Set([...root.querySelectorAll('.provider-card[open]')].map(card => card.dataset.profileId));
    const advanced = new Set([...root.querySelectorAll('.provider-card .provider-advanced[open]')].map(details => details.closest('.provider-card').dataset.profileId));
    if (openIndex !== undefined) expanded.add(draft.profiles[openIndex]?.id);
    root.innerHTML = draft.profiles.map((profile, index) => profileCard(profile, index, expanded.has(profile.id), advanced.has(profile.id))).join('') ||
      '<span class="rules-empty">No providers added.</span>';
  }

  function profileCard(profile, index, open, advanced) {
    const cap = profile.capabilities || {};
    const price = profile.pricing || {};
    const gateway = profile.transport === 'cloudflare-provider';
    const custom = gateway && profile.providerSlug?.startsWith('custom-');
    const keyStorageReady = current?.environment?.cloudflareGatewayKeysTokenConfigured;
    return `
      <details class="provider-card" data-card-index="${index}" data-profile-id="${escapeHtml(profile.id)}" ${open ? 'open' : ''}>
        <summary class="provider-card-summary">
          <strong>${escapeHtml(profile.label || 'Provider')}</strong>
          <span>${escapeHtml(profile.model || 'Model not set')}</span>
          <small>${[cap.vision && 'Vision', cap.webSearch && 'Web search'].filter(Boolean).join(' · ')}</small>
        </summary>
        <div class="provider-card-body">
          <div class="provider-profile-grid">
            ${field(index, 'label', 'Name', profile.label)}
            ${field(index, 'model', 'Model ID', profile.model, 'Exact model name', 'provider-span-2')}
            ${selectField(index, 'protocol', 'API format', profile.protocol, [['responses','Responses'],['chat-completions','Chat Completions']])}
            ${gateway ? field(index, 'providerSlug', 'Provider slug', profile.providerSlug, 'openai or custom-myprovider') : ''}
            ${gateway ? `<div class="provider-base-url provider-span-2" ${custom ? '' : 'hidden'}>${field(index, 'baseUrl', 'HTTPS base URL', profile.baseUrl, 'https://api.example.com')}</div>` : ''}
            ${gateway ? field(index, 'pathPrefix', 'API path prefix', profile.pathPrefix, 'v1') : ''}
          </div>
          ${gateway ? `
            <form class="provider-key-form" data-key-index="${index}" autocomplete="off">
              ${field(index, 'byokAlias', 'Key alias', profile.byokAlias, 'A unique name for the key')}
              ${keyStorageReady ? `
                <div class="provider-field"><label for="provider-key-${index}">API key</label>
                  <input id="provider-key-${index}" name="provider-api-key" type="password" autocomplete="new-password" spellcheck="false" maxlength="4096" required />
                </div>
                <button type="submit" class="btn ghost small">Save API key</button>
              ` : '<small class="provider-key-note">In-app key storage needs one-time setup. You can still use an existing key alias.</small>'}
            </form>
          ` : ''}
          <div class="provider-capabilities">
            ${capBox(index,'vision','Vision',cap.vision)}${capBox(index,'webSearch','Built-in web search',cap.webSearch)}
          </div>
          ${cap.webSearch ? `<div class="provider-search-method">${webSearchModeField(index, profile)}</div>` : ''}
          <div class="provider-card-actions">
            <button type="button" class="btn ghost small" data-action="test" data-index="${index}">Test provider</button>
            ${cap.vision ? `<button type="button" class="btn ghost small" data-action="test-vision" data-index="${index}">Test vision</button>` : ''}
          </div>
          <div id="providerTest${index}" class="provider-test-result" role="status"></div>
          <details class="provider-advanced" ${advanced ? 'open' : ''}>
            <summary>Advanced</summary>
            <div class="provider-profile-grid">
              ${field(index, 'id', 'Profile ID', profile.id)}
              ${selectField(index, 'transport', 'Transport', profile.transport, [['openai-direct','Direct OpenAI'],['cloudflare-rest','Cloudflare REST / Unified'],['cloudflare-provider','Cloudflare provider/custom']])}
              ${profile.transport === 'cloudflare-rest' ? field(index, 'byokAlias', 'Key alias', profile.byokAlias) : ''}
              ${gateway ? field(index, 'sessionHeader', 'Session header', profile.sessionHeader, 'Optional') : ''}
            </div>
            <div class="provider-capabilities">
              ${capBox(index,'jsonSchema','JSON schema',cap.jsonSchema)}${capBox(index,'reasoning','Reasoning',cap.reasoning)}${capBox(index,'promptCache','Prompt cache',cap.promptCache)}${capBox(index,'store','store:false',cap.store)}
            </div>
            <div class="provider-pricing">
              ${priceField(index,'input','Input $ / 1M',price.input)}${priceField(index,'cached','Cached $ / 1M',price.cached)}${priceField(index,'output','Output $ / 1M',price.output)}${priceField(index,'webSearch','Search $ / call',price.webSearch)}
            </div>
            <div class="provider-card-actions">
              ${gateway ? `<button type="button" class="btn ghost small" data-action="sync" data-index="${index}" ${custom && profile.baseUrl ? '' : 'hidden'}>Sync address</button>` : ''}
              <button type="button" class="btn danger small" data-action="remove" data-index="${index}">Remove profile</button>
            </div>
          </details>
        </div>
      </details>
    `;
  }

  function renderRoutes() {
    const root = document.getElementById('providerRoutes');
    const advanced = root.querySelector('details')?.open;
    const options = (profiles, emptyLabel) => `<option value="">${emptyLabel}</option>${profiles.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.label || p.id)}</option>`).join('')}`;
    const profiles = options(draft.profiles, 'Select a provider');
    const visionProfiles = options(draft.profiles.filter(profile => profile.capabilities?.vision), 'Select a vision provider');
    const optional = options(draft.profiles, 'Disabled');
    const modes = ['auto','economy','quality'];
    const main = modes.map((mode) => {
      const route = draft.routes?.[mode] || {};
      return `<div class="provider-route-row"><strong>${capitalize(mode)}</strong>${routeSelect(mode,'extraction','Screenshot extraction',route.extraction,visionProfiles)}${routeSelect(mode,'primary','Classification',route.primary,profiles)}</div>`;
    }).join('');
    const fallback = modes.map((mode) => {
      const route = draft.routes?.[mode] || {};
      return `<div class="provider-route-row"><strong>${capitalize(mode)}</strong>${routeSelect(mode,'research','Research',route.research,optional)}${routeSelect(mode,'escalation','Escalation',route.escalation,optional)}</div>`;
    }).join('');
    root.innerHTML = `${main}<details class="provider-advanced" ${advanced ? 'open' : ''}><summary>Research and escalation</summary>${fallback}</details>`;
    root.querySelectorAll('select').forEach((select) => { select.value = select.dataset.value || ''; });
  }

  function routeSelect(mode, role, label, value, options) {
    const id = `provider-route-${mode}-${role}`;
    return `<div class="provider-field"><label for="${id}">${label}<span class="provider-sr-only"> for ${capitalize(mode)}</span></label><select id="${id}" data-route-mode="${mode}" data-route-role="${role}" data-value="${escapeHtml(value || '')}">${options}</select></div>`;
  }

  function field(index, path, label, value, placeholder = '', extraClass = '', disabled = false) {
    return `<label class="provider-field ${extraClass}"><span>${label}</span><input data-index="${index}" data-path="${path}" value="${escapeHtml(value || '')}" placeholder="${escapeHtml(placeholder)}" ${disabled ? 'disabled' : ''}/></label>`;
  }

  function selectField(index, path, label, value, choices) {
    return `<label class="provider-field"><span>${label}</span><select data-index="${index}" data-path="${path}">${choices.map(([key,text]) => `<option value="${key}" ${value === key ? 'selected' : ''}>${text}</option>`).join('')}</select></label>`;
  }

  function webSearchModeField(index, profile) {
    const enabled = Boolean(profile.capabilities?.webSearch);
    const value = profile.webSearchMode || (profile.protocol === 'chat-completions' ? 'chat-tools' : 'responses');
    const choices = profile.protocol === 'chat-completions'
      ? [['chat-tools','Chat built-in web_search tool'],['chat-options','Chat web_search_options'],['openrouter-plugin','OpenRouter/compatible web plugin'],['native','Provider-native / automatic']]
      : [['responses','Responses web_search tool'],['native','Provider-native / automatic']];
    return `<label class="provider-field provider-search-mode"><span>Search method</span><select data-index="${index}" data-path="webSearchMode" ${enabled ? '' : 'disabled'}>${choices.map(([key,text]) => `<option value="${key}" ${value === key ? 'selected' : ''}>${text}</option>`).join('')}</select></label>`;
  }

  function priceField(index, key, label, value) {
    return `<label class="provider-field"><span>${label}</span><input type="number" min="0" step="0.0001" data-index="${index}" data-price="${key}" value="${value == null ? '' : escapeHtml(value)}" placeholder="optional" /></label>`;
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
    const capKey = event.target.dataset.cap || '';
    if (capKey) profile.capabilities[capKey] = Boolean(event.target.checked);
    else if (event.target.dataset.price) profile.pricing[event.target.dataset.price] = event.target.value === '' ? null : Number(event.target.value);
    else if (path) profile[path] = event.target.value;
    else return;

    if (path === 'protocol') {
      if (profile.protocol === 'chat-completions' && (!profile.webSearchMode || profile.webSearchMode === 'responses')) profile.webSearchMode = 'chat-tools';
      if (profile.protocol === 'responses' && ['chat-tools','chat-options','openrouter-plugin'].includes(profile.webSearchMode)) profile.webSearchMode = 'responses';
    }
    if (capKey === 'webSearch' && profile.capabilities.webSearch && !profile.webSearchMode) {
      profile.webSearchMode = profile.protocol === 'chat-completions' ? 'chat-tools' : 'responses';
    }

    dirty = true;
    persistSessionDraft();

    const card = event.target.closest('.provider-card');
    if (event.type === 'change' && path === 'transport') {
      renderProfiles();
      document.querySelector(`[data-index="${index}"][data-path="${path}"]`)?.focus();
    } else if (path === 'providerSlug' || path === 'baseUrl') {
      const custom = profile.providerSlug.startsWith('custom-');
      card.querySelector('.provider-base-url').hidden = !custom;
      card.querySelector('[data-action="sync"]').hidden = !custom || !profile.baseUrl;
    } else if (event.type === 'change' && path === 'protocol' && profile.capabilities.webSearch) {
      card.querySelector('.provider-search-method').innerHTML = webSearchModeField(index, profile);
    } else if (event.type === 'change' && ['id','label'].includes(path)) {
      renderRoutes();
      if (path === 'id') card.dataset.profileId = profile.id;
      if (path === 'label') document.querySelector(`[data-card-index="${index}"] .provider-card-summary strong`).textContent = profile.label || 'Provider';
    } else if (path === 'model') {
      document.querySelector(`[data-card-index="${index}"] .provider-card-summary span`).textContent = profile.model || 'Model not set';
    } else if (event.type === 'change' && ['vision','webSearch'].includes(capKey)) {
      renderProfiles();
      renderRoutes();
      document.querySelector(`[data-index="${index}"][data-cap="${capKey}"]`)?.focus();
    }
    scheduleValidate();
  }

  async function handleProfileAction(event) {
    const button = event.target.closest('[data-action]');
    if (!button || !draft || busy) return;
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
    if (button.dataset.action === 'test' || button.dataset.action === 'test-vision') await testProfile(index, button);
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

  async function saveProfileKey(event) {
    const form = event.target.closest('[data-key-index]');
    if (!form) return;
    event.preventDefault();
    const index = Number(form.dataset.keyIndex);
    const profile = draft?.profiles[index];
    const input = form.querySelector('input[type="password"]');
    if (busy || !profile || !input) return;
    const result = document.getElementById(`providerTest${index}`);
    const button = form.querySelector('button[type="submit"]');
    const alias = profile.byokAlias?.trim();
    if (!alias) {
      result.textContent = 'Enter a key alias before saving.';
      form.querySelector('[data-path="byokAlias"]')?.focus();
      return;
    }
    const body = JSON.stringify({ config: draft, profileId: profile.id, apiKey: input.value });
    input.value = '';
    button.disabled = true;
    setBusy(true);
    result.textContent = 'Saving API key…';
    try {
      const response = await fetch('/api/provider-key', {
        method: 'POST', mode: 'same-origin', redirect: 'error',
        headers: { 'content-type': 'application/json' }, body,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Could not save the API key.');
      result.textContent = `Key saved as ${data.alias}. Test the provider before publishing.`;
    } catch (error) {
      result.textContent = error.message || 'Could not save the API key.';
    } finally {
      setBusy(false);
      button.disabled = false;
    }
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
    let id = `gateway-provider-${n}`;
    const used = new Set(draft.profiles.map((p) => p.id));
    while (used.has(id)) id = `gateway-provider-${++n}`;
    draft.profiles.push({
      id,
      label: `Compatible provider ${n}`,
      transport: 'cloudflare-provider',
      protocol: 'chat-completions',
      model: '',
      providerSlug: `custom-provider-${n}`,
      baseUrl: '',
      pathPrefix: 'v1',
      byokAlias: id,
      sessionHeader: '',
      webSearchMode: 'native',
      capabilities: { vision:false, jsonSchema:false, reasoning:false, webSearch:false, promptCache:false, store:false },
      pricing: { input:null, cached:null, output:null, webSearch:null },
    });
    dirty = true;
    persistSessionDraft();
    const index = draft.profiles.length - 1;
    renderProfiles(index);
    document.querySelector(`[data-index="${index}"][data-path="label"]`)?.focus();
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
    const action = button.dataset.action;
    const vision = action === 'test-vision';
    button.disabled = true;
    button.textContent = 'Testing…';
    result.textContent = vision ? 'Checking whether the model can read an image…' : draft.profiles[index].capabilities?.webSearch
      ? 'Running structured-output + web-search compatibility test…'
      : 'Running a small structured-output request…';
    try {
      const response = await fetch('/api/providers', {
        method:'POST', headers:{'content-type':'application/json'},
        body:JSON.stringify({ action, profileId:draft.profiles[index].id, config:draft }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Provider test failed.');
      if (vision) {
        result.textContent = 'Vision passed. The provider read the image correctly.';
        return;
      }
      const syncText = data.sync?.changed ? ' · address synchronized' : '';
      const webSource = data.webSearchSources?.[0]?.url;
      const webText = data.webSearchRequested
        ? ` · Liquipedia search verified (${data.webSearchMode || 'enabled'})${webSource ? ` · ${webSource}` : ''}`
        : '';
      result.textContent = `Connection and JSON passed${syncText}${webText}`;
    } catch (error) {
      result.textContent = `✕ ${error.message || 'Provider test failed.'}`;
    } finally {
      button.textContent = vision ? 'Test vision' : 'Test provider';
      button.disabled = false;
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
    ].join('');
    document.getElementById('providerPublishBtn').disabled = busy || !dirty || !validation?.valid;
    document.getElementById('providerVersion').textContent = dirty ? 'Unpublished changes' : '';
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
      setState(`Provider settings published.${syncCount ? ` ${syncCount} custom provider address${syncCount === 1 ? '' : 'es'} synchronized.` : ''}`, 'ok');
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
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch])); }

  window.RISK_PROVIDERS = { open: openManager, reload: loadCurrent };
})();
