const http = require('http');
const constants = require('./constants');

const OPENAPI_VERSION = '3.1.0';
const DEFAULT_METHODS_FOR_ANY = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

const normalizeMethod = (verb) => {
    if (typeof verb !== 'string' || verb.trim() === '') return ['get'];

    const method = verb.toLowerCase();
    return method === 'any' ? DEFAULT_METHODS_FOR_ANY : [method];
};

const toOpenApiPath = (endpointPath) => {
    if (typeof endpointPath !== 'string' || endpointPath.trim() === '') return '/';
    return endpointPath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
};

const extractPathParameters = (endpointPath) => {
    if (typeof endpointPath !== 'string' || endpointPath.trim() === '') return [];

    const pathParameters = endpointPath.match(/:([A-Za-z0-9_]+)/g) || [];

    return pathParameters.map((parameter) => ({
        name: parameter.substring(1),
        in: 'path',
        required: true,
        schema: { type: 'string' }
    }));
};

const getResponseStatusCode = (endpointConfiguration) => {
    const status = parseInt(endpointConfiguration.responseStatus, 10);

    if (!Number.isNaN(status) && status >= 100 && status <= 599) {
        return status;
    }

    return constants.HTTP_STATUS_CODES.OK;
};

const buildResponseContent = (contentType) => {
    if (!contentType) return undefined;

    const isJsonContentType = contentType.toLowerCase().includes('json');

    return {
        [contentType]: {
            schema: isJsonContentType ? {} : { type: 'string' }
        }
    };
};

const buildOperation = (method, endpointPath, endpointConfiguration) => {
    const responseStatusCode = getResponseStatusCode(endpointConfiguration);
    const responseContentType = endpointConfiguration.responseContentType || constants.DEFAULT_CONTENT_TYPE;
    const responseDescription = http.STATUS_CODES[responseStatusCode] || 'Configured response';

    const operation = {
        summary: `${method.toUpperCase()} ${toOpenApiPath(endpointPath)}`,
        responses: {
            [responseStatusCode]: {
                description: responseDescription
            }
        }
    };

    const responseContent = buildResponseContent(responseContentType);
    if (responseContent !== undefined) {
        operation.responses[responseStatusCode].content = responseContent;
    }

    const parameters = extractPathParameters(endpointPath);
    if (parameters.length > 0) {
        operation.parameters = parameters;
    }

    const metadata = {};
    if (endpointConfiguration.data !== undefined) metadata.data = endpointConfiguration.data;
    if (endpointConfiguration.handler !== undefined) metadata.handler = endpointConfiguration.handler;
    if (endpointConfiguration.delay !== undefined) metadata.delay = endpointConfiguration.delay;

    if (Object.keys(metadata).length > 0) {
        operation['x-mockapi'] = metadata;
    }

    return operation;
};

const buildSpec = (settings, endpointList) => {
    const openApiSettings = settings || {};
    const endpoints = endpointList || {};
    const paths = {};

    for (const endpointPath in endpoints) {
        if (!Object.hasOwnProperty.call(endpoints, endpointPath)) continue;

        const endpointConfiguration = endpoints[endpointPath] || {};
        const openApiPath = toOpenApiPath(endpointPath);

        if (!paths[openApiPath]) {
            paths[openApiPath] = {};
        }

        const methods = normalizeMethod(endpointConfiguration.verb);
        for (const method of methods) {
            paths[openApiPath][method] = buildOperation(method, endpointPath, endpointConfiguration);
        }
    }

    return {
        openapi: OPENAPI_VERSION,
        info: {
            title: openApiSettings.title || 'MockAPI',
            version: openApiSettings.version || '1.0.0',
            description: openApiSettings.description || 'OpenAPI definition generated from .mockapi-config.'
        },
        servers: [{ url: '/' }],
        paths
    };
};

const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const escapeJsString = (value) => String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");

const buildDocsPage = (settings) => {
    const docsSettings = settings || {};
    const title = escapeHtml(docsSettings.title || 'MockAPI');
    const specPath = escapeJsString(docsSettings.specPath || '/openapi.json');

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} - API Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    <style>
      html, body {
        margin: 0;
        background: #f6f8fa;
      }
      #swagger-ui {
        min-height: 100vh;
      }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.onload = function() {
        window.ui = SwaggerUIBundle({
          url: '${specPath}',
          dom_id: '#swagger-ui',
          deepLinking: true,
          presets: [SwaggerUIBundle.presets.apis],
          layout: 'BaseLayout'
        });
      };
    </script>
  </body>
</html>`;
};

module.exports = {
    buildSpec,
    buildDocsPage,
    toOpenApiPath
};
