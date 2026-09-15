# Changelog

## Unreleased

- Full-path routing and literal-route precedence.
- Validated, atomic configuration reloads with clear errors.
- Per-method endpoints, inline responses, headers, templates, matching, and resettable sequences.
- Opt-in request history and assertions.
- Awaited custom handlers, body limits, request timeouts, safer file serving, and strict TLS startup.
- Working CLI initialization, overwrite protection, explicit configuration paths, and validation.
- Offline Swagger UI with request bodies, schemas, examples, and multiple response statuses.
- Node 22+ support, Node 24 Docker image, corrected debug ports, and Windows/Linux CI.

## Version 2.5.1 notes

- Fixed a small issue with the CLI that prevented to create a default configuration file.

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

