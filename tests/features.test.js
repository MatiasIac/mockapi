const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { serve, temporary } = require('./helpers');

it('routes dotted paths, decoded parameters, and literal paths independently of declaration order', async t => {
    const { get } = await serve(t, { endpoints: {
        '/users/:id': { get: { response: { id: '{{params.id}}' } } },
        '/users/me': { get: { response: 'literal' } },
        '/v1.0/status': { get: { response: 'version' } },
        '/report.json': { get: { response: 'report' } }
    } });
    assert.equal((await get('/users/me')).body, 'literal');
    assert.deepEqual(JSON.parse((await get('/users/jane.doe')).body), { id: 'jane.doe' });
    assert.deepEqual(JSON.parse((await get('/users/Jane%20Doe')).body), { id: 'Jane Doe' });
    assert.deepEqual(JSON.parse((await get('/users/a%2Fb')).body), { id: 'a/b' });
    assert.equal((await get('/v1.0/status')).body, 'version');
    assert.equal((await get('/report.json')).body, 'report');
    assert.equal((await get('/users/%ZZ')).status, 400);
});

it('supports per-method responses, legacy endpoints, custom headers, and specific methods before any', async t => {
    const { get } = await serve(t, { endpoints: {
        '/users': {
            any: { response: 'fallback' },
            GET: { response: [] },
            post: { responseStatus: 201, response: { id: 42 }, responseHeaders: { Location: '/users/42', 'Retry-After': 3 } }
        },
        '/legacy': { verb: 'GET', response: 'legacy' }
    } });
    assert.deepEqual(JSON.parse((await get('/users')).body), []);
    const created = await get('/users', { method: 'POST' });
    assert.equal(created.status, 201);
    assert.equal(created.headers.location, '/users/42');
    assert.equal(created.headers['retry-after'], '3');
    assert.equal(created.headers['content-type'], 'application/json');
    assert.equal((await get('/users', { method: 'DELETE' })).body, 'fallback');
    assert.equal((await get('/legacy')).body, 'legacy');
});

it('renders nested JSON with preserved types, repeated query values, and request metadata', async t => {
    const { get } = await serve(t, { endpoints: { '/orders/:id': { post: {
        response: { id: '{{params.id}}', total: '{{body.total}}', enabled: '{{body.enabled}}', items: '{{body.items}}', tags: '{{query.tag}}', message: 'Hello {{body.name}}', method: '{{method}}' },
        responseHeaders: { 'X-Request-Id': '{{headers.x-request-id}}' }
    } } } });
    const response = await get('/orders/42?tag=a&tag=b', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'abc' }, body: JSON.stringify({ name: 'Alice', total: 12.5, enabled: false, items: [1, 2] }) });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { id: '42', total: 12.5, enabled: false, items: [1, 2], tags: ['a', 'b'], message: 'Hello Alice', method: 'post' });
    assert.equal(response.headers['x-request-id'], 'abc');
});

