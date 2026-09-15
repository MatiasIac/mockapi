const http = require('node:http');
const { normalizeEndpoints, mergeResponse } = require('./configuration');

const toOpenApiPath = endpoint => endpoint.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
const own = (value, key) => Object.hasOwn(value, key);
const hasTemplate = value => typeof value === 'string' ? value.includes('{{') : value && typeof value === 'object' ? Object.values(value).some(hasTemplate) : false;

function schemaFor(value) {
    if (value === null) return { type: 'null' };
    if (Array.isArray(value)) {
        const schemas = [...new Set(value.map(item => JSON.stringify(schemaFor(item))))].map(item => JSON.parse(item));
        return { type: 'array', items: schemas.length > 1 ? { anyOf: schemas } : schemas[0] || {} };
    }
    if (typeof value === 'object') return { type: 'object', properties: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, schemaFor(item)])) };
    if (hasTemplate(value)) return {};
    return { type: Number.isInteger(value) ? 'integer' : typeof value };
}

function buildOperation(method, route) {
    const definition = route.definition;
    const operation = { summary: definition.summary || `${method.toUpperCase()} ${toOpenApiPath(route.path)}`, responses: {} };
    if (definition.description) operation.description = definition.description;
    if (definition.requestBody) operation.requestBody = structuredClone(definition.requestBody);
    const params = route.path.split('/').filter(part => part.startsWith(':')).map(part => ({ name: part.slice(1), in: 'path', required: true, schema: { type: 'string' } }));
    for (const parameter of definition.parameters || []) {
        const index = params.findIndex(item => item.in === parameter.in && item.name === parameter.name);
        const value = structuredClone(parameter);
        if (value.in === 'path') value.required = true;
        if (index < 0) params.push(value); else params[index] = value;
    }
    if (params.length) operation.parameters = params;
    const definitions = definition.sequence ? definition.sequence.map(step => mergeResponse(definition, step)) : [definition, ...(definition.variants || []).map(({ match, ...variant }) => mergeResponse(definition, variant))];
    for (const [index, response] of definitions.entries()) {
        const status = response.responseStatus || 200;
        const result = operation.responses[status] ||= { description: http.STATUS_CODES[status] || 'Configured response' };
        const headerContentType = Object.entries(response.responseHeaders || {}).find(([name]) => name.toLowerCase() === 'content-type')?.[1];
        const contentType = headerContentType || response.responseContentType || (own(response, 'response') && typeof response.response !== 'string' ? 'application/json' : 'text/plain');
        if (![204, 304].includes(status)) {
            result.content ||= {};
            const content = result.content[contentType] ||= { schema: own(response, 'responseSchema') ? structuredClone(response.responseSchema) : own(response, 'response') ? schemaFor(response.response) : contentType.includes('json') ? {} : { type: 'string' } };
            const example = own(response, 'responseExample') ? response.responseExample : response.response;
            if (example !== undefined && !hasTemplate(example)) {
                content.examples ||= {};
                content.examples['response' + index] = { value: structuredClone(example) };
            }
        }
        if (response.responseHeaders) {
            result.headers ||= {};
            for (const [name, value] of Object.entries(response.responseHeaders)) {
                if (name.toLowerCase() === 'content-type') continue;
                result.headers[name] = { schema: { type: 'string' }, ...(!hasTemplate(value) ? { example: String(value) } : {}) };
            }
        }
    }
    const metadata = {};
    for (const key of ['data', 'handler', 'delay', 'match', 'sequenceMode']) if (own(definition, key)) metadata[key] = definition[key];
    if (definition.sequence) metadata.sequenceLength = definition.sequence.length;
    if (Object.keys(metadata).length) operation['x-mockapi'] = metadata;
    return operation;
}

function buildSpec(settings = {}, endpoints = {}) {
    const routes = Array.isArray(endpoints) ? endpoints : normalizeEndpoints(endpoints);
    const paths = Object.create(null);
    for (const route of routes) {
        const pathname = toOpenApiPath(route.path);
        paths[pathname] ||= {};
        const methods = route.method === 'any' ? ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'] : [route.method];
        for (const method of methods) {
            if (route.method === 'any' && paths[pathname][method]) continue;
            paths[pathname][method] = buildOperation(method, route);
        }
    }
    return { openapi: '3.1.0', info: { title: settings.title || 'MockAPI', version: settings.version || '1.0.0', description: settings.description || 'OpenAPI definition generated from .mockapi-config.' }, servers: [{ url: '/' }], paths };
}

const escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const scriptJson = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

function buildDocsPage(settings = {}) {
    const assets = (settings.docsPath || '/docs').replace(/\/$/, '') + '/assets';
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(settings.title || 'MockAPI')} - API Docs</title>
  <link rel="stylesheet" href="${escapeHtml(assets)}/swagger-ui.css" />
  <style>html,body{margin:0;background:#f6f8fa}#swagger-ui{min-height:100vh}</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="${escapeHtml(assets)}/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function() {
      window.ui = SwaggerUIBundle({
        url: ${scriptJson(settings.specPath || '/openapi.json')},
        dom_id: '#swagger-ui', deepLinking: true, validatorUrl: null,
        presets: [SwaggerUIBundle.presets.apis], layout: 'BaseLayout'
      });
    };
  </script>
</body>
</html>`;
}

module.exports = { buildSpec, buildDocsPage, toOpenApiPath };
