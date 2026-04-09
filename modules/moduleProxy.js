const constants = require("./constants");
const HttpException = require('./HttpException');

class Proxy {

    _externalModuleList = {};

    constructor(externalModulePath, logger) {
        this._externalModuleList = {};
        this._logger = logger;
        this._externalModulePath = externalModulePath;
    }

    async load(modules) {
        for (const moduleName in modules) {
            if (Object.hasOwnProperty.call(modules, moduleName)) {
                const moduleFileName = modules[moduleName];
                
                try {
                    const modulePath = `${this._externalModulePath}${moduleFileName}.js`;

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
        const module = this._externalModuleList[name];

        if (!module) {
            throw new HttpException(constants.HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR, `Module ${name} doesn't exist`);
        }

        try {
            return module.process(requestInformation, data);
        } catch (error) {
            throw new HttpException(constants.HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR, `Module ${name} failed. ${error}`);
        }
    }
    
}

module.exports = Proxy;