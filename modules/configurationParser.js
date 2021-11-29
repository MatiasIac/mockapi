const readers = require("./readers");

const parseProperties = function (properties) {
    let property = {
        startIndex: 0,
        format: "json",
        direction: "rand"
    };

    if (properties === undefined) return property;

    const props = properties;

    if (props.length < 3) throw new Error("Invalid properties");
    if (isNaN(props[2])) throw new Error("Index must be a number");

    property.startIndex = parseFloat(props[2]);
    property.format = props[0];
    property.direction = props[1];

    return property;
}

const injectHandlers = function (data) {

    for (const variable in data) {
        if (Object.hasOwnProperty.call(data, variable)) {
            const node = data[variable];
            
            if (node.path === undefined) throw new Error("Node requires a path");
            if (node.reader === undefined) throw new Error("Node requires a reader");
            if (readers[node.reader + "_reader"] === undefined) throw new Error("Selected reader cannot be found");

            const properties = parseProperties(node.properties);

            const nodeHandler = readers[node.reader + "_reader"];
            node.dataHandler = nodeHandler(node.path, properties);
        }
    }
};

module.exports = {
    loadHandlersFromConfiguration: injectHandlers
}