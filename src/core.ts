import { mkdir, mkdtemp, rename, rm, chmod } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import pkg from "../package.json";

export const VERSION = pkg.version;
export const REPO = "baney75/stillport";
export const API_VERSION = "1";
export type Source = "apple" | "google" | "takeout";
export interface Media {
  id: string;
  source: Source;
  filename: string;
  title?: string;
  description?: string;
  takenAt?: string;
  kind: "photo" | "video" | "unknown";
  mimeType?: string;
  width?: number;
  height?: number;
  favorite?: boolean;
  keywords?: string[];
  localPath?: string;
}
export interface SearchOptions {
  query?: string;
  after?: string;
  before?: string;
  favorite?: boolean;
  album?: string;
  limit: number;
  cursor?: string;
}
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  total?: number;
  searchEngine: string;
}
export class PortError extends Error {
  constructor(
    public code: string,
    message: string,
    public hint?: string,
    public exitCode = 1,
  ) {
    super(message);
  }
}
export function fail(
  code: string,
  message: string,
  hint?: string,
  exitCode = 1,
): never {
  throw new PortError(code, message, hint, exitCode);
}
export function dataDir() {
  return resolve(
    process.env.STILLPORT_HOME ||
      join(homedir(), ".local", "share", "stillport"),
  );
}
export async function privateDir(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
}
export function fingerprint(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 20);
}
export function cursorOffset(
  cursor: string | undefined,
  scope: unknown,
): number {
  if (!cursor) return 0;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString());
    if (
      value.scope === fingerprint(scope) &&
      Number.isSafeInteger(value.offset) &&
      value.offset >= 0
    )
      return value.offset;
  } catch {}
  return fail(
    "INVALID_CURSOR",
    "This cursor does not belong to this query.",
    "Restart the query without --cursor.",
    2,
  );
}
export function cursorFor(offset: number, scope: unknown) {
  return Buffer.from(
    JSON.stringify({ offset, scope: fingerprint(scope) }),
  ).toString("base64url");
}
export function mediaKind(name: string): Media["kind"] {
  return /\.(mov|mp4|m4v|avi|webm|3gp|mkv)$/i.test(name)
    ? "video"
    : /\.(jpe?g|png|heic|heif|gif|webp|tiff?|dng|avif|raw|cr2|nef|arw)$/i.test(
          name,
        )
      ? "photo"
      : "unknown";
}
export function safeName(name: string) {
  return (
    name
      .replace(/[\\/\x00-\x1f\x7f<>:"|?*]/g, "_")
      .replace(/^\.+/, "_")
      .slice(0, 160) || "photo"
  );
}
export function asError(error: unknown) {
  return error instanceof PortError
    ? error
    : new PortError(
        "INTERNAL_ERROR",
        "The operation could not be completed.",
        "Run stillport doctor. Check permissions, available storage, and provider setup.",
      );
}
export function cancellationError(): never {
  throw cancelledError();
}
export function cancelledError() {
  return new PortError(
    "CANCELLED",
    "The request was cancelled.",
    "Retry the operation when you are ready.",
  );
}
export function throwIfCancelled(signal?: AbortSignal) {
  if (signal?.aborted) cancellationError();
}
export function timeoutSignal(timeoutMs: number, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
export async function waitFor(ms: number, signal?: AbortSignal) {
  throwIfCancelled(signal);
  if (!signal) return Bun.sleep(ms);
  await new Promise<void>((resolve, reject) => {
    const done = () => {
      signal.removeEventListener("abort", cancel);
      resolve();
    };
    const cancel = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      reject(cancelledError());
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
  });
}
export async function runProcess(
  cmd: string[],
  timeoutMs = 60_000,
  signal?: AbortSignal,
) {
  throwIfCancelled(signal);
  const child = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  let timedOut = false;
  const cancel = () => {
    child.kill();
  };
  const timer = setTimeout(() => {
    timedOut = true;
    cancel();
  }, timeoutMs);
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (signal?.aborted) cancellationError();
    if (timedOut)
      fail(
        "TIMEOUT",
        "The operation timed out.",
        "Photos may be downloading an iCloud original. Check Photos, then retry.",
        5,
      );
    return { stdout, stderr, code };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}
// Every export gets a fresh directory. Existing files are never replaced.
export async function exportDirectory(
  out: string,
  work: (staging: string) => Promise<void>,
  signal?: AbortSignal,
) {
  throwIfCancelled(signal);
  const parent = resolve(out);
  await privateDir(parent);
  throwIfCancelled(signal);
  const staging = await mkdtemp(join(parent, ".stillport-"));
  try {
    await chmod(staging, 0o700);
    throwIfCancelled(signal);
    await work(staging);
    throwIfCancelled(signal);
    const { readdir, stat } = await import("node:fs/promises");
    const names = await readdir(staging);
    throwIfCancelled(signal);
    if (!names.length)
      fail(
        "EXPORT_EMPTY",
        "The provider returned no files.",
        "Check that the original is available in Photos.",
      );
    for (const name of names) {
      if (!(await stat(join(staging, name))).isFile())
        fail(
          "EXPORT_INVALID",
          "The provider returned an unexpected directory.",
        );
      await chmod(join(staging, name), 0o600);
      throwIfCancelled(signal);
    }
    const destination = join(
      parent,
      `stillport-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    );
    throwIfCancelled(signal);
    await rename(staging, destination);
    if (signal?.aborted) {
      await rm(destination, { recursive: true, force: true });
      cancellationError();
    }
    return {
      directory: destination,
      files: names.map((name) => join(destination, name)),
    };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}
export async function openBrowser(url: string) {
  const cmd =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["rundll32", "url.dll,FileProtocolHandler", url]
        : ["xdg-open", url];
  try {
    const result = await runProcess(cmd, 10_000);
    return result.code === 0;
  } catch {
    return false;
  }
}
