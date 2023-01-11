const parser = require('./urlParser');
const http = require('http');
const constants = require('./constants');
const handlerLoader = require('./configurationParser');

class Core {

    _logger = null;
    _port = 0;
    _enableCors = false;
    _endpointList = [];
    _logLevel = ""
    _modulesProxy = null;
    _configurations = null;
    _data = null;

    constructor(logger, configurations, modulesProxy) {
        this._configurations = configurations;
        this._logger = logger;
        this._port = configurations.port;
        this._enableCors = configurations.enableCors;
        this._endpointList = configurations.endpoints;
        this._modulesProxy = modulesProxy;

        this._data = configurations.data || { };
        handlerLoader.loadHandlersFromConfiguration(this._data);
    }

    run() {
        const self = this;

        http.createServer((request, response) => {
            let bodyPayload = [];
        
            request.on('data', (chunk) => {
                bodyPayload.push(chunk);
            }).on('end', () => {
                bodyPayload = Buffer.concat(bodyPayload).toString();
        
                const urlInformation = parser.parse(request.url);
        
                self._logger.info(`Requesting: ${urlInformation.base} - Verb: ${request.method}`);
        
                if (bodyPayload !== '') {
                    self._logger.info(`Incoming body: ${bodyPayload}`);
                }
        
                let actionFound = false;
                let responseBody = null;
                let responseStatus = null;
                let contentType = null;
        
                for (const endpointUrl in self._endpointList) {
                    if (Object.hasOwnProperty.call(self._endpointList, endpointUrl)) {
                        const endpoint = self._endpointList[endpointUrl];
                        const requestMethod = request.method.toLowerCase();
                        
                        if (
                            endpointUrl === urlInformation.base && 
                            (endpoint.verb === "any" || endpoint.verb.toLowerCase() === requestMethod)
                        ) {
        
                            if (endpoint.data !== undefined && self._data[endpoint.data] === undefined) {
                                self._logger.error("No matching data variable for this request");
                                break;
                            }
        
                            actionFound = true;
                            contentType = endpoint.responseContentType;
        
                            try {
                                const processData = endpoint.data === undefined ?
                                    "" : 
                                    self._data[endpoint.data].dataHandler(urlInformation);
        
                                responseBody = endpoint.handler !== undefined ?
                                    self._modulesProxy.execute(endpoint.handler, { 
                                        method: requestMethod, 
                                        url: endpointUrl, 
                                        body: bodyPayload
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
        
                response.statusCode = responseStatus || 
                    (!actionFound ? 
                        constants.HTTP_STATUS_CODES.NOT_FOUND : 
                        constants.HTTP_STATUS_CODES.OK);
        
                response.setHeader('Content-Type', contentType || constants.DEFAULT_CONTENT_TYPE);
                
                self._enableCors && response.setHeader('Access-Control-Allow-Origin', '*');
        
                response.end(responseBody);
            });
        }).listen(self._port);
    }
}

module.exports = Core;