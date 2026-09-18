const readline = require('node:readline');
const fs = require('node:fs');
const YAML = require('yaml');
const { prepareConfiguration } = require('./configuration');

class CLI {
    constructor(configurationFilePath, args = process.argv.slice(2)) {
        this._configurationFilePath = configurationFilePath;
        this.args = [...args];
    }

    hasCommands() { return this.args.length > 0; }

    static parse(args) {
        const result = { command: 'start' };
        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            if (['init', '--init', 'validate', '--validate', 'help', '--help', '--version'].includes(arg)) {
                if (result.command !== 'start') throw new Error('Specify only one command');
                result.command = arg.replace(/^--/, '');
            } else if (arg === '--ui') result.ui = true;
            else if (['--yes', '-y', '--force'].includes(arg)) result[arg === '--force' ? 'force' : 'yes'] = true;
            else if (['--config', '--port'].includes(arg)) {
                if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`${arg} requires a value`);
                result[arg.slice(2)] = args[++i];
            } else throw new Error(`Unknown argument '${arg}'. Run mockapi --help.`);
        }
        if ((result.yes || result.force || result.port !== undefined) && result.command !== 'init') throw new Error('--yes, --force, and --port are init options');
        if (result.ui && result.command !== 'start') throw new Error('--ui is a start option');
        return result;
    }

    async init(options) {
        if (!options.force && fs.existsSync(this._configurationFilePath)) throw new Error('Configuration already exists. Use --force to overwrite it.');
        let port = options.port ?? 8080;
        let cors = true;
        let endpoint = true;
        if (!options.yes) {
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
            const answers = rl[Symbol.asyncIterator]();
            const ask = async prompt => {
                process.stdout.write(prompt);
                const answer = await answers.next();
                return answer.done ? '' : answer.value.trim();
            };
            try {
                port = await ask(`Set MockAPI listening port (${port}): `) || port;
                cors = !/^n(?:o)?$/i.test(await ask('Enable CORS? Y/n: '));
                endpoint = !/^n(?:o)?$/i.test(await ask('Include a default endpoint? Y/n: '));
            } finally { rl.close(); }
        }
        if (!/^\d+$/.test(String(port)) || Number(port) < 1 || Number(port) > 65535) throw new Error('port: must be an integer from 1 to 65535');
        const config = { port: Number(port), enableCors: cors, endpoints: endpoint ? { '/data': { get: { response: { message: 'MockAPI is ready' } } } } : {}, log: 'verbose' };
        prepareConfiguration(config);
        await fs.promises.writeFile(this._configurationFilePath, YAML.stringify(config), { flag: options.force ? 'w' : 'wx' });
        console.log(`Configuration created: ${this._configurationFilePath}`);
    }

    help() {
        console.log('MockAPI\n\nmockapi [--config FILE] [--ui]\nmockapi init [--yes] [--port NUMBER] [--force] [--config FILE]\nmockapi validate [--config FILE]\nmockapi --version\n\n--ui enables the web console at /__mockapi/ui/ (or your configured admin path).\ninit creates a working configuration; --force permits overwriting an existing file.\nvalidate checks configuration, data files, TLS, and custom handler exports.');
    }
}

module.exports = CLI;
