# Verification

## 0.1.3 plugin candidate, October 2, 2026

The local candidate passed TypeScript checking and 28 tests with 207 assertions,
a standalone macOS ARM64 build, installer/demo shell syntax checking, and
`git diff --check`. The compiled MCP server initialized protocol `2025-06-18`,
discovered 12 tools, and returned provider capabilities.

An independent protocol review reproduced cancellation during a Google JSON
response body returning `INVALID_RESPONSE`. The previous MCP cancellation test
used a runner that already threw `CANCELLED`, so it could not detect the provider
body catch. A streaming HTTP regression failed before the repair and passed
afterward. A separate MCP test now cancels the real Google provider's pending
synthetic JSON body through `notifications/cancelled` and requires `CANCELLED`.
Malformed JSON without cancellation still returns `INVALID_RESPONSE`.

The plugin ZIP contains 11 explicitly listed public files. Tests extracted it,
checked icon and onboarding resources, rejected missing files, symlinks, and
version mismatches, excluded added private files, and compared two builds byte
for byte. SHA-256: `443b1fa7e682ea17b6b4656ce72de746c92c5835eb5dbf8aedc4ca2bffb739c7`.
The skill validator passed. Codex installed the local marketplace plugin as
`stillport@stillport-marketplace` version `0.1.3`.

The extracted ZIP's public fixture completed import, caption search, preview,
and export through the compiled CLI. The generated preview was visually inspected
and matched the committed demo JPEG. The export matched the source PNG's hash,
the source stayed unchanged, and the exported file had mode `0600`. CI now runs
the extracted fixture on macOS and Linux alongside source and compiled checks.

The package is a skill for a local shell environment, with the CLI installed
separately. Its stdio MCP server is not a hosted directory connection. Native
Apple library access and real Google-account OAuth/Picker were not retested in
this pass. Directory upload, scan acceptance, review approval, and publication
are separate external states; local packaging and installation do not prove them.

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

## 0.1.2 candidate verification, September 7, 2026

The candidate passed TypeScript checking and 21 Bun tests with 181 assertions, a clean standalone build, shell syntax checks for `install.sh` and the public demo script, and `git diff --check`. The new Google media-byte regression checks exercise HTTP 401, 403, 404, and 410 through the download path, including error code, exit code, recovery guidance, provider-body redaction, and cleanup of partial output.

The compiled macOS ARM64 candidate reported `0.1.2` and passed `doctor`, capability discovery, and CLI schema discovery. Its committed synthetic public Takeout fixture completed import, caption search, and JPEG preview through `examples/takeout-demo/run.sh`. The source hash remained `bc326bc6448f30c32e26dbf48250017efc5d11576a56abfe2268d77420a14ca8`; the generated preview was a readable 1600 × 1066 JPEG with mode `0600`. The demo script also proved that this output matched `brand/demo-preview.jpg` byte for byte at SHA-256 `cc722a5d900ecdcc333985a2cf36a3e01a592e2151dc07fe241aa0ce19083e51`. No private library data or credentials are present in the fixture or page.

The revised product page was visually inspected in a normal, visible Vivaldi 8.1.4087.75 window at 1280 × 900, 390 × 844, and a 640-CSS-pixel viewport captured at 2× device scale. The actual Stillport-generated preview rendered at desktop and phone sizes. All checked layouts had no horizontal overflow, the accessibility tree had no unnamed interactive controls, reduced-motion emulation removed button transitions, and no external scripts loaded. A browser user gesture changed the install control to `Copied`; an independent read of the macOS system clipboard returned the exact visible one-line install command. Safari, iOS hardware, assistive technology, and a real Google-account Picker round trip remain outside this pass.
