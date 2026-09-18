// Run with npm run test:browser. Uses an installed Chromium browser through CDP;
// no browser library or runtime dependency is added to the application.
const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const YAML = require('yaml');

const root = path.resolve(__dirname, '../..');
const browser = process.env.CHROME_PATH || [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find(file => fs.existsSync(file));

async function until(check, description, timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (await check()) return;
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Timed out: ' + description);
}

class CDP {
    constructor(socket) {
        this.socket = socket; this.id = 0; this.pending = new Map(); this.errors = []; this.urls = [];
        socket.addEventListener('message', event => {
            const message = JSON.parse(event.data);
            if (message.id) {
                const operation = this.pending.get(message.id);
                if (operation) {
                    this.pending.delete(message.id);
                    clearTimeout(operation.timer);
                    if (message.error) operation.reject(new Error(message.error.message));
                    else operation.resolve(message.result);
                }
            } else if (message.method === 'Runtime.exceptionThrown') this.errors.push(message.params.exceptionDetails);
            else if (message.method === 'Log.entryAdded' && message.params.entry.source === 'security') this.errors.push(message.params.entry);
            else if (message.method === 'Network.requestWillBeSent') this.urls.push(message.params.request.url);
        });
    }
    send(method, params = {}) {
        const id = ++this.id;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP timed out: ' + method)); }, 20000);
            this.pending.set(id, { resolve, reject, timer });
            this.socket.send(JSON.stringify({ id, method, params }));
        });
    }
    async evaluate(expression) {
        const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
    }
    async click(selector) { await this.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); }
    async fill(selector, value, event = 'input') {
        await this.evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); element.value = ${JSON.stringify(value)}; element.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true })); })()`);
    }
    async wait(expression, description) { await until(() => this.evaluate(expression), description); }
    async screenshot(filename) {
        const result = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
        const destination = path.join(root, '.local-data', filename);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, Buffer.from(result.data, 'base64'));
    }
}

it('manages a real running instance in desktop and mobile Chromium', { timeout: 120000 }, async t => {
    assert.ok(browser, 'Install Chrome/Chromium/Edge or set CHROME_PATH to run browser verification.');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockapi-browser-'));
    const configPath = path.join(dir, 'config.yaml');
    const fixture = YAML.parse(fs.readFileSync(path.join(root, 'examples/console.yaml'), 'utf8'));
    fixture.port = 0;
    fixture.log = 'none';
    fixture.admin = { token: 'browser-test-token' };
    fs.writeFileSync(configPath, YAML.stringify(fixture));
    const children = [];
    let client;
    t.after(async () => {
        client?.socket.close();
        for (const child of children.reverse()) {
            if (child.exitCode === null && child.signalCode === null) {
                const exited = once(child, 'exit'); child.kill(); await exited;
            }
        }
        const resolved = path.resolve(dir);
        if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('mockapi-browser-')) throw new Error('Unsafe browser temporary directory');
        fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 });
    });
    const server = spawn(process.execPath, [path.join(root, 'main.js'), '--config', configPath], { windowsHide: true });
    children.push(server);
    let serverOutput = '';
    server.stdout.on('data', data => { serverOutput += data; });
    server.stderr.on('data', data => { serverOutput += data; });
    await until(() => /MockAPI listening on/.test(serverOutput), 'CLI startup: ' + serverOutput);
    const origin = 'http://localhost:' + serverOutput.match(/listening on http:\/\/localhost:(\d+)/)[1];
    const chrome = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + path.join(dir, 'browser-profile'), 'about:blank'], { windowsHide: true });
    children.push(chrome);
    let chromeOutput = '';
    chrome.stderr.on('data', data => { chromeOutput += data; });
    await until(() => /DevTools listening on/.test(chromeOutput), 'Chromium startup');
    const debugging = new URL(chromeOutput.match(/DevTools listening on (ws:\/\/\S+)/)[1]);
    const targets = await (await fetch('http://' + debugging.host + '/json/list')).json();
    const socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    client = new CDP(socket);
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Log.enable');
    await client.send('Network.enable');
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    await client.send('Page.navigate', { url: origin + '/__mockapi/ui/' });
    await client.wait('document.querySelector("#auth-dialog")?.open', 'token login');
    await client.fill('#admin-token', 'wrong');
    await client.click('#auth-form button[type="submit"]');
    await client.wait('!document.querySelector("#auth-error").hidden', 'incorrect token feedback');
    await client.fill('#admin-token', 'browser-test-token');
    await client.click('#auth-form button[type="submit"]');
    await client.wait('!document.querySelector("#auth-dialog").open && document.querySelectorAll(".endpoint-item").length === 6', 'authenticated endpoint list');
    assert.equal(await client.evaluate('document.querySelector("#endpoint-path").value'), '/api/users');
    await client.screenshot('web-console-desktop.png');

    await client.click('#new-endpoint');
    await client.fill('#endpoint-path', '/browser-test');
    await client.fill('#endpoint-summary', 'Browser-created endpoint');
    await client.fill('#endpoint-body', '{"created":true}');
    await client.fill('#endpoint-status', '201');
    await client.click('#save-endpoint');
    await client.wait('document.querySelectorAll(".endpoint-item").length === 7 && document.querySelector("#draft-indicator").hidden', 'endpoint create');
    assert.equal((await fetch(origin + '/browser-test')).status, 201);
    assert.deepEqual(await (await fetch(origin + '/browser-test')).json(), { created: true });
    assert.deepEqual(YAML.parse(fs.readFileSync(configPath, 'utf8')).endpoints['/browser-test'].get.response, { created: true });
    await client.fill('#endpoint-body', '{invalid');
    await client.click('#save-endpoint');
    await client.wait('!document.querySelector("#endpoint-error").hidden', 'invalid response feedback');
    assert.deepEqual(await (await fetch(origin + '/browser-test')).json(), { created: true });
    await client.fill('#endpoint-body', '{"created":false}');
    await client.click('#save-endpoint');
    await client.wait('document.querySelector("#draft-indicator").hidden', 'endpoint update');

    await client.click('#test-endpoint');
    await client.wait('!document.querySelector("#page-tester").hidden', 'tester navigation');
    await client.click('#send-request');
    await client.wait('!document.querySelector("#tester-result").hidden', 'live request result');
    assert.match(await client.evaluate('document.querySelector("#tester-response-body").textContent'), /"created": false/);
    assert.match(await client.evaluate('document.querySelector("#response-meta").textContent'), /201/);
    await client.click('[data-page="history"]');
    await client.wait('document.querySelectorAll("#request-rows tr").length > 0', 'request history');
    await client.click('[data-request]');
    await client.wait('document.querySelector("#request-dialog").open', 'request inspection');
    assert.doesNotMatch(await client.evaluate('document.querySelector("#request-detail").textContent'), /browser-test-token/);
    await client.click('#close-request');

    await client.click('[data-page="endpoints"]');
    await client.fill('#endpoint-body', '{"draft":true}');
    const externallyEdited = YAML.parse(fs.readFileSync(configPath, 'utf8'));
    externallyEdited.endpoints['/external'] = { get: { response: 'from disk' } };
    fs.writeFileSync(configPath, YAML.stringify(externallyEdited));
    await client.wait('!document.querySelector("#notice").hidden', 'external edit conflict');
    await client.click('#save-endpoint');
    await client.wait('document.querySelector("#endpoint-error").textContent.includes("Configuration changed")', 'stale save rejected');
    assert.equal(await client.evaluate('document.querySelector("#endpoint-body").value'), '{"draft":true}');
    await client.click('#reload');
    await client.wait('document.querySelector("#confirm-dialog").open', 'discard confirmation');
    await client.click('#confirm-action');
    await client.wait('document.querySelectorAll(".endpoint-item").length === 8', 'external configuration loaded');
    assert.equal(await client.evaluate('document.querySelector("#endpoint-body").value'), '{\n  "created": false\n}');

    await client.click('#duplicate-endpoint');
    await client.wait('document.querySelector("#endpoint-path").value === "/browser-test-copy"', 'duplicate draft');
    await client.click('#save-endpoint');
    await client.wait('document.querySelectorAll(".endpoint-item").length === 9', 'duplicate saved');
    await client.click('#delete-endpoint');
    await client.wait('document.querySelector("#confirm-dialog").open', 'delete confirmation');
    await client.click('#confirm-action');
    await client.wait('document.querySelectorAll(".endpoint-item").length === 8', 'endpoint deleted');
    assert.equal((await fetch(origin + '/browser-test-copy')).status, 404);

    await client.click('[data-page="configuration"]');
    await client.click('#config-expert-mode');
    assert.doesNotMatch(await client.evaluate('document.querySelector("#config-source").value'), /browser-test-token/);
    const config = JSON.parse(await client.evaluate('document.querySelector("#config-source").value'));
    config.endpoints['/configured'] = { post: { response: { ok: true } } };
    await client.fill('#config-source', YAML.stringify(config));
    await client.click('#validate-config');
    await client.wait('document.querySelector("#toast").textContent.includes("Configuration is valid")', 'YAML validation');
    assert.equal((await fetch(origin + '/configured', { method: 'POST' })).status, 404);
    await client.click('#save-config');
    await client.wait('document.querySelector("#toast").textContent.includes("Configuration saved")', 'YAML saved');
    assert.deepEqual(await (await fetch(origin + '/configured', { method: 'POST' })).json(), { ok: true });

    await client.click('[data-page="endpoints"]');
    await client.click('#new-endpoint');
    await client.fill('#endpoint-path', '/nullable');
    await client.fill('#endpoint-body', 'null');
    await client.click('#save-endpoint');
    await client.wait('document.querySelector("#draft-indicator").hidden', 'null response saved');
    assert.equal(await client.evaluate('document.querySelector("#endpoint-body").value'), 'null');
    await client.fill('#endpoint-summary', '<img src=x onerror="window.injected=true">');
    await client.click('#save-endpoint');
    await client.wait('document.querySelector("#draft-indicator").hidden', 'null response edited');
    assert.equal(await (await fetch(origin + '/nullable')).text(), 'null');
    assert.equal(await client.evaluate('!!window.injected || !!document.querySelector("#endpoint-list img")'), false, 'endpoint metadata must be rendered as text');

    const importPath = path.join(dir, 'import.yaml');
    const imported = YAML.parse(fs.readFileSync(configPath, 'utf8'));
    delete imported.admin.token;
    imported.endpoints['/imported'] = { get: { response: 'imported' } };
    fs.writeFileSync(importPath, YAML.stringify(imported));
    const document = await client.send('DOM.getDocument');
    const input = await client.send('DOM.querySelector', { nodeId: document.root.nodeId, selector: '#import-file' });
    await client.send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [importPath] });
    await client.wait('!document.querySelector("#page-configuration").hidden && document.querySelector("#config-source").value.includes("/imported")', 'YAML file imported as a draft');
    assert.equal((await fetch(origin + '/imported')).status, 404);
    await client.click('#save-config');
    await client.wait('document.querySelector("#draft-indicator").hidden', 'import applied');
    assert.equal(await (await fetch(origin + '/imported')).text(), 'imported');
    await client.click('[data-page="endpoints"]');
    const downloads = path.join(dir, 'downloads');
    await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
    await client.click('#export-button');
    const exportPath = path.join(downloads, 'mockapi-config.yaml');
    await until(() => fs.existsSync(exportPath), 'configuration downloaded');
    const exported = fs.readFileSync(exportPath, 'utf8');
    assert.doesNotMatch(exported, /browser-test-token/);
    assert.equal(YAML.parse(exported).endpoints['/imported'].get.response, 'imported');

    await verifyVisualConfiguration(client, origin, configPath, dir);
    await client.click('[data-page="endpoints"]');

    await client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    assert.equal(await client.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, 'mobile layout must not overflow horizontally');
    await client.screenshot('web-console-mobile.png');
    await client.fill('#endpoint-search', 'nothing-here');
    assert.equal(await client.evaluate('document.querySelectorAll(".endpoint-item").length'), 0);
    await client.fill('#endpoint-search', '');
    await client.click('#connection');
    await client.click('#disconnect');
    await client.wait('document.querySelector("#connection-label").textContent === "Disconnected"', 'disconnect');
    assert.equal(await client.evaluate('document.querySelector("#config-source").value'), '');
    assert.deepEqual(client.errors, [], 'no JavaScript exceptions or CSP violations');
    assert.deepEqual(client.urls.filter(url => !url.startsWith(origin) && !url.startsWith('data:')), [], 'console must work without external assets');
});

async function verifyVisualConfiguration(client, origin, configPath, dir) {
    const field = path => '[data-field=' + JSON.stringify(JSON.stringify(path)) + ']';
    const control = path => '[data-value-path=' + JSON.stringify(JSON.stringify(path)) + ']';
    const keyControl = path => '[data-key-path=' + JSON.stringify(JSON.stringify(path)) + ']';
    const configure = path => field(path) + ' > .visual-property-heading .visual-switch input';
    const change = async (path, value) => client.fill(control(path), value, 'change');
    const openCards = async () => client.evaluate('document.querySelectorAll("#config-visual details.visual-card").forEach(node => { node.open = true; })');
    const draft = async () => JSON.parse(await client.evaluate('document.querySelector("#config-source").value'));
    await client.click('[data-page="configuration"]');
    await client.click('#config-normal-mode');
    await client.wait('!document.querySelector("#config-visual").hidden', 'normal mode');
    await client.screenshot('configuration-normal-desktop.png');
    await client.click('#config-expert-mode');
    const fixture = await draft();
    fs.writeFileSync(path.join(dir, 'rows.csv'), 'id,name\n1,Alice\n2,Bob\n');
    fs.writeFileSync(path.join(dir, 'handler.cjs'), 'exports.process = (request, data) => data;');
    fixture.data = { rows: { reader: 'csv', path: './rows.csv', properties: ['json', 'seq', -1] } };
    fixture.externalModulesPath = '.';
    fixture.customHandlers = { custom: 'handler.cjs' };
    fixture.enableCors = { origins: ['https://example.com'], methods: ['GET', 'POST'], headers: '*', credentials: true };
    fixture.maxBodyBytes = 2000000;
    fixture.requestTimeout = 12000;
    fixture.admin.historyLimit = 250;
    fixture.admin.bodyLimit = 2000;
    fixture.openApi = { enabled: true, docsPath: '/docs', specPath: '/openapi.json', title: 'Legacy title', info: { title: 'Visual API', version: '2', description: 'Description' } };
    fixture.endpoints['/visual-legacy'] = { verb: 'GET', data: 'rows', handler: 'custom', responseHeaders: { 'X-Count': 2 } };
    fixture.endpoints['/visual-sequence'] = { get: { response: { phase: 'base' }, sequence: [{ responseStatus: 503, data: 'rows' }, { responseStatus: 200, response: false }], sequenceMode: 'cycle' } };
    fixture.endpoints['/visual-conditional'] = { post: {
        response: null, summary: 'Metadata retained', description: 'Long description',
        match: { headers: { 'x-auth': 'allowed' } },
        variants: [{ match: { query: { mode: 'special' }, body: { enabled: true } }, data: 'rows', handler: 'custom', responseStatus: 202 }],
        parameters: [{ name: 'mode', in: 'query', schema: { type: ['string', 'null'] }, example: 'special', 'x-extension': { preserved: true } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { enabled: { type: 'boolean' } } }, example: { enabled: true } } } },
        responseSchema: { anyOf: [{ type: 'array', items: { type: 'object' } }, { type: 'null' }], 'x-custom': [false, null, 0] },
        responseExample: [false, null, 0, '']
    } };
    await client.fill('#config-source', YAML.stringify(fixture));
    await client.click('#config-normal-mode');
    await client.wait('!document.querySelector("#config-visual").hidden', 'YAML draft converted without applying');
    for (const section of ['endpoints', 'data', 'handlers', 'cors', 'docs', 'admin', 'general']) await client.click('[data-section="' + section + '"]');
    await client.click('#config-expert-mode');
    assert.deepEqual(await draft(), fixture, 'all supported shapes must round-trip without normalization or lost metadata');
    assert.equal((await fetch(origin + '/visual-legacy')).status, 404, 'mode changes must not apply a draft');
    await client.click('#config-normal-mode');
    await client.click('[data-section="data"]');
    await openCards();
    await client.fill(keyControl(['data', 'rows']), 'records', 'change');
    assert.equal((await draft()).endpoints['/visual-legacy'].data, 'records');
    assert.equal((await draft()).endpoints['/visual-sequence'].get.sequence[0].data, 'records');
    assert.equal((await draft()).endpoints['/visual-conditional'].post.variants[0].data, 'records');
    await openCards();
    await client.fill(control(['data', 'records', 'properties', 2]), '0');
    assert.equal((await draft()).data.records.properties[2], 0);
    await client.click(field(['data']) + ' > .visual-map > button');
    await client.fill(keyControl(['data', 'source']), 'text-fixture', 'change');
    await openCards();
    await client.fill(control(['data', 'text-fixture', 'path']), './rows.csv');
    await change(['data', 'text-fixture', 'reader'], 'text');
    await client.click('[data-section="handlers"]');
    await openCards();
    await client.fill(keyControl(['customHandlers', 'custom']), 'transform', 'change');
    assert.equal((await draft()).endpoints['/visual-legacy'].handler, 'transform');
    assert.equal((await draft()).endpoints['/visual-conditional'].post.variants[0].handler, 'transform');
    await client.click('[data-section="endpoints"]');
    assert.deepEqual(client.errors.map(error => error.exception?.description || error.text), [], 'visual sections must render without errors');
    await client.click(field(['endpoints']) + ' > .visual-map > button');
    await client.fill(keyControl(['endpoints', '/api/new']), '/normal-created', 'change');
    await openCards();
    const endpoint = ['endpoints', '/normal-created', 'get'];
    await client.fill(control([...endpoint, 'response', 'message']), 'Created visually');
    await client.click(configure([...endpoint, 'responseStatus']));
    await client.fill(control([...endpoint, 'responseStatus']), '201');
    await client.click(configure([...endpoint, 'delay']));
    await client.fill(control([...endpoint, 'delay']), '2');
    await client.click(configure([...endpoint, 'sequence']));
    await openCards();
    await client.fill(control([...endpoint, 'sequence', 0, 'responseStatus']), '502');
    await client.click(configure([...endpoint, 'sequenceMode']));
    await change([...endpoint, 'sequenceMode'], 'cycle');
    const sequenceCard = '[data-card=' + JSON.stringify(JSON.stringify([...endpoint, 'sequence', 0])) + ']';
    await client.click(sequenceCard + ' .visual-array-actions button:nth-child(2)');
    assert.deepEqual((await draft()).endpoints['/normal-created'].get.sequence.map(item => item.responseStatus), [200, 502]);
    await client.click(configure([...endpoint, 'variants']));
    await client.wait('document.querySelector("#confirm-dialog").open', 'exclusive scenario confirmation');
    await client.click('#confirm-action');
    await client.wait('!!JSON.parse(document.querySelector("#config-source").value).endpoints["/normal-created"].get.variants', 'variants enabled');
    assert.equal((await draft()).endpoints['/normal-created'].get.sequence, undefined);
    assert.equal((await draft()).endpoints['/normal-created'].get.sequenceMode, undefined);
    await openCards();
    await client.click(configure([...endpoint, 'variants', 0, 'match', 'query']));
    await client.click(field([...endpoint, 'variants', 0, 'match', 'query']) + ' > .visual-map > button');
    await openCards();
    await client.fill(control([...endpoint, 'variants', 0, 'match', 'query', 'mode']), 'special');
    await client.fill(control([...endpoint, 'variants', 0, 'responseStatus']), '202');
    // Add a typed null property without using source text.
    await client.click(field([...endpoint, 'response']) + ' > .visual-value > .visual-map > button');
    await openCards();
    const newValue = '[data-card=' + JSON.stringify(JSON.stringify([...endpoint, 'response', 'property'])) + '] .visual-value-toolbar select';
    await client.fill(newValue, 'null', 'change');
    await client.fill(keyControl([...endpoint, 'response', 'property']), 'empty', 'change');
    await client.click('#config-expert-mode');
    const visuallyEdited = await draft();
    assert.equal(visuallyEdited.endpoints['/normal-created'].get.response.empty, null);
    assert.equal(visuallyEdited.endpoints['/visual-conditional'].post.response, null);
    assert.deepEqual(visuallyEdited.endpoints['/visual-conditional'].post.responseSchema, fixture.endpoints['/visual-conditional'].post.responseSchema);
    await client.click('#config-normal-mode');
    await client.click('#save-config');
    await client.wait('document.querySelector("#config-draft-indicator").hidden || !document.querySelector("#configuration-error").hidden', 'visual save result');
    assert.equal(await client.evaluate('document.querySelector("#configuration-error").textContent'), '', await client.evaluate('JSON.stringify([...document.querySelectorAll("#config-visual :invalid")].map(node => ({path:node.dataset.valuePath || node.dataset.keyPath, value:node.value, message:node.validationMessage})))'));
    await client.wait('document.querySelector("#config-draft-indicator").hidden', 'normal configuration applied');
    assert.equal((await fetch(origin + '/normal-created')).status, 201);
    assert.equal((await fetch(origin + '/normal-created?mode=special')).status, 202);
    assert.deepEqual(await (await fetch(origin + '/normal-created')).json(), { message: 'Created visually', empty: null });
    assert.deepEqual(await (await fetch(origin + '/visual-legacy')).json(), { id: '1', name: 'Alice' });
    assert.equal(YAML.parse(fs.readFileSync(configPath, 'utf8')).customHandlers.transform, 'handler.cjs');
    // Invalid expert text remains intact and does not replace the visual draft.
    await client.click('#config-expert-mode');
    const goodSource = await client.evaluate('document.querySelector("#config-source").value');
    await client.fill('#config-source', '{invalid');
    await client.click('#config-normal-mode');
    await client.wait('!document.querySelector("#configuration-error").hidden', 'invalid source mode error');
    assert.equal(await client.evaluate('document.querySelector("#config-expert").hidden'), false);
    assert.equal(await client.evaluate('document.querySelector("#config-source").value'), '{invalid');
    await client.fill('#config-source', goodSource);
    await client.click('#config-normal-mode');
    await client.click('[data-section="general"]');
    await client.fill(control(['port']), '10001');
    await client.click('#download-draft');
    const downloaded = path.join(dir, 'downloads', 'mockapi-draft.json');
    await until(() => fs.existsSync(downloaded), 'restart configuration draft download');
    assert.equal(JSON.parse(fs.readFileSync(downloaded, 'utf8')).port, 10001);
    assert.equal(YAML.parse(fs.readFileSync(configPath, 'utf8')).port, 0);
    await client.click('#discard-config');
    await client.wait('document.querySelector("#confirm-dialog").open', 'visual discard confirmation');
    await client.click('#confirm-action');
    await client.wait('document.querySelector("#config-draft-indicator").hidden', 'visual draft discarded');
    await client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    assert.equal(await client.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, 'normal configuration must fit mobile');
    await client.screenshot('configuration-normal-mobile.png');
}
