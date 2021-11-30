const http = require('http');
const LOG = require('./modules/log');
const YAML = require('yaml');
const constants = require('./modules/constants');
const readers = require('./modules/readers');
const parser = require('./modules/urlParser');
const handlerInjector = require('./modules/configurationParser');
const ModuleProxy = require('./modules/moduleProxy')

const rootPath = __dirname;
const configFile = readers.text_reader(`${rootPath}/${constants.CONFIG_FILE_NAME}`);
const parsedConfiguration = YAML.parse(configFile());

if (parsedConfiguration.port === undefined) throw new Error("port property is required");

const port = parsedConfiguration.port;
const enableCors = parsedConfiguration.enableCors;
const endpointList = parsedConfiguration.endpoints;
const logLevel = parsedConfiguration.log || constants.LOG_LEVELS.ALL;
const log = new LOG(logLevel);
const moduleProxy = new ModuleProxy(parsedConfiguration.externalModulesPath || constants.EXTERNAL_MODULES_PATH, log);

if (parsedConfiguration.customHandlers !== undefined) {
    moduleProxy.load(parsedConfiguration.customHandlers);
}

let data = parsedConfiguration.data || { };
handlerInjector.loadHandlersFromConfiguration(data);

log.message(``);
log.message(`Mock API configuration:`);
log.message(`  PORT: ${constants.COLOR.fgGreen}${port}${constants.COLOR.reset}`);
log.message(`  CORS enabled: ${enableCors ? constants.COLOR.fgGreen : constants.COLOR.fgRed}${enableCors}${constants.COLOR.reset}`);
log.message(``);

log.message(`> Mock API attempting to use port: ${constants.COLOR.fgRed}${port}${constants.COLOR.reset}`)

http.createServer((request, response) => {
    let bodyPayload = [];

    request.on('data', (chunk) => {
        bodyPayload.push(chunk);
    }).on('end', () => {
        bodyPayload = Buffer.concat(bodyPayload).toString();

        const urlInformation = parser.parse(request.url);

        log.info(`Requesting: ${urlInformation.base} - Verb: ${request.method}`);

        if (bodyPayload !== '') {
            log.info(`Incoming body: ${bodyPayload}`);
        }

        let actionFound = false;
        let responseBody = null;
        let responseStatus = null;
        let contentType = null;

        for (const endpointUrl in endpointList) {
            if (Object.hasOwnProperty.call(endpointList, endpointUrl)) {
                const endpoint = endpointList[endpointUrl];
                const requestMethod = request.method.toLowerCase();
                
                if (endpointUrl === urlInformation.base && (endpoint.verb === "any" || endpoint.verb.toLowerCase() === requestMethod)) {

                    if (endpoint.data !== undefined && data[endpoint.data] === undefined) {
                        log.error("No matching data variable for this request");
                        break;
                    }

                    actionFound = true;
                    contentType = endpoint.responseContentType;

                    try {
                        const processData = endpoint.data === undefined ? "" : data[endpoint.data].dataHandler(urlInformation);

                        responseBody = endpoint.handler !== undefined ?
                            moduleProxy.execute(endpoint.handler, { method: requestMethod, url: endpointUrl, body: bodyPayload }, processData) :
                            processData;
                        
                        responseStatus = endpoint.responseStatus;
                    } catch(ex) {
                        log.error(`${ex.message}`);

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
        
        enableCors && response.setHeader('Access-Control-Allow-Origin', '*');

        response.end(responseBody);
    });
}).listen(port);

log.message(`> Mock API listening on port: ${constants.COLOR.fgGreen}${port}${constants.COLOR.reset}`)
log.message(``);