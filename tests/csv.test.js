const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const CSV = require('../modules/csv');

describe('CSV Parser', () => {

    describe('_parseCSV', () => {

        it('should parse basic CSV with headers', () => {
            const csv = new CSV('id,name\n1,Alice\n2,Bob', { startIndex: 0, format: 'json', direction: 'seq' });
            const result = JSON.parse(csv.read());
            assert.equal(result.id, '1');
            assert.equal(result.name, 'Alice');
        });

        it('should handle CRLF line endings', () => {
            const csv = new CSV('id,name\r\n1,Alice\r\n2,Bob', { startIndex: 0, format: 'json', direction: 'seq' });
            const result = JSON.parse(csv.read());
            assert.equal(result.id, '1');
            assert.equal(result.name, 'Alice');
        });

        it('should handle CR-only line endings', () => {
            const csv = new CSV('id,name\r1,Alice\r2,Bob', { startIndex: 0, format: 'json', direction: 'seq' });
            const result = JSON.parse(csv.read());
            assert.equal(result.id, '1');
            assert.equal(result.name, 'Alice');
        });

        it('should handle commas inside quoted fields', () => {
            const csv = new CSV('id,name\n1,"test, value"\n2,normal', { startIndex: 0, format: 'json', direction: 'seq' });
            const result = JSON.parse(csv.read());
            assert.equal(result.name, 'test, value');
        });

        it('should handle escaped quotes inside fields', () => {
            const csv = new CSV('id,name\n1,"say ""hello"""\n2,world', { startIndex: 0, format: 'json', direction: 'seq' });
            const result = JSON.parse(csv.read());
            assert.equal(result.name, 'say "hello"');
        });

        it('should handle empty fields', () => {
            const csv = new CSV('id,name,extra\n1,,value', { startIndex: 0, format: 'json', direction: 'seq' });
            const result = JSON.parse(csv.read());
            assert.equal(result.name, '');
            assert.equal(result.extra, 'value');
        });
    });

    describe('sequential reading', () => {

        it('should return records in order', () => {
            const csv = new CSV('id,name\n1,Alice\n2,Bob\n3,Carol', { startIndex: 0, format: 'json', direction: 'seq' });
            const r1 = JSON.parse(csv.read());
            const r2 = JSON.parse(csv.read());
            const r3 = JSON.parse(csv.read());
            assert.equal(r1.name, 'Alice');
            assert.equal(r2.name, 'Bob');
            assert.equal(r3.name, 'Carol');
        });

        it('should wrap around when reaching end', () => {
            const csv = new CSV('id,name\n1,Alice\n2,Bob', { startIndex: 0, format: 'json', direction: 'seq' });
            csv.read(); // Alice
            csv.read(); // Bob
            const r3 = JSON.parse(csv.read()); // wraps to Alice
            assert.equal(r3.name, 'Alice');
        });

        it('should respect startIndex', () => {
            const csv = new CSV('id,name\n1,Alice\n2,Bob\n3,Carol', { startIndex: 1, format: 'json', direction: 'seq' });
            const r1 = JSON.parse(csv.read());
            assert.equal(r1.name, 'Bob');
        });
    });

    describe('random reading', () => {

        it('should return a valid record', () => {
            const csv = new CSV('id,name\n1,Alice\n2,Bob\n3,Carol', { startIndex: 0, format: 'json', direction: 'rand' });
            const result = JSON.parse(csv.read());
            assert.ok(result.id);
            assert.ok(result.name);
        });
    });

    describe('return all records', () => {

        it('should return all records when startIndex is -1', () => {
            const csv = new CSV('id,name\n1,Alice\n2,Bob', { startIndex: -1, format: 'json', direction: 'seq' });
            const result = JSON.parse(csv.read());
            assert.equal(result.length, 2);
            assert.equal(result[0].name, 'Alice');
            assert.equal(result[1].name, 'Bob');
        });
    });

    describe('text format', () => {

        it('should return raw arrays', () => {
            const csv = new CSV('id,name\n1,Alice', { startIndex: 0, format: 'text', direction: 'seq' });
            const result = JSON.parse(csv.read());
            assert.deepEqual(result, ['1', 'Alice']);
        });
    });
});
