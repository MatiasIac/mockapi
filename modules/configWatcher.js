const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

class ConfigWatcher {
    constructor(filePath, logger, onChange) {
        this._filePath = path.resolve(filePath);
        this._logger = logger;
        this._onChange = onChange;
        this._stopped = true;
        this._queue = Promise.resolve();
    }

    watch() {
        if (!this._stopped) return;
        this._stopped = false;
        // Watching the directory survives editor saves that replace the file's inode.
        this._watcher = fs.watch(path.dirname(this._filePath), (_event, filename) => {
            if (filename && filename.toString() !== path.basename(this._filePath)) return;
            clearTimeout(this._timer);
            this._timer = setTimeout(() => {
                this._queue = this._queue.then(() => this._reload());
            }, 100);
        });
        this._watcher.on('error', error => this._logger.error(`Configuration watcher failed: ${error.message}`));
    }

    async _reload() {
        if (this._stopped) return;
        try {
            const contents = await fs.promises.readFile(this._filePath, 'utf8');
            const config = YAML.parse(contents);
            if (this._stopped) return;
            await this._onChange(config);
            this._logger.info('Configuration reloaded');
        } catch (error) { this._logger.error(`Hot-reload failed: ${error.message}`); }
    }

    stop() {
        this._stopped = true;
        clearTimeout(this._timer);
        this._watcher?.close();
        this._watcher = null;
        return this._queue;
    }
}

module.exports = ConfigWatcher;
