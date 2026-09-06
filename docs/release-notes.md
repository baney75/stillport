Stillport’s first public release: Apple Photos native search, Google Photos Picker, and Google Takeout archive access for AI agents.

- TypeScript + Bun, with standalone macOS/Linux binaries for ARM64 and x64.
- Native Apple search, albums, selection, metadata, reveal, previews, and exports.
- Google Desktop OAuth with PKCE and OS credential storage; selected-media sessions and downloads.
- Local Takeout metadata search, date filtering, pagination, and safe copies.
- JSON CLI, discoverable command schema, 12-tool MCP stdio server, and a portable agent skill.
- Checksum-verified installer and updater with a retained previous binary.

Install with the repository’s install.sh. Assets named stillport-PLATFORM-ARCH are standalone executables; SHA256SUMS covers all four.

Google requires your own OAuth Desktop client and user selection in Picker. The initial release has automated Google HTTP-contract tests; real Google-account authorization is not yet verified. Apple native access was exercised on macOS. See docs/verification.md for scope and limits. Initial macOS releases are not notarized.
