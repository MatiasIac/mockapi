const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const { serve, temporary } = require('./helpers');

const read = async (get, root = '/__mockapi', headers) => JSON.parse((await get(root + '/config', { headers })).body);
const save = (get, input, root = '/__mockapi', headers) => get(root + '/config', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(input) });

it('serves the bundled console without exposing configuration, including custom paths and HEAD', async t => {
    const { get, core } = await serve(t, { admin: { path: '/manage', token: 'test-secret' } });
    assert.equal((await get('/manage')).headers.location, '/manage/ui/');
    for (const url of ['/manage/ui/', '/manage/ui/app.js', '/manage/ui/styles.css', '/manage/ui/config-schema.js', '/manage/ui/config-visual.js']) {
        const response = await get(url);
        assert.equal(response.status, 200);
        assert.equal(response.headers['cache-control'], 'no-store');
        assert.equal(response.headers['x-content-type-options'], 'nosniff');
        assert.match(response.headers['content-security-policy'], /frame-ancestors 'none'/);
        assert.doesNotMatch(response.body, /test-secret/);
        assert.equal((await get(url, { method: 'HEAD' })).body, '');
    }
    assert.equal((await get('/manage/config')).status, 401);
    assert.deepEqual(core.getRequests(), []);
    assert.equal((await get('/manage/ui/../../main.js')).status, 404);
    const disabled = await serve(t);
    assert.equal((await disabled.get('/__mockapi/ui/')).status, 404);
});

it('parses configuration drafts without applying or semantically validating incomplete options', async t => {
    const { get } = await serve(t, { admin: true });
    const before = await read(get);
    const config = { port: 9999, data: { unfinished: { reader: 'csv', path: 'not-created.csv' } }, endpoints: { '/draft': { get: { response: null } } }, unknown: { preserve: true } };
    const parsed = await get('/__mockapi/config/parse', { method: 'POST', body: JSON.stringify({ source: YAML.stringify(config) }) });
    assert.equal(parsed.status, 200, parsed.body);
    assert.deepEqual(JSON.parse(parsed.body).config, config);
    assert.deepEqual(await read(get), before);
    for (const source of ['port: [invalid', 'null', '- list']) {
        assert.equal((await get('/__mockapi/config/parse', { method: 'POST', body: JSON.stringify({ source }) })).status, 400);
    }
    const protectedInstance = await serve(t, { admin: { token: 'protected' } });
    assert.equal((await protectedInstance.get('/__mockapi/config/parse', { method: 'POST', body: JSON.stringify({ config }) })).status, 401);
});

it('rejects cross-origin and rebinding requests to local configuration administration', async t => {
    const { get } = await serve(t, { admin: true, enableCors: true });
    for (const headers of [{ Origin: 'https://untrusted.example' }, { Host: 'untrusted.example' }]) {
        assert.equal((await get('/__mockapi/config', { headers })).status, 403);
        assert.equal((await save(get, { config: {} }, '/__mockapi', headers)).status, 403);
    }
    const response = await get('/__mockapi/config');
    assert.equal(response.status, 200);
    assert.equal(response.headers['access-control-allow-origin'], undefined);
});

