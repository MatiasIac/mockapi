const parser = require('./urlParser');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const constants = require('./constants');
const handlerLoader = require('./configurationParser');
const openApi = require('./openApi');

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain',
    '.xml': 'application/xml',
    '.pdf': 'application/pdf'
};

class Core {

    _logger = null;
    _port = 0;
    _cors = null;
    _endpointList = [];
    _logLevel = ""
    _modulesProxy = null;
    _configurations = null;
    _data = null;
    _staticPath = null;
    _connections = new Set();
    _tls = null;
    _openApi = null;
    _openApiSpec = null;

    constructor(logger, configurations, modulesProxy) {
        this._configurations = configurations;
        this._logger = logger;
        this._port = configurations.port;
        this._cors = this._parseCors(configurations.enableCors);
        this._endpointList = configurations.endpoints;
        this._modulesProxy = modulesProxy;
        this._staticPath = configurations.staticPath || null;
        this._tls = this._parseTls(configurations.tls);
        this._openApi = this._parseOpenApi(configurations.openApi);

        this._data = configurations.data || { };
        handlerLoader.loadHandlersFromConfiguration(this._data);
        this._refreshOpenApiSpec();
    }

    _parseTls(tlsConfig) {
        if (!tlsConfig || !tlsConfig.cert || !tlsConfig.key) return null;

        try {
            return {
                cert: fs.readFileSync(tlsConfig.cert),
                key: fs.readFileSync(tlsConfig.key)
            };
        } catch (error) {
            this._logger.error(`Failed to load TLS certificates: ${error.message}`);
            return null;
        }
    }

    _parseCors(corsConfig) {
        if (!corsConfig) return null;

        if (corsConfig === true) {
            return { origins: '*', methods: '*', headers: '*' };
        }

        return {
            origins: corsConfig.origins || '*',
            methods: corsConfig.methods || '*',
            headers: corsConfig.headers || '*'
        };
    }

    _normalizeRoutePath(routePath, fallbackPath) {
        if (typeof routePath !== 'string' || routePath.trim() === '') return fallbackPath;

        let normalized = routePath.trim();

        if (!normalized.startsWith('/')) {
            normalized = `/${normalized}`;
        }

        if (normalized.length > 1 && normalized.endsWith('/')) {
            normalized = normalized.slice(0, -1);
        }

        return normalized;
    }

    _parseOpenApi(openApiConfig) {
        const defaultConfig = {
            enabled: true,
            docsPath: '/docs',
            specPath: '/openapi.json',
            title: 'MockAPI',
            version: '1.0.0',
            description: 'OpenAPI definition generated from .mockapi-config.'
        };

        if (openApiConfig === false) {
            return {
                ...defaultConfig,
                enabled: false
            };
        }

        if (openApiConfig === true || openApiConfig === undefined || openApiConfig === null) {
            return defaultConfig;
        }

        if (typeof openApiConfig !== 'object') {
            return defaultConfig;
        }

        const infoConfig = openApiConfig.info || {};

        return {
            enabled: openApiConfig.enabled !== false,
            docsPath: this._normalizeRoutePath(openApiConfig.docsPath, defaultConfig.docsPath),
            specPath: this._normalizeRoutePath(openApiConfig.specPath, defaultConfig.specPath),
            title: infoConfig.title || openApiConfig.title || defaultConfig.title,
            version: infoConfig.version || openApiConfig.version || defaultConfig.version,
            description: infoConfig.description || openApiConfig.description || defaultConfig.description
        };
    }

    _refreshOpenApiSpec() {
        this._openApiSpec = openApi.buildSpec(this._openApi, this._endpointList);
    }

    _applyCorsHeaders(request, response) {
        if (!this._cors) return false;

        const origin = request.headers['origin'] || '*';
        const allowedOrigin = this._cors.origins === '*'
            ? '*'
            : (this._cors.origins.includes(origin) ? origin : null);

        if (!allowedOrigin) return false;

        response.setHeader('Access-Control-Allow-Origin', allowedOrigin);

        const methods = this._cors.methods === '*'
            ? 'GET, POST, PUT, DELETE, PATCH, OPTIONS'
            : (Array.isArray(this._cors.methods) ? this._cors.methods.join(', ') : this._cors.methods);
        response.setHeader('Access-Control-Allow-Methods', methods);

        const headers = this._cors.headers === '*'
            ? 'Content-Type, Authorization, X-Requested-With'
            : (Array.isArray(this._cors.headers) ? this._cors.headers.join(', ') : this._cors.headers);
        response.setHeader('Access-Control-Allow-Headers', headers);

        return true;
    }

    _serveStaticFile(request, response, urlPath) {
        const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
        const filePath = path.join(this._staticPath, safePath);
        const resolvedPath = path.resolve(filePath);
        const resolvedStatic = path.resolve(this._staticPath);

        if (!resolvedPath.startsWith(resolvedStatic)) {
            response.statusCode = constants.HTTP_STATUS_CODES.FORBIDDEN;
            response.end('Forbidden');
            return;
        }

        if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
            return false;
        }

        const ext = path.extname(resolvedPath).toLowerCase();
        const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

        this._logger.info(`Serving static file: ${resolvedPath}`);

        response.statusCode = constants.HTTP_STATUS_CODES.OK;
        response.setHeader('Content-Type', mimeType);
        this._applyCorsHeaders(request, response);

        const stream = fs.createReadStream(resolvedPath);
        stream.pipe(response);