it('matches query, headers, and nested body fields with a default response', async t => {
    const { get } = await serve(t, { endpoints: { '/search': { post: {
        response: 'default', variants: [{ match: { query: { mode: 'special' }, headers: { 'X-Role': 'admin' }, body: { filter: { active: true } } }, response: 'matched', responseStatus: 202 }]
    } } } });
    const options = { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Role': 'admin' }, body: '{"filter":{"active":true,"extra":1}}' };
    assert.equal((await get('/search?mode=special', options)).status, 202);
    assert.equal((await get('/search?mode=ordinary', options)).body, 'default');
    assert.equal((await get('/search?mode=special', { ...options, body: '{"filter":{"active":false}}' })).body, 'default');
});

it('supports endpoint-level request conditions', async t => {
    const { get } = await serve(t, { endpoints: { '/private': { get: { match: { headers: { authorization: 'Bearer example' } }, response: 'allowed' } } } });
    assert.equal((await get('/private')).status, 404);
    assert.equal((await get('/private', { headers: { authorization: 'Bearer example' } })).body, 'allowed');
});

it('reserves sequence steps in arrival order and holds the last response', async t => {
    const { get } = await serve(t, { admin: true, endpoints: { '/job': { get: { sequence: [
        { responseStatus: 503, response: { step: '{{scenario.index}}' }, delay: 50 },
        { responseStatus: 503, response: { step: '{{scenario.index}}' } },
        { response: { step: '{{scenario.index}}', ready: true } }
    ] } } } });
    const responses = await Promise.all([get('/job'), get('/job'), get('/job')]);
    assert.deepEqual(responses.map(item => item.status), [503, 503, 200]);
    assert.deepEqual(responses.map(item => JSON.parse(item.body).step), [0, 1, 2]);
    assert.equal((await get('/job')).status, 200);
    assert.equal((await get('/__mockapi/reset', { method: 'POST' })).status, 200);
    assert.equal((await get('/job')).status, 503);
});

it('cycles sequences independently for each route and method', async t => {
    const definition = { sequenceMode: 'cycle', sequence: [{ response: 'first' }, { response: 'second' }] };
    const { get } = await serve(t, { endpoints: { '/cycle': { get: definition, post: definition } } });
    assert.equal((await get('/cycle')).body, 'first');
    assert.equal((await get('/cycle')).body, 'second');
    assert.equal((await get('/cycle', { method: 'POST' })).body, 'first');
    assert.equal((await get('/cycle')).body, 'first');
});

it('captures bounded request history and asserts actual payloads', async t => {
    const { core, get } = await serve(t, { admin: { historyLimit: 2 }, endpoints: { '/items/:id': { post: { responseStatus: 201, response: 'ok' } } } });
    for (const id of [1, 2, 3]) await get(`/items/${id}?page=1`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    const history = JSON.parse((await get('/__mockapi/requests?method=post')).body).requests;
    assert.equal(history.length, 2);
    assert.equal(history[0].path, '/items/2');
    assert.equal(history[1].status, 201);
    assert.deepEqual(history[1].body, { id: 3 });
    assert.equal(history[1].params.id, '3');
    const check = match => get('/__mockapi/assert', { method: 'POST', body: JSON.stringify(match) });
    assert.equal((await check({ match: { method: 'POST', body: { id: 3 } }, count: 1 })).status, 200);
    assert.equal((await check({ match: { path: '/missing' }, min: 1 })).status, 409);
    assert.equal((await check({ count: -1 })).status, 400);
    assert.equal((await check({ count: 1, min: 0 })).status, 400);
    assert.equal((await check({ min: 4, max: 2 })).status, 400);
    assert.equal((await check({ match: { unknown: true } })).status, 400);
    assert.equal((await get('/__mockapi/assert', { method: 'POST', body: 'invalid' })).status, 400);
    const copy = core.getRequests();
    copy[0].body.id = 999;
    assert.equal(core.getRequests()[0].body.id, 2);
    await get('/__mockapi/reset', { method: 'POST' });
    assert.deepEqual(core.getRequests(), []);
});

it('records body truncation and leaves administration disabled by default', async t => {
    const enabled = await serve(t, { admin: { bodyLimit: 3 }, endpoints: { '/a': { post: { response: 'ok' } } } });
    await enabled.get('/a', { method: 'POST', body: 'abcdef' });
    assert.equal(enabled.core.getRequests()[0].body, 'abc');
    assert.equal(enabled.core.getRequests()[0].bodyTruncated, true);
    const disabled = await serve(t, { endpoints: {} });
    assert.equal((await disabled.get('/__mockapi/requests')).status, 404);
    assert.deepEqual(disabled.core.getRequests(), []);
});

it('protects custom admin paths using bearer tokens and blocks cross-origin local access', async t => {
    const token = await serve(t, { admin: { path: '/control', token: 'test-token' }, endpoints: {} });
    assert.equal((await token.get('/control/requests')).status, 401);
    assert.equal((await token.get('/control/requests', { headers: { Authorization: 'Bearer test-token' } })).status, 200);
    assert.equal((await token.get('/__mockapi/requests')).status, 404);
    const local = await serve(t, { admin: true, endpoints: {} });
    assert.equal((await local.get('/__mockapi/reset', { method: 'POST', headers: { Origin: 'https://example.org' } })).status, 403);
});

it('rejects malformed JSON, oversized content-length and chunked bodies while staying healthy', async t => {
    const { get, port } = await serve(t, { maxBodyBytes: 8, endpoints: { '/body': { post: { response: 'ok' } } } });
    assert.equal((await get('/body', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad}' })).status, 400);
    assert.equal((await get('/body', { method: 'POST', body: '123456789' })).status, 413);
    const chunked = await new Promise((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port, path: '/body', method: 'POST' }, res => {
            res.resume(); res.on('end', () => resolve(res.statusCode));
        });
        req.on('error', reject); req.write('1234'); req.write('56789'); req.end();
    });
    assert.equal(chunked, 413);
    assert.equal((await get('/body', { method: 'POST', body: 'ok' })).status, 200);
});

it('times out incomplete request bodies', async t => {
    const { port, get } = await serve(t, { requestTimeout: 100, endpoints: { '/body': { post: { response: 'ok' } } } });
    const status = await new Promise((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port, path: '/body', method: 'POST', headers: { 'Content-Length': 100 } }, res => {
            res.resume(); res.on('end', () => { resolve(res.statusCode); req.destroy(); });
        });
        req.on('error', reject); req.write('one byte short');
    });
    assert.equal(status, 408);
    assert.equal((await get('/body', { method: 'POST' })).status, 200);
});

