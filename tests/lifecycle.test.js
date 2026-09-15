const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const YAML = require('yaml');
const ModuleProxy = require('../modules/moduleProxy');
const ConfigWatcher = require('../modules/configWatcher');
const { logger, temporary, beforeRemoval, serve, request } = require('./helpers');

const main = path.resolve(__dirname, '../main.js');
function cli(dir, args, input = '') {
    return spawnSync(process.execPath, [main, ...args], { cwd: dir, input, encoding: 'utf8', timeout: 10000 });
}
async function running(t, dir, args = []) {
    const child = spawn(process.execPath, [main, ...args], { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
    beforeRemoval(dir, async () => {
        if (child.exitCode === null && child.signalCode === null) {
            const exited = once(child, 'exit');
            child.kill();
            await exited;
        }
    });
    let output = '';
    child.stdout.on('data', data => output += data);
    child.stderr.on('data', data => output += data);
    const deadline = Date.now() + 10000;
    while (!output.includes('MockAPI listening on')) {
        if (child.exitCode !== null || child.signalCode !== null || Date.now() > deadline) throw new Error('Server did not start: ' + output);
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    return { child, port: Number(output.match(/listening on https?:\/\/localhost:(\d+)/)[1]), output: () => output };
}
async function eventually(check) {
    const deadline = Date.now() + 5000;
    while (!await check()) {
        if (Date.now() > deadline) throw new Error('Timed out waiting for configuration reload');
        await new Promise(resolve => setTimeout(resolve, 30));
    }
}

it('initializes a working API and validates it through the real CLI', async t => {
    const dir = temporary(t);
    const initialized = cli(dir, ['init', '--yes', '--port', '8123']);
    assert.equal(initialized.status, 0, initialized.stderr);
    const config = YAML.parse(fs.readFileSync(path.join(dir, '.mockapi-config'), 'utf8'));
    assert.equal(config.port, 8123);
    assert.equal(typeof config.port, 'number');
    assert.equal(cli(dir, ['validate']).status, 0);
    config.port = 0;
    fs.writeFileSync(path.join(dir, '.mockapi-config'), YAML.stringify(config));
    const server = await running(t, dir);
    const response = await request(server.port, '/data');
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { message: 'MockAPI is ready' });
});

it('protects existing configs and validates init arguments', t => {
    const dir = temporary(t);
    assert.equal(cli(dir, ['init', '--yes']).status, 0);
    const filename = path.join(dir, '.mockapi-config');
    const original = fs.readFileSync(filename, 'utf8');
    assert.equal(cli(dir, ['init', '--yes']).status, 1);
    assert.equal(fs.readFileSync(filename, 'utf8'), original);
    assert.equal(cli(dir, ['init', '--yes', '--force', '--port', '9999']).status, 0);
    assert.equal(YAML.parse(fs.readFileSync(filename, 'utf8')).port, 9999);
    for (const port of ['abc', '0', '65536', '1.5']) assert.equal(cli(dir, ['init', '--yes', '--force', '--port', port]).status, 1);
    assert.equal(cli(dir, ['--unknown']).status, 1);
    assert.equal(cli(dir, ['--config']).status, 1);
    assert.equal(cli(dir, ['--force']).status, 1);
    assert.equal(cli(dir, ['--help']).status, 0);
    assert.equal(cli(dir, ['--version']).stdout.trim(), require('../package.json').version);
});

it('supports piped interactive init, numeric ports, and omitting the sample endpoint', t => {
    const dir = temporary(t);
    const result = cli(dir, ['--init'], '8765\nn\nn\n');
    assert.equal(result.status, 0, result.stderr);
    const config = YAML.parse(fs.readFileSync(path.join(dir, '.mockapi-config'), 'utf8'));
    assert.equal(config.port, 8765);
    assert.equal(config.enableCors, false);
    assert.deepEqual(config.endpoints, {});
    assert.equal(cli(dir, ['validate']).status, 0);
});

it('reports missing, malformed, and semantically invalid config files with nonzero exit codes', t => {
    const dir = temporary(t);
    assert.equal(cli(dir, ['validate']).status, 1);
    for (const value of ['port: [', 'port: 0\nendpoints:\n  /a:\n    get:\n      data: absent\n']) {
        fs.writeFileSync(path.join(dir, '.mockapi-config'), value);
        const result = cli(dir, ['validate']);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /MockAPI:/);
    }
});

it('loads data relative to an explicit config file and waits for real async ESM handlers at startup', async t => {
    const dir = temporary(t);
    const nested = path.join(dir, 'nested');
    fs.mkdirSync(nested);
    fs.writeFileSync(path.join(nested, 'sample.txt'), 'fixture');
    fs.writeFileSync(path.join(nested, 'handler.mjs'), "await new Promise(resolve => setTimeout(resolve, 75)); export async function process(request, data) { return { data, header: request.headers['x-value'], id: request.params.id }; }");
    const config = { port: 0, log: 'none', externalModulesPath: '.', customHandlers: { handler: 'handler.mjs' }, data: { text: { path: 'sample.txt', reader: 'text' } }, endpoints: { '/first/:id': { get: { handler: 'handler', data: 'text' } } } };
    fs.writeFileSync(path.join(nested, 'mock.yaml'), YAML.stringify(config));
    assert.equal(cli(dir, ['validate', '--config', 'nested/mock.yaml']).status, 0);
    const server = await running(t, dir, ['--config', 'nested/mock.yaml']);
    assert.deepEqual(JSON.parse((await request(server.port, '/first/42', { headers: { 'X-Value': 'present' } })).body), { data: 'fixture', header: 'present', id: '42' });
});

it('validates handler exports and missing modules before starting the server', t => {
    const dir = temporary(t);
    const config = { port: 0, externalModulesPath: '.', customHandlers: { handler: 'bad' }, endpoints: { '/a': { get: { handler: 'handler' } } } };
    fs.writeFileSync(path.join(dir, '.mockapi-config'), YAML.stringify(config));
    assert.match(cli(dir, ['validate']).stderr, /customHandlers.handler/);
    fs.writeFileSync(path.join(dir, 'bad.js'), 'module.exports = { other() {} };');
    const result = cli(dir, []);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /process function/);
    assert.doesNotMatch(result.stdout, /listening/);
});

