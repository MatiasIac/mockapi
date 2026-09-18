const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const Core = require('../modules/core');

const logger = () => ({ info() {}, error() {}, debug() {}, message() {}, detail() {} });
const cleanups = new Map();
function beforeRemoval(dir, cleanup) { cleanups.get(dir).push(cleanup); }
function temporary(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockapi-tests-'));
    cleanups.set(dir, []);
    t.after(async () => {
        for (const cleanup of cleanups.get(dir).reverse()) await cleanup();
        cleanups.delete(dir);
        const resolved = path.resolve(dir);
        if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('mockapi-tests-')) throw new Error('Unsafe temporary directory');
        fs.rmSync(resolved, { recursive: true, force: true });
    });
    return dir;
}
function request(port, url = '/', { method = 'GET', headers = {}, body, secure = false } = {}) {
    return new Promise((resolve, reject) => {
        const client = secure ? https : http;
        const req = client.request({ hostname: '127.0.0.1', port, path: url, method, headers, ...(secure ? { rejectUnauthorized: false } : {}) }, res => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('error', reject);
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                resolve({ status: res.statusCode, headers: res.headers, body: buffer.toString(), buffer });
            });
        });
        req.setTimeout(5000, () => req.destroy(new Error('Test request timed out')));
        req.on('error', reject);
        req.end(body);
    });
}
async function serve(t, config = {}, proxy, basePath, managementOptions) {
    const core = new Core(logger(), { port: 0, ...config }, proxy, basePath, managementOptions);
    const server = core.run();
    t.after(() => new Promise(resolve => core.stop(resolve)));
    await once(server, 'listening');
    const port = server.address().port;
    return { core, port, get: (url, options) => request(port, url, options) };
}

module.exports = { logger, temporary, beforeRemoval, request, serve };
