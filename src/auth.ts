import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { fail, openBrowser } from "./core";
import { requestJson } from "./http";
const SCOPE =
  "https://www.googleapis.com/auth/photospicker.mediaitems.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
interface Credential {
  clientId: string;
  clientSecret?: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}
interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}
export function validProfile(profile: string) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(profile))
    fail(
      "INVALID_PROFILE",
      "Profile must be 1–64 letters, digits, underscores or hyphens.",
      undefined,
      2,
    );
  return profile;
}
const key = (profile: string) => ({
  service: "dev.stillport.google",
  name: validProfile(profile),
});
async function read(profile: string): Promise<Credential | null> {
  try {
    const raw = await Bun.secrets.get(key(profile));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return fail(
      "KEYCHAIN_UNAVAILABLE",
      "The operating system credential store is unavailable.",
      "Unlock Keychain or start a Linux Secret Service. Headless agents can supply STILLPORT_GOOGLE_ACCESS_TOKEN.",
      3,
    );
  }
}
async function save(profile: string, value: Credential) {
  try {
    await Bun.secrets.set({ ...key(profile), value: JSON.stringify(value) });
  } catch {
    fail(
      "KEYCHAIN_UNAVAILABLE",
      "Could not store authorization in the operating system credential store.",
      "Unlock Keychain or start a Linux Secret Service. No plaintext credential file was written.",
      3,
    );
  }
}
export function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return {
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
  };
}
export function validState(actual: string | null, expected: string) {
  if (!actual) return false;
  const a = Buffer.from(actual),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export async function accessToken(profile = "default") {
  validProfile(profile);
  if (process.env.STILLPORT_GOOGLE_ACCESS_TOKEN)
    return process.env.STILLPORT_GOOGLE_ACCESS_TOKEN;
  const credential = await read(profile);
  if (!credential)
    return fail(
      "AUTH_REQUIRED",
      "Google Photos is not connected for this profile.",
      "Run stillport auth google --client-json /path/to/desktop-client.json.",
      3,
    );
  if (credential.expiresAt > Date.now() + 60_000) return credential.accessToken;
  if (!credential.refreshToken)
    return fail(
      "AUTH_REQUIRED",
      "Google authorization expired.",
      "Run stillport auth google again.",
      3,
    );
  const body = new URLSearchParams({
    client_id: credential.clientId,
    refresh_token: credential.refreshToken,
    grant_type: "refresh_token",
  });
  if (credential.clientSecret)
    body.set("client_secret", credential.clientSecret);
  const token = await requestJson<TokenResponse>(TOKEN_URL, {
    method: "POST",
    body,
  });
  if (!token.access_token || !Number.isFinite(token.expires_in))
    fail(
      "AUTH_RESPONSE_INVALID",
      "Google returned an incomplete token response.",
    );
  await save(profile, {
    ...credential,
    accessToken: token.access_token,
    refreshToken: token.refresh_token || credential.refreshToken,
    expiresAt: Date.now() + token.expires_in * 1000,
  });
  return token.access_token;
}
export async function authStatus(profile = "default") {
  validProfile(profile);
  if (process.env.STILLPORT_GOOGLE_ACCESS_TOKEN)
    return {
      configured: true,
      credentialSource: "environment",
      verified: false,
    };
  const credential = await read(profile);
  return {
    configured: !!credential,
    credentialSource: "os-keychain",
    verified: false,
    ...(credential ? { refreshable: !!credential.refreshToken } : {}),
  };
}
export async function logout(profile = "default") {
  try {
    await Bun.secrets.delete(key(profile));
  } catch {
    fail(
      "KEYCHAIN_UNAVAILABLE",
      "Could not remove the local credential.",
      "Unlock your credential store and retry.",
      3,
    );
  }
  return {
    disconnected: true,
    profile,
    note: "Local credentials removed. Revoke server access in your Google Account connections if needed. Environment tokens are unaffected.",
  };
}
export async function login(
  options: { profile: string; clientJson?: string; open?: boolean },
  notify: (value: unknown) => void,
) {
  validProfile(options.profile);
  let clientId = process.env.STILLPORT_GOOGLE_CLIENT_ID;
  let clientSecret = process.env.STILLPORT_GOOGLE_CLIENT_SECRET;
  if (options.clientJson) {
    try {
      const config = await Bun.file(options.clientJson).json();
      if (!config.installed?.client_id)
        fail(
          "INVALID_CLIENT",
          "Use a Google OAuth Desktop app client JSON file.",
          undefined,
          2,
        );
      clientId = config.installed.client_id;
      clientSecret = config.installed.client_secret;
    } catch (e) {
      if (e instanceof Error && "code" in e && e.code === "INVALID_CLIENT")
        throw e;
      fail(
        "INVALID_CLIENT",
        "Could not read the OAuth Desktop app client JSON file.",
        undefined,
        2,
      );
    }
  }
  if (!clientId) {
    const existing = await read(options.profile);
    clientId = existing?.clientId;
    clientSecret = existing?.clientSecret;
  }
  if (!clientId)
    return fail(
      "CLIENT_REQUIRED",
      "A Google OAuth Desktop app client is required.",
      "See docs/google-setup.md. Pass --client-json or set STILLPORT_GOOGLE_CLIENT_ID.",
      2,
    );
  const { verifier, challenge } = pkce();
  const state = randomBytes(32).toString("base64url");
  const callbackPath = "/oauth/callback";
  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: unknown) => void;
  let used = false;
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (request.method !== "GET" || url.pathname !== callbackPath)
        return new Response("Not found", { status: 404 });
      if (
        url.host !== `127.0.0.1:${server.port}` ||
        !validState(url.searchParams.get("state"), state)
      )
        return new Response("Invalid authorization state", { status: 400 });
      if (used)
        return new Response("Authorization already received", { status: 409 });
      const code = url.searchParams.get("code");
      if (!code && !url.searchParams.has("error"))
        return new Response("Missing authorization code", { status: 400 });
      used = true;
      if (!code) {
        rejectCode(new Error("denied"));
        return new Response("Authorization declined. You may close this tab.", {
          headers: { Connection: "close", "Cache-Control": "no-store" },
        });
      }
      resolveCode(code);
      return new Response(
        '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Stillport connected</title><body style="background:#f6f2e9;color:#163b36;font:20px system-ui;padding:12vh 10vw"><p>STILLPORT</p><h1>Back to the good stuff.</h1><p>Authorization received. Return to your terminal to confirm the connection.</p></body>',
        {
          headers: {
            "Content-Type": "text/html",
            Connection: "close",
            "Cache-Control": "no-store",
            "Content-Security-Policy":
              "default-src 'none'; style-src 'unsafe-inline'",
          },
        },
      );
    },
  });
  const redirectUri = `http://127.0.0.1:${server.port}${callbackPath}`;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
  }).toString();
  const timer = setTimeout(() => rejectCode(new Error("timeout")), 180_000);
  try {
    notify({
      event: "authorization_required",
      url: url.href,
      expiresInSeconds: 180,
    });
    if (options.open !== false) await openBrowser(url.href);
    let code: string;
    try {
      code = await codePromise;
    } catch {
      return fail(
        "AUTH_INCOMPLETE",
        "Google authorization was declined or timed out.",
        "Run auth google again when ready.",
        3,
      );
    }
    const body = new URLSearchParams({
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
    if (clientSecret) body.set("client_secret", clientSecret);
    const token = await requestJson<TokenResponse>(TOKEN_URL, {
      method: "POST",
      body,
    });
    if (
      !token.access_token ||
      !Number.isFinite(token.expires_in) ||
      (token.scope && !token.scope.split(" ").includes(SCOPE))
    )
      fail(
        "AUTH_SCOPE_MISSING",
        "Google did not grant Photos Picker access.",
        "Sign in again and allow selected photo access.",
        3,
      );
    await save(options.profile, {
      clientId,
      clientSecret,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + token.expires_in * 1000,
    });
    return {
      connected: true,
      profile: options.profile,
      scope: SCOPE,
      credentialStore: "os-keychain",
    };
  } finally {
    clearTimeout(timer);
    await server.stop();
  }
}
