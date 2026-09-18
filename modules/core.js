const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { timingSafeEqual, randomUUID } = require('node:crypto');
const parser = require('./urlParser');
const openApi = require('./openApi');
const HttpException = require('./HttpException');
const Management = require('./management');
const YAML = require('yaml');
const { prepareConfiguration, mergeResponse, restartRequired } = require('./configuration');
const { matches, render, assertion } = require('./requestTools');

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain',
    '.xml': 'application/xml', '.pdf': 'application/pdf', '.woff2': 'font/woff2'
};

class Core {
    constructor(logger, configurations, modulesProxy, basePath = process.cwd(), managementOptions) {
        this._logger = logger;
        this._basePath = basePath;
        this._connections = new Set();
        this._history = [];
        this._requestId = 0;
        this._historyGeneration = 0;
        this._state = this._prepare(configurations, modulesProxy);
        this.management = new Management(this, managementOptions);
    }

    _prepare(configurations, modulesProxy) {
        const prepared = prepareConfiguration(configurations, this._basePath);
        return { ...prepared, source: structuredClone(configurations), revision: randomUUID(), modulesProxy, spec: openApi.buildSpec(prepared.openApi, prepared.routes), sequences: new Map() };
    }

    run() {
        if (this._server) throw new Error('Server has already been started');
        this._startedAt = new Date().toISOString();
        const handler = (request, response) => {
            const state = this._state;
            this._handle(request, response, state).catch(error => this._error(response, error));
        };
        this._server = this._state.tls ? https.createServer(this._state.tls, handler) : http.createServer(handler);
        this._server.requestTimeout = this._state.config.requestTimeout;
        this._server.headersTimeout = Math.min(60000, this._state.config.requestTimeout);
        this._server.on('connection', socket => {
            this._connections.add(socket);
            socket.on('close', () => this._connections.delete(socket));
        });
        this._server.on('error', error => this._logger.error(`Server error: ${error.message}`));
        this._server.listen(this._state.config.port, this._state.config.host);
        return this._server;
    }

    _error(response, error) {
        this._logger.error(error.message || String(error));
        if (response.destroyed || response.writableEnded) return;
        if (response.headersSent) { response.destroy(); return; }
        const status = Number.isInteger(error.httpStatusCode) && error.httpStatusCode >= 400 && error.httpStatusCode <= 599 ? error.httpStatusCode : 500;
        for (const name of response.getHeaderNames()) {
            if (!name.startsWith('access-control-') && !['vary', 'connection'].includes(name)) response.removeHeader(name);
        }
        this._send(response, status, { error: error.message || 'Internal server error' });
    }

    _send(response, status, body, headers = {}, contentType) {
        if (response.destroyed || response.writableEnded) return;
        const json = body !== undefined && body !== null && typeof body === 'object' && !Buffer.isBuffer(body);
        const payload = body === undefined ? '' : Buffer.isBuffer(body) ? body : json || body === null || typeof body === 'boolean' || typeof body === 'number' ? JSON.stringify(body) : String(body);
        response.statusCode = status;
        response.setHeader('Content-Type', contentType || (json || body === null || typeof body === 'boolean' || typeof body === 'number' ? 'application/json' : 'text/plain'));
        for (const [name, value] of Object.entries(headers)) response.setHeader(name, String(value));
        response.end(status === 204 || status === 304 ? undefined : payload);
    }

    _cors(request, response, state) {
        const cors = state.config.enableCors;
        if (!cors) return;
        const options = cors === true ? {} : cors;
        const origins = options.origins ?? '*';
        const origin = request.headers.origin;
        const allowed = origins === '*' || (Array.isArray(origins) ? origins.includes(origin) : origins === origin);
        if (!allowed) return;
        if (origins !== '*' || options.credentials) response.setHeader('Vary', 'Origin');
        if (options.credentials && !origin) return;
        response.setHeader('Access-Control-Allow-Origin', origins === '*' && !options.credentials ? '*' : origin);
        const list = (value, fallback) => value === undefined || value === '*' ? fallback : Array.isArray(value) ? value.join(', ') : value;
        response.setHeader('Access-Control-Allow-Methods', list(options.methods, 'GET, HEAD, POST, PUT, DELETE, PATCH, OPTIONS'));
        response.setHeader('Access-Control-Allow-Headers', list(options.headers, request.headers['access-control-request-headers'] || 'Content-Type, Authorization, X-Requested-With'));
        if (options.credentials) response.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    _readBody(request, response, state) {
        return new Promise((resolve, reject) => {
            const chunks = [];
            let bytes = 0;
            let settled = false;
            const finish = (error, body) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (error) { chunks.length = 0; reject(error); }
                else resolve(body);
            };
            const timer = setTimeout(() => {
                if (!response.headersSent) response.setHeader('Connection', 'close');
                finish(new HttpException(408, 'Request body timed out'));
                request.resume();
            }, state.config.requestTimeout);
            timer.unref();
            request.on('data', chunk => {
                if (settled) return;
                bytes += chunk.length;
                if (bytes > state.config.maxBodyBytes) {
                    response.setHeader('Connection', 'close');
                    finish(new HttpException(413, `Request body exceeds ${state.config.maxBodyBytes} bytes`));
                    return;
                }
                chunks.push(chunk);
            });
            request.on('end', () => finish(null, Buffer.concat(chunks).toString('utf8')));
            request.on('error', error => finish(error));
            request.on('aborted', () => finish(new HttpException(400, 'Request aborted')));
            if (Number(request.headers['content-length']) > state.config.maxBodyBytes) {
                response.setHeader('Connection', 'close');
                finish(new HttpException(413, `Request body exceeds ${state.config.maxBodyBytes} bytes`));
                request.resume();
            }
        });
    }

