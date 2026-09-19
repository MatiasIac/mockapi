# MockAPI

A lightweight HTTP API server for development, testing, and prototyping. Define
endpoints in YAML, return fixtures or inline JSON, and simulate errors and changing
responses without building a backend.

## Quick start

Requires Node.js **22 or newer**. CI tests Node 22 and 24 on Windows and Linux;
the Docker image uses Node 24 LTS.

```sh
npm install --global mockapi-msi
mockapi init --yes
mockapi validate
mockapi
```

Open `http://localhost:8080/data` for the generated sample response and
`http://localhost:8080/docs` for interactive API documentation.

From this repository:

```sh
npm ci
node main.js validate
npm start
npm test
```

The repository's `.mockapi-config` retains the CSV example at
`http://localhost:8001/data`. See [examples/features.yaml](examples/features.yaml)
for a runnable demonstration of the new features:

```sh
node main.js --config examples/features.yaml
```

## CLI

```text
mockapi [--config FILE] [--ui]
mockapi init [--yes] [--port NUMBER] [--force] [--config FILE]
mockapi validate [--config FILE]
mockapi --help
mockapi --version
```

- `init` asks for a port, CORS, and a sample endpoint. `--yes` accepts defaults.
- `--force` explicitly permits overwriting an existing configuration.
- `validate` checks options, route definitions, referenced data, TLS certificates,
  and custom-handler exports. It exits with a nonzero status on failure.
- `--config` selects a file; otherwise `.mockapi-config` in the current directory
  is used. Relative data, handler, static, and TLS paths resolve from the
  **configuration file's directory**.
- Loading or validating custom handlers executes their JavaScript module code.
- `--ui` enables the web console and administration API for this process. It uses
  your configured admin path and token, if present.

## Web console

Manage a running Mock API instance in your browser:

```sh
# From this repository (the bundled configuration uses port 8001)
npm run start:ui
# Open http://localhost:8001/__mockapi/ui/

# From an installed CLI
mockapi --ui
# Open http://localhost:8080/__mockapi/ui/ for the generated configuration

# Explore a complete example with users, products, and orders
node main.js --config examples/console.yaml
# Open http://localhost:8080/__mockapi/ui/
```

The console runs on the **same server and port** as your mock API. It connects to
that running instance; opening another browser tab does not start another mock
server. No build step, external assets, paid service, or frontend dependencies
are required. The normal CLI and configuration-file workflow remain available.

You can also add `admin: true` to an existing running instance's configuration.
Hot reload enables the console at `/__mockapi/ui/`. With `admin.path: /control`,
the console is at `/control/ui/`. Administration remains disabled by default.
An instance running an older version of Mock API must first be upgraded and
restarted to load the console implementation.

The console provides:

- **Endpoints:** search, create, edit, duplicate, and delete routes. Configure
  methods, JSON/text responses, file data sources, status codes, delays, and
  headers. Advanced JSON options expose matching, variants, response sequences,
  custom handlers, and OpenAPI metadata without discarding those options during
  ordinary edits. Both legacy `verb` and per-method configurations are supported.
- **Request tester:** send requests to the current instance and inspect response
  bodies, headers, status, and timing. Replace path parameters with actual values;
  use the saved configuration. The tester does not attach your admin token, send
  browser credentials, or follow redirects. Response previews are limited to
  1 MiB and requests time out after 60 seconds. Browser restrictions apply to
  methods and managed headers; TRACE requires another HTTP client.
- **Request log:** inspect incoming requests, including query parameters, headers,
  bodies, status, and duration. Filter the log, pause updates, or clear history
  without resetting scenarios. The configured history/body limits still apply.
- **Configuration:** choose **Normal mode** for guided visual controls or
  **Expert mode** for the JSON/YAML editor. Both edit the same draft, including
  endpoints, response values, sources, handlers, CORS, and OpenAPI settings.
  Import a file as a draft for review, or export the saved configuration as YAML.
  Live saves must keep the current host, port, TLS, and enabled admin path.
  Exports omit admin tokens.

### Normal and expert configuration modes

Normal mode is the default. Sections cover server settings, endpoints, data
sources, custom handlers, CORS, documentation, and administration. Each option
has a label and explanation. Enable its **Configure** checkbox to supply a value;
leave it off to keep the server's default or a scenario's inherited value.

- Add, rename, update, and remove endpoint paths and HTTP methods. Legacy `verb`
  routes retain their original format. Configure statuses, delays, content types,
  response headers, and custom handlers using labeled controls.
