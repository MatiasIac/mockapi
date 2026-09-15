const constants = require("./constants");

const parser = (url) => {

    const parsedUrl = new URL(url, constants.BASE_URL);
    const urlSections = parsedUrl.pathname.split("/").filter((e) => e !== "");

    const baseUrl = "/" + urlSections.filter((e) => e.indexOf(".") < 0).join("/");
    const file = urlSections.filter((e) => e.indexOf(".") >= 0);
    const hasFile = file.length > 0;

    return {
        pathname: parsedUrl.pathname,
        base: baseUrl,
        file: hasFile ? file[0] : "",
        hasFile: hasFile,
        search: parsedUrl.searchParams
    };

};

/**
 * Matches a request path against an endpoint pattern that may contain
 * path parameters (e.g., /users/:id/orders/:orderId).
 *
 * @param {string} pattern - The endpoint pattern from the configuration.
 * @param {string} requestPath - The actual incoming request base path.
 * @returns {{ match: boolean, params: Object }} Whether it matched and extracted path parameters.
 */
const matchPath = (pattern, requestPath) => {
    const patternParts = pattern.split("/").filter((e) => e !== "");
    const requestParts = requestPath.split("/").filter((e) => e !== "");

    if (patternParts.length !== requestParts.length) {
        return { match: false, params: {} };
    }

    const params = {};

    for (let i = 0; i < patternParts.length; i++) {
        if (patternParts[i].startsWith(":")) {
            Object.defineProperty(params, patternParts[i].substring(1), { value: decodeURIComponent(requestParts[i]), enumerable: true, configurable: true });
        } else if (decodeURIComponent(patternParts[i]) !== decodeURIComponent(requestParts[i])) {
            return { match: false, params: {} };
        }
    }

    return { match: true, params };
};

module.exports = {
    parse: parser,
    matchPath: matchPath,
    query: search => {
        const result = Object.create(null);
        for (const [key, value] of search) {
            if (!Object.hasOwn(result, key)) result[key] = value;
            else result[key] = Array.isArray(result[key]) ? [...result[key], value] : [result[key], value];
        }
        return result;
    }
};
