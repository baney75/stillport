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

## 0.1.1 candidate verification, September 6, 2026

The candidate passed TypeScript checking and 20 Bun tests with 157 assertions, a clean standalone build, shell syntax checking for `install.sh`, and `git diff --check`. All four release targets cross-compiled. The macOS ARM64 executable ran `--version`, `doctor`, `capabilities`, CLI schema, and MCP initialization/tool-discovery checks; the macOS x64 executable also reported `0.1.1` through Rosetta. Linux executables were not run on physical Linux hosts in this local pass.

Apple Photos 12.0 reported 1,481 items in the open library. A native `dogs` search returned current opaque item IDs; the compiled candidate turned one allowed HEIC result into a readable, correctly oriented 1200 × 1600 JPEG. An invalid item ID returned structured `NOT_FOUND` with exit code 4. Normal and original export behavior is unchanged. No private library metadata, IDs, or images are committed to this repository.

A synthetic local Takeout archive completed import, caption search, metadata retrieval, preview, and export through the compiled binary. The source hash was unchanged, the preview was a readable JPEG, and the index and exported media had mode `0600`. Automated checks also cover repeat import, paging, Unicode-normalized names, absent and malformed sidecars, missing media, symlinks that move outside the archive, SQL-like input, output collisions, and cleanup of failed exports.

Compiled MCP stdio checks initialized protocol `2025-06-18`, discovered the tool schemas, called capability discovery, and cancelled an active Google request. Cancellation returned a structured `CANCELLED` result. An MCP integration check also cancelled a Takeout export after its private staging directory existed; the result was `CANCELLED`, the staging directory was removed, and no final directory was published. Automated Google tests cover the documented Picker session and media-item wire contracts, polling metadata, bearer-authenticated downloads, URL-host restrictions, pagination, denial, expiry, transient retries, processing state, cleanup, and cancellation. No Google credential was configured on the verification host, so a real account authorization and person-completed Picker round trip remain unverified.

The static product page was rendered in Vivaldi's Chromium engine at 1280 × 900, 390 × 844, and a 640 × 450 CSS viewport captured at 2× device scale for the 200% check. It had no horizontal overflow at the narrow or 200% sizes, no unnamed link or button accessibility nodes, a logical keyboard focus order, no external scripts, and zero-second transitions with reduced motion enabled. The install control selected the exact one-line command when clipboard access was unavailable. Safari, iOS hardware, and assistive-technology sessions were not part of this pass.
