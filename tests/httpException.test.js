const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const HttpException = require('../modules/HttpException');

describe('HttpException', () => {

    it('should create an error with status code and message', () => {
        const ex = new HttpException(404, 'Not Found');
        assert.equal(ex.message, 'Not Found');
        assert.equal(ex.httpStatusCode, 404);
        assert.equal(ex.name, 'HttpException');
    });

    it('should be an instance of Error', () => {
        const ex = new HttpException(500, 'Server Error');
        assert.ok(ex instanceof Error);
        assert.ok(ex instanceof HttpException);
    });

    it('should have a stack trace', () => {
        const ex = new HttpException(400, 'Bad Request');
        assert.ok(ex.stack);
        assert.ok(ex.stack.includes('Bad Request'));
    });
});
