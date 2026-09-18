#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const YAML = require('yaml');
const Log = require('./modules/log');
const CLI = require('./modules/cli');
const Core = require('./modules/core');
const ModuleProxy = require('./modules/moduleProxy');
const ConfigWatcher = require('./modules/configWatcher');
const { prepareConfiguration } = require('./modules/configuration');
const banner = require('./modules/banner');

async function main() {
    const options = CLI.parse(process.argv.slice(2));
    const configPath = path.resolve(options.config || '.mockapi-config');
    const basePath = path.dirname(configPath);
    const cli = new CLI(configPath);
    if (options.command === 'help') { cli.help(); return; }
    if (options.command === 'version') { console.log(require('./package.json').version); return; }
    if (options.command === 'init') { await cli.init(options); return; }
    if (!fs.existsSync(configPath)) throw new Error('Configuration file not found. Run mockapi init --yes.');
    const contents = await fs.promises.readFile(configPath, 'utf8');
    const transform = config => {
        if (options.ui && config && typeof config === 'object' && !Array.isArray(config)) config.admin = { ...(config.admin && typeof config.admin === 'object' ? config.admin : {}), enabled: true };
        return config;
    };
    const config = transform(YAML.parse(contents));
    const prepared = prepareConfiguration(config, basePath);
    const logger = new Log(prepared.config.log || 'verbose');
    const load = async next => {
        const candidate = prepareConfiguration(next, basePath);
        const proxy = new ModuleProxy(candidate.config.externalModulesPath, logger);
        await proxy.load(candidate.config.customHandlers);
        return proxy;
    };
    const proxy = await load(config);
    if (options.command === 'validate') { console.log(`Configuration valid: ${configPath}`); return; }
    const core = new Core(logger, config, proxy, basePath, { configPath, contents, transform });
    const server = core.run();
    try { await once(server, 'listening'); } catch (error) { core.stop(); throw error; }
    let stopping = false;
    const watcher = new ConfigWatcher(configPath, logger, async () => {
        if (stopping) return;
        await core.management.reloadFile();
    }, error => { core.management.lastError = error.message; });
    try { watcher.watch(); } catch (error) { core.stop(); throw error; }
    if (config.log !== 'none') banner.display();
    console.log(`MockAPI listening on ${prepared.tls ? 'https' : 'http'}://localhost:${server.address().port}`);
    if (prepared.admin.enabled) console.log(`Web console: ${prepared.tls ? 'https' : 'http'}://localhost:${server.address().port}${prepared.admin.path}/ui/`);
    const shutdown = async () => {
        if (stopping) return;
        stopping = true;
        await watcher.stop();
        await core.management.queue;
        await new Promise(resolve => core.stop(resolve));
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
}

main().catch(error => { console.error(`MockAPI: ${error.message}`); process.exitCode = 1; });
