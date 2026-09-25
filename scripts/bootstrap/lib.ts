/**
 * Pure, side-effect-free helpers for `scripts/bootstrap.ts`.
 *
 * Everything in this module is deterministic (randomness is injected) so it can
 * be unit tested with `pnpm test:bootstrap`. Anything that touches the network,
 * the filesystem or child processes lives in `bootstrap.ts` / `io.ts`.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_NEON_REGION = "aws-sa-east-1";
export const LOCAL_APP_URL = "http://localhost:3000";
export const GOOGLE_CALLBACK_PATH = "/api/auth/callback/google";
export const STATE_VERSION = 1;

/** GitHub and Vercel both cap repository/project names at 100 characters. */
const MAX_SLUG_LENGTH = 100;

/** Google Cloud project IDs: 6-30 chars, lowercase letters/digits/hyphens, start with a letter. */
const GCP_PROJECT_ID_MIN = 6;
const GCP_PROJECT_ID_MAX = 30;
const GCP_SUFFIX_LENGTH = 6;
const GCP_PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

/** Vercel Blob store names are short; keep well under the dashboard limit. */
const MAX_BLOB_STORE_NAME_LENGTH = 32;

/** Name of the repository this kit is cloned from; used to detect the template remote. */
export const STARTER_KIT_REPO_NAME = "agentic-coding-starter-kit";

// ---------------------------------------------------------------------------
// Slugs and identifiers
// ---------------------------------------------------------------------------

/**
 * Turns a human app name ("Mi App Ñandú") into a slug valid for GitHub, Vercel,
 * Neon and npm package names ("mi-app-nandu").
 */
export function slugify(input: string): string {
  const slug = input
    .normalize("NFD")
    // Strip combining diacritics so "ñ" -> "n", "á" -> "a".
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");

  if (!slug) {
    throw new Error(`No se pudo generar un nombre válido a partir de "${input}"`);
  }
  return slug;
}

/** Returns true when `id` satisfies Google Cloud's project ID rules. */
export function isValidGcpProjectId(id: string): boolean {
  return (
    id.length >= GCP_PROJECT_ID_MIN &&
    id.length <= GCP_PROJECT_ID_MAX &&
    GCP_PROJECT_ID_PATTERN.test(id) &&
    !id.includes("--")
  );
}

/**
 * Produces a random lowercase alphanumeric suffix. `randomInt(max)` must return
 * an integer in [0, max); it is injected so tests are deterministic.
 */
export function randomSuffix(length: number, randomInt: (max: number) => number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[randomInt(alphabet.length)] ?? "a";
  }
  return out;
}

/**
 * Builds a globally-unique-ish Google Cloud project ID: `<slug>-<random>`.
 * The slug part is trimmed so the whole ID fits in 30 chars and is prefixed
 * with "app-" when it does not start with a letter.
 */
export function generateGcpProjectId(slug: string, randomInt: (max: number) => number): string {
  const suffix = randomSuffix(GCP_SUFFIX_LENGTH, randomInt);
  let base = slug.replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
  if (!/^[a-z]/.test(base)) {
    base = `app-${base}`;
  }
  const maxBaseLength = GCP_PROJECT_ID_MAX - GCP_SUFFIX_LENGTH - 1;
  base = base.slice(0, maxBaseLength).replace(/-+$/g, "");
  const id = `${base}-${suffix}`;

  if (!isValidGcpProjectId(id)) {
    throw new Error(`ID de proyecto de Google inválido generado: ${id}`);
  }
  return id;
}

/** Blob store name derived from the app slug. */
export function blobStoreName(slug: string): string {
  const suffix = "-blob";
  return `${slug.slice(0, MAX_BLOB_STORE_NAME_LENGTH - suffix.length).replace(/-+$/g, "")}${suffix}`;
}

/**
 * Maps a Neon region to the closest Vercel region so Blob storage lives near
 * the database. Falls back to Vercel's default (iad1).
 */
