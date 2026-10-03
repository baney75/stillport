# Release notes

## 0.2.0

- Native Windows x64 and ARM64 builds, a checksum-verifying PowerShell installer,
  per-user state, protected output ACLs and updates after the executable exits.
- Oriented, bounded Windows previews for JPEG, PNG, GIF, TIFF and BMP.
- Private offline galleries through CLI and MCP, with local previews, metadata,
  filtering, pagination and placeholders for missing or unsupported previews.
- Archive inventory and index-only forget commands for moved Takeout archives.
- NFC-normalized Unicode metadata search, including migration of existing indexes.
- Date, album and favorites filters exposed consistently by MCP listings.
- Google previews reject unsupported MIME types, invalid headers, truncated still responses and
  oversized dimensions; failed downloads publish no partial gallery or preview.
- Reproducible plugin ZIPs built without an external ZIP executable; Windows
  installer and public PowerShell fixture included in the plugin.

Install with `install.sh` on macOS/Linux or `install.ps1` on Windows. The six
standalone executables need neither Bun nor Node; `SHA256SUMS` covers all six executables.
The plugin ZIP has its own checksum sidecar and supplies a skill for a local
macOS, Windows or Linux shell with the CLI installed separately. Its stdio MCP
server is a separate local integration. Codex directory review and publication
remain separate from this GitHub release.

Google requires your own OAuth Desktop client and a person to select items in
Picker. Automated HTTP-contract tests use synthetic responses; a real Google
account round trip remains unverified. Apple native search and preview were
exercised in earlier macOS verification. See [verification](verification.md) for
the current tested scope. macOS binaries are not notarized and Windows binaries
are not Authenticode signed.
