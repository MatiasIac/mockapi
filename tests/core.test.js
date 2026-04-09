const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

// Minimal logger stub
const createLogger = () => ({
    info: () => {},
    error: () => {},
    debug: () => {},
    message: () => {},
    detail: () => {}
});

// Minimal moduleProxy stub
const createModuleProxy = () => ({
    execute: (name, reqInfo, data) => data,
    load: () => {}
});

const Core = require('../modules/core');

const makeRequest = (port, method, path, protocol = 'http') => {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port,
            path,
            method,
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
        });
        req.on('error', reject);
        req.end();
    });
};

const getAvailablePort = () => {
    return new Promise((resolve, reject) => {
        const server = http.createServer();
        server.listen(0, () => {
            const port = server.address().port;
            server.close(() => resolve(port));
        });
        server.on('error', reject);
    });
};

describe('Core HTTP Server', () => {

    it('should return 404 for unmatched endpoints', async () => {
        const port = await getAvailablePort();
        const core = new Core(createLogger(), {
            port,
            enableCors: false,
            endpoints: {}
        }, createModuleProxy());

        core.run();

        try {
            const res = await makeRequest(port, 'GET', '/nonexistent');
            assert.equal(res.statusCode, 404);
        } finally {
            await new Promise(resolve => core.stop(resolve));
        }
    });

    it('should match a configured endpoint and return data', async () => {
        const port = await getAvailablePort();
        const core = new Core(createLogger(), {
            port,
            enableCors: false,
            endpoints: {
                '/test': {
                    verb: 'get',
                    responseStatus: 200,
                    responseContentType: 'application/json'
                }
            }
        }, createModuleProxy());

        core.run();

        try {
            const res = await makeRequest(port, 'GET', '/test');
            assert.equal(res.statusCode, 200);
            assert.equal(res.headers['content-type'], 'application/json');
        } finally {
            await new Promise(resolve => core.stop(resolve));
        }
    });

    it('should match endpoints with path parameters', async () => {
        const port = await getAvailablePort();

        const handlerData = {};
        const mockProxy = {
            execute: (name, reqInfo, data) => {
                handlerData.params = reqInfo.params;
                return JSON.stringify(reqInfo.params);
            },
            load: () => {}
        };

        const core = new Core(createLogger(), {
            port,
            enableCors: false,
            endpoints: {
                '/users/:id': {
                    verb: 'get',
                    handler: 'testHandler',
                    responseStatus: 200,
                    responseContentType: 'application/json'
                }
            }
        }, mockProxy);

        core.run();

        try {
            const res = await makeRequest(port, 'GET', '/users/42');
            assert.equal(res.statusCode, 200);
            const body = JSON.parse(res.body);
            assert.equal(body.id, '42');
        } finally {
            await new Promise(resolve => core.stop(resolve));
        }
    });

    it('should handle CORS allow-all', async () => {
        const port = await getAvailablePort();
        const core = new Core(createLogger(), {
            port,
            enableCors: true,
            endpoints: {
                '/test': { verb: 'get', responseStatus: 200 }
            }
        }, createModuleProxy());

        core.run();

        try {
            const res = await makeRequest(port, 'GET', '/test');
            assert.equal(res.headers['access-control-allow-origin'], '*');
        } finally {
            await new Promise(resolve => core.stop(resolve));
        }
    });

    it('should not add CORS headers when disabled', async () => {
        const port = await getAvailablePort();
        const core = new Core(createLogger(), {
            port,
            enableCors: false,
            endpoints: {
                '/test': { verb: 'get', responseStatus: 200 }
            }
        }, createModuleProxy());

        core.run();

        try {
            const res = await makeRequest(port, 'GET', '/test');
            assert.equal(res.headers['access-control-allow-origin'], undefined);
        } finally {
            await new Promise(resolve => core.stop(resolve));
        }
    });

    it('should match verb "any" for all methods', async () => {
        const port = await getAvailablePort();
        const core = new Core(createLogger(), {
            port,
            enableCors: false,
            endpoints: {
                '/anything': { verb: 'any', responseStatus: 200 }
            }
        }, createModuleProxy());

        core.run();

        try {
            const getRes = await makeRequest(port, 'GET', '/anything');
            const postRes = await makeRequest(port, 'POST', '/anything');
            assert.equal(getRes.statusCode, 200);
            assert.equal(postRes.statusCode, 200);
        } finally {
            await new Promise(resolve => core.stop(resolve));
        }
    });

    it('should not match wrong verb', async () => {
        const port = await getAvailablePort();
        const core = new Core(createLogger(), {
            port,
            enableCors: false,
            endpoints: {
                '/only-post': { verb: 'post', responseStatus: 201 }
            }
        }, createModuleProxy());

        core.run();

        try {
            const res = await makeRequest(port, 'GET', '/only-post');
            assert.equal(res.statusCode, 404);
        } finally {
            await new Promise(resolve => core.stop(resolve));
        }
    });

    it('should apply response delay', async () => {
        const port = await getAvailablePort();
        const core = new Core(createLogger(), {
            port,
            enableCors: false,
            endpoints: {
                '/slow': { verb: 'get', responseStatus: 200, delay: 200 }
            }
        }, createModuleProxy());

        core.run();

        try {
            const start = Date.now();
            const res = await makeRequest(port, 'GET', '/slow');
            const elapsed = Date.now() - start;
            assert.equal(res.statusCode, 200);
            assert.ok(elapsed >= 180, `Expected delay >=180ms, got ${elapsed}ms`);
        } finally {
            await new Promise(resolve => core.stop(resolve));
        }
    });

    it('should expose generated OpenAPI JSON', async () => {
        const port = await getAvailablePort();
        const core = new Core(createLogger(), {
            port,
            enableCors: false,
            endpoints: {
                '/users/:id': {
                    verb: 'get',
                    responseStatus: 200,
                    responseContentType: 'application/json'
                }
            }
        }, createModuleProxy());

        core.run();

        try {
            const res = await makeRequest(port, 'GET', '/openapi.json');
            assert.equal(res.statusCode, 200);
            assert.match(res.headers['content-type'], /application\/json/);

            const spec = JSON.parse(res.body);
            assert.equal(spec.openapi, '3.1.0');
            assert.ok(spec.paths['/users/{id}']);
            assert.ok(spec.paths['/users/{id}'].get);
            assert.equal(spec.paths['/users/{id}'].get.parameters[0].name, 'id');
        } finally {
            await new Promise(resolve => core.stop(resolve));
        }
    });

    it('should expose OpenAPI docs page', async () => {
        const port = await getAvailablePort();
        const core = new Core(createLogger(), {
            port,
            enableCors: false,
            endpoints: {
                '/health': {
                    verb: 'get',
                    responseStatus: 200
                }
            }
        }, createModuleProxy());

        core.run();

        try {
            const res = await makeRequest(port, 'GET', '/docs');
            assert.equal(res.statusCode, 200);
            assert.match(res.headers['content-type'], /text\/html/);
            assert.match(res.body, /SwaggerUIBundle/);
            assert.match(res.body, /\/openapi\.json/);
        } finally {
            await new Promise(resolve => core.stop(resolve));
        }
    });

    it('should update OpenAPI JSON after configuration reload', async () => {
        const port = await getAvailablePort();
        const core = new Core(createLogger(), {
            port,
            enableCors: false,
            endpoints: {
                '/before': {
                    verb: 'get',
                    responseStatus: 200
                }
            }
        }, createModuleProxy());

        core.run();

        try {
            const initialSpecResponse = await makeRequest(port, 'GET', '/openapi.json');
            const initialSpec = JSON.parse(initialSpecResponse.body);
            assert.ok(initialSpec.paths['/before']);
            assert.equal(initialSpec.paths['/after'], undefined);

            core.reload({
                port,
                enableCors: false,
                endpoints: {
                    '/after': {
                        verb: 'post',
                        responseStatus: 201
                    }
                }
            });

            const updatedSpecResponse = await makeRequest(port, 'GET', '/openapi.json');
            const updatedSpec = JSON.parse(updatedSpecResponse.body);
            assert.equal(updatedSpec.paths['/before'], undefined);
            assert.ok(updatedSpec.paths['/after']);
            assert.ok(updatedSpec.paths['/after'].post);
        } finally {
            await new Promise(resolve => core.stop(resolve));
        }
    });

    it('should disable OpenAPI endpoints when configured', async () => {
        const port = await getAvailablePort();
        const core = new Core(createLogger(), {
            port,
            enableCors: false,
            openApi: {
                enabled: false
            },
            endpoints: {
                '/test': {
                    verb: 'get',
                    responseStatus: 200
                }
            }
        }, createModuleProxy());

        core.run();

        try {
            const specRes = await makeRequest(port, 'GET', '/openapi.json');
            const docsRes = await makeRequest(port, 'GET', '/docs');
            assert.equal(specRes.statusCode, 404);
            assert.equal(docsRes.statusCode, 404);
        } finally {
            await new Promise(resolve => core.stop(resolve));
        }
    });

    it('should expose OpenAPI endpoints using custom configured paths', async () => {
        const port = await getAvailablePort();
        const core = new Core(createLogger(), {
            port,
            enableCors: false,
            openApi: {
                docsPath: 'api-docs',
                specPath: 'spec.json'
            },
            endpoints: {
                '/status': {
                    verb: 'get',
                    responseStatus: 200
                }
            }
        }, createModuleProxy());

        core.run();

        try {
            const specRes = await makeRequest(port, 'GET', '/spec.json');
            const docsRes = await makeRequest(port, 'GET', '/api-docs');

            assert.equal(specRes.statusCode, 200);
            assert.equal(docsRes.statusCode, 200);
            assert.match(docsRes.body, /\/spec\.json/);
        } finally {
            await new Promise(resolve => core.stop(resolve));
        }
    });
});
