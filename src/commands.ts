export interface Command {
  description: string;
  positional?: string;
  required?: string[];
  options: string[];
  mutation?: boolean;
}
const page = ["source", "limit", "cursor"];
const search = [...page, "after", "before", "favorite", "album"];
export const commands: Record<string, Command> = {
  doctor: {
    description:
      "Check local prerequisites without opening Photos or contacting Google.",
    options: ["profile"],
  },
  capabilities: {
    description: "Discover provider search engines and limitations.",
    options: [],
  },
  schema: {
    description: "Print the machine-readable CLI contract.",
    options: [],
  },
  status: {
    description:
      "Probe a provider. Apple may request Automation permission; Google checks credential configuration.",
    options: ["source", "profile"],
  },
  search: {
    description:
      "Search Apple Photos with its native engine, or search Takeout metadata. Google search happens in Picker.",
    positional: "query",
    options: [...search, "profile"],
  },
  list: {
    description:
      "List Apple Photos, Takeout media, or a Google Picker selection.",
    options: [...search, "session", "profile"],
  },
  albums: {
    description: "List Apple albums or Takeout folders.",
    options: page,
  },
  selection: {
    description: "Read the current selection in the Photos app.",
    options: ["limit", "cursor"],
  },
  get: {
    description: "Get an item by its opaque provider ID.",
    positional: "id",
    options: ["source", "session", "profile"],
  },
  export: {
    description:
      "Export one item into a new private subfolder of --out. Never overwrites.",
    positional: "id",
    required: ["out"],
    options: ["source", "session", "profile", "out", "original"],
    mutation: true,
  },
  preview: {
    description:
      "Export an Apple or Google image preview up to 1600 pixels for an agent to view.",
    positional: "id",
    required: ["out"],
    options: ["source", "session", "profile", "out"],
    mutation: true,
  },
  reveal: {
    description: "Reveal an Apple item in the native Photos app.",
    positional: "id",
    options: [],
    mutation: true,
  },
  "auth google": {
    description:
      "Connect Google via Desktop OAuth, PKCE, and the OS credential store.",
    options: ["client-json", "profile", "no-open"],
    mutation: true,
  },
  "auth logout": {
    description: "Remove a profile’s Google credentials from this device.",
    options: ["profile"],
    mutation: true,
  },
  "google pick": {
    description:
      "Create a Google Picker session. Return its URL for the user to search and select.",
    options: ["max-items", "profile", "open"],
    mutation: true,
  },
  "google session": {
    description:
      "Check whether the user finished picking. Honor pollingConfig when polling.",
    positional: "session",
    options: ["profile"],
  },
  "google items": {
    description: "List media the user picked in a session.",
    positional: "session",
    options: ["limit", "cursor", "profile"],
  },
  "google close": {
    description: "End a Picker session and its access to selected items.",
    positional: "session",
    options: ["profile"],
    mutation: true,
  },
  "takeout import": {
    description:
      "Index an extracted Google Takeout archive locally without copying media.",
    positional: "directory",
    options: [],
    mutation: true,
  },
  "agent skill": {
    description: "Print a portable skill for photo-aware agents.",
    options: [],
  },
  mcp: {
    description: "Serve photo tools through MCP over stdio.",
    options: ["profile"],
  },
  update: {
    description:
      "Install the latest GitHub release after checksum verification. Use --check to inspect only.",
    options: ["check"],
    mutation: true,
  },
};
export const optionTypes: Record<string, "string" | "boolean"> = {
  source: "string",
  limit: "string",
  cursor: "string",
  after: "string",
  before: "string",
  favorite: "boolean",
  album: "string",
  session: "string",
  profile: "string",
  out: "string",
  original: "boolean",
  "client-json": "string",
  "no-open": "boolean",
  "max-items": "string",
  open: "boolean",
  check: "boolean",
  human: "boolean",
  help: "boolean",
  version: "boolean",
  json: "boolean",
};
export const capabilities = {
  apple: {
    platform: "macOS",
    searchEngine: "apple-photos-native",
    nativeSearch: true,
    searchInput:
      "Plain text passed to Photos.search unchanged. Matches depend on the Photos version, language and completed indexing.",
    operations: [
      "search",
      "list",
      "albums",
      "selection",
      "get",
      "export",
      "preview",
      "reveal",
    ],
    permission: "macOS Automation for the calling terminal or agent host",
    scope: "currently open Photos library",
    cloud: "iCloud originals may need downloading by Photos",
    limits: [
      "No programmatic access to every smart album or Hidden/Recently Deleted collection",
      "Search syntax is defined by Photos; no universal Boolean or OCR guarantee",
    ],
  },
  google: {
    platform: "macOS, Linux",
    searchEngine: "google-photos-picker",
    nativeSearch: "interactive",
    operations: ["pick", "session", "items", "get", "export", "preview"],
    scope: "only items the user selects",
    permission: "Google Photos Picker OAuth",
    limits: [
      "No background search across an existing Google Photos library",
      "Selection requires a person in Google Photos",
      "Sessions and download URLs expire",
      "Image downloads omit location; video downloads are transcoded",
    ],
  },
  takeout: {
    platform: "macOS, Linux",
    searchEngine: "takeout-metadata",
    nativeSearch: false,
    operations: ["import", "search", "list", "albums", "get", "export"],
    scope: "local extracted archive",
    limits: [
      "Filename, caption and folder search only",
      "No Google face, object, OCR or live library search",
      "Archive must remain on disk",
      "Import refreshes the index; no automatic sync",
    ],
  },
};
