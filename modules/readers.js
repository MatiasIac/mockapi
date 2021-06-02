const fs = require('fs');
const constants = require("./constants");
const CSV = require('./csv');
const HttpException = require('./HttpException');

const text_reader = (file) => {
    return () => {
        if (!fs.existsSync(file)) {
            throw new HttpException(constants.HTTP_STATUS_CODES.NOT_FOUND, `File ${file} doesn't exists`);
        }

        return fs.readFileSync(file, 'utf8');
    };
};

const folder_reader = (folder) => {
    return (urlInformation) => {

        if (!urlInformation.hasFile) {
            throw new HttpException(constants.HTTP_STATUS_CODES.NOT_ACCEPTABLE, "File not provided");
        }

        return text_reader(folder + urlInformation.file)()
    };
};

const csv_reader = (file, parameters) => {
    const csvContent = text_reader(file, parameters)();
    const csvReader = new CSV(csvContent, parameters);

    return () => csvReader.read();
};

module.exports = {
    text_reader: text_reader,
    folder_reader: folder_reader,
    csv_reader: csv_reader
};