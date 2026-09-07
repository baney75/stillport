# Product review brief

Reviewed September 6, 2026. These references informed Stillport's product and documentation work; they do not represent award submissions or endorsements.

## External criteria

- [Awwwards Mobile Excellence Guidelines](https://www.awwwards.com/mobile-excellence-guidelines.pdf) emphasize mobile usability, performance, discoverability, accessible sizing, and resilient interaction. For Stillport, that means a fast static introduction, readable commands, visible focus, no horizontal overflow, and no interaction that depends on animation.
- [The Webby Awards 2025/2026 judging criteria](https://www.webbyawards.com/judging-criteria/) cover content, structure and navigation, visual design, functionality, interactivity, innovation, and overall experience for websites; the software criteria also require the product to work for its audience. Stillport treats the CLI and MCP retrieval flow as the product, not the landing page alone.
- [CSS Design Awards](https://www.cssdesignawards.com/about) describes UI, UX, innovation, completeness, originality, and error-free execution as parts of its judging systems. Stillport uses those as craft prompts only. No internal review can establish an award result.

## Comparable product experiences

- [Immich quick start](https://docs.immich.app/overview/quick-start/) gives a single low-choice path, then branches into detailed setup and recovery. Stillport follows that pattern with install, `doctor`, provider choice, preview, and export before advanced configuration.
- [1Password CLI get started](https://www.1password.dev/cli/get-started) pairs installation with an immediate binary check and clearly separates operating-system requirements. Stillport documents a checksum check, `--version`, `doctor`, and the difference between source and standalone updates.
- [GitHub CLI manual](https://cli.github.com/manual/) makes the command hierarchy searchable and predictable. Stillport keeps the same contract available to both people and agents through `--help`, `schema`, `capabilities`, and MCP tool discovery.

## Acceptance criteria

- A new user can install a verified standalone binary, run a sanity check, identify the correct provider, and find the relevant setup guide.
- Apple Photos search can produce a correctly oriented JPEG preview bounded to 1600 pixels without editing the library; permission denial, missing items, and unavailable exports leave no ambiguous success or partial final directory.
- A synthetic Takeout archive supports import, search, preview, and export without changing its media. Re-import, pagination, Unicode filenames, missing sidecars, stale files, symlinks, collisions, and traversal attempts have reproducible checks.
- Google Picker behavior matches the current official sessions and media-items contracts. Automated contract tests remain distinct from a real authorized account round trip.
- A compatible MCP client can initialize, discover tools, reject invalid input, complete the synthetic retrieval flow, and cancel an active request with a readable error.
- The product page and documentation explain provider boundaries, privacy, setup, support, update, and rollback. The page works at desktop and narrow-phone widths, 200% zoom, keyboard focus, and reduced motion.
- The candidate passes `bun run check`, `bun run build`, compiled CLI and MCP smoke tests, installer syntax and behavior checks, and independent adversarial review before release.

## Current Google contract

Google's current [Picker session resource](https://developers.google.com/photos/picker/reference/rest/v1/sessions) returns `pickerUri`, `expireTime`, `mediaItemsSet`, and a recommended `pollingConfig`; clients should stop when `timeoutIn` is reached and wait `pollInterval` between checks. The [media-items guide](https://developers.google.com/photos/picker/guides/media-items) requires an OAuth bearer token on selected-media downloads, says base URLs normally last 60 minutes, documents `=w…-h…` image previews, `=d` image downloads without location metadata, and `=dv` transcoded video downloads. Stillport exposes these boundaries and does not claim background access to an existing Google Photos library.
