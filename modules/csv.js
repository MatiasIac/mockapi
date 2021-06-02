const CSV = function (content, properties) {
    this._content = content;
    this._properties = properties;
    this._currentIndex = properties.startIndex;
    this._data = this._readData();
    this._formattedData = [];

    this["_" + properties.format]();
};

CSV.prototype._readData = function () {
    let data = [];
    const lines = this._content.split("\r\n");

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const extractedLine = line.match(/(?:,|\n|^)("(?:(?:"")*[^"]*)*"|[^",\n]*|(?:\n|$))/gm);
        
        let parsedLine = [];

        for (let i = 0; i < extractedLine.length; i++) {
            const item = extractedLine[i];
            parsedLine.push(item);
        }

        data.push(parsedLine);
    }

    return data;
};

CSV.prototype._json = function () {
    
};

CSV.prototype._text = function () {

};

CSV.prototype.read = function () {


    this._currentIndex++;
};

module.exports = CSV;