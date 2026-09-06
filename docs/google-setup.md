# Connect Google Photos

Stillport uses your own OAuth Desktop app client. There is no shared hosted OAuth service or bundled Google credential.

1. Create or select a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the [Google Photos Picker API](https://console.cloud.google.com/apis/library/photospicker.googleapis.com).
3. Configure the OAuth consent screen in Google Auth Platform. For a personal test project, add the Google account you will use as a test user.
4. Create an OAuth client with application type **Desktop app**. Download its JSON file to a private location outside a repository.
5. Run `stillport auth google --client-json /path/to/desktop-client.json` and finish authorization in your browser.
6. Run `stillport google pick --open`. Search and select in Google Photos, then use the returned session ID with `google session` and `google items`.

The requested scope is `https://www.googleapis.com/auth/photospicker.mediaitems.readonly`. Public distribution of an OAuth client can require Google verification; publishing this CLI does not supply or verify a shared client. Test-mode authorizations can expire and need sign-in again.

OAuth uses S256 PKCE, a random state, and a short-lived loopback callback bound to `127.0.0.1` on a random port. Access tokens, refresh tokens, and client configuration go into macOS Keychain or Linux Secret Service through Bun’s OS credential API. Stillport does not fall back to plaintext token files. Linux needs a running, unlocked credential service.

For environments without a browser on the same machine, supply a short-lived access token with the Picker scope in `STILLPORT_GOOGLE_ACCESS_TOKEN` using your agent host’s secret configuration. Stillport will not refresh environment tokens. Do not pass tokens on the command line or in chat. This token takes precedence over stored profiles for every Google command. `auth logout` cannot unset an environment token.

Optional environment variables: `STILLPORT_GOOGLE_CLIENT_ID` and `STILLPORT_GOOGLE_CLIENT_SECRET`. The client JSON is usually easier. After the first login, `stillport auth google --profile NAME` can reuse the saved client configuration. Use `--no-open` to print the authorization URL on stderr without launching a browser; the callback still needs to reach the same machine.

`stillport status --source google` reports credential configuration, not a live account identity check. Start a Picker session to verify current API access. Stillport does not request email/profile identity scopes. Check the chosen account in Google’s consent and Picker screens.

Remove local credentials with `stillport auth logout --profile NAME`. Revoke server-side authorization in [Google Account connections](https://myaccount.google.com/connections). Close a Picker session with `google close SESSION` after exports finish. Expired media URLs are refreshed by listing the still-active session again when exporting; expired sessions require a new selection.

References: [Picker API](https://developers.google.com/photos/picker/reference/rest), [session contract](https://developers.google.com/photos/picker/reference/rest/v1/sessions), [media downloads](https://developers.google.com/photos/picker/guides/media-items), [Desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app), [API changes](https://developers.google.com/photos/support/updates).