        return true;
    }

    _handleOpenApiRequest(request, response, pathName) {
        if (!this._openApi || this._openApi.enabled === false || request.method !== 'GET') {
            return false;
        }

        if (pathName === this._openApi.specPath) {
            response.statusCode = constants.HTTP_STATUS_CODES.OK;
            response.setHeader('Content-Type', 'application/json');
            this._applyCorsHeaders(request, response);
            response.end(JSON.stringify(this._openApiSpec, null, 2));
            return true;
        }

        if (pathName === this._openApi.docsPath || pathName === `${this._openApi.docsPath}/`) {
            response.statusCode = constants.HTTP_STATUS_CODES.OK;
            response.setHeader('Content-Type', 'text/html; charset=utf-8');
            this._applyCorsHeaders(request, response);
            response.end(openApi.buildDocsPage(this._openApi));
            return true;
        }

        return false;
    }

    run() {
        const self = this;

        const requestHandler = (request, response) => {

            // Handle CORS preflight requests
            if (request.method === 'OPTIONS' && self._cors) {
                self._applyCorsHeaders(request, response);
                response.statusCode = constants.HTTP_STATUS_CODES.NO_CONTENT;
                response.end();
                return;
            }

            const urlInformation = parser.parse(request.url);

            if (self._handleOpenApiRequest(request, response, urlInformation.pathname)) {
                return;
            }

            let bodyPayload = [];
        
            request.on('data', (chunk) => {
                bodyPayload.push(chunk);
            }).on('end', () => {
                bodyPayload = Buffer.concat(bodyPayload).toString();
        
                self._logger.info(`Requesting: ${urlInformation.base} - Verb: ${request.method}`);
        
                if (bodyPayload !== '') {
                    self._logger.info(`Incoming body: ${bodyPayload}`);
                }
        
                let actionFound = false;
                let responseBody = null;
                let responseStatus = null;
                let contentType = null;
                let delay = 0;
        
                for (const endpointUrl in self._endpointList) {
                    if (Object.hasOwnProperty.call(self._endpointList, endpointUrl)) {
                        const endpoint = self._endpointList[endpointUrl];
                        const requestMethod = request.method.toLowerCase();
                        
                        const pathResult = parser.matchPath(endpointUrl, urlInformation.base);

                        if (
                            pathResult.match && 
                            (endpoint.verb === "any" || endpoint.verb.toLowerCase() === requestMethod)
                        ) {
        
                            if (endpoint.data !== undefined && self._data[endpoint.data] === undefined) {
                                self._logger.error("No matching data variable for this request");
                                break;
                            }

                            // Merge path params and query params into urlInformation
                            urlInformation.params = pathResult.params;
                            urlInformation.query = Object.fromEntries(urlInformation.search);
        
                            actionFound = true;
                            contentType = endpoint.responseContentType;
                            delay = endpoint.delay || 0;
        
                            try {
                                const processData = endpoint.data === undefined ?
                                    "" : 
                                    self._data[endpoint.data].dataHandler(urlInformation);
        
                                responseBody = endpoint.handler !== undefined ?
                                    self._modulesProxy.execute(endpoint.handler, { 
                                        method: requestMethod, 
                                        url: endpointUrl, 
                                        body: bodyPayload,
                                        params: urlInformation.params,
                                        query: urlInformation.query
                                    }, processData) : processData;
                                
                                responseStatus = endpoint.responseStatus;
                            } catch(ex) {
                                self._logger.error(`${ex.message}`);
        
                                responseStatus = ex.httpStatusCode;
                                responseBody = ex.message;
                            }
                            
                            break;
                        }
                    }
                }
        
                const sendResponse = () => {
                    // Try static file serving before returning 404
                    if (!actionFound && self._staticPath) {
                        const served = self._serveStaticFile(request, response, urlInformation.pathname);
                        if (served !== false) return;
                    }

                    response.statusCode = responseStatus || 
                        (!actionFound ? 
                            constants.HTTP_STATUS_CODES.NOT_FOUND : 
                            constants.HTTP_STATUS_CODES.OK);
        
                    response.setHeader('Content-Type', contentType || constants.DEFAULT_CONTENT_TYPE);
                    
                    self._applyCorsHeaders(request, response);
        
                    response.end(responseBody);
                };

                if (delay > 0) {
                    self._logger.info(`Delaying response by ${delay}ms`);
                    setTimeout(sendResponse, delay);
                } else {
                    sendResponse();
                }
            });
        };

        this._server = this._tls
            ? https.createServer(this._tls, requestHandler)
            : http.createServer(requestHandler);

        this._server.listen(self._port);

        this._server.on('connection', (socket) => {
            self._connections.add(socket);
            socket.on('close', () => self._connections.delete(socket));
        });
    }

    reload(configurations) {
        this._configurations = configurations;
        this._port = configurations.port;
        this._cors = this._parseCors(configurations.enableCors);
        this._endpointList = configurations.endpoints;
        this._staticPath = configurations.staticPath || null;
        this._openApi = this._parseOpenApi(configurations.openApi);

        this._data = configurations.data || {};
        handlerLoader.loadHandlersFromConfiguration(this._data);
        this._refreshOpenApiSpec();

        this._logger.info('Configuration reloaded');
    }

    stop(callback) {
        if (this._server) {
            this._server.close(callback);
            for (const socket of this._connections) {
                socket.destroy();
            }
            this._connections.clear();
        } else if (callback) {
            callback();
        }
    }
}

module.exports = Core;
