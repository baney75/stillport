# Verification

Initial implementation checks, September 2026:

- Live Apple Photos on macOS: native search, date query, pagination across distinct results, item lookup, album listing, a 1600-pixel preview, and original export passed. An unavailable item produced an explicit empty-export error and left no partial files. Apple is addressed by its bundle ID; resolving an app by display name produced an incorrect scripting target during development.
- Automated CLI checks exercise schema discovery, capability discovery, structured errors, argument rejection, dates, and Google’s interactive-search boundary.
- Synthetic Takeout integration covers sidecar captions and timestamps, paging, SQL literal input, private exports, export collision avoidance, symlink escape rejection, and removal of stale index rows after re-import.
- Google HTTP-contract tests cover Picker requests, pagination, authenticated media requests, download parameters, host validation, failed-download cleanup, processing video rejection, transient GET retry, and non-retry of session creation.
- OAuth tests check PKCE and state validation. Real Google-account login, token refresh, selection and download have not been exercised with a user OAuth client. These are implemented, not live-account verified.
- MCP tests cover handshake, tool discovery, annotations, input validation, notifications, and successful/error tool results.
- Update tests cover platform selection, version ordering, and checksum-manifest rejection. Release installation and update status are checked separately during publication.

Native Photos results vary with its current library and indexing state. No automated test requires private photos. No private library output or credentials are included in this repository. The brand sheet was rendered at 1280-pixel and 390-pixel widths; no horizontal overflow was present on the phone layout.
