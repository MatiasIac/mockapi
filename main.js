const http = require('http');
const YAML = require('yaml');
const constants = require("./modules/constants");
const readers = require("./modules/readers");
const parser = require("./modules/urlParser");
const handlerInjector = require("./modules/configurationParser");
const LOG = require("./modules/log");


const configFile = readers.text_reader(constants.CONFIG_FILE_NAME);
const parsedConfiguration = YAML.parse(configFile());

if (parsedConfiguration.port === undefined) throw new Error("port property is required");

const port = parsedConfiguration.port;
const endpointList = parsedConfiguration.endpoints;
const logLevel = parsedConfiguration.log || constants.LOG_LEVELS.ALL;
const log = new LOG(logLevel);

let data = parsedConfiguration.data || { };
handlerInjector.loadHandlersFromConfiguration(data);

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
                
                if (endpointUrl === urlInformation.base && (endpoint.verb === "any" || endpoint.verb.toLowerCase() === request.method.toLowerCase())) {

                    if (endpoint.response !== undefined && data[endpoint.response] === undefined) {
                        log.error("No matching data variable for this request");
                        break;
                    }

                    actionFound = true;
                    contentType = endpoint.responseContentType;

                    try {
                        responseBody = endpoint.response === undefined ? "" : data[endpoint.response].dataHandler(urlInformation);
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

        response.end(responseBody);
    });
}).listen(port);

log.message(`> Mock API listening on port: ${constants.COLOR.fgGreen}${port}${constants.COLOR.reset}`)