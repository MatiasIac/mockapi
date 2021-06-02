const constants = require("./constants");

const Log = function(logLevel) {
    this._logLevel = logLevel || "verbose";
};

Log.prototype._write = function (message) {
    const date = (new Date()).toString();

    console.log(`${date} ${message}`);
};

Log.prototype.debug = function (message) {
    if (this._logLevel === constants.LOG_LEVELS.DEBUG || this._logLevel === constants.LOG_LEVELS.VERBOSE) {
        this._write(`${constants.COLOR.fgYellow}[DEBUG]${constants.COLOR.reset} - ${message}`);
    }
};

Log.prototype.error = function (message) {
    if (this._logLevel === constants.LOG_LEVELS.ERROR || this._logLevel === constants.LOG_LEVELS.VERBOSE) {
        this._write(`${constants.COLOR.fgRed}[ERROR]${constants.COLOR.reset} - ${message}`);
    }
};

Log.prototype.info = function (message) {
    if (this._logLevel === constants.LOG_LEVELS.VERBOSE) {
        this._write(`${constants.COLOR.fgYellow}[INFO]${constants.COLOR.reset} - ${message}`);
    }
};

Log.prototype.detail = function (message) {
    if (this._logLevel === constants.LOG_LEVELS.VERBOSE) {
        this._write(`${message}`);
    }
};

Log.prototype.message = (message) => console.log(message);

module.exports = Log;