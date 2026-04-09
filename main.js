#!/usr/bin/env node

'use strict';

const LOG = require('./modules/log');
const YAML = require('yaml');
const constants = require('./modules/constants');
const readers = require('./modules/readers');
const ModuleProxy = require('./modules/moduleProxy');
const CLI = require('./modules/cli');
const CORE = require('./modules/core');
const banner = require('./modules/banner');
const ConfigWatcher = require('./modules/configWatcher');

const rootPath = process.cwd();
const configFilePath = `${rootPath}/${constants.CONFIG_FILE_NAME}`;

const cli = new CLI(configFilePath);

if (cli.hasCommands()) {
    cli.executeCommandLine();
    process.exit(0);
}

if (!readers.file_exists(configFilePath)) {
    console.log(`Configuration file not found. Please run ${constants.COLOR.fgGreen}--init${constants.COLOR.reset} using the CLI.`);
    process.exit(1);
}

const configFile = readers.text_reader(configFilePath);
const parsedConfiguration = YAML.parse(configFile());

if (parsedConfiguration.port === undefined) throw new Error("port property is required");

const logLevel = parsedConfiguration.log || constants.LOG_LEVELS.ALL;
const log = new LOG(logLevel);
const moduleProxy = new ModuleProxy(`file://${rootPath}/${(parsedConfiguration.externalModulesPath || constants.EXTERNAL_MODULES_PATH)}`, log);

if (parsedConfiguration.customHandlers !== undefined) {
    moduleProxy.load(parsedConfiguration.customHandlers);
}

log.message(``);
banner.display();
log.message(`Mock API configuration:`);
log.message(`  PORT: ${constants.COLOR.fgGreen}${parsedConfiguration.port}${constants.COLOR.reset}`);
log.message(`  CORS enabled: ${parsedConfiguration.enableCors ? constants.COLOR.fgGreen : constants.COLOR.fgRed}${!!parsedConfiguration.enableCors}${constants.COLOR.reset}`);
log.message(`  HTTPS: ${parsedConfiguration.tls ? constants.COLOR.fgGreen + 'enabled' : constants.COLOR.fgRed + 'disabled'}${constants.COLOR.reset}`);
if (parsedConfiguration.staticPath) {
    log.message(`  Static files: ${constants.COLOR.fgGreen}${parsedConfiguration.staticPath}${constants.COLOR.reset}`);
}
log.message(``);

const protocol = parsedConfiguration.tls ? 'https' : 'http';

log.message(`> Mock API attempting to use port: ${constants.COLOR.fgRed}${parsedConfiguration.port}${constants.COLOR.reset}`)

const core = new CORE(log, parsedConfiguration, moduleProxy);
core.run();

log.message(`> Mock API listening on ${constants.COLOR.fgGreen}${protocol}://localhost:${parsedConfiguration.port}${constants.COLOR.reset}`);

const watcher = new ConfigWatcher(configFilePath, log, (newConfig) => {
    core.reload(newConfig);
    log.message(`> Configuration reloaded. Endpoints updated.`);
});
watcher.watch();

log.message(`> Hot-reload enabled. Watching ${constants.COLOR.fgYellow}${constants.CONFIG_FILE_NAME}${constants.COLOR.reset} for changes.`);
log.message(``);

let isShuttingDown = false;

const shutdown = (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    log.message(`\n> ${signal} received. Shutting down gracefully...`);
    watcher.stop();
    core.stop(() => {
        log.message(`> Mock API stopped.`);
        process.exit(0);
    });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));