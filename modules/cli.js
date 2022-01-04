const readline = require('readline');
const YAML = require('yaml');
const fs = require('fs');

class CLI {

    _configurationFilePath = "";
    _arguments = [];
    _commands = {
        "--help": this._helpCommand,
        "help": this._helpCommand,
        "init": this._initCommand,
        "--init": this._initCommand
    };
    _configTemplate = {
        port: 8080,
        enableCors: true,
        data: {
          myRows: { path: 'YOUR FOLDER', reader: 'folder' }
        },
        endpoints: {
          '/data': {
            verb: 'get',
            data: 'myRows',
            responseStatus: 200,
            responseContentType: 'application/json'
          }
        },
        log: 'verbose'
    };

    constructor(configurationFilePath) {
        this._configurationFilePath = configurationFilePath;
        this._arguments = process.argv.slice(2);
    }

    _initCommand() {
        let configTemplate = this._configTemplate;

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        console.log("Creating a basic configuration file");
        console.log("");

        rl.question(`Set MockAPI listening port (8080): `, (port) => {
            rl.question(`Do you want to enable CORS? Y/n: `, (enableCors) => {
                rl.question(`Do you want to include default endpoint? Y/n: `, (defaultEndpoint) => {
                    const configPort = port || 8080;
                    const configEnableCors = enableCors === "Y" || enableCors === "y" || enableCors === "";
                    const configDefaultEndpoint = defaultEndpoint === "Y" || defaultEndpoint === "y" || defaultEndpoint === "";

                    configTemplate.port = configPort;
                    configTemplate.enableCors = configEnableCors;

                    if (configDefaultEndpoint === false) {
                        delete configTemplate.endpoints;
                        delete configTemplate.data;
                    }

                    const configFile = YAML.stringify(configTemplate);

                    fs.writeFile(this._configurationFilePath, configFile, (err) => {
                        if (err) {
                            console.log(err);
                        } else {
                            console.log("Configuration file created");
                        }
                    });
                    
                    rl.close();
                });
            });        
        });

    }

    _helpCommand() {
        console.log("Run MockAPI:");
        console.log("mockapi\n");
        console.log("Command execution:\n");
        console.log("mockapi <command>");
        console.log("");
        console.log("--help, help    shows this help");
        console.log("--init, init    creates a basic configuration file");
        console.log("");
    }

    hasCommands() { return this._arguments.length > 0; }

    executeCommandLine() {
        if (this._arguments.length > 0) {

            let command = this._commands["--help"];

            if (this._commands[this._arguments[0]] !== undefined) {
                command = this._commands[this._arguments[0]];
            }

            command.apply(this);
        }
    }
}

module.exports = CLI;