it('returns 500 for ordinary thrown errors, missing template fields, and unsafe rendered headers', async t => {
    const { get } = await serve(t, { customHandlers: { broken: 'stub' }, endpoints: {
        '/error': { get: { handler: 'broken' } },
        '/template': { get: { response: '{{query.absent}}' } },
        '/header': { get: { response: 'ok', responseHeaders: { 'X-Test': '{{query.value}}' } } },
        '/prototype': { get: { response: '{{body.constructor}}' } }
    } }, { execute() { throw new Error('Unexpected failure'); } });
    for (const url of ['/error', '/template', '/header?value=a%0D%0Ab', '/prototype']) assert.equal((await get(url)).status, 500);
    assert.match((await get('/error')).body, /Unexpected failure/);
});

it('rejects invalid reloads without changing endpoints, docs, or sequence state', async t => {
    const config = { port: 0, endpoints: { '/before': { get: { sequence: [{ response: 'first' }, { response: 'second' }] } } } };
    const { core, get } = await serve(t, config);
    assert.equal((await get('/before')).body, 'first');
    assert.throws(() => core.reload({ port: 0, endpoints: { '/after': { get: {} } }, data: { bad: { reader: 'csv', path: 'missing.csv' } } }), /data.bad.path/);
    assert.equal((await get('/before')).body, 'second');
    assert.equal((await get('/after')).status, 404);
    assert.ok(JSON.parse((await get('/openapi.json')).body).paths['/before']);
    assert.throws(() => core.reload({ ...config, port: 12345 }), /Restart required/);
    core.reload({ port: 0, endpoints: { '/after': { post: { response: 'new' } } } });
    assert.equal((await get('/before')).status, 404);
    assert.equal((await get('/after', { method: 'POST' })).body, 'new');
});

it('keeps delayed responses consistent across reload and reset', async t => {
    const { core, get } = await serve(t, { admin: true, endpoints: { '/pending': { get: { delay: 80, response: 'old' } } } });
    const pending = get('/pending');
    await new Promise(resolve => setTimeout(resolve, 30));
    core.reload({ port: 0, admin: true, endpoints: { '/pending': { get: { response: 'new' } } } });
    assert.equal((await pending).body, 'old');
    assert.deepEqual(core.getRequests(), []);
    assert.equal((await get('/pending')).body, 'new');
});

it('serves binary files, HEAD, encoded names, and legacy folder data; resets CSV position', async t => {
    const dir = temporary(t);
    fs.writeFileSync(path.join(dir, 'file.bin'), Buffer.from([0, 255, 128, 42]));
    fs.writeFileSync(path.join(dir, 'hello world.txt'), 'text');
    fs.writeFileSync(path.join(dir, 'sample.json'), '{"ok":true}');
    fs.writeFileSync(path.join(dir, 'data.csv'), 'id\n1\n2');
    const { core, get } = await serve(t, { staticPath: dir, data: {
        folder: { reader: 'folder', path: dir }, csv: { reader: 'csv', path: path.join(dir, 'data.csv'), properties: ['json', 'seq', 0] }
    }, endpoints: { '/files': { verb: 'get', data: 'folder' }, '/csv': { get: { data: 'csv' } } } });
    assert.deepEqual((await get('/file.bin')).buffer, Buffer.from([0, 255, 128, 42]));
    assert.equal((await get('/file.bin', { method: 'HEAD' })).body, '');
    assert.equal((await get('/file.bin', { method: 'POST' })).status, 404);
    assert.equal((await get('/hello%20world.txt')).body, 'text');
    assert.deepEqual(JSON.parse((await get('/files/sample.json')).body), { ok: true });
    assert.equal(JSON.parse((await get('/csv')).body).id, '1');
    assert.equal(JSON.parse((await get('/csv')).body).id, '2');
    core.reset();
    assert.equal(JSON.parse((await get('/csv')).body).id, '1');
    assert.equal((await get('/%2e%2e%2foutside.txt')).status, 403);
    assert.equal((await get('/missing.bin')).status, 404);
});

