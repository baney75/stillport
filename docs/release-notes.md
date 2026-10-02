Stillport 0.1.3 adds an installable Codex skill plugin and fixes cancellation while a Google JSON response is loading.

- Cancelling a Google request after headers arrive now returns `CANCELLED` while its JSON body is loading; malformed JSON still returns `INVALID_RESPONSE`.
- A portable plugin manifest and repository marketplace make the photo workflow installable in Codex. The skill includes local CLI setup, Google guidance, and the public synthetic fixture.
- Reproducible plugin packaging checks referenced resources and version agreement, rejects symlinks, and excludes credentials, indexes, development dependencies, and compiled executables.
- CI and releases build the plugin ZIP alongside the existing standalone CLI. A published privacy document describes provider requests, local retention, and agent-host data handling.

Install with the repository's install.sh. Assets named stillport-PLATFORM-ARCH are standalone executables; SHA256SUMS covers all four. The plugin ZIP has its own SHA-256 sidecar and requires a local macOS or Linux shell plus the CLI. Its stdio MCP server remains a separate local integration. A directory upload is separate from review approval and publication.

Google requires your own OAuth Desktop client and a person to select items in Picker. Automated Google HTTP-contract tests passed; a real Google-account authorization remains unverified. Apple native search and preview were exercised on macOS. See docs/verification.md for the tested scope and limits. macOS releases are not notarized.
