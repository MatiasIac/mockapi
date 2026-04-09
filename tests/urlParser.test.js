const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parse, matchPath } = require('../modules/urlParser');

describe('URL Parser', () => {

    describe('parse', () => {

        it('should parse a simple path', () => {
            const result = parse('/users');
            assert.equal(result.base, '/users');
            assert.equal(result.pathname, '/users');
            assert.equal(result.hasFile, false);
            assert.equal(result.file, '');
        });

        it('should parse a nested path', () => {
            const result = parse('/api/v1/users');
            assert.equal(result.base, '/api/v1/users');
            assert.equal(result.pathname, '/api/v1/users');
        });

        it('should extract file from path', () => {
            const result = parse('/files/image.png');
            assert.equal(result.base, '/files');
            assert.equal(result.file, 'image.png');
            assert.equal(result.hasFile, true);
            assert.equal(result.pathname, '/files/image.png');
        });

        it('should parse query parameters', () => {
            const result = parse('/users?role=admin&active=true');
            assert.equal(result.base, '/users');
            assert.equal(result.search.get('role'), 'admin');
            assert.equal(result.search.get('active'), 'true');
        });

        it('should handle root path', () => {
            const result = parse('/');
            assert.equal(result.base, '/');
            assert.equal(result.hasFile, false);
        });
    });

    describe('matchPath', () => {

        it('should match exact paths', () => {
            const result = matchPath('/users', '/users');
            assert.equal(result.match, true);
            assert.deepEqual(result.params, {});
        });

        it('should not match different paths', () => {
            const result = matchPath('/users', '/orders');
            assert.equal(result.match, false);
        });

        it('should extract single path parameter', () => {
            const result = matchPath('/users/:id', '/users/42');
            assert.equal(result.match, true);
            assert.equal(result.params.id, '42');
        });

        it('should extract multiple path parameters', () => {
            const result = matchPath('/users/:userId/orders/:orderId', '/users/5/orders/99');
            assert.equal(result.match, true);
            assert.equal(result.params.userId, '5');
            assert.equal(result.params.orderId, '99');
        });

        it('should not match when segment count differs', () => {
            const result = matchPath('/users/:id', '/users/42/extra');
            assert.equal(result.match, false);
        });

        it('should not match when static segment differs', () => {
            const result = matchPath('/users/:id/orders', '/users/42/items');
            assert.equal(result.match, false);
        });

        it('should match nested paths without parameters', () => {
            const result = matchPath('/api/v1/data', '/api/v1/data');
            assert.equal(result.match, true);
        });
    });
});