    async _static(request, response, root, urlPath) {
        if (!['GET', 'HEAD'].includes(request.method)) return false;
        let decoded;
        try { decoded = decodeURIComponent(urlPath); } catch { throw new HttpException(400, 'Malformed URL encoding'); }
        if (decoded.includes('\0')) throw new HttpException(400, 'Invalid file path');
        const resolvedRoot = await fs.promises.realpath(root);
        const target = path.resolve(resolvedRoot, '.' + decoded.replace(/\\/g, '/'));
        const inside = file => {
            const relative = path.relative(resolvedRoot, file);
            return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
        };
        if (!inside(target)) throw new HttpException(403, 'Forbidden');
        let real;
        try {
            real = await fs.promises.realpath(target);
            if (!inside(real)) throw new HttpException(403, 'Forbidden');
            if (!(await fs.promises.stat(real)).isFile()) return false;
        } catch (error) {
            if (['ENOENT', 'ENOTDIR'].includes(error.code)) return false;
            throw error;
        }
        const file = await fs.promises.open(real, 'r');
        response.statusCode = 200;
        response.setHeader('Content-Type', MIME_TYPES[path.extname(real).toLowerCase()] || 'application/octet-stream');
        if (request.method === 'HEAD') { await file.close(); response.end(); return true; }
        await pipeline(file.createReadStream(), response);
        return true;
    }

    async _docs(request, response, state, pathname) {
        if (!state.openApi.enabled || !['GET', 'HEAD'].includes(request.method)) return false;
        if (pathname === state.openApi.specPath) { this._send(response, 200, state.spec); return true; }
        if (pathname === state.openApi.docsPath || pathname === state.openApi.docsPath + '/') {
            this._send(response, 200, openApi.buildDocsPage(state.openApi), {}, 'text/html; charset=utf-8');
            return true;
        }
        const assetPrefix = state.openApi.docsPath.replace(/\/$/, '') + '/assets/';
        if (pathname.startsWith(assetPrefix)) {
            const asset = pathname.slice(assetPrefix.length);
            if (!['swagger-ui.css', 'swagger-ui-bundle.js'].includes(asset)) throw new HttpException(404, 'Asset not found');
            return this._static(request, response, path.dirname(require.resolve('swagger-ui-dist/package.json')), '/' + asset);
        }
        return false;
    }

    _authorize(request, state) {
        if (state.admin.token) {
            const expected = Buffer.from('Bearer ' + state.admin.token);
            const supplied = Buffer.from(request.headers.authorization || '');
            if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new HttpException(401, 'Admin token required');
        } else {
            const address = request.socket.remoteAddress || '';
            if (!(address === '::1' || /^(::ffff:)?127\./.test(address))) throw new HttpException(403, 'Remote admin access requires a configured token');
            let hostname;
            try { hostname = new URL('http://' + request.headers.host).hostname; } catch { /* rejected below */ }
            if (!(hostname === 'localhost' || hostname === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(hostname))) throw new HttpException(403, 'Local admin access requires a localhost or loopback Host header');
        }
        if (request.headers.origin && !state.admin.token && request.headers.origin !== `${request.socket.encrypted ? 'https' : 'http'}://${request.headers.host}`) throw new HttpException(403, 'Cross-origin admin access requires a token');
    }

