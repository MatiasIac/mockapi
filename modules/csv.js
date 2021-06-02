let CSV = function (content, properties) {
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
    if (this._data.length === 0) return;

    const propertyNames = this._data[0];

    for (let i = 1; i < this._data.length; i++) {
        const record = this._data[i];
        let obj = { };

        for (let j = 0; j < record.length; j++) {
            const data = record[j];
            obj[propertyNames[j]] = data;
        }

        this._formattedData.push(obj);
    }
};

CSV.prototype._text = function () {
    this._formattedData = this._data.slice(1);
};

CSV.prototype._seq = function() {
    if (this._currentIndex >= this._formattedData.length || this._currentIndex < 0) this._currentIndex = 0;

    const record = this._formattedData[this._currentIndex];
    this._currentIndex++;

    return record;
};

CSV.prototype._rand = function() {
    this._currentIndex = parseInt((Math.random() * this._formattedData.length - 1) + 1);
    const record = this._formattedData[this._currentIndex];

    return record;
};

CSV.prototype.read = function () {
    if (this._currentIndex === -1) {
        return JSON.stringify(this._formattedData);
    }

    return JSON.stringify(this["_" + this._properties.direction]());   
};

module.exports = CSV;