const constants = require("./constants");

class Log {

    constructor(logLevel) {
        this._logLevel = logLevel || "verbose";
    }

    _write(message) {
        const date = (new Date()).toISOString();
        console.log(`${date} ${message}`);
    }

    debug(message) {
        if (this._logLevel === constants.LOG_LEVELS.DEBUG || this._logLevel === constants.LOG_LEVELS.VERBOSE) {
            this._write(`${constants.COLOR.fgYellow}[DEBUG]${constants.COLOR.reset} - ${message}`);
        }
    }

    error(message) {
        if (this._logLevel === constants.LOG_LEVELS.ERROR || this._logLevel === constants.LOG_LEVELS.VERBOSE) {
            this._write(`${constants.COLOR.fgRed}[ERROR]${constants.COLOR.reset} - ${message}`);
        }
    }

    info(message) {
        if (this._logLevel === constants.LOG_LEVELS.VERBOSE) {
            this._write(`${constants.COLOR.fgYellow}[INFO]${constants.COLOR.reset} - ${message}`);
        }
    }

    detail(message) {
        if (this._logLevel === constants.LOG_LEVELS.VERBOSE) {
            this._write(`${message}`);
        }
    }

    message(message) {
        console.log(message);
    }
}

module.exports = Log;