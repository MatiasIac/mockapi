const { it } = require('node:test');
const assert = require('node:assert/strict');
const { buildDocsPage } = require('../modules/openApi');
const { serve } = require('./helpers');

it('documents methods, parameters, JSON schemas, headers, request bodies, and scenario responses', async t => {
    const { get } = await serve(t, { endpoints: { '/users/:id': {
        get: { summary: 'Read a user', parameters: [{ name: 'fields', in: 'query', schema: { type: 'string' } }], response: { id: 1, name: 'Alice' }, responseHeaders: { 'X-Source': 'mock' } },
        post: { requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' }, example: { name: 'Alice' } } } }, sequence: [
            { responseStatus: 503, response: { error: 'retry' } },
            { responseStatus: 201, responseSchema: { type: 'object', properties: { id: { type: 'integer' } } }, response: { id: '{{body.id}}' }, responseExample: { id: 7 } }
        ] }
    } } });
    const spec = JSON.parse((await get('/openapi.json')).body);
    const operations = spec.paths['/users/{id}'];
    assert.equal(operations.get.summary, 'Read a user');
    assert.equal(operations.get.parameters[0].required, true);
    assert.equal(operations.get.parameters[1].name, 'fields');
    assert.equal(operations.get.responses['200'].content['application/json'].schema.properties.id.type, 'integer');
    assert.equal(operations.get.responses['200'].headers['X-Source'].example, 'mock');
    assert.equal(operations.post.requestBody.required, true);
    assert.ok(operations.post.responses['503']);
    assert.equal(operations.post.responses['201'].content['application/json'].examples.response1.value.id, 7);
});

it('serves Swagger assets locally with no external validator or CDN', async t => {
    const { get } = await serve(t, { openApi: { docsPath: '/reference', specPath: '/spec.json' }, endpoints: {} });
    const page = await get('/reference');
    assert.equal(page.status, 200);
    assert.match(page.body, /validatorUrl: null/);
    assert.doesNotMatch(page.body, /https?:\/\//);
    for (const asset of ['swagger-ui.css', 'swagger-ui-bundle.js']) {
        const response = await get('/reference/assets/' + asset);
        assert.equal(response.status, 200);
        assert.ok(response.buffer.length > 1000);
    }
    assert.equal((await get('/reference/assets/package.json')).status, 404);
    assert.equal((await get('/docs')).status, 404);
});

it('escapes docs metadata and inline script values', () => {
    const page = buildDocsPage({ title: '<script>unsafe</script>', specPath: "/spec'</script><script>bad</script>" });
    assert.match(page, /&lt;script&gt;/);
    assert.doesNotMatch(page, /<script>bad/);
    assert.match(page, /\\u003c\/script>/);
});

it('documents explicit methods before any and omits bodies for 204', async t => {
    const { get } = await serve(t, { endpoints: { '/resource': { any: { response: 'fallback' }, get: { responseStatus: 204 } } } });
    const spec = JSON.parse((await get('/openapi.json')).body);
    assert.equal(spec.paths['/resource'].get.responses['204'].content, undefined);
    assert.ok(spec.paths['/resource'].post.responses['200']);
});
