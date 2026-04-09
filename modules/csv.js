class CSV {

    constructor(content, properties) {
        this._properties = properties;
        this._currentIndex = properties.startIndex;
        this._data = this._parseCSV(content);
        this._formattedData = [];

        this._applyFormat(properties.format);
    }

    _parseCSV(content) {
        const rows = [];
        let currentRow = [];
        let currentField = '';
        let insideQuotes = false;
        let i = 0;

        while (i < content.length) {
            const char = content[i];

            if (insideQuotes) {
                if (char === '"') {
                    if (i + 1 < content.length && content[i + 1] === '"') {
                        currentField += '"';
                        i += 2;
                    } else {
                        insideQuotes = false;
                        i++;
                    }
                } else {
                    currentField += char;
                    i++;
                }
            } else {
                if (char === '"') {
                    insideQuotes = true;
                    i++;
                } else if (char === ',') {
                    currentRow.push(currentField);
                    currentField = '';
                    i++;
                } else if (char === '\r' && i + 1 < content.length && content[i + 1] === '\n') {
                    currentRow.push(currentField);
                    currentField = '';
                    rows.push(currentRow);
                    currentRow = [];
                    i += 2;
                } else if (char === '\n' || char === '\r') {
                    currentRow.push(currentField);
                    currentField = '';
                    rows.push(currentRow);
                    currentRow = [];
                    i++;
                } else {
                    currentField += char;
                    i++;
                }
            }
        }

        if (currentField || currentRow.length > 0) {
            currentRow.push(currentField);
            rows.push(currentRow);
        }

        return rows;
    }

    _applyFormat(format) {
        if (typeof this[`_${format}`] === 'function') {
            this[`_${format}`]();
        }
    }

    _json() {
        if (this._data.length === 0) return;

        const propertyNames = this._data[0];

        for (let i = 1; i < this._data.length; i++) {
            const record = this._data[i];
            const obj = {};

            for (let j = 0; j < record.length; j++) {
                obj[propertyNames[j]] = record[j];
            }

            this._formattedData.push(obj);
        }
    }

    _text() {
        this._formattedData = this._data.slice(1);
    }

    _seq() {
        if (this._currentIndex >= this._formattedData.length || this._currentIndex < 0) {
            this._currentIndex = 0;
        }

        const record = this._formattedData[this._currentIndex];
        this._currentIndex++;

        return record;
    }

    _rand() {
        this._currentIndex = Math.floor(Math.random() * this._formattedData.length);
        return this._formattedData[this._currentIndex];
    }

    read() {
        if (this._currentIndex === -1) {
            return JSON.stringify(this._formattedData);
        }

        return JSON.stringify(this[`_${this._properties.direction}`]());
    }
}

module.exports = CSV;