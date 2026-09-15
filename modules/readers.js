const fs = require('fs');
const path = require('path');
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

const file_exists = (file) => fs.existsSync(file);

const folder_reader = (folder) => {
    return (urlInformation) => {

        if (!urlInformation.hasFile) {
            throw new HttpException(constants.HTTP_STATUS_CODES.NOT_ACCEPTABLE, "File not provided");
        }

        const root = fs.realpathSync(folder);
        let name;
        try { name = decodeURIComponent(urlInformation.file); }
        catch { throw new HttpException(400, 'Malformed filename encoding'); }
        const file = path.resolve(root, name);
        const inside = target => {
            const relative = path.relative(root, target);
            return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
        };
        if (!inside(file) || (fs.existsSync(file) && !inside(fs.realpathSync(file)))) {
            throw new HttpException(403, 'Forbidden');
        }
        return text_reader(file)()
    };
};

const csv_reader = function (file, parameters) {
    const csvContent = text_reader(file, parameters)();
    const csvReader = new CSV(csvContent, parameters);

    return csvReader.read.bind(csvReader);
};

module.exports = {
    text_reader: text_reader,
    folder_reader: folder_reader,
    csv_reader: csv_reader,
    file_exists: file_exists
};
