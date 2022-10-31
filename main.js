#!/usr/bin/env node

'use strict';

const LOG = require('./modules/log');
const YAML = require('yaml');
const constants = require('./modules/constants');
const readers = require('./modules/readers');
const ModuleProxy = require('./modules/moduleProxy');
const CLI = require('./modules/cli');
const CORE = require('./modules/core');

const rootPath = process.cwd();
const configFilePath = `${rootPath}/${constants.CONFIG_FILE_NAME}`;

const cli = new CLI(configFilePath);

if (cli.hasCommands()) {
    cli.executeCommandLine();
    return false;
}

if (!readers.file_exists(configFilePath)) {
    console.log(`Configuration file not found. Please run ${constants.COLOR.fgGreen}--init${constants.COLOR.reset} using the CLI.`);
    return false;
}

const configFile = readers.text_reader(configFilePath);
const parsedConfiguration = YAML.parse(configFile());

if (parsedConfiguration.port === undefined) throw new Error("port property is required");

const logLevel = parsedConfiguration.log || constants.LOG_LEVELS.ALL;
const log = new LOG(logLevel);
const moduleProxy = new ModuleProxy(parsedConfiguration.externalModulesPath || constants.EXTERNAL_MODULES_PATH, log);

if (parsedConfiguration.customHandlers !== undefined) {
    moduleProxy.load(parsedConfiguration.customHandlers);
}

log.message(``);
log.message(`Mock API configuration:`);
log.message(`  PORT: ${constants.COLOR.fgGreen}${parsedConfiguration.port}${constants.COLOR.reset}`);
log.message(`  CORS enabled: ${parsedConfiguration.enableCors ? constants.COLOR.fgGreen : constants.COLOR.fgRed}${parsedConfiguration.enableCors}${constants.COLOR.reset}`);
log.message(``);

log.message(`> Mock API attempting to use port: ${constants.COLOR.fgRed}${parsedConfiguration.port}${constants.COLOR.reset}`)

const core = new CORE(log, parsedConfiguration, moduleProxy);
core.run();

log.message(`> Mock API listening on port: ${constants.COLOR.fgGreen}${parsedConfiguration.port}${constants.COLOR.reset}`)
log.message(``);