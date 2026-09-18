'use strict';

(() => {
    const $ = id => document.getElementById(id);
    const adminPath = location.pathname.replace(/\/ui\/$/, '');
    const pageNames = { endpoints: 'Endpoints', tester: 'Request tester', history: 'Request log', configuration: 'Configuration' };
    const basicKeys = ['verb', 'summary', 'response', 'data', 'responseStatus', 'delay', 'responseContentType', 'responseHeaders'];
    let snapshot, routes = [], selected = null, page = 'endpoints';
    let dirty = false, saving = false, connected = false, polling = false, paused = false, disconnected = false;
    let token = '', requests = [], lastResponse = '', toastTimer, requestController, refreshId = 0;
    let configMode = 'normal', switchingMode = false;

    const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    const json = value => JSON.stringify(value, null, 2);
    const badge = method => `<span class="method-badge method-${escape(method.toLowerCase())}">${escape(method.toUpperCase())}</span>`;
    const statusBadge = status => `<span class="status-badge ${status >= 500 ? 'error' : status >= 400 ? 'warning' : ''}">${escape(status)}</span>`;
    const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const visual = new window.ConfigVisualEditor($('config-visual'), {
        onChange(config) { $('config-source').value = json(config); markDirty(); },
        onDirty() { markDirty(); },
        confirm: confirmAction
    });

    function loadConfigDraft(config) {
        $('config-source').value = json(config);
        visual.load(config, snapshot?.instance);
        showError('configuration-error');
    }

    function displayConfigMode(mode) {
        configMode = mode;
        $('config-visual').hidden = mode !== 'normal';
        $('config-expert').hidden = mode !== 'expert';
        $('page-configuration').classList.toggle('visual-mode', mode === 'normal');
        $('config-mode-help').textContent = mode === 'normal' ? 'Guided controls for your complete mock API.' : 'Edit the complete draft directly in JSON or YAML.';
        for (const name of ['normal', 'expert']) {
            $('config-' + name + '-mode').classList.toggle('active', name === mode);
            $('config-' + name + '-mode').setAttribute('aria-pressed', String(name === mode));
        }
    }

    async function parseConfigDraft() {
        let config;
        try { config = JSON.parse($('config-source').value); }
        catch { config = (await api('/config/parse', { method: 'POST', body: JSON.stringify({ source: $('config-source').value }) })).config; }
        if (!isObject(config)) throw new Error('Configuration must be an object.');
        return config;
    }

    async function switchConfigMode(mode) {
        if (mode === configMode || switchingMode || saving) return;
        switchingMode = true;
        const source = $('config-source').value;
        try {
            if (mode === 'normal') {
                const config = await parseConfigDraft();
                if (source !== $('config-source').value) throw new Error('The draft changed while switching modes. Try again.');
                visual.load(config, snapshot?.instance);
            } else $('config-source').value = json(visual.get());
            displayConfigMode(mode);
            showError('configuration-error');
        } catch (error) { showError('configuration-error', 'Cannot switch modes: ' + error.message); }
        finally { switchingMode = false; }
    }

    function configPayload() { return configMode === 'normal' ? { config: visual.get() } : { source: $('config-source').value }; }

    function toast(message) {
        $('toast').textContent = message;
        $('toast').hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
    }

    function showError(id, message = '') { $(id).textContent = message; $(id).hidden = !message; }
    function notice(message = '') { $('notice-text').textContent = message; $('notice').hidden = !message; }
    function markDirty(value = true) { dirty = value; $('draft-indicator').hidden = !value; $('config-draft-indicator').hidden = !value; }

    async function confirmAction(title, message, action = 'Continue') {
        $('confirm-title').textContent = title;
        $('confirm-message').textContent = message;
        $('confirm-action').textContent = action;
        const dialog = $('confirm-dialog');
        if (dialog.open) return false;
        dialog.returnValue = 'cancel';
        dialog.showModal();
        return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }));
    }

    async function canDiscard() {
        return !dirty || await confirmAction('Discard unsaved changes?', 'Your edits have not been applied to the running instance.', 'Discard changes');
    }

    async function api(endpoint, options = {}) {
        const headers = { ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...options.headers };
        const response = await fetch(adminPath + endpoint, { ...options, headers, cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(30000) });
        if (!response.ok) {
            let message = `Request failed (${response.status})`;
            try { message = (await response.json()).error || message; } catch { /* use status */ }
            const error = new Error(message);
            error.status = response.status;
            if (response.status === 401 || response.status === 403) {
                connected = false;
                connectionState(false);
                $('auth-message').textContent = message + '. Enter your instance admin token to connect.';
                if (!$('auth-dialog').open) $('auth-dialog').showModal();
            }
            throw error;
        }
        return options.download ? response.blob() : response.json();
    }

    function connectionState(online) {
        $('connection-dot').classList.toggle('offline', !online);
        $('connection-label').textContent = online ? 'Instance running' : 'Disconnected';
    }

    function getRoutes(config) {
        return Object.entries(config.endpoints || {}).flatMap(([path, entry]) => {
            const legacy = Object.hasOwn(entry, 'verb');
            return (legacy ? [[entry.verb, entry]] : Object.entries(entry)).map(([key, definition]) => ({
                id: path + '\n' + key, path, key, method: key.toUpperCase(), definition, legacy
            }));
        });
    }

    function acceptSnapshot(next, preferredId = selected?.id) {
        snapshot = next;
        routes = getRoutes(next.config);
        connected = true;
        disconnected = false;
        connectionState(true);
        $('version').textContent = 'v' + next.instance.version;
        $('instance-address').textContent = location.host;
        $('config-filename').textContent = next.instance.configFile || 'In memory';
        $('endpoint-total').textContent = routes.length;
        $('nav-endpoint-count').textContent = routes.length;
        $('list-count').textContent = routes.length + ' total';
        $('history-limit').textContent = 'Last ' + next.instance.historyLimit + ' requests';
        $('docs-link').hidden = !next.instance.docsPath;
        if (next.instance.docsPath) $('docs-link').href = next.instance.docsPath;
        $('persistence-help').textContent = next.instance.persistent
            ? `Save & apply updates ${next.instance.configFile} on the server and reloads this instance. Your configuration survives a restart. Relative file paths remain relative to that file.`
            : 'This embedded instance has no configuration file attached. Save & apply updates memory only. Export a copy to keep your configuration after a restart.';
        $('save-endpoint').firstChild.textContent = next.instance.persistent ? 'Save & apply ' : 'Apply changes ';
        $('save-config').textContent = next.instance.persistent ? 'Save & apply' : 'Apply changes';
        loadConfigDraft(next.config);
        markDirty(false);
        const route = routes.find(item => item.id === preferredId) || routes[0];
        editEndpoint(route || null);
        const testerSelection = $('tester-endpoint').value;
        $('tester-endpoint').innerHTML = '<option value="">Custom request</option>' + routes.map(route => `<option value="${escape(route.id)}" ${route.method === 'TRACE' ? 'disabled' : ''}>${escape(route.method)} ${escape(route.path)}${route.method === 'TRACE' ? ' (unavailable in browsers)' : ''}</option>`).join('');
        $('tester-endpoint').value = routes.some(route => route.id === testerSelection) ? testerSelection : '';
        notice(next.instance.reloadError ? 'The last file reload failed: ' + next.instance.reloadError + '. The previous configuration is still running.' : '');
    }

    async function refresh(force = false) {
        const id = ++refreshId;
        const next = await api('/config');
        if (saving || disconnected || id !== refreshId) return;
        connectionState(true);
        connected = true;
        if (!snapshot || force || (!dirty && next.revision !== snapshot.revision)) acceptSnapshot(next);
        else if (next.revision !== snapshot.revision) notice('This instance changed in another window or on disk. Your edits are still here. Reload the latest configuration before saving.');
        else if (next.instance.reloadError) notice('The last file reload failed: ' + next.instance.reloadError + '. The previous configuration is still running.');
        else notice('');
    }

    function renderList() {
        const query = $('endpoint-search').value.trim().toLowerCase();
        const filtered = routes.filter(route => `${route.method} ${route.path} ${route.definition.summary || ''}`.toLowerCase().includes(query));
        $('endpoint-list').innerHTML = filtered.length ? filtered.map(route => `<button type="button" class="endpoint-item ${route.id === selected?.id ? 'selected' : ''}" data-route="${escape(route.id)}" aria-pressed="${route.id === selected?.id}"><span class="endpoint-item-top">${badge(route.method)}<span class="endpoint-item-path" title="${escape(route.path)}">${escape(route.path)}</span></span><span class="endpoint-item-description">${escape(route.definition.summary || (route.definition.data ? 'Data source · ' + route.definition.data : route.definition.sequence ? 'Response sequence' : route.definition.variants ? 'Conditional responses' : (route.definition.responseStatus || 200) + ' response'))}</span></button>`).join('')
            : `<p class="no-results">${routes.length ? 'No endpoints match your search.' : 'No endpoints yet. Create one to get started.'}</p>`;
    }

    function editEndpoint(route, newDefinition) {
        selected = route;
        markDirty(false);
        showError('endpoint-error');
        $('endpoint-form').hidden = !route && !newDefinition;
        $('endpoint-empty').hidden = !!route || !!newDefinition;
        renderList();
        if (!route && !newDefinition) return;
        const definition = route?.definition || newDefinition;
        $('editor-title').textContent = route ? route.path : 'New endpoint';
        $('endpoint-path').value = route?.path || '/api/hello';
        $('endpoint-method').value = route?.method || 'GET';
        $('endpoint-summary').value = definition.summary || '';
        $('endpoint-status').value = definition.responseStatus || 200;
        $('endpoint-delay').value = definition.delay || 0;
        $('endpoint-content-type').value = definition.responseContentType || '';
        $('endpoint-headers').value = json(definition.responseHeaders || {});
        $('response-type').value = Object.hasOwn(definition, 'data') ? 'data' : !Object.hasOwn(definition, 'response') ? 'empty' : typeof definition.response === 'string' ? 'text' : 'json';
        $('endpoint-body').value = typeof definition.response === 'string' ? definition.response : json(Object.hasOwn(definition, 'response') ? definition.response : {});
        const data = Object.keys(snapshot?.config.data || {});
        $('endpoint-data').innerHTML = data.length ? data.map(name => `<option value="${escape(name)}">${escape(name)}</option>`).join('') : '<option value="">No data sources configured</option>';
        $('endpoint-data').value = definition.data || data[0] || '';
        $('endpoint-advanced').value = json(Object.fromEntries(Object.entries(definition).filter(([key]) => !basicKeys.includes(key))));
        $('delete-endpoint').disabled = !route;
        $('duplicate-endpoint').disabled = !route;
        $('test-endpoint').disabled = !route || route.method === 'TRACE';
        $('test-endpoint').title = route?.method === 'TRACE' ? 'Browsers do not support TRACE requests. Test this endpoint with a command-line HTTP client.' : '';
        updateResponseType();
        if (newDefinition) markDirty();
    }

    function updateResponseType() {
        const type = $('response-type').value;
        $('data-source-field').hidden = type !== 'data';
        $('response-body-field').hidden = !['json', 'text'].includes(type);
        $('body-language').textContent = type.toUpperCase();
        $('format-response').hidden = type !== 'json';
    }

    function parseObject(value, field) {
        let parsed;
        try { parsed = JSON.parse(value); } catch (error) { throw new Error(field + ' must be valid JSON: ' + error.message); }
        if (!isObject(parsed)) throw new Error(field + ' must be a JSON object.');
        return parsed;
    }

    function readDefinition() {
        const definition = parseObject($('endpoint-advanced').value, 'Advanced options');
        const duplicate = Object.keys(definition).find(key => basicKeys.includes(key));
        if (duplicate) throw new Error(`Set ${duplicate} using the response fields above, not the advanced options.`);
        definition.responseStatus = Number($('endpoint-status').value);
        definition.delay = Number($('endpoint-delay').value);
        if ($('endpoint-summary').value.trim()) definition.summary = $('endpoint-summary').value.trim();
        if ($('endpoint-content-type').value.trim()) definition.responseContentType = $('endpoint-content-type').value.trim();
        const headers = parseObject($('endpoint-headers').value, 'Response headers');
        if (Object.keys(headers).length) definition.responseHeaders = headers;
        const type = $('response-type').value;
        if (type === 'json') {
            try { definition.response = JSON.parse($('endpoint-body').value); } catch (error) { throw new Error('Response body must be valid JSON: ' + error.message); }
        } else if (type === 'text') definition.response = $('endpoint-body').value;
        else if (type === 'data') {
            if (!$('endpoint-data').value) throw new Error('Choose a data source, or define one in Configuration.');
            definition.data = $('endpoint-data').value;
        }
        return definition;
    }

    function removeRoute(config, route) {
        if (route.legacy) delete config.endpoints[route.path];
        else {
            delete config.endpoints[route.path][route.key];
            if (!Object.keys(config.endpoints[route.path]).length) delete config.endpoints[route.path];
        }
    }

    function putRoute(config, path, method, definition) {
        config.endpoints ||= {};
        const existing = config.endpoints[path];
        if (existing && Object.hasOwn(existing, 'verb')) {
            const { verb, ...previous } = existing;
            config.endpoints[path] = { [verb]: previous };
        }
        config.endpoints[path] ||= {};
        config.endpoints[path][method.toLowerCase()] = definition;
    }

    async function saveConfiguration(payload, preferredId) {
        if (saving || !snapshot) return;
        saving = true;
        refreshId++;
        document.querySelector('main').inert = true;
        try {
            const next = await api('/config', { method: 'PUT', body: JSON.stringify({ ...payload, revision: snapshot.revision }) });
            acceptSnapshot(next, preferredId);
            requests = [];
            renderHistory();
            toast(next.instance.persistent ? 'Configuration saved. Your changes are live.' : 'Changes applied to this running instance.');
        } catch (error) {
            if (error.status === 409) notice(error.message);
            throw error;
        } finally { saving = false; document.querySelector('main').inert = false; }
    }

    async function navigate(nextPage, skipDiscard = false) {
        if (saving) return false;
        if (!pageNames[nextPage]) nextPage = 'endpoints';
        if (page === nextPage) return true;
        if (!skipDiscard && !await canDiscard()) return false;
        if (dirty) {
            editEndpoint(selected);
            loadConfigDraft(snapshot.config);
            markDirty(false);
        }
        page = nextPage;
        document.querySelectorAll('.page').forEach(section => { section.hidden = section.id !== 'page-' + page; });
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.toggle('active', link.dataset.page === page);
            if (link.dataset.page === page) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
        });
        $('breadcrumb-page').textContent = pageNames[page];
        document.title = pageNames[page] + ' · Mock API';
        history.replaceState(null, '', '#' + page);
        if (page === 'configuration' && snapshot) loadConfigDraft(snapshot.config);
        return true;
    }

    function configureTest(route) {
        const method = ['ANY', 'TRACE'].includes(route.method) ? 'GET' : route.method;
        $('tester-endpoint').value = route.id;
        $('tester-method').value = method;
        $('tester-path').value = route.path;
        $('tester-headers').value = ['POST', 'PUT', 'PATCH'].includes(method) ? '{\n  "Content-Type": "application/json"\n}' : '{}';
        $('tester-body').value = ['POST', 'PUT', 'PATCH'].includes(method) ? '{}' : '';
        showError('tester-error');
    }

    async function loadHistory() {
        const data = await api('/requests');
        requests = data.requests;
        renderHistory();
    }

    function renderHistory() {
        $('request-total').textContent = requests.length;
        $('nav-request-count').textContent = requests.length;
        const query = $('history-search').value.trim().toLowerCase();
        const filtered = requests.filter(request => `${request.method} ${request.url} ${request.status}`.toLowerCase().includes(query));
        $('history-caption').textContent = `${paused ? 'Updates paused' : 'Live'} · ${filtered.length} of ${requests.length} requests${snapshot ? ' · limit ' + snapshot.instance.historyLimit : ''}`;
        $('history-empty').hidden = filtered.length > 0;
        $('history-empty').querySelector('h2').textContent = requests.length ? 'No matching requests' : 'Waiting for your first request';
        $('history-empty').querySelector('p').textContent = requests.length ? 'Try another path, method, or status.' : 'Call an endpoint from your application or the request tester. Requests will appear here automatically.';
        $('request-rows').innerHTML = [...filtered].reverse().map(request => `<tr><td title="${escape(request.timestamp)}">${escape(new Date(request.timestamp).toLocaleTimeString())}</td><td>${badge(request.method)}</td><td class="path-cell" title="${escape(request.url)}">${escape(request.url)}</td><td>${statusBadge(request.status)}</td><td>${escape(request.duration)} ms</td><td><button class="button small" data-request="${request.id}">Inspect</button></td></tr>`).join('');
    }

    $('endpoint-search').addEventListener('input', renderList);
    $('endpoint-list').addEventListener('click', async event => {
        const button = event.target.closest('[data-route]');
        if (!button || !await canDiscard()) return;
        editEndpoint(routes.find(route => route.id === button.dataset.route));
    });
    $('endpoint-form').addEventListener('input', () => markDirty());
    $('endpoint-form').addEventListener('change', () => markDirty());
    $('response-type').addEventListener('change', updateResponseType);
    $('format-response').addEventListener('click', () => {
        try { $('endpoint-body').value = json(JSON.parse($('endpoint-body').value)); showError('endpoint-error'); markDirty(); }
        catch (error) { showError('endpoint-error', 'Cannot format JSON: ' + error.message); }
    });
    async function newEndpoint() {
        if (!snapshot || !await canDiscard()) return;
        editEndpoint(null, { response: { message: 'Hello, world!' } });
        $('endpoint-path').focus();
        $('endpoint-path').select();
    }
    $('new-endpoint').addEventListener('click', newEndpoint);
    $('empty-new').addEventListener('click', newEndpoint);
    $('discard-endpoint').addEventListener('click', async () => { if (await canDiscard()) editEndpoint(selected); });
    $('endpoint-form').addEventListener('submit', async event => {
        event.preventDefault();
        showError('endpoint-error');
        try {
            const config = structuredClone(snapshot.config);
            const path = $('endpoint-path').value.trim();
            const method = $('endpoint-method').value;
            const canonical = value => value.replace(/\/+$/, '') || '/';
            if (routes.some(route => route.id !== selected?.id && canonical(route.path) === canonical(path) && route.method === method)) throw new Error('An endpoint with this method and path already exists.');
            const definition = readDefinition();
            let preferredId;
            if (selected && selected.path === path && selected.method === method) {
                if (selected.legacy) config.endpoints[path] = { verb: selected.key, ...definition };
                else config.endpoints[path][selected.key] = definition;
                preferredId = selected.id;
            } else {
                if (selected) removeRoute(config, selected);
                putRoute(config, path, method, definition);
                preferredId = path + '\n' + method.toLowerCase();
            }
            await saveConfiguration({ config }, preferredId);
        } catch (error) { showError('endpoint-error', error.message); }
    });
    $('delete-endpoint').addEventListener('click', async () => {
        if (!selected || !await confirmAction('Delete this endpoint?', `${selected.method} ${selected.path} will be removed from the running instance and its configuration.`, 'Delete endpoint')) return;
        try {
            const config = structuredClone(snapshot.config);
            removeRoute(config, selected);
            await saveConfiguration({ config });
        } catch (error) { showError('endpoint-error', error.message); }
    });
    $('duplicate-endpoint').addEventListener('click', async () => {
        if (!selected || !await canDiscard()) return;
        const original = selected;
        editEndpoint(null, structuredClone(original.definition));
        $('endpoint-method').value = original.method;
        $('endpoint-path').value = original.path.replace(/\/$/, '') + '-copy';
        $('endpoint-path').focus();
    });
    $('test-endpoint').addEventListener('click', async () => {
        if (!selected) return;
        const route = selected;
        if (await navigate('tester')) configureTest(route);
    });
    document.querySelectorAll('.nav-link').forEach(link => link.addEventListener('click', event => { event.preventDefault(); navigate(link.dataset.page); }));
    document.querySelector('.brand').addEventListener('click', event => { event.preventDefault(); navigate('endpoints'); });
    window.addEventListener('hashchange', async () => { if (!await navigate(location.hash.slice(1))) history.replaceState(null, '', '#' + page); });
    window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });

    $('tester-endpoint').addEventListener('change', () => {
        const route = routes.find(item => item.id === $('tester-endpoint').value);
        if (route) configureTest(route);
    });
    $('tester-form').addEventListener('submit', async event => {
        event.preventDefault();
        showError('tester-error');
        $('send-request').disabled = true;
        try {
            const path = $('tester-path').value.trim();
            if (!path.startsWith('/') || path.startsWith('//') || /[\\\r\n]/.test(path)) throw new Error('Enter a path on this instance, starting with a single /.');
            const url = new URL(path, location.origin);
            if (url.origin !== location.origin || url.hash) throw new Error('Use a path and query on this instance, without a fragment.');
            if (url.pathname === adminPath || url.pathname.startsWith(adminPath + '/')) throw new Error('The request tester is for mock endpoints. Use the console controls to manage the instance.');
            const headers = parseObject($('tester-headers').value, 'Request headers');
            for (const [key, value] of Object.entries(headers)) if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`Header ${key} must be a string or number.`);
            const method = $('tester-method').value;
            const body = $('tester-body').value;
            if (['GET', 'HEAD'].includes(method) && body) throw new Error('GET and HEAD cannot include a body in the browser. Clear the request body or choose another method.');
            requestController = new AbortController();
            const timeout = setTimeout(() => requestController.abort(), 60000);
            const started = performance.now();
            try {
                // Never forward the management token or browser credentials to a mock route.
                const response = await fetch(url, { method, headers, ...(body ? { body } : {}), credentials: 'omit', cache: 'no-store', redirect: 'manual', signal: requestController.signal });
                if (response.type === 'opaqueredirect') throw new Error('The endpoint returned a redirect. It was not followed. Inspect its status in the request log.');
                const reader = response.body?.getReader();
                const decoder = new TextDecoder();
                let text = '', bytes = 0, truncated = false;
                if (reader) {
                    while (true) {
                        const chunk = await reader.read();
                        if (chunk.done) break;
                        bytes += chunk.value.byteLength;
                        if (bytes > 1024 * 1024) { truncated = true; await reader.cancel(); break; }
                        text += decoder.decode(chunk.value, { stream: true });
                    }
                    text += decoder.decode();
                }
                try { lastResponse = json(JSON.parse(text)); } catch { lastResponse = text; }
                $('tester-placeholder').hidden = true;
                $('tester-result').hidden = false;
                $('response-meta').innerHTML = `${statusBadge(response.status)}<span>${Math.round(performance.now() - started)} ms</span><span>${bytes.toLocaleString()} B</span>`;
                $('tester-response-body').textContent = (lastResponse || '(empty response)') + (truncated ? '\n\n[Preview truncated at 1 MiB]' : '');
                $('tester-response-headers').textContent = [...response.headers].map(([name, value]) => name + ': ' + value).join('\n');
            } finally { clearTimeout(timeout); requestController = null; }
            if (connected && !paused) await loadHistory();
        } catch (error) { showError('tester-error', error.name === 'AbortError' ? 'Request stopped after 60 seconds.' : error.message); }
        finally { $('send-request').disabled = false; }
    });
    $('copy-response').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(lastResponse); toast('Response copied.'); }
        catch { toast('Clipboard unavailable. Select and copy the response text.'); }
    });
    $('history-search').addEventListener('input', renderHistory);
    $('pause-history').addEventListener('click', () => { paused = !paused; $('pause-history').textContent = paused ? 'Resume updates' : 'Pause updates'; renderHistory(); });
    $('clear-history').addEventListener('click', async () => {
        if (!await confirmAction('Clear the request log?', 'Recorded requests will be removed. Scenario and CSV positions will stay where they are.', 'Clear log')) return;
        try { await api('/requests', { method: 'DELETE' }); requests = []; renderHistory(); toast('Request log cleared.'); }
        catch (error) { toast(error.message); }
    });
    $('request-rows').addEventListener('click', event => {
        const button = event.target.closest('[data-request]');
        const request = button && requests.find(item => item.id === Number(button.dataset.request));
        if (!request) return;
        $('request-detail-title').textContent = request.method + ' ' + request.url;
        $('request-detail').textContent = json(request);
        $('request-dialog').showModal();
    });
    $('close-request').addEventListener('click', () => $('request-dialog').close());

    $('config-source').addEventListener('input', () => markDirty());
    $('config-normal-mode').addEventListener('click', () => switchConfigMode('normal'));
    $('config-expert-mode').addEventListener('click', () => switchConfigMode('expert'));
    $('configuration-form').addEventListener('submit', async event => {
        event.preventDefault();
        showError('configuration-error');
        try { await saveConfiguration(configPayload()); }
        catch (error) { showError('configuration-error', error.message); }
    });
    $('format-config').addEventListener('click', () => {
        try { $('config-source').value = json(JSON.parse($('config-source').value)); markDirty(); showError('configuration-error'); }
        catch { showError('configuration-error', 'Format JSON requires JSON input. YAML can be validated and saved directly.'); }
    });
    $('validate-config').addEventListener('click', async () => {
        $('validate-config').disabled = true;
        try { await api('/config/validate', { method: 'POST', body: JSON.stringify(configPayload()) }); showError('configuration-error'); toast('Configuration is valid. Ready to apply.'); }
        catch (error) { showError('configuration-error', error.message); }
        finally { $('validate-config').disabled = false; }
    });
    $('discard-config').addEventListener('click', async () => {
        if (!await canDiscard()) return;
        loadConfigDraft(snapshot.config);
        markDirty(false);
        showError('configuration-error');
    });
    $('download-draft').addEventListener('click', async () => {
        try {
            const config = configMode === 'normal' ? visual.get() : await parseConfigDraft();
            if (isObject(config.admin)) delete config.admin.token;
            const url = URL.createObjectURL(new Blob([json(config) + '\n'], { type: 'application/json' }));
            const link = document.createElement('a'); link.href = url; link.download = 'mockapi-draft.json'; link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            toast('Draft downloaded. It has not been applied; admin tokens are excluded.');
        } catch (error) { showError('configuration-error', error.message); }
    });
    $('reset-scenarios').addEventListener('click', async () => {
        if (!await confirmAction('Reset this instance’s scenarios?', 'Response sequences and CSV readers will restart, and the request log will be cleared. Your configuration stays the same.', 'Reset scenarios')) return;
        try { await api('/reset', { method: 'POST' }); requests = []; renderHistory(); toast('Scenarios and request history reset.'); }
        catch (error) { toast(error.message); }
    });
    $('import-button').addEventListener('click', async () => { if (snapshot && await canDiscard()) $('import-file').click(); });
    $('import-file').addEventListener('change', async () => {
        const file = $('import-file').files[0];
        if (!file) return;
        if (file.size > 4 * 1024 * 1024) { toast('Import files must be smaller than 4 MiB.'); $('import-file').value = ''; return; }
        const source = await file.text();
        await navigate('configuration', true);
        $('config-source').value = source;
        displayConfigMode('expert');
        markDirty();
        showError('configuration-error');
        toast('Configuration imported as a draft. Review it, then save & apply.');
        $('import-file').value = '';
    });
    $('export-button').addEventListener('click', async () => {
        try {
            const blob = await api('/config/export', { download: true });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url; link.download = 'mockapi-config.yaml'; link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            toast('Saved configuration exported. Admin tokens are excluded.');
        } catch (error) { toast(error.message); }
    });
    $('reload').addEventListener('click', async () => {
        if (!await canDiscard()) return;
        try { await refresh(true); if (!paused) await loadHistory(); toast('Latest configuration loaded.'); }
        catch (error) { notice(error.message); }
    });
    $('connection').addEventListener('click', () => {
        $('auth-message').textContent = connected ? 'Connected to ' + location.origin + '. You can reconnect with another admin token or disconnect this console.' : 'Connect to ' + location.origin + '. Leave the token empty for local access when no token is configured.';
        $('disconnect').hidden = !connected;
        $('auth-dialog').showModal();
    });
    $('auth-form').addEventListener('submit', async event => {
        event.preventDefault();
        token = $('admin-token').value;
        $('admin-token').value = '';
        disconnected = false;
        showError('auth-error');
        try { await refresh(); await loadHistory(); $('auth-dialog').close(); toast('Connected to your instance.'); }
        catch (error) { showError('auth-error', error.message); }
    });
    $('disconnect').addEventListener('click', async () => {
        if (!await canDiscard()) return;
        token = ''; connected = false; disconnected = true; snapshot = undefined; requests = []; routes = []; refreshId++;
        markDirty(false);
        $('admin-token').value = '';
        $('config-source').value = '';
        visual.load({});
        $('tester-response-body').textContent = '';
        $('tester-response-headers').textContent = '';
        $('tester-result').hidden = true;
        $('tester-placeholder').hidden = false;
        $('response-meta').textContent = '';
        lastResponse = '';
        editEndpoint(null); renderHistory(); connectionState(false);
        $('endpoint-total').textContent = '0'; $('nav-endpoint-count').textContent = '0'; $('list-count').textContent = '0 total';
        $('auth-dialog').close();
        notice('Console disconnected. Use the connection button above to reconnect.');
    });

    async function poll() {
        if (polling || saving || disconnected || $('auth-dialog').open || document.hidden) return;
        polling = true;
        try { await refresh(); if (!paused) await loadHistory(); }
        catch (error) {
            connected = false;
            connectionState(false);
            if (![401, 403].includes(error.status)) notice('Unable to reach this instance. Your unsaved edits are kept in this tab. Retrying automatically…');
        } finally { polling = false; }
    }
    displayConfigMode('normal');
    navigate(location.hash.slice(1) || 'endpoints');
    poll();
    setInterval(poll, 3000);
})();