- Build response objects and arrays using typed values: text, number, boolean,
  null, object, or array. Add/remove named properties and reorder array items.
  **Insert a request value** helps create path, query, body, header, method, and
  sequence-index templates without remembering their syntax.
- Configure request matching, conditional variants, ordered response sequences,
  and hold/cycle behavior. Enabling an incompatible response option asks before
  replacing the existing draft option. Sequence and variant overrides preserve
  inheritance from the base response.
- Add file/CSV/folder data sources, select CSV output/selection/start options,
  and register JavaScript handlers. Renaming a source or handler updates its
  references in endpoints, variants, and sequences. Files and handler modules
  must already exist on the server; the console edits their configuration, not
  the files themselves. Use response-body fields to edit inline data values.
- Configure OpenAPI metadata, request bodies, parameters, response schemas, and
  examples. Schema fields have guided controls; additional properties and
  extensions use the same typed-value editor.

Mode switching does not save, reload the API, or reset request history. It
preserves omitted options, legacy formats, data types, and additional metadata.
Expert-mode YAML is parsed without applying it; incomplete semantic settings
can be reviewed before validation. Malformed source remains in Expert mode with
an error. Imported files open as expert drafts and can be switched to Normal mode.

**Download draft** exports the current draft as JSON without applying it or
including an admin token. This also lets you configure host, port, and TLS
visually, then use the downloaded values in the configuration file and restart.
Admin token values are managed only in the file. Both modes retain the same
authorization, validation, persistence, and stale-revision protection.

**Save & apply** validates the configuration and custom handlers, writes the active
file, and swaps the running configuration. Relative paths remain relative to the
configuration file, and unchanged YAML comments are preserved where possible.
YAML aliases may be expanded to preserve independent response values. Changes
survive a restart. Saving resets request history, response sequences, and CSV
positions, just like editing the file. **Reset scenarios** resets those positions
and history without changing the configuration.

Saves use revision checks so a stale tab cannot overwrite another tab or an
external file edit. If there is a conflict, the draft remains visible; reload
the latest configuration before saving again. An invalid external file leaves
the last valid configuration running and must be repaired on disk before the
console can save. A filesystem write failure leaves the running configuration
unchanged. Use a writable **parent directory** for persistent configuration;
atomic saves require creating a temporary sibling file and renaming it.

Changing `host`, `port`, or `tls` requires a restart. Change admin credentials,
the admin path, or the enabled state in the configuration file. The console
does not expose or change the configured token. A CLI process started with
`--ui` keeps administration enabled; saving from that process writes the enabled
admin setting to the file as well.

Without an admin token, only loopback clients with a loopback/localhost Host
header can administer the instance. For Docker or access from another machine,
configure a token, serve over HTTPS on untrusted networks, and enter the token
in the console's connection dialog:

```yaml
admin:
  enabled: true
  token: replace-with-your-own-random-token
```

The login page and bundled assets are public; configuration and request data
require authorization. Tokens stay in the tab's memory until disconnect or
refresh. Mock CORS settings do not grant cross-origin admin access. An admin
token grants control over the entire instance, including configuration of
custom JavaScript handlers. This phase is a **single-instance development tool**;
it does not provide company accounts, tenant isolation, or SaaS hosting.

### Management API

These routes extend the existing admin API and use its authorization rules:

| Method and path | Behavior |
| --- | --- |
| `GET /__mockapi/config` | Active source configuration, revision, and instance information. Admin tokens are redacted. |
| `PUT /__mockapi/config` | Validate, persist, and apply `{ "revision": "…", "config": { … } }`. Supply `source` (YAML/JSON text) instead of `config` to use source text. |
| `POST /__mockapi/config/validate` | Validate `{ "config": { … } }` or `{ "source": "…" }` without applying. |
| `POST /__mockapi/config/parse` | Parse a JSON/YAML draft into an object without loading files, running handlers, validating runtime settings, or applying changes. Requires admin authorization. |
| `GET /__mockapi/config/export` | Download the active configuration as YAML, excluding the admin token. |
| `DELETE /__mockapi/requests` | Clear request history without resetting sequences or CSV readers. |

Configuration mutations return `400` for invalid or restart-required changes,
`409` for missing/stale revisions or external file conflicts, and `500` if
persistence fails. Configuration writes and validation have a separate 5 MiB
body limit and 30-second body timeout, so small mock `maxBodyBytes` settings do
not prevent administration. If you embed `Core` without a configuration-file
option, the console applies changes in memory only and labels that behavior;
export the configuration to retain a copy.