it('creates, changes, and removes live endpoints through revision-checked configuration updates', async t => {
    const { get } = await serve(t, { admin: true, endpoints: { '/old': { verb: 'GET', response: 'old' } } });
    const initial = await read(get);
    assert.equal(initial.instance.endpointCount, 1);
    assert.equal(initial.instance.persistent, false);
    initial.config.endpoints['/users/:id'] = { post: { response: { id: '{{params.id}}', name: '{{body.name}}' }, responseStatus: 201, responseHeaders: { 'X-Mock': 'true' } } };
    const saved = await save(get, initial);
    assert.equal(saved.status, 200, saved.body);
    assert.notEqual(JSON.parse(saved.body).revision, initial.revision);
    const result = await get('/users/42', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"Alice"}' });
    assert.equal(result.status, 201);
    assert.equal(result.headers['x-mock'], 'true');
    assert.deepEqual(JSON.parse(result.body), { id: '42', name: 'Alice' });
    assert.ok(JSON.parse((await get('/openapi.json')).body).paths['/users/{id}']);
    const next = await read(get);
    delete next.config.endpoints['/old'];
    next.config.endpoints['/users/:id'].post.responseStatus = 202;
    assert.equal((await save(get, next)).status, 200);
    assert.equal((await get('/old')).status, 404);
    assert.equal((await get('/users/42', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 500);
    assert.equal((await get('/users/42', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"B"}' })).status, 202);
});

it('validates YAML without changing active config, history, or sequence positions', async t => {
    const { get } = await serve(t, { admin: true, endpoints: { '/job': { get: { sequence: [{ response: 'first' }, { response: 'last' }] } } } });
    const initial = await read(get);
    await get('/job');
    const source = YAML.stringify({ ...initial.config, endpoints: { '/new': { get: { response: true } } } });
    const validation = await get('/__mockapi/config/validate', { method: 'POST', body: JSON.stringify({ source }) });
    assert.equal(validation.status, 200, validation.body);
    assert.equal(JSON.parse(validation.body).valid, true);
    assert.equal((await read(get)).revision, initial.revision);
    assert.equal((await get('/new')).status, 404);
    assert.equal((await get('/job')).body, 'last');
    const saved = await save(get, { source, revision: initial.revision });
    assert.equal(saved.status, 200, saved.body);
    assert.equal((await get('/new')).body, 'true');
});

it('rejects invalid, conflicting, and restart-required changes without damaging the running instance', async t => {
    const { get } = await serve(t, { admin: true, endpoints: { '/keep': { get: { response: 'working' } } } });
    const initial = await read(get);
    const changes = [
        { ...initial.config, port: 8009 },
        { ...initial.config, host: '0.0.0.0' },
        { ...initial.config, admin: false },
        { ...initial.config, admin: { path: '/other' } },
        { ...initial.config, admin: { token: 'cannot-set-here' } },
        { ...initial.config, endpoints: { '/bad': { get: { responseStatus: 100 } } } },
        { ...initial.config, customHandlers: { missing: 'no-such-module' } }
    ];
    for (const config of changes) {
        const response = await save(get, { config, revision: initial.revision });
        assert.equal(response.status, 400, response.body);
        assert.equal((await read(get)).revision, initial.revision);
        assert.equal((await get('/keep')).body, 'working');
    }
    for (const body of ['not json', 'null', '[]', '{}', '{"source":42}', '{"source":"port: ["}', '{"config":{},"source":"port: 0"}']) {
        const response = await get('/__mockapi/config/validate', { method: 'POST', body });
        assert.equal(response.status, 400, body + ': ' + response.body);
    }
    assert.equal((await save(get, { config: initial.config })).status, 409);
});

it('serializes simultaneous saves and rejects stale revisions from other clients', async t => {
    const { get } = await serve(t, { admin: true });
    const initial = await read(get);
    const responses = await Promise.all(['one', 'two'].map(value => save(get, { revision: initial.revision, config: { ...initial.config, endpoints: { '/value': { get: { response: value } } } } })));
    assert.deepEqual(responses.map(result => result.status).sort(), [200, 409]);
    assert.ok(['one', 'two'].includes((await get('/value')).body));
    assert.equal((await save(get, initial)).status, 409);
});

it('redacts tokens in snapshots and exports, and preserves them when saving', async t => {
    const headers = { Authorization: 'Bearer test-secret' };
    const { get } = await serve(t, { admin: { token: 'test-secret', path: '/control' } });
    const initial = await read(get, '/control', headers);
    assert.equal(initial.config.admin.token, undefined);
    assert.equal(initial.instance.tokenRequired, true);
    const exported = await get('/control/config/export', { headers });
    assert.equal(exported.status, 200);
    assert.doesNotMatch(exported.body, /test-secret/);
    assert.equal(YAML.parse(exported.body).admin.path, '/control');
    const result = await save(get, initial, '/control', headers);
    assert.equal(result.status, 200, result.body);
    assert.doesNotMatch(result.body, /test-secret/);
    assert.equal((await get('/control/config')).status, 401);
    assert.equal((await get('/control/config', { headers })).status, 200);
});

it('persists atomic YAML updates with relative paths, comments, and credentials intact', async t => {
    const dir = temporary(t);
    fs.writeFileSync(path.join(dir, 'fixture.txt'), 'fixture');
    const configPath = path.join(dir, '.mockapi-config');
    const contents = '# My API configuration\nport: 0\nadmin:\n  token: test-secret\n# Keep this data source\ndata:\n  source:\n    path: ./fixture.txt # relative to this config\n    reader: text\nendpoints:\n  /legacy:\n    verb: get\n    data: source\n';
    fs.writeFileSync(configPath, contents);
    const headers = { Authorization: 'Bearer test-secret' };
    const { get, core } = await serve(t, YAML.parse(contents), undefined, dir, { configPath, contents });
    const initial = await read(get, '/__mockapi', headers);
    initial.config.endpoints['/new'] = { get: { response: 'saved' } };
    const saved = await save(get, initial, '/__mockapi', headers);
    assert.equal(saved.status, 200, saved.body);
    const text = fs.readFileSync(configPath, 'utf8');
    assert.match(text, /# My API configuration/);
    assert.match(text, /# Keep this data source/);
    assert.match(text, /# relative to this config/);
    assert.equal(YAML.parse(text).data.source.path, './fixture.txt');
    assert.equal(YAML.parse(text).admin.token, 'test-secret');
    assert.equal((await get('/legacy')).body, 'fixture');
    const revision = (await read(get, '/__mockapi', headers)).revision;
    await core.management.reloadFile();
    assert.equal((await read(get, '/__mockapi', headers)).revision, revision, 'watcher must not reapply our own save');
    assert.deepEqual(fs.readdirSync(dir).sort(), ['.mockapi-config', 'fixture.txt']);
    const restarted = await serve(t, YAML.parse(text), undefined, dir);
    assert.equal((await restarted.get('/new')).body, 'saved');
});

it('protects external file edits before the watcher runs and reports invalid reloads', async t => {
    const dir = temporary(t);
    const configPath = path.join(dir, 'config.yaml');
    const config = { port: 0, admin: true, endpoints: { '/value': { get: { response: 'old' } } } };
    const contents = YAML.stringify(config);
    fs.writeFileSync(configPath, contents);
    const { get, core } = await serve(t, config, undefined, dir, { configPath, contents });
    const initial = await read(get);
    const external = YAML.stringify({ ...config, endpoints: { '/value': { get: { response: 'external' } } } });
    fs.writeFileSync(configPath, external);
    assert.equal((await save(get, initial)).status, 409);
    assert.equal(fs.readFileSync(configPath, 'utf8'), external);
    await core.management.reloadFile();
    assert.equal((await get('/value')).body, 'external');
    assert.equal((await save(get, initial)).status, 409);
    fs.writeFileSync(configPath, 'port: [invalid');
    await assert.rejects(core.management.reloadFile());
    assert.ok((await read(get)).instance.reloadError);
    assert.equal((await get('/value')).body, 'external');
});

it('leaves file and runtime unchanged when a configuration write fails', async t => {
    const dir = temporary(t);
    const configPath = path.join(dir, 'config.yaml');
    const config = { port: 0, admin: true, endpoints: { '/value': { get: { response: 'original' } } } };
    const contents = YAML.stringify(config);
    fs.writeFileSync(configPath, contents);
    const { get } = await serve(t, config, undefined, dir, { configPath, contents });
    const initial = await read(get);
    initial.config.endpoints['/value'].get.response = 'changed';
    t.mock.method(fs.promises, 'rename', async () => { throw Object.assign(new Error('Read-only filesystem'), { code: 'EROFS' }); });
    const result = await save(get, initial);
    assert.equal(result.status, 500);
    assert.equal((await get('/value')).body, 'original');
    assert.equal(fs.readFileSync(configPath, 'utf8'), contents);
    assert.equal((await read(get)).revision, initial.revision);
    assert.deepEqual(fs.readdirSync(dir), ['config.yaml']);
});

it('clears request history without resetting sequences; reset preserves source paths and revision', async t => {
    const { get } = await serve(t, { admin: true, endpoints: { '/job': { get: { sequence: [{ response: 'first' }, { response: 'last' }] } } } });
    const initial = await read(get);
    await get('/job');
    assert.equal((await get('/__mockapi/requests', { method: 'DELETE' })).status, 200);
    assert.deepEqual(JSON.parse((await get('/__mockapi/requests')).body).requests, []);
    assert.equal((await get('/job')).body, 'last');
    await get('/__mockapi/reset', { method: 'POST' });
    assert.equal((await get('/job')).body, 'first');
    assert.deepEqual(await read(get), initial);
});

it('keeps configuration administration usable with small mock request body limits', async t => {
    const { get } = await serve(t, { admin: true, maxBodyBytes: 8, endpoints: { '/small': { post: { response: 'ok' } } } });
    const initial = await read(get);
    initial.config.endpoints['/new'] = { get: { response: null } };
    const saved = await save(get, initial);
    assert.equal(saved.status, 200, saved.body);
    assert.equal((await get('/new')).body, 'null');
    assert.equal((await get('/small', { method: 'POST', body: '0123456789' })).status, 413);
});

it('preserves the meaning of YAML aliases when only the anchored endpoint changes', async t => {
    const dir = temporary(t);
    const configPath = path.join(dir, 'config.yaml');
    const contents = 'port: 0\nadmin: true\nendpoints:\n  /one:\n    get: &shared\n      response: original\n  /two:\n    get: *shared\n';
    fs.writeFileSync(configPath, contents);
    const { get } = await serve(t, YAML.parse(contents), undefined, dir, { configPath, contents });
    const initial = await read(get);
    initial.config.endpoints['/one'].get.response = 'changed';
    const saved = await save(get, initial);
    assert.equal(saved.status, 200, saved.body);
    assert.equal((await get('/one')).body, 'changed');
    assert.equal((await get('/two')).body, 'original');
    const persisted = YAML.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(persisted.endpoints['/one'].get.response, 'changed');
    assert.equal(persisted.endpoints['/two'].get.response, 'original');
});