it('handles file-read failures without crashing the server', async t => {
    const dir = temporary(t);
    const filename = path.join(dir, 'data.txt');
    fs.writeFileSync(filename, 'working');
    const { get } = await serve(t, { data: { text: { reader: 'text', path: filename } }, endpoints: { '/file': { get: { data: 'text' } }, '/health': { get: { response: 'ok' } } } });
    fs.unlinkSync(filename);
    fs.mkdirSync(filename);
    assert.equal((await get('/file')).status, 500);
    assert.equal((await get('/health')).body, 'ok');
});

it('applies exact CORS origins, credentials, and requested preflight headers', async t => {
    const { get } = await serve(t, { enableCors: { origins: 'https://allowed.example', credentials: true }, endpoints: { '/ok': { get: { response: 'ok' } } } });
    const allowed = await get('/ok', { headers: { Origin: 'https://allowed.example' } });
    assert.equal(allowed.headers['access-control-allow-origin'], 'https://allowed.example');
    assert.equal(allowed.headers['access-control-allow-credentials'], 'true');
    assert.equal(allowed.headers.vary, 'Origin');
    assert.equal((await get('/ok', { headers: { Origin: 'https://allowed' } })).headers['access-control-allow-origin'], undefined);
    const preflight = await get('/ok', { method: 'OPTIONS', headers: { Origin: 'https://allowed.example', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'X-Custom' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers['access-control-allow-headers'], 'X-Custom');
});

it('suppresses response bodies for HEAD, 204, and 304', async t => {
    const { get } = await serve(t, { endpoints: {
        '/head': { head: { response: 'hidden' } }, '/empty': { get: { responseStatus: 204, response: 'hidden' } }, '/cached': { get: { responseStatus: 304, response: 'hidden' } }
    } });
    assert.equal((await get('/head', { method: 'HEAD' })).body, '');
    assert.equal((await get('/empty')).body, '');
    assert.equal((await get('/cached')).body, '');
});

it('serves explicit OPTIONS routes when the request is not a CORS preflight', async t => {
    const { get } = await serve(t, { enableCors: true, endpoints: { '/options': { options: { response: 'configured' } } } });
    assert.equal((await get('/options', { method: 'OPTIONS' })).body, 'configured');
});

it('blocks symlink escapes from static and folder roots', async t => {
    const dir = temporary(t);
    const root = path.join(dir, 'public');
    const outside = path.join(dir, 'public-extra');
    fs.mkdirSync(root); fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside');
    fs.symlinkSync(outside, path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    const { get } = await serve(t, { staticPath: root, endpoints: {} });
    assert.equal((await get('/link/secret.txt')).status, 403);
    assert.equal((await get('/%2e%2e%2fpublic-extra/secret.txt')).status, 403);
    const { folder_reader } = require('../modules/readers');
    const reader = folder_reader(root);
    assert.throws(() => reader({ hasFile: true, file: 'link/secret.txt' }), error => error.httpStatusCode === 403);
    assert.throws(() => reader({ hasFile: true, file: '../public-extra/secret.txt' }), error => error.httpStatusCode === 403);
});

it('handles a static stream failure and subsequent requests', async t => {
    const { Readable } = require('node:stream');
    const dir = temporary(t);
    const filename = path.join(dir, 'broken.txt');
    fs.writeFileSync(filename, 'data');
    // The server opens the canonical path, which can differ from Windows TEMP.
    const realFilename = await fs.promises.realpath(filename);
    let streamFailed = false;
    const original = fs.promises.open;
    t.mock.method(fs.promises, 'open', async function(file, ...args) {
        if (file === realFilename) return { createReadStream: () => new Readable({ read() {
            streamFailed = true;
            this.destroy(new Error('simulated disk failure'));
        } }) };
        return original.call(this, file, ...args);
    });
    const { get } = await serve(t, { staticPath: dir, endpoints: { '/health': { get: { response: 'ok' } } } });
    await assert.rejects(get('/broken.txt'));
    assert.equal(streamFailed, true, 'The mocked static stream must fail');
    assert.equal((await get('/health')).body, 'ok');
});