## Endpoints

```yaml
port: 8080
enableCors: true
endpoints:
  /users:
    get:
      response:
        - { id: 1, name: Alice }
    post:
      responseStatus: 201
      response: { id: 2, name: "{{body.name}}" }
      responseHeaders:
        Location: /users/2
  /users/:id:
    get:
      response: { id: "{{params.id}}" }
  /users/me:
    get:
      response: { id: 1, name: Alice }
```

Supported methods: `get`, `post`, `put`, `patch`, `delete`, `head`, `options`,
`trace`, and `any`. Names are case-insensitive. Explicit methods take precedence
over `any` for the same path. Literal paths take precedence over parameterized
paths, so `/users/me` wins over `/users/:id` regardless of YAML order.

Dotted paths and identifiers work, including `/v1.0/status`, `/report.json`, and
`/users/jane.doe`. Path parameters are URL-decoded. Trailing slashes are ignored
when matching configured endpoints. Unmatched requests return 404.

The original single-method format remains supported:

```yaml
endpoints:
  /data:
    verb: get
    data: myRows
    responseStatus: 200
    responseContentType: application/json
```

### Response options

| Option | Behavior |
| --- | --- |
| `response` | Inline JSON value or text. Objects, arrays, numbers, booleans, and null are serialized as JSON. |
| `data` | Named file/CSV/folder source. Use `data` or `response`, not both. |
| `responseStatus` | HTTP status, 200–599; defaults to 200. |
| `responseContentType` | Explicit MIME type. Inline JSON defaults to `application/json`; strings and file readers default to `text/plain`. |
| `responseHeaders` | Header names and string/number values; template values are supported. Connection/framing headers are server-managed. |
| `delay` | Nonnegative response delay in milliseconds. |
| `handler` | Named JavaScript handler for custom logic. |

HEAD responses and statuses 204/304 have no body. Unexpected processing failures
return 500. Malformed URLs and JSON request bodies return 400.

### Templates

Use `{{params.id}}`, `{{query.page}}`, `{{headers.x-request-id}}`, `{{body.name}}`,
`{{method}}`, or `{{path}}` inside inline responses and response headers.

A whole-value placeholder preserves the value's type: `"{{body.items}}"` can
produce an array. Embedded placeholders produce text, such as
`"Hello {{body.name}}"`. Templates recurse through JSON objects and arrays.

Bodies with a JSON content type are parsed; other bodies are text. Request header
names are lowercase. Repeated query parameters become arrays. Missing template
values produce a descriptive 500 response. Templates perform property lookup;
they do not evaluate JavaScript.

### Request matching

Use `match` to restrict an endpoint, or `variants` to select a response while
keeping a default:

```yaml
endpoints:
  /search:
    post:
      response: { results: [] }
      variants:
        - match:
            query: { mode: restricted }
            headers: { X-Role: guest }
            body: { filter: { active: true } }
          responseStatus: 403
          response: { error: Access denied }
```

All specified conditions must match. Object conditions match a subset of fields;
arrays and primitive values use exact equality. Header names are case-insensitive.
The first matching variant wins and inherits the endpoint's response settings.
Unmatched variants use the base response. A failed endpoint-level `match` skips
that endpoint. Query values are strings (or arrays of strings).

### Response sequences

```yaml
endpoints:
  /job:
    get:
      sequence:
        - responseStatus: 503
          response: { state: retry }
        - responseStatus: 503
          response: { state: retry }
        - response: { state: complete, step: "{{scenario.index}}" }
      sequenceMode: hold
```

Each matched request reserves the next step before waiting for a handler or delay.
`hold` (default) repeats the final step; `cycle` repeats the sequence. Step indexes
start at zero. Each path/method definition has independent state, shared by its
path parameter values. Steps inherit base response settings; overriding `response`
replaces an inherited `data` source, and vice versa. Sequences and variants cannot
be combined on one endpoint.

Successful configuration reloads and the reset operation restart sequences.
This supports repeatable retry, polling, and pagination tests.

## Request history and assertions

Enable the optional administration API:

```yaml
admin:
  enabled: true
  path: /__mockapi
  historyLimit: 100
  bodyLimit: 16384
  # token: your-test-token
```

Without a token, administration is available to loopback clients only. Configure
a token for access from outside the host/container and send
`Authorization: Bearer your-test-token`. Cross-origin browser access without a
token is rejected. Administration routes are reserved while enabled.

