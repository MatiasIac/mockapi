module.exports = {
    BASE_URL: "http://localhost",
    CONFIG_FILE_NAME: "./.mockapi-config",
    LOG_LEVELS: {
        DEBUG: "debug",
        ERROR: "error",
        VERBOSE: "verbose",
        NONE: "none"
    },
    EXTERNAL_MODULES_PATH: "../apiHandlers/",
    DEFAULT_CONTENT_TYPE: "text/plain",
    HTTP_STATUS_CODES: {
        CONTINUE                            :100,
        SWITCHING_PROTOCOLS	                :101,
        PROCESSING                          :102,
        OK	                                :200,
        CREATED                             :201,
        ACCEPTED                            :202,
        NON_AUTHORITATIVE_INFORMATION       :203,
        NO_CONTENT	                        :204,
        RESET_CONTENT                       :205,
        PARTIAL_CONTENT                     :206,
        MULTI_STATUS	                    :207,
        MULTIPLE_CHOICES	                :300,
        MOVED_PERMANENTLY	                :301,
        MOVED_TEMPORARILY	                :302,
        SEE_OTHER	                        :303,
        NOT_MODIFIED	                    :304,
        USE_PROXY	                        :305,
        TEMPORARY_REDIRECT	                :307,
        PERMANENT_REDIRECT	                :308,
        BAD_REQUEST	                        :400,
        UNAUTHORIZED	                    :401,
        PAYMENT_REQUIRED	                :402,
        FORBIDDEN	                        :403,
        NOT_FOUND	                        :404,
        METHOD_NOT_ALLOWED	                :405,
        NOT_ACCEPTABLE	                    :406,
        PROXY_AUTHENTICATION_REQUIRED       :407,
        REQUEST_TIMEOUT	                    :408,
        CONFLICT                            :409,
        GONE	                            :410,
        LENGTH_REQUIRED                     :411,
        PRECONDITION_FAILED                 :412,
        REQUEST_TOO_LONG	                :413,
        REQUEST_URI_TOO_LONG                :414,
        UNSUPPORTED_MEDIA_TYPE              :415,
        REQUESTED_RANGE_NOT_SATISFIABLE     :416,
        EXPECTATION_FAILED                  :417,
        IM_A_TEAPOT	                        :418,
        INSUFFICIENT_SPACE_ON_RESOURCE	    :419,
        METHOD_FAILURE	                    :420,
        UNPROCESSABLE_ENTITY                :422,
        LOCKED	                            :423,
        FAILED_DEPENDENCY                   :424,
        PRECONDITION_REQUIRED               :428,
        TOO_MANY_REQUESTS	                :429,
        REQUEST_HEADER_FIELDS_TOO_LARGE     :431,
        UNAVAILABLE_FOR_LEGAL_REASONS	    :451,
        INTERNAL_SERVER_ERROR	            :500,
        NOT_IMPLEMENTED	                    :501,
        BAD_GATEWAY	                        :502,
        SERVICE_UNAVAILABLE                 :503,
        GATEWAY_TIMEOUT	                    :504,
        HTTP_VERSION_NOT_SUPPORTED	        :505,
        INSUFFICIENT_STORAGE	            :507,
        NETWORK_AUTHENTICATION_REQUIRED     :511
    },
    COLOR: {
        reset: '\x1b[0m',
        bright: '\x1b[1m',
        dim: '\x1b[2m',
        underscore: '\x1b[4m',
        blink: '\x1b[5m',
        reverse: '\x1b[7m',
        hidden: '\x1b[8m',
        
        fgBlack: '\x1b[30m',
        fgRed: '\x1b[31m',
        fgGreen: '\x1b[32m',
        fgYellow: '\x1b[33m',
        fgBlue: '\x1b[34m',
        fgMagenta: '\x1b[35m',
        fgCyan: '\x1b[36m',
        fgWhite: '\x1b[37m',
        
        bgBlack: '\x1b[40m',
        bgRed: '\x1b[41m',
        bgGreen: '\x1b[42m',
        bgYellow: '\x1b[43m',
        bgBlue: '\x1b[44m',
        bgMagenta: '\x1b[45m',
        bgCyan: '\x1b[46m',
        bgWhite: '\x1b[47m'
    }
};