function HttpException(httpStatusCode, message) {
    var instance = new Error(message);
    
    instance.name = 'HttpException';
    instance.httpStatusCode = httpStatusCode;
    
    Object.setPrototypeOf(instance, Object.getPrototypeOf(this));
    
    if (Error.captureStackTrace) {
        Error.captureStackTrace(instance, HttpException);
    }

    return instance;
  }
  
  HttpException.prototype = Object.create(Error.prototype, {
    constructor: {
        value: Error,
        enumerable: false,
        writable: true,
        configurable: true
    }
});
  
if (Object.setPrototypeOf){
    Object.setPrototypeOf(HttpException, Error);
} else {
    HttpException.__proto__ = Error;
}

module.exports = HttpException;