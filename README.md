# Dynamic mocking descriptive API (MockAPI)

MockAPI help you buiding your app when requires connecting to a not yet built external API.

MockAPI let you create fake responses with pre defined and dynamic data for defined endpoints.

MockAPI also is intended to help you when, during testing phase, you cannot afford complex and expensive products (And you do not need them) that requires bulky configuration steps or depends directly on third party providers that you cannot control.

## Configuration file

MockAPI can be used as it is. Without any additional coding activity. Just configure your endpoints and run ```main.js``` file.

### Configuring MockAPI

Edit ```.mockapi-config``` to add your own endpoints, responses, parsers and data. Use standard YAML notation for this file.

#### Main entry points

**port** - Specify the HTTP port to be used by MockAPI to expose the defined endpoints.

**enableCors** - Enable/Disable CORS for MockAPI.

**externalModulesPath** - Optional configuration. Allows to specify a different path where the user custom handlers are located.

**data** - 
Holds and describe the available data for all endpoints and responses.

**endpoints** - Describe all available endpoints, its verbs and responses.

**log** - Define MockAPI log level.

**customHandlers** - Import a custom HTTP data handler. Use these custom handlers to manipulate the output of your responses for a particular endpoint.

Within ```data``` entry, it is possible to define how the data must be handled. There are three built-in readers that comes with MockAPI.

**csv** - Reads the defined data as CSV.

**text** - Considers the data source as plain text.

**folder** - Reads the files from the folder matching the incoming request name.

#### Data definition

```yaml
myRows:
    path: "./testdata/data.csv"
    reader: csv
    properties: 
      - json
      - seq
      - 0
```
The previous example defines a data source called ```myRows```, which will read the data from the defined ```path```, using the ```csv``` handler, parsing each row as ```json```, reading the values in a ```sequential``` order, starting from record ```0```.

#### Endpoint definition

```yaml
"/users":
  verb: get
  data: myRows
  responseStatus: 200
  responseContentType: "application/json"
```
From the previous code snippet, we are defining an endpoint ```[MockAPI URL]:[PORT]/users```, which will accept ```get``` requests, answering always with ```200``` status code, using data from ```myRows``` data definition in ```JSON``` format.

#### Custom handlers

A custom handler let you manipulate the data as your will. First, define the handler as follows:

```yaml
customHandlers:
  "custom": 
    "myCustomHandler"
```
The previous code defines a custom handler called ```custom``` and will use the script code called ```myCustomHandler```. The custom code must be placed inside of ```scripts``` folder and coded in JavaScript with NodeJS support.

Your custom script must implement the following export format:

```javascript
module.exports = {
    process: [Your function entry point]
};
```

#### Setting up the log level

MockAPI logs information into the execution console. There are different levels of logs that can be used.

```yaml
log: verbose
  #debug <- Useful for custom handlers
  #error <- Only exposes internal errors
  #verbose <- Logs debug, information and errors
  #none <- Turn off the logs
```