| Request | Result |
| --- | --- |
| `GET /__mockapi/requests` | Recent requests, including headers, parsed body, path/query parameters, status, and duration. |
| `GET /__mockapi/requests?method=POST&path=/users` | Filter retained requests by exact method/path. |
| `POST /__mockapi/assert` | Check retained requests against a JSON assertion; 200 on success, 409 on mismatch, 400 on invalid input. |
| `POST /__mockapi/reset` | Clear history and restart sequences and CSV readers. |

Example assertion body:

```json
{
  "match": { "method": "POST", "path": "/users", "body": { "name": "Alice" } },
  "count": 1
}
```

`match` also supports headers and query fields. Use exact `count`, or `min`/`max`.
Without a count range, an assertion requires at least one match.

History records completed mock requests, including unmatched requests and errors;
docs, preflights, and administration calls are excluded. Old entries are evicted
at `historyLimit`. Bodies exceeding `bodyLimit` are truncated and marked
`bodyTruncated`; body assertions then operate on the retained text. Headers and
payloads may contain credentials, so enable history only for suitable test data.
History and scenario state are in memory and reset on a successful reload.

Programmatic `Core` users can call `getRequests(match)`,
`assertRequests(options)`, and `reset()` with the same behavior. Enable `admin`
to record history even when using the programmatic accessors.

## Data sources and custom handlers

```yaml
data:
  myRows:
    path: ./testdata/data.csv
    reader: csv
    properties: [json, seq, 0]
```

- `csv`: first row supplies property names. Format is `json` or `text` (row
  arrays); direction is `seq` or `rand`; the third property is the starting row
  index. Use `-1` to return all rows. Sequential reads wrap at the end.
- `text`: returns file contents as UTF-8 text. JSON files can use this reader
  together with `responseContentType: application/json`.
- `folder`: the legacy `/files` endpoint can serve `/files/name.json` from its
  configured folder. File requests stay inside that directory.

When omitted, CSV properties default to `[json, rand, 0]`. Data paths are checked
at startup/reload. Text and folder files are read per request; CSV is loaded into
memory. Resetting CSV readers restarts sequential position; random reads remain
random.

```yaml
externalModulesPath: ./apiHandlers
customHandlers:
  custom: myCustomHandler
endpoints:
  /custom/:id:
    get:
      handler: custom
      response: { source: mock }
```

```javascript
// apiHandlers/myCustomHandler.js
module.exports.process = async (request, data) => ({
  id: request.params.id,
  payload: data ? JSON.parse(data) : null
});
```

Handlers may return a string, Buffer, JSON value, or a promise for one of those.
The request includes `method`, configured `url`, actual `path`, raw `body`, parsed
`json`, `headers`, `params`, and `query`. The second argument is the configured
response/data; JSON objects are serialized for compatibility with existing handlers.

CommonJS `.js`/`.cjs` and ES module `.mjs` handlers are supported. The server waits
for module loading before listening. Reloading the config reloads handler entry
files; changes to transitive imports may require a restart. Handler files are not
watched independently. Exceptions/rejected promises become HTTP 500 responses;
`HttpException` can supply a deliberate HTTP error status.

## Configuration reloads and limits

Configuration is validated and prepared before it replaces the running state.
Invalid saves retain the previous configuration and log a field-specific error.
File watching handles both direct saves and editor saves that replace the file.
In-flight requests finish using their original configuration.

Changes to `port`, `host`, or `tls` require a restart and reject the reload.

```yaml
maxBodyBytes: 1048576  # default: 1 MiB; larger requests return 413
requestTimeout: 30000 # default: 30 seconds to receive the request body
log: verbose         # verbose, debug, error, or none
```

`requestTimeout` limits incoming requests, not intentionally delayed responses.
Malformed configuration, missing data, invalid handler exports, unavailable ports,
or invalid TLS material cause startup to fail with a nonzero exit code.
SIGINT/SIGTERM stop the watcher and close the server and its connections.

## CORS, static files, and HTTPS

`enableCors: true` permits all origins; `false` disables CORS. Fine-grained example:

```yaml
enableCors:
  origins: [http://localhost:3000]
  methods: [GET, POST, OPTIONS]
  headers: [Content-Type, Authorization]
  credentials: true
staticPath: ./public
tls:
  cert: ./certs/server.crt
  key: ./certs/server.key
```