export function vercelRegionForNeonRegion(neonRegion: string): string {
  const map: Record<string, string> = {
    "aws-sa-east-1": "gru1",
    "aws-us-east-1": "iad1",
    "aws-us-east-2": "cle1",
    "aws-us-west-2": "pdx1",
    "aws-eu-central-1": "fra1",
    "aws-eu-west-2": "lhr1",
    "aws-ap-southeast-1": "sin1",
    "aws-ap-southeast-2": "syd1",
    "azure-eastus2": "iad1",
    "azure-westus3": "sfo1",
    "azure-gwc": "fra1",
  };
  return map[neonRegion] ?? "iad1";
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

/** Normalises an origin-like URL: requires http(s), strips trailing slashes, path, query. */
export function normalizeOrigin(url: string): string {
  const parsed = new URL(url.trim());
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`URL inválida (debe empezar con http:// o https://): ${url}`);
  }
  return parsed.origin;
}

export interface GoogleOAuthConfig {
  javascriptOrigins: string[];
  redirectUris: string[];
}

/** Values the user has to paste into the Google Cloud "Create OAuth client" form. */
export function buildGoogleOAuthConfig(prodUrl: string): GoogleOAuthConfig {
  const origins = [LOCAL_APP_URL, normalizeOrigin(prodUrl)];
  const unique = [...new Set(origins)];
  return {
    javascriptOrigins: unique,
    redirectUris: unique.map((origin) => `${origin}${GOOGLE_CALLBACK_PATH}`),
  };
}

export function googleConsoleUrls(gcpProjectId: string): {
  branding: string;
  createClient: string;
} {
  const project = encodeURIComponent(gcpProjectId);
  return {
    branding: `https://console.cloud.google.com/auth/branding?project=${project}`,
    createClient: `https://console.cloud.google.com/auth/clients/create?project=${project}`,
  };
}

/** Default production URL Vercel assigns to a project. */
export function defaultVercelUrl(projectName: string): string {
  return `https://${projectName}.vercel.app`;
}

/**
 * Ensures a Postgres connection string carries `sslmode=require` (Neon rejects
 * non-TLS connections). Other query params (e.g. channel_binding) are kept.
 */
export function ensureSslModeRequire(connectionString: string): string {
  const trimmed = connectionString.trim();
  if (!/^postgres(ql)?:\/\//.test(trimmed)) {
    throw new Error("La cadena de conexión no parece una URL de Postgres");
  }
  const parsed = new URL(trimmed);
  parsed.searchParams.set("sslmode", "require");
  return parsed.toString();
}

/**
 * True when `url` looks like a real Neon connection string (not the
 * env.example placeholder and not a local Docker URL).
 */
export function isProvisionedNeonUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host.endsWith(".neon.tech") && !host.startsWith("ep-xxxx");
  } catch {
    return false;
  }
}

/** True when a git remote URL points at the starter kit (any owner, https or ssh). */
export function isStarterKitRemote(remoteUrl: string): boolean {
  const repo = remoteUrl
    .trim()
    .replace(/\.git$/, "")
    .replace(/\/+$/, "")
    .split(/[/:]/)
    .pop();
  return repo === STARTER_KIT_REPO_NAME;
}

/**
 * Only URLs made of a conservative character set are handed to the OS opener.
 * On Windows `cmd /c start` re-parses its command line, so characters such as
 * `&`, `|` or `^` must never reach it.
 */
export function isSafeUrlToOpen(url: string): boolean {
  return /^https:\/\/[A-Za-z0-9._~\-/?=:%]+$/.test(url);
}

export interface OpenCommand {
  command: string;
  args: string[];
}

