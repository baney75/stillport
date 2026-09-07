Stillport 0.1.1 completes the preview path and makes long MCP requests cancellable.

- Apple Photos previews are now correctly oriented JPEGs bounded to 1600 pixels. Normal and original exports keep their prior behavior.
- Google Takeout now supports `search` to `preview` to `export`. macOS converts stills to bounded JPEGs; Linux copies web-readable stills unchanged and explains when a format needs macOS.
- MCP clients can cancel an active request. Stillport stops cancellable provider work, removes partial staging folders, and returns a structured `CANCELLED` result.
- Takeout checks now cover repeated import, Unicode names, missing metadata, paging, stale files, symlinks, path changes, and export collisions with synthetic fixtures.
- Google Picker contract checks cover polling data, denial, expiration, temporary failures, authenticated downloads, and cancellation.
- The product page and quickstart now explain provider choice, privacy boundaries, install verification, rollback, and support paths.

Install with the repository’s install.sh. Assets named stillport-PLATFORM-ARCH are standalone executables; SHA256SUMS covers all four.

Google requires your own OAuth Desktop client and a person to select items in Picker. Automated Google HTTP-contract tests passed; a real Google-account authorization remains unverified. Apple native search and preview were exercised on macOS. See docs/verification.md for the tested scope and limits. macOS releases are not notarized.
