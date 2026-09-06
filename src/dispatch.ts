import { existsSync } from "node:fs";
import {
  API_VERSION,
  VERSION,
  dataDir,
  fail,
  type Source,
  type SearchOptions,
} from "./core";
import { authStatus, login, logout, accessToken } from "./auth";
import {
  appleCall,
  appleSearch,
  appleAlbums,
  appleGet,
  appleExport,
} from "./providers/apple";
import { GooglePhotos, googleMedia } from "./providers/google";
import { Takeout } from "./providers/takeout";
import { commands, optionTypes, capabilities } from "./commands";
import { openBrowser } from "./core";
import { update } from "./update";
import skill from "../skills/stillport/SKILL.md" with { type: "text" };
export type Options = Record<string, string | boolean | undefined>;
const str = (o: Options, key: string) =>
  typeof o[key] === "string" ? (o[key] as string) : undefined;
export function integer(
  value: string | undefined,
  fallback: number,
  max: number,
) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max)
    fail(
      "INVALID_ARGUMENT",
      `Expected an integer from 1 to ${max}.`,
      undefined,
      2,
    );
  return Number(value);
}
export function date(value?: string) {
  if (!value) return undefined;
  if (
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(
      value,
    ) ||
    Number.isNaN(Date.parse(value))
  )
    fail(
      "INVALID_DATE",
      "Use YYYY-MM-DD or an ISO timestamp with a timezone.",
      undefined,
      2,
    );
  const result = new Date(value).toISOString();
  if (value.length === 10 && result.slice(0, 10) !== value)
    fail("INVALID_DATE", "This calendar date does not exist.", undefined, 2);
  return result;
}
export function sourceOf(value?: string): Source {
  if (value && !["apple", "google", "takeout"].includes(value))
    fail(
      "INVALID_SOURCE",
      "Source must be apple, google, or takeout.",
      undefined,
      2,
    );
  return (value || "apple") as Source;
}
export async function dispatch(
  command: string,
  argument: string | undefined,
  options: Options,
  notify: (value: unknown) => void = () => {},
): Promise<any> {
  const spec = commands[command];
  if (!spec)
    fail("UNKNOWN_COMMAND", "Unknown command.", "Run stillport --help.", 2);
  for (const key of Object.keys(options)) {
    if (!spec.options.includes(key) && !["human", "json", "help"].includes(key))
      fail(
        "INVALID_ARGUMENT",
        `--${key} does not apply to ${command}.`,
        undefined,
        2,
      );
    if (options[key] !== undefined && typeof options[key] !== optionTypes[key])
      fail("INVALID_ARGUMENT", `--${key} has the wrong type.`, undefined, 2);
  }
  if (spec.positional && !argument?.trim())
    fail(
      "ARGUMENT_REQUIRED",
      `Provide ${spec.positional}.`,
      `Run stillport ${command} --help.`,
      2,
    );
  if (!spec.positional && argument)
    fail(
      "INVALID_ARGUMENT",
      `${command} does not accept a positional argument.`,
      undefined,
      2,
    );
  for (const required of spec.required || [])
    if (!str(options, required))
      fail("ARGUMENT_REQUIRED", `--${required} is required.`, undefined, 2);
  const source = sourceOf(str(options, "source"));
  const profile = str(options, "profile") || "default";
  const limit = integer(str(options, "limit"), 25, 100);
  const cursor = str(options, "cursor");
  const after = date(str(options, "after")),
    before = date(str(options, "before"));
  if (after && before && after >= before)
    fail(
      "INVALID_DATE_RANGE",
      "--after must precede --before. After is inclusive; before is exclusive.",
      undefined,
      2,
    );
  const query: SearchOptions = {
    query: command === "search" ? argument : undefined,
    limit,
    cursor,
    after,
    before,
    album: str(options, "album"),
    favorite: options.favorite === true,
  };
  const google = new GooglePhotos(() => accessToken(profile));
  const withTakeout = async (work: (t: Takeout) => any) => {
    const t = await Takeout.open();
    try {
      return await work(t);
    } finally {
      t.close();
    }
  };
  const session = () =>
    str(options, "session") ||
    fail(
      "SESSION_REQUIRED",
      "Google access needs --session from a Picker selection.",
      "Run stillport google pick, share its pickerUri with the user, then list the selected items.",
      2,
    );
  switch (command) {
    case "schema":
      return {
        apiVersion: API_VERSION,
        version: VERSION,
        commands,
        optionTypes,
        defaults: {
          source: "apple",
          limit: 25,
          output: "json",
          profile: "default",
        },
        dateBounds: {
          after: "inclusive",
          before: "exclusive",
          dateOnlyTimezone: "UTC",
        },
        exitCodes: {
          0: "success",
          1: "failure",
          2: "invalid input",
          3: "authorization or unavailable platform",
          4: "not found",
          5: "temporary provider failure",
        },
      };
    case "capabilities":
      return capabilities;
    case "doctor":
      return {
        version: VERSION,
        platform: process.platform,
        arch: process.arch,
        apple: {
          installed:
            process.platform === "darwin" &&
            existsSync("/System/Applications/Photos.app"),
          permission: "not-probed",
          next: "stillport status --source apple",
        },
        google: {
          setup:
            "stillport auth google --client-json /path/to/desktop-client.json",
          credentialStore:
            process.platform === "darwin"
              ? "macOS Keychain"
              : "OS credential store",
          headless: "STILLPORT_GOOGLE_ACCESS_TOKEN",
          permission: "not-probed",
        },
        takeout: { indexExists: existsSync(dataDir() + "/takeout.sqlite") },
        networkChecked: false,
      };
    case "status":
      return source === "apple"
        ? appleCall({ action: "status" })
        : source === "google"
          ? authStatus(profile)
          : withTakeout((t) => t.status());
    case "search":
    case "list":
      if (source === "apple") return appleSearch(query);
      if (source === "takeout") return withTakeout((t) => t.search(query));
      if (
        command === "search" ||
        after ||
        before ||
        options.favorite ||
        options.album
      )
        fail(
          "INTERACTIVE_SEARCH_REQUIRED",
          "Search your existing Google library inside the Google Photos Picker.",
          "Run stillport google pick. Give the pickerUri to the user; they can use Google’s native search and select photos. Then run google items SESSION.",
          2,
        );
      return google.items(session(), limit, cursor);
    case "albums":
      if (source === "apple") return appleAlbums(limit, cursor);
      if (source === "takeout")
        return withTakeout((t) => t.albums(limit, cursor));
      return fail(
        "UNSUPPORTED_OPERATION",
        "Google Picker does not expose album listing.",
        "Use Google’s Picker to find photos in albums.",
        2,
      );
    case "selection":
      return appleSearch({ limit, cursor }, true);
    case "get":
      return source === "apple"
        ? appleGet(argument!)
        : source === "takeout"
          ? withTakeout((t) => t.get(argument!))
          : googleMedia(await google.find(session(), argument!));
    case "export":
    case "preview": {
      const preview = command === "preview";
      if (options.original && source !== "apple")
        fail(
          "UNSUPPORTED_OPTION",
          "--original is an Apple Photos export option.",
          undefined,
          2,
        );
      if (preview && source === "takeout")
        fail(
          "UNSUPPORTED_OPERATION",
          "Takeout previews are not generated.",
          "Use get to read the localPath or export to copy the file.",
          2,
        );
      if (source === "apple")
        return appleExport(
          argument!,
          str(options, "out")!,
          options.original === true,
          preview,
        );
      if (source === "takeout")
        return withTakeout((t) => t.export(argument!, str(options, "out")!));
      return google.download(
        session(),
        argument!,
        str(options, "out")!,
        preview,
      );
    }
    case "reveal":
      return appleCall({ action: "reveal", id: argument });
    case "auth google":
      return login(
        {
          profile,
          clientJson: str(options, "client-json"),
          open: options["no-open"] !== true,
        },
        notify,
      );
    case "auth logout":
      return logout(profile);
    case "google pick": {
      const result = await google.start(
        integer(str(options, "max-items"), 100, 2000),
      );
      if (options.open) {
        const url = new URL(result.pickerUri);
        if (url.protocol !== "https:" || url.hostname !== "photos.google.com")
          fail(
            "UNTRUSTED_PICKER_URL",
            "Google returned an unexpected Picker URL.",
          );
        return {
          ...result,
          opened: await openBrowser(result.pickerUri),
          searchEngine: "google-photos-native-interactive",
        };
      }
      return {
        ...result,
        next: "Ask the user to open pickerUri and select photos. Poll google session using pollingConfig; then call google items.",
        searchEngine: "google-photos-native-interactive",
      };
    }
    case "google session":
      return google.session(argument!);
    case "google items":
      return google.items(argument!, limit, cursor);
    case "google close":
      return google.close(argument!);
    case "takeout import":
      return withTakeout((t) => t.import(argument!));
    case "agent skill":
      return { name: "stillport", content: skill };
    case "update":
      return update(options.check === true);
    default:
      return fail(
        "UNKNOWN_COMMAND",
        "Unknown command.",
        "Run stillport --help.",
        2,
      );
  }
}