/** Cross-platform "open this URL in the browser" command. */
export function openUrlCommand(platform: NodeJS.Platform, url: string): OpenCommand {
  if (platform === "win32") {
    // The empty argument becomes `""` (the window title); without it `start`
    // would treat the URL itself as the title. libuv quotes empty args as "".
    return { command: "cmd", args: ["/c", "start", "", url] };
  }
  if (platform === "darwin") {
    return { command: "open", args: [url] };
  }
  return { command: "xdg-open", args: [url] };
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

export type RepoVisibility = "private" | "public";

export interface BootstrapOptions {
  appName: string | undefined;
  visibility: RepoVisibility;
  region: string;
  skipGoogle: boolean;
  skipBlob: boolean;
  skipDeploy: boolean;
  dryRun: boolean;
  yes: boolean;
  help: boolean;
  prodUrl: string | undefined;
  googleProjectId: string | undefined;
  neonOrgId: string | undefined;
}

const VALUE_FLAGS = ["--region", "--prod-url", "--google-project", "--neon-org"] as const;
type ValueFlag = (typeof VALUE_FLAGS)[number];

function isValueFlag(flag: string): flag is ValueFlag {
  return (VALUE_FLAGS as readonly string[]).includes(flag);
}

/** Parses `process.argv.slice(2)`. Throws on unknown flags or missing values. */
export function parseArgs(argv: readonly string[]): BootstrapOptions {
  const options: BootstrapOptions = {
    appName: undefined,
    visibility: "private",
    region: DEFAULT_NEON_REGION,
    skipGoogle: false,
    skipBlob: false,
    skipDeploy: false,
    dryRun: false,
    yes: false,
    help: false,
    prodUrl: undefined,
    googleProjectId: undefined,
    neonOrgId: undefined,
  };

  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i] ?? "";
    // Support both `--flag value` and `--flag=value`.
    const eq = raw.startsWith("--") ? raw.indexOf("=") : -1;
    const flag = eq > 0 ? raw.slice(0, eq) : raw;
    const inlineValue = eq > 0 ? raw.slice(eq + 1) : undefined;

    if (isValueFlag(flag)) {
      const value = inlineValue ?? argv[++i];
      if (value === undefined || value === "" || value.startsWith("--")) {
        throw new Error(`Falta el valor para ${flag}`);
      }
      if (flag === "--region") options.region = value;
      else if (flag === "--prod-url") options.prodUrl = normalizeOrigin(value);
      else if (flag === "--google-project") {
        if (!isValidGcpProjectId(value)) {
          throw new Error(`ID de proyecto de Google inválido: ${value}`);
        }
        options.googleProjectId = value;
      } else options.neonOrgId = value;
      continue;
    }

    if (inlineValue !== undefined) {
      throw new Error(`La opción ${flag} no acepta valor`);
    }

    switch (flag) {
      case "--private":
        options.visibility = "private";
        break;
      case "--public":
        options.visibility = "public";
        break;
      case "--skip-google":
        options.skipGoogle = true;
        break;
      case "--skip-blob":
        options.skipBlob = true;
        break;
      case "--skip-deploy":
        options.skipDeploy = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--yes":
      case "-y":
        options.yes = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        if (flag.startsWith("-")) {
          throw new Error(`Opción desconocida: ${flag}`);
        }
        positionals.push(raw);
    }
  }

  if (positionals.length > 1) {
    throw new Error(`Se esperaba un solo nombre de app, recibí: ${positionals.join(" ")}`);
  }
  options.appName = positionals[0];

  if (!/^[a-z0-9-]+$/.test(options.region)) {
    throw new Error(`Región de Neon inválida: ${options.region}`);
  }
  return options;
}

// ---------------------------------------------------------------------------
// .env handling
// ---------------------------------------------------------------------------

const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

/**
 * Removes surrounding quotes and inline comments from a raw .env value,
 * following dotenv's rules (what Next.js uses): single quotes and backticks
 * are literal, double quotes only expand `\n`, unquoted values end at " #".
 */
