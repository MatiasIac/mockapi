'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const YAML = require('yaml');
const HttpException = require('./HttpException');
const ModuleProxy = require('./moduleProxy');
const { object, restartRequired } = require('./configuration');

// Keep the file watcher and browser writes in one queue. The original (relative)
// configuration is separate from the prepared runtime's absolute file paths.
class Management {
    constructor(core, options = {}) {
        this.core = core;
        this.filePath = options.configPath;
        this.contents = options.contents;
        this.transform = options.transform || (config => config);
        this.queue = Promise.resolve();
        this.lastError = null;
    }

    serialize(action) {
        const operation = this.queue.then(action);
        this.queue = operation.catch(() => {});
        return operation;
    }

    snapshot() {
        const config = structuredClone(this.core._state.source);
        if (object(config.admin)) delete config.admin.token;
        const state = this.core._state;
        return {
            config, revision: state.revision,
            instance: {
                version: require('../package.json').version,
                port: this.core._server?.address()?.port ?? state.config.port,
                tls: !!state.tls, startedAt: this.core._startedAt,
                configFile: this.filePath ? path.basename(this.filePath) : null,
                persistent: !!this.filePath, tokenRequired: !!state.admin.token,
                adminPath: state.admin.path, historyLimit: state.admin.historyLimit,
                docsPath: state.openApi.enabled ? state.openApi.docsPath : null,
                endpointCount: state.routes.length, reloadError: this.lastError
            }
        };
    }

    async prepare(input) {
        let config;
        try {
            config = typeof input.source === 'string' ? YAML.parse(input.source) : structuredClone(input.config);
            if (!object(config)) throw new Error('Configuration must be an object');
            // Credentials and the control URL are managed from the host configuration.
            if (object(config.admin) && Object.hasOwn(config.admin, 'token')) throw new Error('Change admin.token in the configuration file, not through the web console');
            if (this.core._state.admin.token) {
                config.admin = { ...(object(config.admin) ? config.admin : { enabled: config.admin === true }), token: this.core._state.admin.token };
            }
            const next = this.core._prepare(config, null);
            const changes = restartRequired(this.core._state.config, next.config);
            if (changes.length) throw new Error(`Restart required to change ${changes.join(', ')}`);
            if (!next.admin.enabled || next.admin.path !== this.core._state.admin.path) throw new Error('Change admin.enabled or admin.path in the configuration file, not through the web console');
            const proxy = new ModuleProxy(next.config.externalModulesPath, this.core._logger);
            await proxy.load(next.config.customHandlers);
            next.modulesProxy = proxy;
            return next;
        } catch (error) { throw new HttpException(400, error.message); }
    }

    async checkDisk() {
        if (!this.filePath) return;
        const contents = await fs.promises.readFile(this.filePath, 'utf8');
        if (contents !== this.contents) throw new HttpException(409, 'The configuration file changed. Wait for hot reload, then reload the latest configuration before saving.');
    }

    save(input, authorize = () => {}) {
        return this.serialize(async () => {
            authorize();
            const revision = this.core._state.revision;
            if (input.revision !== revision) throw new HttpException(409, 'Configuration changed in another window or on disk. Reload the latest configuration before saving.');
            await this.checkDisk();
            const next = await this.prepare(input);
            // Module imports can be asynchronous; do not overwrite a direct Core.reload.
            if (revision !== this.core._state.revision) throw new HttpException(409, 'Configuration changed while validating. Reload before saving.');
            await this.checkDisk();
            if (this.filePath) {
                const document = YAML.parseDocument(this.contents);
                if (document.errors.length) throw new HttpException(409, 'The configuration file is invalid. Fix it on disk before saving.');
                updateDocument(document, next.source);
                let contents = document.toString();
                // Editing an anchor can affect aliases elsewhere in a YAML document.
                // Expand them if preserving the syntax would change other responses.
                if (!isDeepStrictEqual(YAML.parse(contents), next.source)) contents = YAML.stringify(next.source);
                // Write alongside the target so rename is atomic on the same volume.
                const temporary = this.filePath + '.' + randomUUID() + '.tmp';
                try {
                    const stat = await fs.promises.stat(this.filePath);
                    await fs.promises.writeFile(temporary, contents, { flag: 'wx', mode: stat.mode & 0o777 });
                    await this.checkDisk();
                    if (revision !== this.core._state.revision) throw new HttpException(409, 'Configuration changed while saving. Reload before saving.');
                    await fs.promises.rename(temporary, this.filePath);
                    this.contents = contents;
                    this.savedContents = contents;
                } finally {
                    await fs.promises.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') this.core._logger.error(error.message); });
                }
            }
            this.core._apply(next);
            this.lastError = null;
            return this.snapshot();
        });
    }

    reloadFile() {
        return this.serialize(async () => {
            try {
                const contents = await fs.promises.readFile(this.filePath, 'utf8');
                if (contents === this.savedContents) { this.savedContents = undefined; this.lastError = null; return; }
                const config = this.transform(YAML.parse(contents));
                const next = this.core._prepare(config, null);
                const changes = restartRequired(this.core._state.config, next.config);
                if (changes.length) throw new Error(`Restart required to change ${changes.join(', ')}`);
                const proxy = new ModuleProxy(next.config.externalModulesPath, this.core._logger);
                await proxy.load(next.config.customHandlers);
                next.modulesProxy = proxy;
                this.core._apply(next);
                this.contents = contents;
                this.savedContents = undefined;
                this.lastError = null;
            } catch (error) { this.lastError = error.message; throw error; }
        });
    }
}

function updateDocument(document, config) {
    function update(keys, value) {
        const current = document.getIn(keys, true);
        if (isDeepStrictEqual(document.getIn(keys)?.toJSON?.() ?? document.getIn(keys), value)) return;
        if (YAML.isMap(current) && object(value)) {
            for (const pair of [...current.items]) if (!Object.hasOwn(value, String(pair.key.value))) current.delete(pair.key.value);
            for (const [key, child] of Object.entries(value)) update([...keys, key], child);
        } else document.setIn(keys, value);
    }
    update([], config);
}

module.exports = Management;
