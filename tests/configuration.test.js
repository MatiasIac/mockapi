const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { prepareConfiguration } = require('../modules/configuration');
const { temporary } = require('./helpers');

const invalid = [
    ['empty document', null, /configuration/],
    ['missing port', {}, /port/],
    ['string port', { port: '8001' }, /port/],
    ['fractional port', { port: 1.5 }, /port/],
    ['negative port', { port: -1 }, /port/],
    ['large port', { port: 65536 }, /port/],
    ['unknown top-level field', { port: 0, porrt: 8001 }, /porrt/],
    ['unknown endpoint field', { port: 0, endpoints: { '/a': { get: { respones: {} } } } }, /respones/],
    ['invalid verb', { port: 0, endpoints: { '/a': { verb: 'gti' } } }, /verb/],
    ['missing verb', { port: 0, endpoints: { '/a': { response: 'hello' } } }, /HTTP method/],
    ['invalid status', { port: 0, endpoints: { '/a': { get: { responseStatus: 100 } } } }, /responseStatus/],
    ['negative delay', { port: 0, endpoints: { '/a': { get: { delay: -1 } } } }, /delay/],
    ['unknown data', { port: 0, endpoints: { '/a': { get: { data: 'absent' } } } }, /unknown data/],
    ['unknown handler', { port: 0, endpoints: { '/a': { get: { handler: 'absent' } } } }, /unknown custom handler/],
    ['invalid content type', { port: 0, endpoints: { '/a': { get: { responseContentType: 42 } } } }, /responseContentType/],
    ['newline header', { port: 0, endpoints: { '/a': { get: { responseHeaders: { 'X-Test': 'bad\r\nheader' } } } } }, /responseHeaders/],
    ['invalid header name', { port: 0, endpoints: { '/a': { get: { responseHeaders: { 'bad name': 'x' } } } } }, /responseHeaders/],
    ['managed header', { port: 0, endpoints: { '/a': { get: { responseHeaders: { 'Content-Length': 10 } } } } }, /managed/],
    ['empty sequence', { port: 0, endpoints: { '/a': { get: { sequence: [] } } } }, /sequence/],
    ['invalid sequence mode', { port: 0, endpoints: { '/a': { get: { sequenceMode: 'random' } } } }, /sequenceMode/],
    ['nested sequence', { port: 0, endpoints: { '/a': { get: { sequence: [{ sequence: [{}] }] } } } }, /unknown option/],
    ['empty variants', { port: 0, endpoints: { '/a': { get: { variants: [] } } } }, /variants/],
    ['variant without condition', { port: 0, endpoints: { '/a': { get: { variants: [{ response: 'a' }] } } } }, /requires match/],
    ['invalid condition', { port: 0, endpoints: { '/a': { get: { match: { query: 'wrong' } } } } }, /query/],
    ['invalid path', { port: 0, endpoints: { 'relative': { get: {} } } }, /absolute URL/],
    ['duplicate parameter', { port: 0, endpoints: { '/:id/:id': { get: {} } } }, /unique/],
    ['equivalent routes', { port: 0, endpoints: { '/:id': { get: {} }, '/:name': { get: {} } } }, /equivalent/],
    ['duplicate normalized method', { port: 0, endpoints: { '/a': { get: {}, GET: {} } } }, /equivalent/],
    ['reserved docs route', { port: 0, endpoints: { '/docs': { get: {} } } }, /OpenAPI route/],
    ['reserved admin route', { port: 0, admin: true, endpoints: { '/__mockapi/reset': { post: {} } } }, /admin path/],
    ['overlapping docs paths', { port: 0, openApi: { docsPath: '/same', specPath: '/same' } }, /must differ/],
    ['invalid CORS origin', { port: 0, enableCors: { origins: 42 } }, /origins/],
    ['invalid body limit', { port: 0, maxBodyBytes: 0 }, /maxBodyBytes/],
    ['invalid timeout', { port: 0, requestTimeout: 0 }, /requestTimeout/],
    ['incomplete TLS', { port: 0, tls: {} }, /tls.cert/],
    ['invalid history limit', { port: 0, admin: { historyLimit: 0 } }, /historyLimit/],
    ['empty admin token', { port: 0, admin: { token: '' } }, /token/],
    ['root admin path', { port: 0, admin: { path: '/' } }, /root path/],
    ['invalid docs parameters', { port: 0, endpoints: { '/a': { get: { parameters: [{ name: 'a', in: 'invalid' }] } } } }, /parameters/]
];
for (const [name, input, expected] of invalid) it(`rejects ${name} with a useful field error`, () => assert.throws(() => prepareConfiguration(input), expected));

it('validates CSV options and data references before reading requests', t => {
    const dir = temporary(t);
    fs.writeFileSync(path.join(dir, 'data.csv'), 'id\n1\n2');
    const config = properties => ({ port: 0, data: { rows: { reader: 'csv', path: 'data.csv', properties } }, endpoints: {} });
    for (const properties of [['json', 'sequential', 0], ['unknown', 'seq', 0], ['json', 'seq', 0.5], ['json', 'seq', -2], ['json']]) assert.throws(() => prepareConfiguration(config(properties), dir), /data.rows.properties/);
    assert.throws(() => prepareConfiguration({ port: 0, data: { bad: { reader: 'invalid', path: 'data.csv' } } }, dir), /data.bad.reader/);
    assert.throws(() => prepareConfiguration({ port: 0, data: { bad: { reader: 'text', path: 'missing' } } }, dir), /data.bad.path/);
    const source = config(['json', 'seq', 0]);
    const prepared = prepareConfiguration(source, dir);
    assert.equal(source.data.rows.path, 'data.csv');
    assert.equal(source.data.rows.dataHandler, undefined);
    assert.equal(JSON.parse(prepared.data.rows.dataHandler()).id, '1');
});

it('rejects unreadable or malformed TLS certificates instead of falling back to HTTP', t => {
    const dir = temporary(t);
    fs.writeFileSync(path.join(dir, 'cert.pem'), 'not a certificate');
    fs.writeFileSync(path.join(dir, 'key.pem'), 'not a key');
    assert.throws(() => prepareConfiguration({ port: 0, tls: { cert: 'absent', key: 'absent' } }, dir), /tls.cert/);
    assert.throws(() => prepareConfiguration({ port: 0, tls: { cert: 'cert.pem', key: 'key.pem' } }, dir), /tls:/);
});

it('allows legacy and per-method configurations and disabled reserved paths', () => {
    const prepared = prepareConfiguration({ port: 0, openApi: false, endpoints: { '/docs': { verb: 'get' }, '/users': { get: { response: [] }, post: { responseStatus: 201 } } } });
    assert.equal(prepared.routes.length, 3);
    assert.equal(prepared.admin.enabled, false);
    assert.equal(prepared.config.maxBodyBytes, 1048576);
});