function parseEnvValue(raw: string): string {
  const value = raw.trim();
  const quote = value[0];
  if ((quote === '"' || quote === "'" || quote === "`") && value.length >= 2) {
    let end = 1;
    while (end < value.length && value[end] !== quote) {
      // dotenv lets \" appear inside a double-quoted value without closing it.
      end += value[end] === "\\" && value[end + 1] === quote ? 2 : 1;
    }
    if (end < value.length) {
      const inner = value.slice(1, end);
      return quote === '"' ? inner.replace(/\\n/g, "\n") : inner;
    }
  }
  const hash = value.search(/\s#/);
  return (hash >= 0 ? value.slice(0, hash) : value).trim();
}

/** Minimal dotenv parser: KEY=value, quotes, comments. Later keys win. */
export function parseEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const match = ENV_LINE.exec(line);
    if (match?.[1] !== undefined) {
      result[match[1]] = parseEnvValue(match[2] ?? "");
    }
  }
  return result;
}

/**
 * Serialises a value so dotenv reads it back unchanged. Plain values stay
 * unquoted; otherwise the first quote style not contained in the value is used
 * (single/backtick quotes are literal in dotenv). Values bootstrap writes
 * (URLs, base64, tokens) never need more than that.
 */
export function formatEnvValue(value: string): string {
  if (value === "") return "";
  if (/^[A-Za-z0-9_\-.:/@?=&%+,~]+$/.test(value)) return value;
  if (value.includes("\n")) {
    if (value.includes('"'))
      throw new Error("No se puede guardar en .env un valor multilínea con comillas");
    return `"${value.replace(/\n/g, "\\n")}"`;
  }
  const quote = ["'", "`", '"'].find((q) => !value.includes(q));
  if (!quote)
    throw new Error("No se puede guardar en .env un valor con los tres tipos de comillas");
  return `${quote}${value}${quote}`;
}

/**
 * Builds the new .env content.
 *
 * Precedence per key: `provisioned` (values bootstrap just obtained from the
 * cloud providers, non-empty) > `existing` (user's current .env, non-empty) >
 * the template's default. The template's layout and comments are preserved;
 * keys that exist only in the user's .env are appended so nothing is lost.
 */
