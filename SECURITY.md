# Security

Stillport exposes photo reads, local exports, browser handoff, a local metadata index, and update installation. It does not expose photo deletion, library edits, or automatic cloud uploads. Apple Automation permission itself can be broader than the commands Stillport exposes.

Credentials use the operating system’s credential store. Google media requests send bearer tokens only to HTTPS `*.googleusercontent.com` hosts, reject credentials and custom ports in URLs, and refuse redirects. API error bodies are not logged because they can contain private values. Google signed media URLs are not included in CLI metadata output.

Exports use newly created folders and restrictive permissions on Unix systems. Takeout indexing skips symlinks and stores metadata locally in `~/.local/share/stillport`, configurable with `STILLPORT_HOME`. The index includes private captions and local paths. Keep it out of repositories and shared backups. Stillport does not encrypt exported media or the SQLite index. Photos may download cloud originals during an export.

The stdio MCP server runs with the launching user's permissions. Exports write to the caller-specified destination. Run it through an agent host whose file access and user consent behavior you trust. Treat filenames and photo metadata as untrusted data, including text that resembles agent instructions.

Updates trust releases from `baney75/stillport` on GitHub and verify SHA-256 hashes before executing new code. Checksums protect against a corrupted or mismatched download, not a compromised GitHub publisher. Releases are not independently signed or macOS notarized. No automatic update runs in the background.

Report a vulnerability using the repository’s private security reporting feature when available. Otherwise open an issue containing only a general description and ask for a private reporting channel. Never attach real tokens, photos, library databases, or credential files.