it('loads CommonJS handlers, awaits successful results, and catches async rejection', async t => {
    const dir = temporary(t);
    fs.writeFileSync(path.join(dir, 'good.js'), 'module.exports.process = async request => ({ name: request.json.name });');
    fs.writeFileSync(path.join(dir, 'bad.js'), 'module.exports.process = async () => { await Promise.resolve(); throw new Error("rejected handler"); };');
    const proxy = new ModuleProxy(dir, logger());
    await proxy.load({ good: 'good', bad: 'bad' });
    const { get } = await serve(t, { customHandlers: { good: 'good', bad: 'bad' }, endpoints: { '/good': { post: { handler: 'good' } }, '/bad': { get: { handler: 'bad' } } } }, proxy);
    assert.deepEqual(JSON.parse((await get('/good', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"Alice"}' })).body), { name: 'Alice' });
    assert.equal((await get('/bad')).status, 500);
    assert.match((await get('/bad')).body, /rejected handler/);
    await assert.rejects(proxy.execute('absent', {}, ''), /does not exist/);
    await assert.rejects(proxy.load({ missing: 'missing' }), /customHandlers.missing/);
    assert.deepEqual(await proxy.execute('good', { json: { name: 'Still loaded' } }), { name: 'Still loaded' });
});

it('watches actual file changes, atomic replacements, invalid saves, and handler changes', async t => {
    const dir = temporary(t);
    const filename = path.join(dir, '.mockapi-config');
    fs.writeFileSync(path.join(dir, 'handler.js'), 'module.exports.process = () => "first";');
    const config = { port: 0, log: 'none', externalModulesPath: '.', customHandlers: { handler: 'handler' }, endpoints: { '/value': { get: { handler: 'handler' } } } };
    fs.writeFileSync(filename, YAML.stringify(config));
    const server = await running(t, dir);
    assert.equal((await request(server.port, '/value')).body, 'first');
    fs.writeFileSync(path.join(dir, 'handler.js'), 'module.exports.process = () => "second";');
    const replacement = path.join(dir, 'next-config');
    fs.writeFileSync(replacement, YAML.stringify(config));
    fs.renameSync(replacement, filename);
    await eventually(async () => (await request(server.port, '/value')).body === 'second');
    fs.writeFileSync(filename, 'port: [invalid');
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal((await request(server.port, '/value')).body, 'second');
    const changed = { ...config, endpoints: { '/value': { get: { response: 'third' } } } };
    fs.writeFileSync(filename, YAML.stringify(changed));
    await eventually(async () => (await request(server.port, '/value')).body === 'third');
});

it('reloads configuration through a Windows short directory path', { skip: process.platform !== 'win32' }, async t => {
    const dir = temporary(t);
    const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'for %I in ("%MOCKAPI_TEST_DIR%") do @echo %~sI'], {
        env: { ...process.env, MOCKAPI_TEST_DIR: dir }, encoding: 'utf8', timeout: 5000, windowsVerbatimArguments: true
    });
    assert.equal(result.status, 0, result.stderr);
    const shortDir = result.stdout.trim();
    assert.equal(fs.realpathSync.native(shortDir), fs.realpathSync.native(dir));
    if (!shortDir.includes('~')) { t.skip('Temporary volume does not provide Windows short names'); return; }
    const filename = path.join(dir, '.mockapi-config');
    const config = value => YAML.stringify({ port: 0, log: 'none', endpoints: { '/value': { get: { response: value } } } });
    fs.writeFileSync(filename, config('first'));
    const server = await running(t, dir, ['--config', path.join(shortDir, '.mockapi-config')]);
    assert.equal((await request(server.port, '/value')).body, 'first');
    fs.writeFileSync(filename, config('second'));
    await eventually(async () => (await request(server.port, '/value')).body === 'second');
    const replacement = path.join(dir, 'next-config');
    fs.writeFileSync(replacement, config('third'));
    fs.renameSync(replacement, filename);
    await eventually(async () => (await request(server.port, '/value')).body === 'third');
});

it('serializes watcher callbacks, catches callback rejection, and stops watching', async t => {
    const dir = temporary(t);
    const filename = path.join(dir, 'config.yaml');
    fs.writeFileSync(filename, 'port: 0');
    let active = 0, maximum = 0, calls = 0;
    const errors = [];
    const watcher = new ConfigWatcher(filename, { ...logger(), error: message => errors.push(message) }, async () => {
        active++; maximum = Math.max(maximum, active); calls++;
        await new Promise(resolve => setTimeout(resolve, 150));
        active--;
        throw new Error('callback failure');
    });
    watcher.watch();
    t.after(() => watcher.stop());
    fs.writeFileSync(filename, 'port: 1');
    await eventually(() => calls === 1);
    fs.writeFileSync(filename, 'port: 2');
    await eventually(() => calls === 2 && active === 0);
    assert.equal(maximum, 1);
    assert.equal(errors.length, 2);
    await watcher.stop();
    fs.writeFileSync(filename, 'port: 3');
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(calls, 2);
});

it('serves HTTPS using valid certificates', async t => {
    const { port } = await serve(t, { tls: { cert: path.join(__dirname, 'fixtures/tls/cert.pem'), key: path.join(__dirname, 'fixtures/tls/key.pem') }, endpoints: { '/secure': { get: { response: { secure: true } } } } });
    const response = await request(port, '/secure', { secure: true });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { secure: true });
});

it('prints a clear startup failure when the port is already occupied', async t => {
    const { port } = await serve(t, { endpoints: {} });
    const dir = temporary(t);
    fs.writeFileSync(path.join(dir, '.mockapi-config'), YAML.stringify({ port, log: 'none' }));
    const result = cli(dir, []);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /EADDRINUSE/);
    assert.doesNotMatch(result.stdout, /listening on/);
});
