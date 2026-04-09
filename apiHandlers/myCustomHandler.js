/**
 * Example custom handler for MockAPI.
 *
 * Custom handlers let you manipulate the response for an endpoint.
 * When an endpoint uses a handler, this module processes the data
 * instead of returning it directly.
 *
 * @param {Object} requestInformation - Incoming request details.
 * @param {string} requestInformation.method - HTTP method (get, post, etc.).
 * @param {string} requestInformation.url - Matched endpoint URL.
 * @param {string} requestInformation.body - Raw request body.
 * @param {string} data - Pre-processed data from the configured data reader.
 * @returns {string} The response body to send back to the client.
 */
const process = (requestInformation, data) => {
    // Example: wrap the data in an envelope with request metadata
    const response = {
        endpoint: requestInformation.url,
        method: requestInformation.method,
        payload: data ? JSON.parse(data) : null
    };

    return JSON.stringify(response);
};

module.exports = { process };