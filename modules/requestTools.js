const { isDeepStrictEqual } = require('node:util');
const HttpException = require('./HttpException');
const { object, validateMatch } = require('./configuration');

function subset(expected, actual) {
    if (!object(expected)) return isDeepStrictEqual(expected, actual);
    return object(actual) && Object.entries(expected).every(([key, value]) => Object.hasOwn(actual, key) && subset(value, actual[key]));
}

function matches(match = {}, request) {
    return Object.entries(match).every(([key, expected]) => {
        if (key === 'method') return request.method.toLowerCase() === expected.toLowerCase();
        if (key === 'headers') return Object.entries(expected).every(([name, value]) => subset(value, request.headers[name.toLowerCase()]));
        return subset(expected, request[key]);
    });
}

function lookup(context, expression) {
    let value = context;
    for (const key of expression.trim().split('.')) {
        if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key) || ['__proto__', 'constructor', 'prototype'].includes(key)) {
            throw new HttpException(500, `Template value '${expression}' is unavailable`);
        }
        value = value[key];
    }
    return value;
}

function render(value, context) {
    if (Array.isArray(value)) return value.map(item => render(item, context));
    if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, render(item, context)]));
    if (typeof value !== 'string') return value;
    const exact = value.match(/^\{\{\s*([^{}]+?)\s*\}\}$/);
    if (exact) return lookup(context, exact[1]);
    return value.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, expression) => {
        const result = lookup(context, expression);
        return typeof result === 'object' ? JSON.stringify(result) : String(result);
    });
}

function assertion(options, requests) {
    if (!object(options)) throw new HttpException(400, 'Assertion must be an object');
    for (const key of Object.keys(options)) if (!['match', 'count', 'min', 'max'].includes(key)) throw new HttpException(400, `Unknown assertion option '${key}'`);
    try { validateMatch(options.match || {}, 'match', true); } catch (error) { throw new HttpException(400, error.message); }
    for (const key of ['count', 'min', 'max']) if (options[key] !== undefined && (!Number.isInteger(options[key]) || options[key] < 0)) throw new HttpException(400, `${key} must be a nonnegative integer`);
    if (options.count !== undefined && (options.min !== undefined || options.max !== undefined)) throw new HttpException(400, 'Use count or min/max');
    if (options.min !== undefined && options.max !== undefined && options.min > options.max) throw new HttpException(400, 'min must not exceed max');
    const count = requests.filter(request => matches(options.match, request)).length;
    const min = options.count ?? options.min ?? (options.max === undefined ? 1 : 0);
    const max = options.count ?? options.max ?? Infinity;
    return { passed: count >= min && count <= max, count, expected: { min, max: Number.isFinite(max) ? max : null } };
}

module.exports = { matches, render, assertion };
