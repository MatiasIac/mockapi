const action = function (requestInformation, data) {
    console.log(data);
    console.log(requestInformation);
    return JSON.stringify("Hello from custom module");
};

module.exports = {
    process: action
};