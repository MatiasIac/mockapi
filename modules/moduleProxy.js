const constants = require("./constants");
const HttpException = require('./HttpException');

class Proxy {

    _externalModuleList = {};

    constructor(logger) {
        this._externalModuleList = {};
        this._logger = logger;
    }

    async load(modules) {
        for (const moduleName in modules) {
            if (Object.hasOwnProperty.call(modules, moduleName)) {
                const moduleFileName = modules[moduleName];
                
                try {
                    const modulePath = `${constants.EXTERNAL_MODULES_PATH}${moduleFileName}.js`;

                    this._logger.info(`Attempting to load module ${moduleName} from ${modulePath}`);

                    const module = await import(modulePath);

                    this._externalModuleList[moduleName] = module;

                    this._logger.info(`Module '${moduleName}' was loaded`);
                } catch (error) {
                    this._logger.error(`Module '${moduleName}' failed during loading ${error}`);
                }
            }
        }
    }

    execute(name, requestInformation, data) {
        for (const moduleName in this._externalModuleList) {
            if (Object.hasOwnProperty.call(this._externalModuleList, moduleName) && moduleName === name) {
                const module = this._externalModuleList[moduleName];

                try {
                    return module.process(requestInformation, data);    
                } catch (error) {
                    throw new HttpException(constants.HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR, `Module ${moduleName} failed. ${error}`);
                }
                
            }
        }

        throw new HttpException(constants.HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR, `Module ${moduleName} doesn't exists`);
    }
    
}

module.exports = Proxy;