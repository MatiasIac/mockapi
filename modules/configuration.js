const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const tls = require('node:tls');
const { isDeepStrictEqual } = require('node:util');
const readers = require('./configurationParser');

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace', 'any'];
const own = (value, key) => Object.hasOwn(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (field, message) => { throw new Error(`${field}: ${message}`); };
const check = (condition, field, message) => { if (!condition) fail(field, message); };
const fields = (value, allowed, field) => {
    check(object(value), field, 'must be an object');
    for (const key of Object.keys(value)) check(allowed.includes(key), `${field}.${key}`, 'unknown option');
};
const integer = (value, min, max, field) => check(Number.isInteger(value) && value >= min && value <= max, field, `must be an integer from ${min} to ${max}`);
const routePath = (value, field) => {
    check(typeof value === 'string' && value.startsWith('/') && !/[?#\\\s]/.test(value), field, 'must be an absolute URL path without a query, fragment, backslash, or whitespace');
    try { decodeURIComponent(value); } catch { fail(field, 'contains malformed URL encoding'); }
    return value.length > 1 ? value.replace(/\/+$/, '') : value;
};

function validateMatch(match, field, history = false) {
    fields(match, history ? ['method', 'path', 'headers', 'query', 'body'] : ['headers', 'query', 'body'], field);
    for (const name of ['headers', 'query']) {
        if (own(match, name)) check(object(match[name]), `${field}.${name}`, 'must be an object');
    }
    for (const name of ['method', 'path']) {
        if (own(match, name)) check(typeof match[name] === 'string', `${field}.${name}`, 'must be a string');
    }
}

function validateResponse(response, field, config, nested = false) {
    const allowed = ['verb', 'response', 'data', 'handler', 'responseStatus', 'responseContentType', 'responseHeaders', 'delay', 'summary', 'description', 'requestBody', 'parameters', 'responseSchema', 'responseExample'];
    fields(response, nested ? allowed.filter(key => !['verb'].includes(key)) : [...allowed, 'match', 'variants', 'sequence', 'sequenceMode'], field);
    if (own(response, 'verb')) check(typeof response.verb === 'string' && METHODS.includes(response.verb.toLowerCase()), `${field}.verb`, 'must be a supported HTTP method or any');
    if (own(response, 'responseStatus')) integer(response.responseStatus, 200, 599, `${field}.responseStatus`);
    if (own(response, 'delay')) integer(response.delay, 0, 2147483647, `${field}.delay`);
    if (own(response, 'responseContentType')) {
        check(typeof response.responseContentType === 'string' && response.responseContentType.length > 0, `${field}.responseContentType`, 'must be a nonempty string');
        try { http.validateHeaderValue('Content-Type', response.responseContentType); } catch (error) { fail(`${field}.responseContentType`, error.message); }
    }
    check(!(own(response, 'response') && own(response, 'data')), field, 'use either response or data');
    if (own(response, 'data')) check(typeof response.data === 'string' && own(config.data, response.data), `${field}.data`, `unknown data source '${response.data}'`);
    if (own(response, 'handler')) check(typeof response.handler === 'string' && own(config.customHandlers, response.handler), `${field}.handler`, `unknown custom handler '${response.handler}'`);
    if (own(response, 'responseHeaders')) {
        check(object(response.responseHeaders), `${field}.responseHeaders`, 'must be an object');
        for (const [key, value] of Object.entries(response.responseHeaders)) {
            check(typeof value === 'string' || typeof value === 'number', `${field}.responseHeaders.${key}`, 'must be a string or number');
            check(!['content-length', 'transfer-encoding', 'connection'].includes(key.toLowerCase()), `${field}.responseHeaders.${key}`, 'is managed by the server');
            try { http.validateHeaderName(key); http.validateHeaderValue(key, value); } catch (error) { fail(`${field}.responseHeaders.${key}`, error.message); }
        }
    }
    for (const key of ['summary', 'description']) if (own(response, key)) check(typeof response[key] === 'string', `${field}.${key}`, 'must be a string');
    for (const key of ['requestBody', 'responseSchema']) if (own(response, key)) check(object(response[key]) || (key === 'responseSchema' && typeof response[key] === 'boolean'), `${field}.${key}`, 'must be an OpenAPI object (or boolean schema)');
    if (own(response, 'parameters')) {
        check(Array.isArray(response.parameters), `${field}.parameters`, 'must be an array');
        response.parameters.forEach((parameter, i) => check(object(parameter) && typeof parameter.name === 'string' && ['query', 'header', 'path', 'cookie'].includes(parameter.in), `${field}.parameters[${i}]`, 'requires a name and valid in location'));
    }
    if (own(response, 'match')) validateMatch(response.match, `${field}.match`);
    if (own(response, 'variants')) {
        check(Array.isArray(response.variants) && response.variants.length > 0, `${field}.variants`, 'must be a nonempty array');
        response.variants.forEach((variant, i) => {
            check(object(variant) && own(variant, 'match'), `${field}.variants[${i}]`, 'requires match');
            const { match, ...definition } = variant;
            validateMatch(match, `${field}.variants[${i}].match`);
            validateResponse(definition, `${field}.variants[${i}]`, config, true);
            validateResponse(mergeResponse(response, definition), `${field}.variants[${i}] (merged response)`, config, true);
        });
    }
    if (own(response, 'sequenceMode')) check(['hold', 'cycle'].includes(response.sequenceMode) && own(response, 'sequence'), `${field}.sequenceMode`, 'requires sequence and must be hold or cycle');
    if (own(response, 'sequence')) {
        check(!own(response, 'variants'), field, 'variants and sequence cannot be combined');
        check(Array.isArray(response.sequence) && response.sequence.length > 0, `${field}.sequence`, 'must be a nonempty array');
        response.sequence.forEach((step, i) => {
            validateResponse(step, `${field}.sequence[${i}]`, config, true);
            validateResponse(mergeResponse(response, step), `${field}.sequence[${i}] (merged response)`, config, true);
        });
    }
}

function mergeResponse(base, override) {
    const { verb, match, variants, sequence, sequenceMode, ...response } = base;
    if (own(override, 'response')) delete response.data;
    if (own(override, 'data')) delete response.response;
    return { ...response, ...override, responseHeaders: { ...response.responseHeaders, ...override.responseHeaders } };
}

function normalizeEndpoints(endpoints = {}) {
    check(object(endpoints), 'endpoints', 'must be an object');
    const routes = [];
    for (const [url, definition] of Object.entries(endpoints)) {
        const field = `endpoints[${JSON.stringify(url)}]`;
        const pathname = routePath(url, field);
        check(object(definition), field, 'must be an object');
        if (own(definition, 'verb')) {
            routes.push({ path: pathname, method: String(definition.verb).toLowerCase(), definition, field });
        } else {
            check(Object.keys(definition).length > 0, field, 'requires verb or HTTP method definitions');
            for (const [method, endpoint] of Object.entries(definition)) {
                check(METHODS.includes(method.toLowerCase()), `${field}.${method}`, 'expected an HTTP method');
                check(object(endpoint) && !own(endpoint, 'verb'), `${field}.${method}`, 'must be an endpoint object without verb');
                routes.push({ path: pathname, method: method.toLowerCase(), definition: endpoint, field: `${field}.${method}` });
            }
        }
    }
    const seen = new Set();
    for (const route of routes) {
        const params = route.path.split('/').filter(segment => segment.startsWith(':'));
        check(params.every(param => /^:[A-Za-z_][A-Za-z0-9_]*$/.test(param)) && new Set(params).size === params.length, route.field, 'path parameter names must be unique identifiers');
        const key = `${route.method} ${route.path.replace(/:[^/]+/g, ':')}`;
        check(!seen.has(key), route.field, 'duplicates an equivalent route');
        seen.add(key);
        route.key = `${route.method} ${route.path}`;
    }
    return routes.sort((a, b) => {
        const left = a.path.split('/'), right = b.path.split('/');
        for (let i = 0; i < Math.min(left.length, right.length); i++) {
            const difference = Number(left[i].startsWith(':')) - Number(right[i].startsWith(':'));
            if (difference) return difference;
        }
        return right.length - left.length || Number(a.method === 'any') - Number(b.method === 'any');
    });
}

function prepareConfiguration(input, basePath = process.cwd()) {
    fields(input, ['port', 'host', 'enableCors', 'externalModulesPath', 'staticPath', 'openApi', 'data', 'endpoints', 'log', 'customHandlers', 'tls', 'maxBodyBytes', 'requestTimeout', 'admin'], 'configuration');
    const config = structuredClone(input);
    integer(config.port, 0, 65535, 'port');
    if (own(config, 'host')) check(typeof config.host === 'string' && config.host.length > 0, 'host', 'must be a nonempty string');
    config.maxBodyBytes ??= 1024 * 1024;
    config.requestTimeout ??= 30000;
    integer(config.maxBodyBytes, 1, 1024 * 1024 * 1024, 'maxBodyBytes');
    integer(config.requestTimeout, 1, 2147483647, 'requestTimeout');
    if (own(config, 'log')) check(['verbose', 'debug', 'error', 'none'].includes(config.log), 'log', 'must be verbose, debug, error, or none');
    config.data ??= {};
    config.customHandlers ??= {};
    check(object(config.data), 'data', 'must be an object');
    check(object(config.customHandlers), 'customHandlers', 'must be an object');
    for (const [name, file] of Object.entries(config.customHandlers)) check(typeof file === 'string' && file.length > 0, `customHandlers.${name}`, 'must be a module filename');
    for (const key of ['externalModulesPath', 'staticPath']) {
        if (own(config, key)) {
            check(typeof config[key] === 'string' && config[key].length > 0, key, 'must be a directory path');
            config[key] = path.resolve(basePath, config[key]);
        }
    }
    config.externalModulesPath ??= path.resolve(basePath, 'apiHandlers');
    if (config.staticPath) {
        try { check(fs.statSync(config.staticPath).isDirectory(), 'staticPath', 'must be a directory'); } catch (error) { fail('staticPath', error.message); }
    }
    for (const [name, source] of Object.entries(config.data)) {
        const field = `data.${name}`;
        fields(source, ['path', 'reader', 'properties'], field);
        check(typeof source.path === 'string' && source.path.length > 0, `${field}.path`, 'must be a file or directory path');
        check(['csv', 'text', 'folder'].includes(source.reader), `${field}.reader`, 'must be csv, text, or folder');
        if (source.properties !== undefined) {
            check(Array.isArray(source.properties) && source.properties.length === 3, `${field}.properties`, 'must contain [format, direction, startIndex]');
            check(['json', 'text'].includes(source.properties[0]), `${field}.properties[0]`, 'must be json or text');
            check(['seq', 'rand'].includes(source.properties[1]), `${field}.properties[1]`, 'must be seq or rand');
            integer(source.properties[2], -1, Number.MAX_SAFE_INTEGER, `${field}.properties[2]`);
        }
        source.path = path.resolve(basePath, source.path);
        try {
            const stat = fs.statSync(source.path);
            check(source.reader === 'folder' ? stat.isDirectory() : stat.isFile(), `${field}.path`, `must be a ${source.reader === 'folder' ? 'directory' : 'file'}`);
            fs.accessSync(source.path, fs.constants.R_OK);
        } catch (error) { fail(`${field}.path`, error.message); }
    }
    if (config.enableCors !== undefined && typeof config.enableCors !== 'boolean') {
        fields(config.enableCors, ['origins', 'methods', 'headers', 'credentials'], 'enableCors');
        for (const key of ['origins', 'methods', 'headers']) {
            const value = config.enableCors[key];
            if (value !== undefined) {
                check(typeof value === 'string' || (Array.isArray(value) && value.every(item => typeof item === 'string')), `enableCors.${key}`, 'must be a string or string array');
                try { http.validateHeaderValue(key, Array.isArray(value) ? value.join(', ') : value); } catch (error) { fail(`enableCors.${key}`, error.message); }
            }
        }
        if (own(config.enableCors, 'credentials')) check(typeof config.enableCors.credentials === 'boolean', 'enableCors.credentials', 'must be a boolean');
    }
    let tlsOptions = null;
    if (config.tls !== undefined) {
        fields(config.tls, ['cert', 'key'], 'tls');
        tlsOptions = {};
        for (const key of ['cert', 'key']) {
            check(typeof config.tls[key] === 'string' && config.tls[key].length > 0, `tls.${key}`, 'is required');
            config.tls[key] = path.resolve(basePath, config.tls[key]);
            try { tlsOptions[key] = fs.readFileSync(config.tls[key]); } catch (error) { fail(`tls.${key}`, error.message); }
        }
        try { tls.createSecureContext(tlsOptions); } catch (error) { fail('tls', error.message); }
    }
    let docs = config.openApi;
    if (docs !== undefined && typeof docs !== 'boolean') {
        fields(docs, ['enabled', 'docsPath', 'specPath', 'info', 'title', 'version', 'description'], 'openApi');
        if (own(docs, 'enabled')) check(typeof docs.enabled === 'boolean', 'openApi.enabled', 'must be a boolean');
        if (docs.info !== undefined) {
            fields(docs.info, ['title', 'version', 'description'], 'openApi.info');
            for (const [key, value] of Object.entries(docs.info)) check(typeof value === 'string', `openApi.info.${key}`, 'must be a string');
        }
    }
    docs = object(docs) ? docs : { enabled: docs !== false };
    for (const key of ['title', 'version', 'description']) if (own(docs, key)) check(typeof docs[key] === 'string', `openApi.${key}`, 'must be a string');
    for (const key of ['docsPath', 'specPath']) if (own(docs, key)) check(typeof docs[key] === 'string' && docs[key].length > 0, `openApi.${key}`, 'must be a nonempty path');
    const openApi = {
        enabled: docs.enabled !== false,
        docsPath: routePath('/' + (docs.docsPath || '/docs').replace(/^\/+/, ''), 'openApi.docsPath'),
        specPath: routePath('/' + (docs.specPath || '/openapi.json').replace(/^\/+/, ''), 'openApi.specPath'),
        title: docs.info?.title ?? docs.title ?? 'MockAPI',
        version: docs.info?.version ?? docs.version ?? '1.0.0',
        description: docs.info?.description ?? docs.description ?? 'OpenAPI definition generated from .mockapi-config.'
    };
    check(openApi.docsPath !== openApi.specPath, 'openApi', 'docsPath and specPath must differ');
    let admin = config.admin;
    if (admin !== undefined && typeof admin !== 'boolean') fields(admin, ['enabled', 'path', 'token', 'historyLimit', 'bodyLimit'], 'admin');
    admin = object(admin) ? admin : { enabled: admin === true };
    if (own(admin, 'enabled')) check(typeof admin.enabled === 'boolean', 'admin.enabled', 'must be a boolean');
    admin = { enabled: true, path: '/__mockapi', historyLimit: 100, bodyLimit: Math.min(16384, config.maxBodyBytes), ...admin };
    admin.path = routePath(admin.path, 'admin.path');
    check(admin.path !== '/', 'admin.path', 'cannot be the root path');
    integer(admin.historyLimit, 1, 10000, 'admin.historyLimit');
    integer(admin.bodyLimit, 0, config.maxBodyBytes, 'admin.bodyLimit');
    if (own(admin, 'token')) check(typeof admin.token === 'string' && admin.token.length > 0 && !/[\r\n]/.test(admin.token), 'admin.token', 'must be a nonempty token without newlines');
    const routes = normalizeEndpoints(config.endpoints);
    for (const route of routes) {
        validateResponse(route.definition, route.field, config);
        if (openApi.enabled) check(![openApi.docsPath, openApi.specPath].includes(route.path) && !route.path.startsWith(openApi.docsPath + '/assets/'), route.field, 'conflicts with an OpenAPI route');
        if (admin.enabled) check(route.path !== admin.path && !route.path.startsWith(admin.path + '/'), route.field, 'conflicts with the admin path');
    }
    if (admin.enabled && openApi.enabled) check(![openApi.docsPath, openApi.specPath].some(url => url === admin.path || url.startsWith(admin.path + '/')), 'admin.path', 'conflicts with OpenAPI routes');
    const data = structuredClone(config.data);
    try { readers.loadHandlersFromConfiguration(data); } catch (error) { fail('data', error.message); }
    return { config, routes, data, tls: tlsOptions, openApi, admin };
}

function restartRequired(current, next) {
    return ['port', 'host', 'tls'].filter(key => !isDeepStrictEqual(current[key], next[key]));
}

module.exports = { prepareConfiguration, normalizeEndpoints, mergeResponse, validateMatch, restartRequired, object };