export function mergeEnvFile(
  template: string,
  existingContent: string,
  provisioned: Readonly<Record<string, string | undefined>>
): string {
  const existing = parseEnv(existingContent);
  const seen = new Set<string>();

  const pick = (key: string, fallback: string): string => {
    const fromProvisioned = provisioned[key];
    if (fromProvisioned) return fromProvisioned;
    const fromExisting = existing[key];
    if (fromExisting) return fromExisting;
    return fallback;
  };

  const lines = template.split(/\r?\n/).map((line) => {
    if (/^\s*#/.test(line)) return line;
    const match = ENV_LINE.exec(line);
    if (match?.[1] === undefined) return line;
    const key = match[1];
    seen.add(key);
    return `${key}=${formatEnvValue(pick(key, parseEnvValue(match[2] ?? "")))}`;
  });

  const extras: string[] = [];
  for (const key of Object.keys(existing)) {
    if (!seen.has(key)) {
      seen.add(key);
      extras.push(`${key}=${formatEnvValue(pick(key, ""))}`);
    }
  }
  for (const [key, value] of Object.entries(provisioned)) {
    if (!seen.has(key) && value) {
      seen.add(key);
      extras.push(`${key}=${formatEnvValue(value)}`);
    }
  }

  // Drop trailing blank lines, then re-add exactly one newline at EOF.
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") lines.pop();
  if (extras.length > 0) {
    lines.push("", "# Added by pnpm bootstrap / kept from your previous .env", ...extras);
  }
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Vercel env plan
// ---------------------------------------------------------------------------

export type VercelTarget = "production" | "preview" | "development";
export const ALL_VERCEL_TARGETS: readonly VercelTarget[] = ["production", "preview", "development"];

export interface VercelEnvEntry {
  name: string;
  target: VercelTarget;
  value: string;
}

/**
 * Which env vars go to which Vercel environment. Shared secrets go everywhere;
 * URLs that only make sense for the production domain go to production only.
 * Empty values are skipped (e.g. Google when --skip-google).
 */
export function buildVercelEnvPlan(
  env: Readonly<Record<string, string | undefined>>,
  prodUrl: string
): VercelEnvEntry[] {
  const shared = ["POSTGRES_URL", "BETTER_AUTH_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];
  const plan: VercelEnvEntry[] = [];
  for (const name of shared) {
    const value = env[name];
    if (!value) continue;
    for (const target of ALL_VERCEL_TARGETS) plan.push({ name, target, value });
  }
  const origin = normalizeOrigin(prodUrl);
  plan.push({ name: "NEXT_PUBLIC_APP_URL", target: "production", value: origin });
  // Better Auth builds OAuth redirect URIs from BETTER_AUTH_URL when set.
  plan.push({ name: "BETTER_AUTH_URL", target: "production", value: origin });
  return plan;
}

// ---------------------------------------------------------------------------
// CLI output parsing (defensive: CLI JSON shapes change between versions)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Extracts the project id from `neonctl projects create --output json`. */
export function extractNeonProjectId(json: unknown): string | undefined {
  if (!isRecord(json)) return undefined;
  const project = json.project;
  if (isRecord(project) && typeof project.id === "string") return project.id;
  return typeof json.id === "string" ? json.id : undefined;
}

/** Finds a project by name in `neonctl projects list --output json` (array or {projects}). */
export function findNeonProjectIdByName(json: unknown, name: string): string | undefined {
  const list = Array.isArray(json) ? json : isRecord(json) ? json.projects : undefined;
  if (!Array.isArray(list)) return undefined;
  for (const item of list) {
    if (isRecord(item) && item.name === name && typeof item.id === "string") return item.id;
  }
  return undefined;
}

/** Collects every string value in a JSON tree. */
function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (isRecord(value)) Object.values(value).forEach((v) => collectStrings(v, out));
  return out;
}

/**
 * Best-effort production URL from `vercel project inspect --format json`.
 * Prefers `<project>.vercel.app`, then the shortest `<project>-*.vercel.app`
 * alias (Vercel appends a suffix when the plain name is taken). Deployment
 * URLs contain a hash and are longer, so "shortest" avoids them.
 */
export function extractVercelProductionUrl(json: unknown, projectName: string): string | undefined {
  const hosts = collectStrings(json)
    .map((s) => s.replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
    .filter((h) => /^[a-z0-9-]+\.vercel\.app$/.test(h));
  const exact = `${projectName}.vercel.app`;
  if (hosts.includes(exact)) return `https://${exact}`;
  const candidates = hosts
    .filter((h) => h.startsWith(`${projectName}-`))
    .sort((a, b) => a.length - b.length);
  return candidates[0] ? `https://${candidates[0]}` : undefined;
}

/** Finds a Blob store by name in `vercel blob list-stores --json` output. */
export function findBlobStore(json: unknown, name: string): boolean {
  const list = Array.isArray(json) ? json : isRecord(json) ? json.stores : undefined;
  if (!Array.isArray(list)) return false;
  return list.some((item) => isRecord(item) && item.name === name);
}

// ---------------------------------------------------------------------------
// Persistent state (.bootstrap.json) — never holds secrets
// ---------------------------------------------------------------------------

export const STEP_IDS = [
  "identity",
  "github",
  "neon",
  "vercel",
  "blob",
  "google",
  "env",
  "vercel-env",
  "migrate",
  "deploy",
] as const;
export type StepId = (typeof STEP_IDS)[number];

export interface BootstrapState {
  version: number;
  slug: string;
  completed: Partial<Record<StepId, string>>;
  github?: { url: string };
  neon?: { projectId: string; region: string };
  vercel?: { projectName: string; prodUrl: string };
  blob?: { storeName: string };
  google?: { projectId: string };
}

export function createState(slug: string): BootstrapState {
  return { version: STATE_VERSION, slug, completed: {} };
}

/** Keys that must never be persisted to .bootstrap.json. */
const SECRET_LIKE = /(secret|token|password|postgres_url|connection|client_id)/i;

/** Validates JSON read from disk; returns undefined for anything unrecognised. */
export function parseState(raw: string): BootstrapState | undefined {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(data) || data.version !== STATE_VERSION || typeof data.slug !== "string") {
    return undefined;
  }
  const completed: Partial<Record<StepId, string>> = {};
  if (isRecord(data.completed)) {
    for (const id of STEP_IDS) {
      const value = data.completed[id];
      if (typeof value === "string") completed[id] = value;
    }
  }
  const state: BootstrapState = { version: STATE_VERSION, slug: data.slug, completed };

  const str = (obj: unknown, key: string): string | undefined =>
    isRecord(obj) && typeof obj[key] === "string" ? obj[key] : undefined;

  const githubUrl = str(data.github, "url");
  if (githubUrl) state.github = { url: githubUrl };
  const neonId = str(data.neon, "projectId");
  if (neonId) state.neon = { projectId: neonId, region: str(data.neon, "region") ?? "" };
  const vercelName = str(data.vercel, "projectName");
  const vercelUrl = str(data.vercel, "prodUrl");
  if (vercelName && vercelUrl) state.vercel = { projectName: vercelName, prodUrl: vercelUrl };
  const storeName = str(data.blob, "storeName");
  if (storeName) state.blob = { storeName };
  const googleId = str(data.google, "projectId");
  if (googleId) state.google = { projectId: googleId };
  return state;
}

/** Serialises state; throws if anything secret-looking slipped in. */
export function serializeState(state: BootstrapState): string {
  const json = JSON.stringify(state, null, 2);
  const offending = collectKeys(JSON.parse(json)).find((key) => SECRET_LIKE.test(key));
  if (offending) {
    throw new Error(`Refusing to persist secret-like key "${offending}" in .bootstrap.json`);
  }
  if (/postgres(ql)?:\/\/[^\s"]*:[^\s"]*@/.test(json)) {
    throw new Error("Refusing to persist a database connection string in .bootstrap.json");
  }
  return `${json}\n`;
}

function collectKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => collectKeys(v, out));
  else if (isRecord(value)) {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      collectKeys(v, out);
    }
  }
  return out;
}

