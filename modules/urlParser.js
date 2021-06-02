const constants = require("./constants");

const parser = (url) => {

    const parsedUrl = new URL(url, constants.BASE_URL);
    const urlSections = parsedUrl.pathname.split("/").filter((e) => e !== "");

    const baseUrl = "/" + urlSections.filter((e) => e.indexOf(".") < 0).join("/");
    const file = urlSections.filter((e) => e.indexOf(".") >= 0);
    const hasFile = file.length > 0;

    return {
        base: baseUrl,
        file: hasFile ? file[0] : "",
        hasFile: hasFile,
        search: parsedUrl.searchParamss
    };

};

module.exports = {
    parse: parser
};