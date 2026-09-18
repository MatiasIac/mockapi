'use strict';

// Descriptions drive the visual editor; the server remains the validation authority.
// Keep optional properties absent until explicitly enabled by the user.
((root, factory) => {
    const schema = factory();
    if (typeof module === 'object' && module.exports) module.exports = schema;
    else root.MockConfigSchema = schema;
})(globalThis, () => {
    const text = (label, help = '', extra = {}) => ({ kind: 'string', label, help, default: '', ...extra });
    const number = (label, value, min, max, help = '') => ({ kind: 'number', label, default: value, min, max, integer: true, help });
    const select = (label, options, value, help = '') => ({ kind: 'enum', label, options, default: value, help });
    const flag = (label, value, help = '') => ({ kind: 'boolean', label, default: value, help });
    const value = (label, help = '', extra = {}) => ({ kind: 'value', label, help, default: {}, ...extra });
    const object = (label, fields, help = '', extra = {}) => ({ kind: 'object', label, fields, help, default: {}, ...extra });
    const map = (label, item, name, help = '', extra = {}) => ({ kind: 'map', label, item, name, help, default: {}, ...extra });
    const array = (label, item, help = '', extra = {}) => ({ kind: 'array', label, item, help, default: [], ...extra });
    const union = (label, choices, help = '') => ({ kind: 'union', label, choices, help, default: choices[0].value ?? choices[0].schema.default });
    const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace', 'any'];
    const schema = object('Schema', {}, 'Describe the expected value. Additional JSON Schema keywords and extensions can be added as properties.', { additional: value('Keyword value') });
    schema.fields = {
        type: union('Value type', [{ label: 'Single type', schema: select('Type', ['object', 'array', 'string', 'integer', 'number', 'boolean', 'null'], 'object') }, { label: 'Multiple types', schema: array('Allowed types', select('Type', ['object', 'array', 'string', 'integer', 'number', 'boolean', 'null'], 'string')) }]),
        title: text('Title'), description: text('Description', '', { multiline: true }),
        properties: map('Object properties', schema, 'property', 'Add a name and a schema for each property.'),
        required: array('Required properties', text('Property name'), 'List the property names that must be supplied.'),
        items: schema,
        enum: array('Allowed values', value('Value', '', { default: '' })),
        const: value('Exact value', '', { default: '' }),
        default: value('Default value', '', { default: '' }),
        examples: array('Examples', value('Example')),
        format: text('Format', 'Examples: date-time, email, uuid, uri.', { suggestions: ['date-time', 'date', 'email', 'uuid', 'uri', 'binary'] }),
        pattern: text('Text pattern', 'A regular expression describing accepted text.'),
        minLength: number('Minimum text length', 0, 0, Number.MAX_SAFE_INTEGER),
        maxLength: number('Maximum text length', 100, 0, Number.MAX_SAFE_INTEGER),
        minimum: { kind: 'number', label: 'Minimum value', default: 0 },
        maximum: { kind: 'number', label: 'Maximum value', default: 100 },
        minItems: number('Minimum items', 0, 0, Number.MAX_SAFE_INTEGER),
        maxItems: number('Maximum items', 100, 0, Number.MAX_SAFE_INTEGER),
        uniqueItems: flag('Unique items', true),
        additionalProperties: union('Additional properties', [{ label: 'Allowed', value: true }, { label: 'Disallowed', value: false }, { label: 'Constrained by a schema', schema }]),
        allOf: array('All of these schemas', schema), anyOf: array('Any of these schemas', schema), oneOf: array('Exactly one of these schemas', schema),
        $ref: text('Schema reference', 'For example: #/components/schemas/User'),
        readOnly: flag('Read only', true), writeOnly: flag('Write only', true), deprecated: flag('Deprecated', true)
    };
    const schemaOrBoolean = union('Response schema', [{ label: 'Schema fields', schema }, { label: 'Allow any value', value: true }, { label: 'Allow no value', value: false }], 'OpenAPI metadata; this does not validate incoming requests.');
    const example = object('Named example', {
        summary: text('Summary'), description: text('Description'), value: value('Example value'), externalValue: text('External example URL'), $ref: text('Reference')
    }, '', { additional: value('Extension') });
    const mediaType = object('Media type', {
        schema, example: value('Example value'), examples: map('Named examples', example, 'example'),
        encoding: map('Encoding', value('Encoding options'), 'property')
    }, '', { additional: value('Extension') });
    const content = map('Content types', mediaType, 'application/json', 'Add media types and their schema or examples.');
    const requestBody = object('Request body documentation', {
        description: text('Description'), required: flag('Required', true), content, $ref: text('Reference')
    }, 'Describes the request body in OpenAPI documentation.', { additional: value('Extension') });
    const parameter = object('Parameter', {
        name: { ...text('Name'), required: true },
        in: { ...select('Location', ['query', 'header', 'path', 'cookie'], 'query'), required: true },
        description: text('Description'), required: flag('Required', true), deprecated: flag('Deprecated', true),
        allowEmptyValue: flag('Allow empty value', true), allowReserved: flag('Allow reserved characters', true),
        style: select('Serialization style', ['form', 'simple', 'matrix', 'label', 'spaceDelimited', 'pipeDelimited', 'deepObject'], 'form'),
        explode: flag('Explode arrays and objects', true), schema, example: value('Example value'),
        examples: map('Named examples', example, 'example'), content, $ref: text('Reference')
    }, 'Path parameters are always required. Other properties describe the parameter in OpenAPI.', { default: { name: 'page', in: 'query' }, additional: value('Extension') });
    const match = object('Match request', {
        headers: map('Headers', value('Expected value', '', { default: '' }), 'x-mode', 'Header names are case-insensitive.'),
        query: map('Query parameters', value('Expected value', '', { default: '' }), 'mode', 'Query values are strings; repeated query values can be arrays.'),
        body: value('Request body', 'Objects match a subset of properties. Arrays and primitive values must match exactly.')
    }, 'All configured conditions must match. An empty condition matches every request.');
    const responseFields = {
        response: value('Response body', 'Build JSON objects and arrays or return text, numbers, booleans, and null. Template values can come from the request.', { templated: true, exclusive: ['data'] }),
        data: { kind: 'reference', label: 'Data source', target: 'data', default: '', help: 'Read a configured text, CSV, or folder source instead of an inline response.', exclusive: ['response'] },
        responseStatus: number('Status code', 200, 200, 599, 'HTTP response status. Defaults to 200.'),
        delay: number('Response delay (ms)', 0, 0, 2147483647, 'Simulate a slower dependency.'),
        responseContentType: text('Content type', 'Automatic when omitted. For example: application/json or text/plain.', { default: 'application/json', suggestions: ['application/json', 'text/plain', 'text/html', 'application/xml', 'application/octet-stream'] }),
        responseHeaders: map('Response headers', value('Header value', '', { default: '', types: ['string', 'number'], templated: true }), 'X-Custom-Header', 'Header values support request templates. Framing headers are managed by the server.'),
        handler: { kind: 'reference', label: 'Custom handler', target: 'customHandlers', default: '', help: 'Run a configured JavaScript handler to transform the response.' },
        summary: text('Summary', 'A short name for this endpoint.'),
        description: text('Description', 'Longer description for API documentation.', { multiline: true }),
        requestBody,
        parameters: array('Documented parameters', parameter),
        responseSchema: schemaOrBoolean,
        responseExample: value('Response example', 'Override the example shown in OpenAPI documentation.')
    };
    const response = object('Response overrides', responseFields, 'Only enabled options override the base response. Headers are merged with the base headers.');
    const variant = object('Conditional response', { match: { ...match, required: true }, ...responseFields }, 'The first matching variant wins. Unmatched requests use the base response.', { default: { match: {}, responseStatus: 200 } });
    const endpoint = object('Endpoint', {
        ...responseFields, match,
        variants: array('Conditional responses', variant, 'Return different responses based on query parameters, headers, or request bodies.', { default: [{ match: {}, responseStatus: 200 }], exclusive: ['sequence', 'sequenceMode'] }),
        sequence: array('Response sequence', response, 'Return steps in order. Omitted step options inherit from the base response.', { default: [{ responseStatus: 503 }, { responseStatus: 200 }], exclusive: ['variants'] }),
        sequenceMode: { ...select('After the last step', [{ value: 'hold', label: 'Keep returning the last step' }, { value: 'cycle', label: 'Repeat from the first step' }], 'hold'), dependsOn: 'sequence' }
    }, '', { groups: {
        'Response': ['summary', 'response', 'data', 'responseStatus', 'delay', 'responseContentType', 'responseHeaders', 'handler'],
        'Request matching': ['match'],
        'Scenarios': ['variants', 'sequence', 'sequenceMode'],
        'API documentation': ['description', 'requestBody', 'parameters', 'responseSchema', 'responseExample']
    } });
    const legacyEndpoint = { ...endpoint, fields: { verb: { ...select('HTTP method', methods, 'get'), required: true }, ...endpoint.fields } };
    const endpointMethods = map('HTTP methods', endpoint, 'get', 'Add a response for each HTTP method at this path.', { keyOptions: methods, default: { get: { response: { message: 'Hello, world!' } } }, itemDefault: { response: { message: 'Hello, world!' } }, addLabel: 'Add method' });
    const route = { kind: 'route', label: 'Endpoint path', endpointMethods, legacyEndpoint, default: endpointMethods.default };
    const source = object('Data source', {
        path: { ...text('File or folder path', 'Relative paths resolve from the configuration file directory. The file must exist on the server.', { default: './testdata/data.csv' }), required: true },
        reader: { ...select('Reader', [{ value: 'csv', label: 'CSV records' }, { value: 'text', label: 'Text / JSON file' }, { value: 'folder', label: 'Folder of files' }], 'csv', 'Folder readers select a file using the request URL.'), required: true },
        properties: { kind: 'tuple', label: 'CSV reading options', help: 'These options affect CSV readers. Omit them to use JSON, sequential order, starting at record 0.', default: ['json', 'seq', 0], items: [
            select('Output format', [{ value: 'json', label: 'JSON object' }, { value: 'text', label: 'Raw fields' }], 'json'),
            select('Record selection', [{ value: 'seq', label: 'Sequential' }, { value: 'rand', label: 'Random' }], 'seq'),
            number('Starting record', 0, -1, Number.MAX_SAFE_INTEGER, 'Use -1 to return every record on each request; otherwise use a zero-based index.')
        ] }
    }, '', { default: { path: './testdata/data.csv', reader: 'csv' } });
    const stringOrList = label => union(label, [{ label: 'Single value or wildcard', schema: text('Value', '', { default: '*' }) }, { label: 'List of values', schema: array('Values', text('Value')) }]);
    const corsOptions = object('CORS options', {
        origins: stringOrList('Allowed origins'), methods: stringOrList('Allowed methods'), headers: stringOrList('Allowed headers'),
        credentials: flag('Allow credentials', true, 'The response echoes the allowed request origin when credentials are enabled.')
    }, 'Omitted origins, methods, and headers use the server defaults.');
    const docsInfo = object('API information', {
        title: text('Title', '', { default: 'MockAPI' }), version: text('API version', '', { default: '1.0.0' }), description: text('Description', '', { multiline: true })
    });
    const docs = object('Documentation options', {
        enabled: flag('Enabled', true), docsPath: text('Documentation path', '', { default: '/docs' }), specPath: text('OpenAPI JSON path', '', { default: '/openapi.json' }),
        info: { ...docsInfo, help: 'These values take precedence over the legacy title, version, and description options below.' },
        ...docsInfo.fields
    });
    const admin = object('Administration options', {
        enabled: flag('Enabled', true, 'Manage the enabled state in the file. A process started with --ui keeps this enabled.'),
        path: text('Console base path', 'Changing this in a live browser save is blocked. Download the draft and update the file.', { default: '/__mockapi' }),
        token: { ...text('Admin token', 'Managed in the configuration file. Tokens are never returned to the console.'), locked: true },
        historyLimit: number('Request history limit', 100, 1, 10000, 'The maximum number of recorded requests kept in memory.'),
        bodyLimit: number('Recorded body limit (bytes)', 16384, 0, 1073741824, 'Must not exceed the maximum request body size. Default: the smaller of 16 KiB and the request body limit.')
    });
    const fields = {
        port: { ...number('Listening port', 8080, 0, 65535, 'Requires a restart. Use 0 to let the operating system select a free port.'), required: true },
        host: text('Listening host', 'Requires a restart. Omit to use the system default binding.', { default: '127.0.0.1' }),
        log: select('Logging level', ['verbose', 'debug', 'error', 'none'], 'verbose'),
        maxBodyBytes: number('Maximum request body (bytes)', 1048576, 1, 1073741824, 'Default: 1 MiB. Larger mock requests are rejected.'),
        requestTimeout: number('Request timeout (ms)', 30000, 1, 2147483647, 'Default: 30 seconds.'),
        staticPath: text('Static files directory', 'Serve unmatched GET/HEAD requests from this existing directory.', { default: './public' }),
        externalModulesPath: text('Handler directory', 'Resolve custom handler filenames from this directory. Default: apiHandlers beside the configuration file.', { default: './apiHandlers' }),
        endpoints: map('Endpoints', route, '/api/new', 'Create paths, add HTTP methods, and configure their responses.', { addLabel: 'Add endpoint', keyLabel: 'Endpoint path' }),
        data: map('Data sources', source, 'source', 'Connect responses to existing files on the server. Edit inline response values under Endpoints.', { addLabel: 'Add data source', keyLabel: 'Source name' }),
        customHandlers: map('Custom handlers', text('Module filename', 'A JavaScript module exporting a process function. Supports .js, .cjs, and .mjs.', { default: 'myCustomHandler.js' }), 'handler', 'Register handlers, then select them in endpoint responses. Loading a handler executes its module code.', { addLabel: 'Add handler', keyLabel: 'Handler name' }),
        enableCors: union('Cross-origin requests', [{ label: 'Disabled', value: false }, { label: 'Enabled with defaults', value: true }, { label: 'Custom options', schema: corsOptions }]),
        openApi: union('API documentation', [{ label: 'Enabled with defaults', value: true }, { label: 'Disabled', value: false }, { label: 'Custom options', schema: docs }], 'OpenAPI documentation is enabled by default.'),
        admin: union('Administration', [{ label: 'Enabled with defaults', value: true }, { label: 'Disabled', value: false }, { label: 'Custom options', schema: admin }], 'Live saves cannot disable administration, change its path, or change its token.'),
        tls: object('HTTPS certificates', {
            cert: { ...text('Certificate file', 'Path to a PEM certificate on the server.'), required: true },
            key: { ...text('Private key file', 'Path to the matching PEM private key on the server.'), required: true }
        }, 'Requires a restart. Download your draft and update the configuration file to change TLS.')
    };
    const sections = [
        { id: 'general', label: 'Server', description: 'Control logging, request limits, and how your mock API listens.', keys: ['port', 'host', 'log', 'maxBodyBytes', 'requestTimeout', 'staticPath', 'tls'] },
        { id: 'endpoints', label: 'Endpoints', description: 'Build responses, match requests, and simulate changing behavior.', keys: ['endpoints'] },
        { id: 'data', label: 'Data sources', description: 'Reuse existing files as mock responses.', keys: ['data'] },
        { id: 'handlers', label: 'Handlers', description: 'Register custom response handlers.', keys: ['externalModulesPath', 'customHandlers'] },
        { id: 'cors', label: 'CORS', description: 'Choose which applications can call your mock API from a browser.', keys: ['enableCors'] },
        { id: 'docs', label: 'Documentation', description: 'Configure the automatically generated API reference.', keys: ['openApi'] },
        { id: 'admin', label: 'Administration', description: 'Configure request recording and review console access settings.', keys: ['admin'] }
    ];
    return { fields, sections, endpoint, responseFields, source, methods, value };
});
