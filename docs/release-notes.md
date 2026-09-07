Stillport 0.1.2 fixes selected-media recovery errors and adds a reproducible public retrieval demonstration.

- Google selected-media downloads now preserve recovery semantics: 401 returns `AUTH_REQUIRED`, 403 returns `ACCESS_DENIED`, and 404 or 410 returns `NOT_FOUND`, with the matching exit code and next action.
- Media-byte endpoint regressions cover every mapped status, provider-body redaction, and partial-output cleanup.
- The repository includes a metadata-stripped synthetic harbor fixture, a one-command Takeout demonstration, and the actual JPEG preview produced by Stillport.
- The product page connects that command to abridged structured output and the viewable preview without using private library data.
- This release includes the 0.1.1 Apple JPEG preview, Takeout preview, and MCP cancellation improvements.

Install with the repository’s install.sh. Assets named stillport-PLATFORM-ARCH are standalone executables; SHA256SUMS covers all four.

Google requires your own OAuth Desktop client and a person to select items in Picker. Automated Google HTTP-contract tests passed; a real Google-account authorization remains unverified. Apple native search and preview were exercised on macOS. See docs/verification.md for the tested scope and limits. macOS releases are not notarized.
