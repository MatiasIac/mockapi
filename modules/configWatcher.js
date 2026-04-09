const fs = require('fs');
const YAML = require('yaml');
const readers = require('./readers');

class ConfigWatcher {

    _filePath = '';
    _logger = null;
    _onChange = null;
    _watcher = null;
    _debounceTimer = null;

    constructor(filePath, logger, onChange) {
        this._filePath = filePath;
        this._logger = logger;
        this._onChange = onChange;
    }

    watch() {
        this._logger.info(`Watching configuration file for changes: ${this._filePath}`);

        this._watcher = fs.watch(this._filePath, (eventType) => {
            if (eventType !== 'change') return;

            // Debounce rapid file system events
            clearTimeout(this._debounceTimer);
            this._debounceTimer = setTimeout(() => {
                this._reload();
            }, 300);
        });
    }

    _reload() {
        try {
            const configFile = readers.text_reader(this._filePath);
            const parsedConfiguration = YAML.parse(configFile());

            if (parsedConfiguration.port === undefined) {
                this._logger.error('Hot-reload skipped: port property is required');
                return;
            }

            this._logger.message('');
            this._logger.info('Configuration file changed. Reloading...');
            this._onChange(parsedConfiguration);
        } catch (error) {
            this._logger.error(`Hot-reload failed: ${error.message}`);
        }
    }

    stop() {
        if (this._watcher) {
            this._watcher.close();
            this._watcher = null;
        }
        clearTimeout(this._debounceTimer);
    }
}

module.exports = ConfigWatcher;