    async _admin(request, response, state, url) {
        if (!state.admin.enabled || !(url.pathname === state.admin.path || url.pathname.startsWith(state.admin.path + '/'))) return false;
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Referrer-Policy', 'no-referrer');
        const endpoint = url.pathname.slice(state.admin.path.length);
        if (['GET', 'HEAD'].includes(request.method)) {
            if (['', '/', '/ui'].includes(endpoint)) {
                this._send(response, 302, '', { Location: state.admin.path + '/ui/' });
                return true;
            }
            const assets = { '/ui/': 'index.html', '/ui/app.js': 'app.js', '/ui/styles.css': 'styles.css', '/ui/config-schema.js': 'config-schema.js', '/ui/config-visual.js': 'config-visual.js' };
            if (Object.hasOwn(assets, endpoint)) {
                response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
                return this._static(request, response, path.join(__dirname, '../web'), '/' + assets[endpoint]);
            }
        }
        this._authorize(request, state);
        if (endpoint === '/config' && request.method === 'GET') {
            this._send(response, 200, this.management.snapshot());
        } else if (endpoint === '/config/export' && request.method === 'GET') {
            this._send(response, 200, YAML.stringify(this.management.snapshot().config), { 'Content-Disposition': 'attachment; filename="mockapi-config.yaml"' }, 'application/yaml; charset=utf-8');
        } else if (['/config', '/config/validate', '/config/parse'].includes(endpoint) && request.method === (endpoint === '/config' ? 'PUT' : 'POST')) {
            const body = await this._readBody(request, response, { config: { maxBodyBytes: 5 * 1024 * 1024, requestTimeout: 30000 } });
            let input;
            try { input = JSON.parse(body); } catch { throw new HttpException(400, 'Configuration requires a JSON body'); }
            if (!input || typeof input !== 'object' || Array.isArray(input) || (Object.hasOwn(input, 'config') === Object.hasOwn(input, 'source')) || (Object.hasOwn(input, 'source') && typeof input.source !== 'string')) throw new HttpException(400, 'Provide either config (an object) or source (YAML or JSON text)');
            if (endpoint === '/config/parse') {
                let config;
                try { config = typeof input.source === 'string' ? YAML.parse(input.source) : input.config; }
                catch (error) { throw new HttpException(400, error.message); }
                if (!config || typeof config !== 'object' || Array.isArray(config)) throw new HttpException(400, 'Configuration must be an object');
                this._send(response, 200, { config });
            } else if (endpoint === '/config/validate') {
                const next = await this.management.prepare(input);
                const config = structuredClone(next.source);
                if (config.admin && typeof config.admin === 'object') delete config.admin.token;
                this._send(response, 200, { valid: true, config });
            } else this._send(response, 200, await this.management.save(input, () => this._authorize(request, this._state)));
        } else if (endpoint === '/requests' && request.method === 'GET') {
            const match = Object.fromEntries(url.searchParams);
            if (Object.keys(match).some(key => !['method', 'path'].includes(key))) throw new HttpException(400, 'Request filters support method and path');
            this._send(response, 200, { requests: this.getRequests(match), limit: state.admin.historyLimit });
        } else if (endpoint === '/requests' && request.method === 'DELETE') {
            await this._readBody(request, response, state);
            this._history = [];
            this._historyGeneration++;
            this._send(response, 200, { cleared: true });
        } else if (endpoint === '/assert' && request.method === 'POST') {
            const body = await this._readBody(request, response, state);
            let options;
            try { options = JSON.parse(body); } catch { throw new HttpException(400, 'Assertion requires a JSON body'); }
            const result = this.assertRequests(options);
            this._send(response, result.passed ? 200 : 409, result);
        } else if (endpoint === '/reset' && request.method === 'POST') {
            await this._readBody(request, response, state);
            this.reset();
            this._send(response, 200, { reset: true });
        } else throw new HttpException(404, 'Admin endpoint not found');
        return true;
    }

