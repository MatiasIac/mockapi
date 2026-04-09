class HttpException extends Error {
    constructor(httpStatusCode, message) {
        super(message);
        this.name = 'HttpException';
        this.httpStatusCode = httpStatusCode;
    }
}

module.exports = HttpException;