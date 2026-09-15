const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const HttpException = require('./HttpException');

class Proxy {
    constructor(externalModulePath, logger) {
        this._externalModuleList = Object.create(null);
        this._logger = logger;
        this._externalModulePath = externalModulePath.startsWith('file:') ? fileURLToPath(externalModulePath) : externalModulePath;
    }

    async load(modules) {
        const loaded = Object.create(null);
        for (const [name, filename] of Object.entries(modules)) {
            const modulePath = path.resolve(this._externalModulePath, /\.(?:[cm]?js)$/.test(filename) ? filename : filename + '.js');
            try {
                if (modulePath.endsWith('.mjs')) {
                    const module = await import(pathToFileURL(modulePath).href + '?reload=' + randomUUID());
                    loaded[name] = module.process ? module : module.default;
                } else {
                    const resolved = require.resolve(modulePath);
                    delete require.cache[resolved];
                    const module = require(resolved);
                    loaded[name] = module.process ? module : module.default;
                }
                if (typeof loaded[name]?.process !== 'function') throw new Error('must export a process function');
                this._logger.info(`Module '${name}' was loaded`);
            } catch (error) { throw new Error(`customHandlers.${name}: ${error.message}`); }
        }
        this._externalModuleList = loaded;
    }

    async execute(name, requestInformation, data) {
        const module = this._externalModuleList[name];
        if (!module) throw new HttpException(500, `Module ${name} does not exist`);
        try { return await module.process(requestInformation, data); }
        catch (error) {
            if (error instanceof HttpException) throw error;
            throw new HttpException(500, `Module ${name} failed. ${error.message || error}`);
        }
    }
}

module.exports = Proxy;
