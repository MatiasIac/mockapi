# Dynamic mocking descriptive API (MockAPI)

MockAPI help you buiding your app when requires connecting to a not yet built external API.

MockAPI let you create fake responses with pre defined and dynamic data for defined endpoints.

MockAPI also is intended to help you when, during testing phase, you cannot afford complex and expensive products (And you do not need them) that requires bulky configuration steps or depends directly on third party providers that you cannot control.

## Version 2.5.0 notes

- **OpenAPI JSON endpoint**: MockAPI now generates and serves an OpenAPI document at `/openapi.json` based on your configured endpoints.
- **Interactive docs page**: Swagger UI is available at `/docs`, allowing users to inspect and try endpoints directly from the browser.
- **OpenAPI configuration**: New optional `openApi` section allows enabling/disabling docs and overriding docs/spec paths and metadata.

## Version 2.4.0 notes

- **HTTPS support**: New `tls` configuration option with `cert` and `key` paths. When provided, MockAPI starts an HTTPS server instead of HTTP.
- **Unit tests**: Test suite added using Node.js built-in test runner. Tests cover CSV parsing, URL parsing, path matching, HttpException, and Core HTTP server behavior. Run with `npm test`.

## Version 2.3.0 notes

- **CORS fine-tuning**: `enableCors` now accepts an object to configure specific origins, methods, and headers. Preflight (OPTIONS) requests are handled automatically. Boolean `true` is still supported for allow-all behavior.
- **Graceful shutdown**: The server now handles `SIGTERM` and `SIGINT` signals, cleanly closing the HTTP server and config watcher before exiting.
- **Static file serving**: New `staticPath` configuration option serves files from a local directory. Requests that don't match any endpoint will attempt to serve a static file before returning 404.

## Version 2.2.0 notes

- **Path parameters**: Endpoints now support path parameters using `:param` syntax (e.g., `/users/:id`). Extracted parameters are available in custom handlers via `requestInformation.params`.
- **Query parameters**: Query string parameters are now parsed and available in custom handlers via `requestInformation.query`.
- **Response delay**: Endpoints can now simulate slow APIs with a `delay` property (in milliseconds).
- **Hot-reload**: The configuration file is watched for changes. Endpoints and data sources are automatically reloaded without restarting the server.

## Version 2.1.0 notes

- Codebase modernized to ES6 classes (`HttpException`, `Log`, `CSV`).
- CSV parser rewritten with RFC 4180 compliant state machine. Correctly handles commas inside quoted fields, escaped quotes, and mixed line endings (`\r\n`, `\n`, `\r`).
- Fixed bug in `urlParser` (`searchParamss` typo).
- Fixed bug in `moduleProxy.execute()` referencing a variable outside its scope.
- Fixed invalid top-level `return` statements in `main.js`.
- Docker image updated from Node 12 (EOL) to Node 20 LTS; switched to `npm ci --omit=dev`.
- Removed deprecated `version` key from Docker Compose files.
- `package.json` updated with `files`, `keywords`, and engine requirement bumped to `>=18`.
- Custom handler example (`myCustomHandler.js`) modernized with JSDoc and meaningful sample logic.
- ASCII art banner displayed on application startup.

## Version 2.0.1 notes

- A bug related to custom handlers was detected and fixed.

## Version 2.0.0 notes

- Using NodeJS managers such as NVM causes configuration file not being picked from the execution/working folder.
- New CORE class created and code moved from the main module.
- Additional checking for the configuration file.
- Folder file readear incorrect path contactenation fixed.

## Configuration file

MockAPI can be used as it is. Without any additional coding activity. Just configure your endpoints and run ```main.js``` file.

### Configuring MockAPI

Edit ```.mockapi-config``` to add your own endpoints, responses, parsers and data. Use standard YAML notation for this file.

#### Main entry points

**port** - Specify the HTTP port to be used by MockAPI to expose the defined endpoints.

**enableCors** - Configure CORS for MockAPI. Accepts ```true``` for allow-all behavior, or an object for fine-grained control.

**externalModulesPath** - Optional configuration. Allows to specify a different path where the user custom handlers are located.

**staticPath** - Optional configuration. Path to a local directory to serve static files from. Requests that don't match any endpoint will fall back to static file serving.

**openApi** - Optional configuration to enable/disable generated OpenAPI docs and customize routes and document metadata.

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

#### Path parameters

Endpoints support path parameters using the ```:param``` syntax. Parameters are extracted from the URL and made available to custom handlers.

```yaml
"/users/:id":
  verb: get
  data: myRows
  responseStatus: 200
  responseContentType: "application/json"
```

A request to ```/users/42``` will match this endpoint and extract ```{ id: "42" }``` as path parameters. Multiple path parameters are supported (e.g., ```/users/:userId/orders/:orderId```).

A custom handler can then use these parameters:

```javascript
const process = (requestInformation, data) => {
    const userId = requestInformation.params.id;
    // requestInformation.params contains all extracted path parameters
    // requestInformation.query contains all query string parameters
    return JSON.stringify({ userId, data: JSON.parse(data) });
};

module.exports = { process };
```

Combining path and query parameters, a request to ```/users/42?fields=name,email``` would provide:

```javascript
requestInformation.params  // { id: "42" }
requestInformation.query   // { fields: "name,email" }
```

#### Query parameters

Query string parameters are automatically parsed from the request URL. For example, a request to ```/users?role=admin&active=true``` will make ```{ role: "admin", active: "true" }``` available in custom handlers via ```requestInformation.query```.

#### Response delay

Simulate slow API responses by adding a ```delay``` property (in milliseconds) to any endpoint:

```yaml
"/users":
  verb: get
  data: myRows
  delay: 2000
  responseStatus: 200
  responseContentType: "application/json"
```

The previous example will wait ```2000ms``` before sending the response, which is useful for testing loading states, spinners and timeout handling.

#### Hot-reload

MockAPI watches the ```.mockapi-config``` file for changes. When the file is saved, endpoints and data sources are automatically reloaded without restarting the server. This allows you to add, remove, or modify endpoints while the server is running.

#### OpenAPI docs

MockAPI can auto-generate OpenAPI docs from your configured endpoints and expose them with built-in routes:

- ``/openapi.json`` - generated OpenAPI document
- ``/docs`` - Swagger UI page powered by the generated document

These routes update automatically when `.mockapi-config` changes (hot-reload).
The `/docs` page loads Swagger UI assets from `unpkg.com`.

To customize or disable this feature, use the optional `openApi` section:

```yaml
openApi:
  enabled: true
  docsPath: "/docs"
  specPath: "/openapi.json"
  info:
    title: "My Mock API"
    version: "1.0.0"
    description: "Generated from MockAPI configuration."
```

Disable docs completely:

```yaml
openApi:
  enabled: false
```

#### CORS configuration

CORS can be configured in three ways:

**Disabled** (default):
```yaml
enableCors: false
```

**Allow all** (same as previous versions):
```yaml
enableCors: true
```

**Fine-grained control** — specify allowed origins, methods, and headers:
```yaml
enableCors:
  origins:
    - "http://localhost:3000"
    - "https://myapp.example.com"
  methods:
    - GET
    - POST
    - PUT
  headers:
    - Content-Type
    - Authorization
```

When using fine-grained CORS, MockAPI automatically handles ```OPTIONS``` preflight requests. If the request origin is not in the allowed list, CORS headers are not set.

#### Static file serving

MockAPI can serve static files from a local directory. Add the ```staticPath``` property to your configuration:

```yaml
staticPath: "./public"
```

When a request does not match any configured endpoint, MockAPI will attempt to serve a matching file from the specified directory. The file's MIME type is determined automatically from its extension. Supported types include HTML, CSS, JavaScript, JSON, PNG, JPG, GIF, SVG, PDF, and more.

For example, with ```staticPath: "./public"```, a request to ```/images/logo.png``` will serve the file at ```./public/images/logo.png```.

#### HTTPS

MockAPI supports HTTPS. Add a ```tls``` section to your configuration with the paths to your certificate and private key files:

```yaml
tls:
  cert: "./certs/server.crt"
  key: "./certs/server.key"
```

When TLS is configured, MockAPI starts an HTTPS server instead of HTTP. If the certificate files cannot be read, MockAPI falls back to HTTP and logs an error.

To generate a self-signed certificate for local development:

```bash
openssl req -x509 -newkey rsa:2048 -keyout server.key -out server.crt -days 365 -nodes -subj "/CN=localhost"
```

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

## MockAPI CLI

MockAPI provides a small but helpful CLI. Type ```mockapi --help``` to get the available commands from the CLI once MockAPI is installed.

#### The ```init``` command

Once MockAPI is globally installed, you will need a configuration file with minimal information to be able of start mocking the API. The ```init``` command argument will lead you through different basic questions helping you to initialize this configuration file.

```powershell
mockapi --init
```

You can skip every question which will assign some default values to the configuration file. Later you could change these values using any text editor.

## Running MockAPI with Docker

MockAPI includes Docker support for running the application in a containerized environment.

### Building the Docker image

```bash
docker build -t mockapi .
```

### Running with Docker

```bash
docker run -p 3001:8001 -v $(pwd)/.mockapi-config:/usr/src/app/.mockapi-config mockapi
```

This maps port `3001` on your host to port `8001` inside the container and mounts your local configuration file into the container. Adjust the port mapping to match the `port` value in your `.mockapi-config` file.

### Running with Docker Compose

#### Production mode

```bash
docker compose up
```

This builds and starts MockAPI using the `docker-compose.yml` file, exposing the API on port `3001`.

#### Debug mode

```bash
docker compose -f docker-compose.debug.yml up
```

This starts MockAPI with the Node.js inspector enabled on port `9229`, allowing you to attach a debugger. The API is available on port `3000`.

### Mounting custom data and handlers

To use your own data files and custom handlers with Docker, mount them as volumes:

```bash
docker run -p 3001:8001 \
  -v $(pwd)/.mockapi-config:/usr/src/app/.mockapi-config \
  -v $(pwd)/testdata:/usr/src/app/testdata \
  -v $(pwd)/apiHandlers:/usr/src/app/apiHandlers \
  mockapi
```