CORS preflights are answered automatically. Static files are a fallback for
unmatched GET/HEAD requests, with MIME types inferred from extensions. Directory
traversal and symlinks escaping the configured root are rejected.

Omit `tls` for HTTP. When TLS is configured, both a valid certificate and key are
required; MockAPI does not fall back to HTTP on certificate errors.

## OpenAPI and offline docs

`/openapi.json` serves an OpenAPI 3.1 document and `/docs` serves Swagger UI. All UI
assets are served locally from the installed package; the online validator is
disabled. No CDN access is required at runtime.

```yaml
openApi:
  enabled: true
  docsPath: /docs
  specPath: /openapi.json
  info:
    title: My Mock API
    version: 1.0.0
    description: Local development API
```

Use `openApi: false` to disable docs. Enabled docs paths are reserved. Endpoint
metadata supports `summary`, `description`, `parameters`, `requestBody`,
`responseSchema`, and `responseExample` using OpenAPI shapes. Inline response
schemas/examples are generated automatically; templates and file/custom-handler
responses may need explicit schemas/examples. Sequence/variant statuses and
response headers are included. Metadata documents the API; it does not validate
incoming requests against schemas.

## Docker and verification

```sh
docker build -t mockapi .
docker run --rm -p 3001:8001 mockapi
docker compose up --build
```

The normal Compose service exposes the bundled API at `http://localhost:3001`.
Debug mode exposes it on port 3000, with the inspector bound to host loopback:

```sh
docker compose -f docker-compose.debug.yml up --build
```

Mount a custom config and any fixture/handler directories when needed. For example,
from a POSIX shell:

```sh
docker run --rm -p 3001:8001 \
  -v "$PWD/.mockapi-config:/usr/src/app/.mockapi-config:ro" \
  -v "$PWD/testdata:/usr/src/app/testdata:ro" \
  -v "$PWD/apiHandlers:/usr/src/app/apiHandlers:ro" mockapi
```

The image runs as the `node` user; mounted files must be readable by that user.
Match the container port to the configuration's `port`. For editor saves that
replace the config file, mounting its parent directory preserves watcher behavior
more reliably than a single-file mount.

For web-console **saving**, mount the whole configuration directory with write
access, set `admin.token` in that configuration, and ensure the `node` user can
write to the directory. Use the standard `.mockapi-config` filename in Docker
as well as when running locally. For example, if `mock-workspace/.mockapi-config` specifies
port 8001 and includes a token:

```sh
docker run --rm -p 127.0.0.1:3001:8001 \
  -v "$PWD/mock-workspace:/workspace" \
  mockapi node main.js --config /workspace/.mockapi-config
# Open http://localhost:3001/__mockapi/ui/ and enter the configured token.
```

Single-file bind mounts and read-only mounts cannot support atomic console
saves. Changes to the image's bundled file without a directory mount are local
to that container and disappear when the container is removed.

To create a reusable container from the published image, run this **once**.
Replace `WORKSPACE_PATH` with the absolute path to a directory containing your
`.mockapi-config`, configured with port 8001, `admin.enabled: true`, and an
`admin.token`:

```sh
docker run -d --name mockapi --restart unless-stopped -p 127.0.0.1:8001:8001 --mount "type=bind,source=WORKSPACE_PATH,target=/workspace" matiasiacono/mock-api:3.0.0 node main.js --config /workspace/.mockapi-config
```

The terminal is available immediately, and the container remains after stopping.
Open `http://localhost:8001/__mockapi/ui/` and enter your configured token.
It starts automatically when Docker starts unless you explicitly stopped it.
Use Docker Desktop's start/stop controls or reuse the container with:

```sh
docker stop mockapi
docker start mockapi
```

```sh
npm test
npm run test:coverage
npm run test:browser
docker run --rm --network none mockapi npm test
```

Tests cover configuration, routing, responses, scenarios, history/assertions,
HTTP limits, CORS, file/stream failures, HTTPS, async handlers, real CLI processes,
and filesystem reloads. CI runs on Windows/Linux with Node 22/24 and tests the
Docker image with external networking disabled.

The browser check uses an installed Chrome, Chromium, or Edge through its local
debugging protocol. Set `CHROME_PATH` if it is not in a standard location. It
tests token login, live endpoint CRUD, the request tester/log, YAML validation,
file conflicts, and the mobile layout. Screenshots are written to the ignored
`.local-data/` directory. It does not install browser libraries or change your
working configuration.

See [CHANGELOG.md](CHANGELOG.md) for release history.