export function isStepDone(state: BootstrapState, step: StepId): boolean {
  return typeof state.completed[step] === "string";
}

/** Returns a new state with `step` marked complete at `now`. */
export function markStepDone(state: BootstrapState, step: StepId, now: Date): BootstrapState {
  return { ...state, completed: { ...state.completed, [step]: now.toISOString() } };
}

// ---------------------------------------------------------------------------
// Preflight install hints
// ---------------------------------------------------------------------------

export type ToolName = "git" | "gh" | "neonctl" | "vercel" | "gcloud";

export interface ToolHint {
  install: string;
  login: string | undefined;
}

/** Exact install + login commands for each CLI, per OS. */
export function toolHint(tool: ToolName, platform: NodeJS.Platform): ToolHint {
  const win = platform === "win32";
  const mac = platform === "darwin";
  switch (tool) {
    case "git":
      return {
        install: win
          ? "winget install --id Git.Git -e"
          : mac
            ? "xcode-select --install   (o: brew install git)"
            : "sudo apt install git   (o el gestor de paquetes de tu distro)",
        login: undefined,
      };
    case "gh":
      return {
        install: win
          ? "winget install --id GitHub.cli -e"
          : mac
            ? "brew install gh"
            : "sudo apt install gh   (ver https://github.com/cli/cli/blob/trunk/docs/install_linux.md)",
        login: "gh auth login",
      };
    case "neonctl":
      return {
        install: mac ? "brew install neonctl   (o: npm i -g neonctl)" : "npm i -g neonctl",
        login: "neonctl auth",
      };
    case "vercel":
      return { install: "npm i -g vercel@latest", login: "vercel login" };
    case "gcloud":
      return {
        install: win
          ? "winget install --id Google.CloudSDK -e"
          : mac
            ? "brew install --cask google-cloud-sdk"
            : "curl https://sdk.cloud.google.com | bash   (ver https://cloud.google.com/sdk/docs/install)",
        login: "gcloud auth login",
      };
  }
}
