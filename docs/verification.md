# Verification

Initial implementation checks, September 2026:

- Live Apple Photos on macOS: native search, date query, pagination across distinct results, item lookup, album listing, a 1600-pixel preview, and original export passed. An unavailable item produced an explicit empty-export error and left no partial files. Apple is addressed by its bundle ID; resolving an app by display name produced an incorrect scripting target during development.
- Automated CLI checks exercise schema discovery, capability discovery, structured errors, argument rejection, dates, and Google’s interactive-search boundary.
- Synthetic Takeout integration covers sidecar captions and timestamps, paging, SQL literal input, private exports, export collision avoidance, symlink escape rejection, and removal of stale index rows after re-import.
- Google HTTP-contract tests cover Picker requests, pagination, authenticated media requests, download parameters, host validation, failed-download cleanup, processing video rejection, transient GET retry, and non-retry of session creation.
- OAuth tests check PKCE, state validation, and a real loopback callback rejecting forged state, invalid methods, and incomplete callbacks, then closing on user denial. Real Google-account login, token refresh, selection and download have not been exercised with a user OAuth client. These are implemented, not live-account verified.
- MCP tests cover handshake, tool discovery, annotations, input validation, notifications, and successful/error tool results. An independent probe using the official MCP TypeScript SDK 1.17.4 connected to the compiled server, discovered all 12 tools, and called capability discovery.
- Update tests cover platform selection, version ordering, and checksum-manifest rejection. Release installation and update status are checked separately during publication.

Native Photos results vary with its current library and indexing state. No automated test requires private photos. No private library output or credentials are included in this repository. The brand sheet was rendered at 1280-pixel and 390-pixel widths; no horizontal overflow was present on the phone layout.

## Published release, September 6, 2026

GitHub release `v0.1.0` contains standalone macOS and Linux ARM64/x64 binaries and `SHA256SUMS`. The release workflow and macOS/Linux CI passed at source commit `5517664` (14 tests, 113 assertions).

On macOS ARM64, the installer fetched from the public repository matched the reviewed installer, verified the public binary checksum, and installed a working `0.1.0` executable. The installed release passed `doctor`, current-version update discovery, and a live native Apple Photos search.

A separately compiled test binary reporting `0.0.0` discovered the public `0.1.0` release, downloaded it, verified its checksum, replaced itself, and then reported `0.1.0`. Its retained rollback executable still reported `0.0.0`. Temporary test copies were removed after this check.

The public installer was exercised on macOS ARM64. Linux CI ran the test suite and compiled executable checks; the macOS Intel and Linux ARM64 assets were cross-compiled, not executed on physical hosts during this verification. Real Google-account authorization remains unverified.