    async _handle(request, response, state) {
        let url;
        try { url = new URL(request.url, 'http://localhost'); decodeURIComponent(url.pathname); } catch { throw new HttpException(400, 'Malformed URL'); }
        if (await this._admin(request, response, state, url)) return;
        this._cors(request, response, state);
        if (request.method === 'OPTIONS' && state.config.enableCors && request.headers.origin && request.headers['access-control-request-method']) { this._send(response, 204); return; }
        if (await this._docs(request, response, state, url.pathname)) return;
        const started = Date.now();
        const generation = this._historyGeneration;
        const record = { id: ++this._requestId, timestamp: new Date(started).toISOString(), method: request.method, path: url.pathname, url: request.url, headers: { ...request.headers }, query: parser.query(url.searchParams), params: {}, body: '' };
        if (state.admin.enabled) response.once('finish', () => {
            if (generation !== this._historyGeneration) return;
            record.status = response.statusCode;
            record.duration = Date.now() - started;
            this._history.push(record);
            if (this._history.length > state.admin.historyLimit) this._history.splice(0, this._history.length - state.admin.historyLimit);
        });
        const rawBody = await this._readBody(request, response, state);
        let body = rawBody;
        if (rawBody && /(?:^|[+/])json(?:;|$)/i.test(request.headers['content-type'] || '')) {
            try { body = JSON.parse(rawBody); } catch { throw new HttpException(400, 'Invalid JSON request body'); }
        }
        record.bodyTruncated = Buffer.byteLength(rawBody) > state.admin.bodyLimit;
        record.body = record.bodyTruncated ? Buffer.from(rawBody).subarray(0, state.admin.bodyLimit).toString('utf8') : body;
        const context = { method: request.method.toLowerCase(), path: url.pathname, headers: request.headers, query: record.query, body, params: {} };
        const info = parser.parse(request.url);
        let selected;
        // The full URL wins. The legacy filename convention is limited to folder data sources.
        for (const legacyFolder of [false, true]) {
            for (const route of state.routes) {
                if (route.method !== 'any' && route.method !== context.method) continue;
                if (legacyFolder && state.data[route.definition.data]?.reader !== 'folder') continue;
                const result = parser.matchPath(route.path, legacyFolder ? info.base : url.pathname);
                if (!result.match) continue;
                context.params = result.params;
                if (!matches(route.definition.match, context)) continue;
                selected = route;
                break;
            }
            if (selected) break;
        }
        if (!selected) {
            if (state.config.staticPath && await this._static(request, response, state.config.staticPath, url.pathname)) return;
            this._send(response, 404, { error: 'No matching endpoint' });
            return;
        }
        record.params = context.params;
        let definition = selected.definition;
        if (definition.variants) {
            const variant = definition.variants.find(item => matches(item.match, context));
            if (variant) {
                const { match, ...override } = variant;
                definition = mergeResponse(definition, override);
            }
        }
        if (definition.sequence) {
            const counter = state.sequences.get(selected.key) || 0;
            const index = definition.sequenceMode === 'cycle' ? counter % definition.sequence.length : Math.min(counter, definition.sequence.length - 1);
            state.sequences.set(selected.key, definition.sequenceMode === 'cycle' ? (index + 1) % definition.sequence.length : Math.min(counter + 1, definition.sequence.length - 1));
            context.scenario = { index };
            definition = mergeResponse(definition, definition.sequence[index]);
        }
        let payload;
        if (Object.hasOwn(definition, 'response')) payload = render(definition.response, context);
        else if (definition.data !== undefined) payload = state.data[definition.data].dataHandler({ ...info, params: context.params, query: context.query });
        else payload = '';
        if (definition.handler !== undefined) {
            if (!state.modulesProxy) throw new HttpException(500, 'Custom handlers have not been loaded');
            payload = await state.modulesProxy.execute(definition.handler, { method: context.method, url: selected.path, path: context.path, body: rawBody, json: typeof body === 'object' ? body : undefined, headers: context.headers, params: context.params, query: context.query }, typeof payload === 'object' ? JSON.stringify(payload) : payload);
        }
        const headers = render(definition.responseHeaders || {}, context);
        if (response.destroyed || response.writableEnded) return;
        if (definition.delay) await new Promise(resolve => {
            const done = () => { clearTimeout(timer); response.off('close', done); resolve(); };
            const timer = setTimeout(done, definition.delay);
            response.once('close', done);
        });
        this._logger.info(`${request.method} ${url.pathname} -> ${definition.responseStatus || 200}`);
        this._send(response, definition.responseStatus || 200, payload, headers, definition.responseContentType);
    }

    reload(configurations, modulesProxy = this._state.modulesProxy) {
        const next = this._prepare(configurations, modulesProxy);
        const changes = restartRequired(this._state.config, next.config);
        if (this._server && changes.length) throw new Error(`Restart required to change ${changes.join(', ')}`);
        this._apply(next);
    }

    _apply(next) {
        this._state = next;
        this._logger._logLevel = next.config.log || 'verbose';
        this._history = [];
        this._historyGeneration++;
        if (this._server) {
            this._server.requestTimeout = next.config.requestTimeout;
            this._server.headersTimeout = Math.min(60000, next.config.requestTimeout);
        }
        this._logger.info('Configuration reloaded');
    }

    getRequests(match = {}) { return structuredClone(this._history.filter(request => matches(match, request))); }
    assertRequests(options) { return assertion(options, this._history); }
    reset() {
        this._state = { ...this._prepare(this._state.source, this._state.modulesProxy), revision: this._state.revision };
        this._history = [];
        this._historyGeneration++;
    }

    stop(callback = () => {}) {
        if (!this._server) { callback(); return; }
        this._server.close(callback);
        for (const socket of this._connections) socket.destroy();
        this._connections.clear();
    }
}

module.exports = Core;
