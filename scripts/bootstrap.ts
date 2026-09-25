#!/usr/bin/env npx tsx
/**
 * One-command provisioning for a new app built from this starter kit.
 *
 *   pnpm bootstrap mi-app [--public] [--region aws-sa-east-1] [--skip-google]
 *                         [--skip-blob] [--skip-deploy] [--dry-run] [--yes]
 *
 * Creates the GitHub repo, Neon database, Vercel project (+ Blob store),
 * Google Cloud project (OAuth client is a guided manual step), writes .env,
 * pushes env vars to Vercel, runs migrations and deploys.
 *
 * Every step is idempotent. Progress and resource IDs (never secrets) are kept
 * in `.bootstrap.json`, so re-running `pnpm bootstrap` resumes where it stopped.
 * Secrets only ever live in `.env` (git-ignored) and in Vercel.
 *
 * See docs/bootstrap.md for prerequisites and details.
 */

import { randomBytes, randomInt } from "crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import {
  CommandError,
  Prompter,
  Runner,
  error,
  header,
  info,
  log,
  step,
  success,
  warn,
} from "./bootstrap/io";
import {
  LOCAL_APP_URL,
  blobStoreName,
  buildGoogleOAuthConfig,
  buildVercelEnvPlan,
  createState,
  defaultVercelUrl,
  ensureSslModeRequire,
  extractNeonProjectId,
  extractVercelProductionUrl,
  findBlobStore,
  findNeonProjectIdByName,
  generateGcpProjectId,
  googleConsoleUrls,
  isProvisionedNeonUrl,
  isSafeUrlToOpen,
  isStarterKitRemote,
  isStepDone,
  markStepDone,
  mergeEnvFile,
  normalizeOrigin,
  openUrlCommand,
  parseArgs,
  parseEnv,
  parseState,
  serializeState,
  slugify,
  toolHint,
  vercelRegionForNeonRegion,
  type BootstrapOptions,
  type BootstrapState,
  type StepId,
  type ToolName,
} from "./bootstrap/lib";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, "..");
const ENV_EXAMPLE = join(ROOT_DIR, "env.example");
const ENV_FILE = join(ROOT_DIR, ".env");
const STATE_FILE = join(ROOT_DIR, ".bootstrap.json");
const PACKAGE_JSON = join(ROOT_DIR, "package.json");

/**
 * The starter kit used to ship this value in env.example. Anyone who copied it
 * has a publicly known secret, so it is always replaced.
 */
const LEAKED_KIT_SECRET = "qtD4Ssa0t5jY7ewALgai97sKhAtn7Ysc";
const BETTER_AUTH_SECRET_BYTES = 32;
const VERCEL_SENSITIVE_PLACEHOLDER = "SENSITIVE_ENV_VALUE_PLACEHOLDER";
const RESUME_HINT = "Volvé a correr `pnpm bootstrap` para continuar desde donde quedó.";

const HELP = `
Uso: pnpm bootstrap <nombre-app> [opciones]

Opciones:
  --private               Repo de GitHub privado (por defecto)
  --public                Repo de GitHub público
  --region <id>           Región de Neon (por defecto aws-sa-east-1)
  --neon-org <id>         Organización de Neon (si tenés más de una)
  --prod-url <url>        URL de producción si no es https://<app>.vercel.app
  --google-project <id>   Reusar un proyecto de Google Cloud existente
  --skip-google           No configurar login con Google
  --skip-blob             No crear Vercel Blob
  --skip-deploy           No desplegar al final
  --dry-run               Mostrar los comandos sin ejecutar nada
  --yes, -y               No pedir confirmaciones
  --help, -h              Mostrar esta ayuda

Variables para uso no interactivo:
  BOOTSTRAP_GOOGLE_CLIENT_ID, BOOTSTRAP_GOOGLE_CLIENT_SECRET
  BOOTSTRAP_NO_BROWSER=1  (no abrir el navegador)

Documentación: docs/bootstrap.md
`;

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface Context {
  opts: BootstrapOptions;
  slug: string;
  state: BootstrapState;
  run: Runner;
  prompt: Prompter;
  /** Current .env values (in-memory mirror so --dry-run works without writing). */
  env: Record<string, string>;
  /** Steps intentionally skipped via flags, for the final summary. */
  skipped: string[];
}

class StepFailure extends Error {
  constructor(
    readonly stepName: string,
    readonly reason: unknown
  ) {
    super(`Falló el paso "${stepName}"`);
  }
}

function saveState(ctx: Context): void {
  if (ctx.run.dryRun) return;
  writeFileSync(STATE_FILE, serializeState(ctx.state));
}

function complete(ctx: Context, id: StepId): void {
  ctx.state = markStepDone(ctx.state, id, new Date());
  saveState(ctx);
}

function loadState(): BootstrapState | undefined {
  if (!existsSync(STATE_FILE)) return undefined;
  const state = parseState(readFileSync(STATE_FILE, "utf-8"));
  if (!state) {
    throw new Error(
      ".bootstrap.json está corrupto o es de otra versión; borralo para empezar de nuevo"
    );
  }
  return state;
}

function readEnvFile(): Record<string, string> {
  return existsSync(ENV_FILE) ? parseEnv(readFileSync(ENV_FILE, "utf-8")) : {};
}

/** Merges provisioned values into .env (and the in-memory mirror). Logs keys only. */
function writeEnv(ctx: Context, values: Record<string, string>): void {
  Object.assign(ctx.env, values);
  const keys = Object.keys(values).join(", ");
  if (ctx.run.dryRun) {
    info(`[dry-run] escribiría en .env: ${keys}`);
    return;
  }
  const template = readFileSync(ENV_EXAMPLE, "utf-8");
  const existing = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf-8") : "";
  writeFileSync(ENV_FILE, mergeEnvFile(template, existing, values), { mode: 0o600 });
  success(`.env actualizado (${keys})`);
}

function skipNotice(label: string): void {
  success(`${label}: ya estaba hecho, lo salteo`);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Step 1: preflight
// ---------------------------------------------------------------------------

function preflight(ctx: Context): void {
  step("Verificando herramientas");
  if (ctx.run.dryRun) {
    info("[dry-run] se omiten las verificaciones de CLIs y logins");
    return;
  }

  const tools: ToolName[] = ["git", "gh", "neonctl", "vercel"];
  if (!ctx.opts.skipGoogle) tools.push("gcloud");

  const problems: string[] = [];
  for (const tool of tools) {
    const hint = toolHint(tool, process.platform);
    const version = ctx.run.run(tool, ["--version"], { allowFailure: true, quiet: true });
    if (version.missing || version.status !== 0) {
      problems.push(
        `${tool} no está instalado.\n      Instalar: ${hint.install}${hint.login ? `\n      Luego:    ${hint.login}` : ""}`
      );
      continue;
    }
    if (!isLoggedIn(ctx, tool)) {
      problems.push(`${tool} no tiene sesión iniciada.\n      Ejecutá: ${hint.login ?? ""}`);
      continue;
    }
    success(`${tool} listo`);
  }

  if (problems.length > 0) {
    console.log();
    problems.forEach((p) => error(p));
    throw new Error(
      "Faltan herramientas o logins (ver arriba). Instalalas y volvé a correr el comando."
    );
  }

  const top = ctx.run.run("git", ["rev-parse", "--show-toplevel"], {
    allowFailure: true,
    quiet: true,
  });
  const sameDir = (a: string, b: string) => {
    const norm = (p: string) => {
      const real = realpathSync(p);
      return process.platform === "win32" ? real.toLowerCase() : real;
    };
    return norm(a) === norm(b);
  };
  if (top.status !== 0 || !sameDir(top.stdout.trim(), ROOT_DIR)) {
    throw new Error(`Ejecutá el comando desde la raíz de un repo git (${ROOT_DIR})`);
  }
  if (!sameDir(process.cwd(), ROOT_DIR)) {
    throw new Error(`Ejecutá el comando desde la raíz del proyecto: cd ${ROOT_DIR}`);
  }
  success("Repositorio git detectado");
}

function isLoggedIn(ctx: Context, tool: ToolName): boolean {
  const probe = (cmd: string, args: string[]) =>
    ctx.run.run(cmd, args, { allowFailure: true, quiet: true });
  switch (tool) {
    case "git":
      return true;
    case "gh":
      return probe("gh", ["auth", "status"]).status === 0;
    case "neonctl":
      return probe("neonctl", ["me", "--output", "json"]).status === 0;
    case "vercel":
      return probe("vercel", ["whoami"]).status === 0;
    case "gcloud": {
      const res = probe("gcloud", [
        "auth",
        "list",
        "--filter=status:ACTIVE",
        "--format=value(account)",
      ]);
      return res.status === 0 && res.stdout.trim().length > 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Step 2: project identity
// ---------------------------------------------------------------------------

function stepIdentity(ctx: Context): void {
  step("Identidad del proyecto");
  const pkg = readFileSync(PACKAGE_JSON, "utf-8");
  const current = (parseJson(pkg) as { name?: unknown } | undefined)?.name;
  if (current === ctx.slug) {
    success(`package.json ya se llama "${ctx.slug}"`);
  } else if (ctx.run.dryRun) {
    info(`[dry-run] cambiaría name en package.json: "${String(current)}" -> "${ctx.slug}"`);
  } else {
    // Targeted replace keeps the file's formatting byte-for-byte otherwise.
    const updated = pkg.replace(/("name"\s*:\s*)"[^"]*"/, `$1${JSON.stringify(ctx.slug)}`);
    writeFileSync(PACKAGE_JSON, updated);
    success(`package.json -> name: "${ctx.slug}"`);
  }
  complete(ctx, "identity");
}

// ---------------------------------------------------------------------------
// Step 3: GitHub
// ---------------------------------------------------------------------------

function stepGitHub(ctx: Context): void {
  step("GitHub");
  if (isStepDone(ctx.state, "github") && ctx.state.github) {
    skipNotice(`Repo ${ctx.state.github.url}`);
    return;
  }
  const { run, slug } = ctx;

  let origin = run.run("git", ["remote", "get-url", "origin"], {
    allowFailure: true,
    dryRun: { status: 1 },
  });
  if (origin.status === 0 && isStarterKitRemote(origin.stdout)) {
    const upstream = run.run("git", ["remote", "get-url", "upstream"], {
      allowFailure: true,
      dryRun: { status: 1 },
    });
    if (upstream.status === 0) {
      run.run("git", ["remote", "remove", "origin"]);
    } else {
      run.run("git", ["remote", "rename", "origin", "upstream"]);
      success("Remote del starter kit renombrado a 'upstream'");
    }
    origin = { ...origin, status: 1 };
  }

  const dirty = run.output("git", ["status", "--porcelain"], {
    dryRun: { stdout: " M package.json" },
  });
  if (dirty) {
    run.run("git", ["add", "-A"]);
    run.run("git", ["commit", "-m", `chore: bootstrap ${slug}`]);
    success("Cambios commiteados");
  }

  let url: string;
  if (origin.status === 0) {
    // Already pointing at the app's own repo (e.g. a previous partial run).
    url = origin.stdout.trim().replace(/\.git$/, "");
    run.run("git", ["push", "-u", "origin", "HEAD"], { streamStderr: true });
  } else {
    const owner = run.output("gh", ["api", "user", "--jq", ".login"], {
      dryRun: { stdout: "<usuario-github>" },
    });
    const existing = run.run(
      "gh",
      ["repo", "view", `${owner}/${slug}`, "--json", "url", "--jq", ".url"],
      {
        allowFailure: true,
        dryRun: { status: 1 },
      }
    );
    if (existing.status === 0 && existing.stdout.trim()) {
      url = existing.stdout.trim();
      warn(`El repo ${url} ya existe; lo reutilizo`);
      run.run("git", ["remote", "add", "origin", `${url}.git`]);
      run.run("git", ["push", "-u", "origin", "HEAD"], { streamStderr: true });
    } else {
      run.run(
        "gh",
        [
          "repo",
          "create",
          slug,
          `--${ctx.opts.visibility}`,
          "--source",
          ".",
          "--remote",
          "origin",
          "--push",
        ],
        { streamStderr: true }
      );
      url = `https://github.com/${owner}/${slug}`;
    }
  }

  ctx.state.github = { url };
  success(`Repo listo: ${url}`);
  complete(ctx, "github");
}

// ---------------------------------------------------------------------------
// Step 4: Neon
// ---------------------------------------------------------------------------

function stepNeon(ctx: Context): void {
  step("Neon Postgres");
  const { run, slug, opts } = ctx;
  const orgArgs = opts.neonOrgId ? ["--org-id", opts.neonOrgId] : [];

  let projectId = ctx.state.neon?.projectId;
  if (!projectId) {
    const list = run.output("neonctl", ["projects", "list", "--output", "json", ...orgArgs], {
      dryRun: { stdout: "[]" },
    });
    projectId = findNeonProjectIdByName(parseJson(list), slug);
    if (projectId) {
      warn(`Ya existe un proyecto Neon "${slug}" (${projectId}); lo reutilizo`);
    } else {
      // The JSON output includes credentials: it is parsed, never printed.
      const created = run.output(
        "neonctl",
        [
          "projects",
          "create",
          "--name",
          slug,
          "--region-id",
          opts.region,
          "--output",
          "json",
          ...orgArgs,
        ],
        { dryRun: { stdout: '{"project":{"id":"<neon-project-id>"}}' } }
      );
      projectId = extractNeonProjectId(parseJson(created));
      if (!projectId) throw new Error("No pude leer el ID del proyecto en la respuesta de neonctl");
      success(`Proyecto Neon creado: ${projectId} (${opts.region})`);
    }
    ctx.state.neon = { projectId, region: opts.region };
    saveState(ctx);
  } else if (isStepDone(ctx.state, "neon")) {
    skipNotice(`Proyecto Neon ${projectId}`);
  }

  // The connection string is a secret: fetch it whenever .env lacks a Neon URL.
  if (!isProvisionedNeonUrl(ctx.env.POSTGRES_URL) || !isStepDone(ctx.state, "neon")) {
    const raw = run.output(
      "neonctl",
      ["connection-string", "--project-id", projectId, "--pooled", "--ssl", "require"],
      {
        dryRun: {
          stdout: "postgresql://user:pass@ep-dry-run-pooler.neon.tech/neondb?sslmode=require",
        },
      }
    );
    writeEnv(ctx, { POSTGRES_URL: ensureSslModeRequire(raw) });
  }
  complete(ctx, "neon");
}

// ---------------------------------------------------------------------------
// Step 5: Vercel project
// ---------------------------------------------------------------------------

async function stepVercel(ctx: Context): Promise<void> {
  step("Vercel");
  if (isStepDone(ctx.state, "vercel") && ctx.state.vercel) {
    skipNotice(`Proyecto Vercel ${ctx.state.vercel.projectName}`);
    return;
  }
  const { run, slug } = ctx;

  const inspect = run.run("vercel", ["project", "inspect", slug, "--format", "json"], {
    allowFailure: true,
    dryRun: { status: 1 },
  });
  if (inspect.status !== 0) {
    run.run("vercel", ["project", "add", slug]);
    success(`Proyecto Vercel "${slug}" creado`);
  } else {
    warn(`El proyecto Vercel "${slug}" ya existe; lo reutilizo`);
  }
  run.run("vercel", ["link", "--yes", "--project", slug]);

  const githubUrl = ctx.state.github?.url;
  if (githubUrl) {
    const connect = run.run("vercel", ["git", "connect", `${githubUrl}.git`, "--yes"], {
      allowFailure: true,
    });
    if (connect.status === 0) success("Repo de GitHub conectado a Vercel");
    else
      warn(
        "No pude conectar el repo (quizás ya estaba conectado). Revisalo en Vercel > Settings > Git."
      );
  }

  // Re-inspect a freshly created project: its assigned domain may differ from
  // <slug>.vercel.app when that name is taken by someone else.
  const details =
    inspect.status === 0
      ? inspect
      : run.run("vercel", ["project", "inspect", slug, "--format", "json"], { allowFailure: true });
  let prodUrl =
    ctx.opts.prodUrl ??
    extractVercelProductionUrl(parseJson(details.stdout), slug) ??
    defaultVercelUrl(slug);
  if (!ctx.opts.yes && !ctx.run.dryRun) {
    const answer = await ctx.prompt.ask(`URL de producción [${prodUrl}]:`);
    if (answer) prodUrl = normalizeOrigin(answer);
  }
  ctx.state.vercel = { projectName: slug, prodUrl };
  success(`URL de producción: ${prodUrl}`);
  complete(ctx, "vercel");
}

function prodUrlOf(ctx: Context): string {
  return ctx.state.vercel?.prodUrl ?? ctx.opts.prodUrl ?? defaultVercelUrl(ctx.slug);
}

// ---------------------------------------------------------------------------
// Step 6: Vercel Blob
// ---------------------------------------------------------------------------

function stepBlob(ctx: Context): void {
  step("Vercel Blob");
  if (ctx.opts.skipBlob) {
    ctx.skipped.push("Vercel Blob (--skip-blob)");
    info("Salteado por --skip-blob");
    return;
  }
  const { run } = ctx;
  const storeName = ctx.state.blob?.storeName ?? blobStoreName(ctx.slug);

  if (isStepDone(ctx.state, "blob") && ctx.env.BLOB_READ_WRITE_TOKEN) {
    skipNotice(`Blob store ${storeName}`);
    return;
  }

  if (!ctx.state.blob) {
    const stores = run.run("vercel", ["blob", "list-stores", "--all", "--json"], {
      allowFailure: true,
      dryRun: { stdout: "[]" },
    });
    if (findBlobStore(parseJson(stores.stdout), storeName)) {
      warn(
        `El Blob store "${storeName}" ya existe; lo reutilizo (verificá que esté conectado al proyecto)`
      );
    } else {
      // --yes connects the store to every environment of the linked project,
      // which makes Vercel add BLOB_READ_WRITE_TOKEN to the project env.
      run.run("vercel", [
        "blob",
        "create-store",
        storeName,
        "--access",
        "public",
        "--region",
        vercelRegionForNeonRegion(ctx.state.neon?.region ?? ctx.opts.region),
        "--yes",
      ]);
      success(`Blob store "${storeName}" creado y conectado`);
    }
    ctx.state.blob = { storeName };
    saveState(ctx);
  }

  // Pull into a private temp dir, read the token, delete immediately.
  const dir = ctx.run.dryRun ? "<tmp>" : mkdtempSync(join(tmpdir(), "bootstrap-"));
  const file = join(dir, "vercel.env");
  try {
    run.run("vercel", ["env", "pull", file, "--environment", "development", "--yes"]);
    const pulled = ctx.run.dryRun
      ? { BLOB_READ_WRITE_TOKEN: "<token>" }
      : parseEnv(readFileSync(file, "utf-8"));
    const token = pulled.BLOB_READ_WRITE_TOKEN;
    if (!token || token === VERCEL_SENSITIVE_PLACEHOLDER) {
      throw new Error(
        "Vercel no devolvió BLOB_READ_WRITE_TOKEN. Conectá el store al proyecto en Vercel > Storage y volvé a correr."
      );
    }
    writeEnv(ctx, { BLOB_READ_WRITE_TOKEN: token });
  } finally {
    if (!ctx.run.dryRun) rmSync(dir, { recursive: true, force: true });
  }
  complete(ctx, "blob");
}

// ---------------------------------------------------------------------------
// Step 7: Google OAuth
// ---------------------------------------------------------------------------

function openInBrowser(ctx: Context, url: string): void {
  if (ctx.run.dryRun || process.env.BOOTSTRAP_NO_BROWSER === "1" || !isSafeUrlToOpen(url)) {
    info(`Abrí: ${url}`);
    return;
  }
  const { command, args } = openUrlCommand(process.platform, url);
  const res = ctx.run.run(command, args, { allowFailure: true, quiet: true });
  if (res.status !== 0) info(`No pude abrir el navegador. Abrí manualmente: ${url}`);
  else info(`Abriendo ${url}`);
}

async function stepGoogle(ctx: Context): Promise<void> {
  step("Login con Google");
  if (ctx.opts.skipGoogle) {
    ctx.skipped.push("Login con Google (--skip-google)");
    info("Salteado por --skip-google");
    return;
  }
  if (isStepDone(ctx.state, "google") && ctx.env.GOOGLE_CLIENT_ID && ctx.env.GOOGLE_CLIENT_SECRET) {
    skipNotice(`Google OAuth (proyecto ${ctx.state.google?.projectId ?? "?"})`);
    return;
  }
  const { run } = ctx;

  const knownId = ctx.state.google?.projectId ?? ctx.opts.googleProjectId;
  const exists =
    knownId !== undefined &&
    run.run("gcloud", ["projects", "describe", knownId, "--format=value(projectId)"], {
      allowFailure: true,
      dryRun: { status: 1 },
    }).status === 0;
  const projectId = knownId ?? generateGcpProjectId(ctx.slug, randomInt);

  if (!exists) {
    const displayName = ctx.slug.slice(0, 30).padEnd(4, "-");
    run.run("gcloud", ["projects", "create", projectId, `--name=${displayName}`], {
      streamStderr: true,
    });
    success(`Proyecto de Google Cloud creado: ${projectId}`);
  } else {
    success(`Uso el proyecto de Google Cloud ${projectId}`);
  }
  ctx.state.google = { projectId };
  saveState(ctx);

  const oauth = buildGoogleOAuthConfig(prodUrlOf(ctx));
  const urls = googleConsoleUrls(projectId);

  console.log();
  log("Google no permite crear el cliente OAuth por API: son 2 pasos manuales.", "yellow");
  log("\n1) Pantalla de consentimiento (Branding)", "bright");
  info("App name: el nombre de tu app · User support email: tu email");
  info("Audience: External · Contact email: tu email · Aceptá y creá");
  openInBrowser(ctx, urls.branding);
  if (!ctx.opts.yes)
    await ctx.prompt.ask("Presioná Enter cuando termines la pantalla de consentimiento...");

  log("\n2) Crear cliente OAuth", "bright");
  info("Application type: Web application");
  info("Authorized JavaScript origins:");
  oauth.javascriptOrigins.forEach((o) => log(`     ${o}`));
  info("Authorized redirect URIs:");
  oauth.redirectUris.forEach((u) => log(`     ${u}`));
  openInBrowser(ctx, urls.createClient);
  console.log();

  const dryRunValue = (label: string) => (ctx.run.dryRun ? `<${label}>` : undefined);
  const clientId =
    process.env.BOOTSTRAP_GOOGLE_CLIENT_ID?.trim() ||
    dryRunValue("google-client-id") ||
    (await ctx.prompt.ask("Client ID:"));
  const clientSecret =
    process.env.BOOTSTRAP_GOOGLE_CLIENT_SECRET?.trim() ||
    dryRunValue("google-client-secret") ||
    (await ctx.prompt.ask("Client Secret (no se muestra):", { mask: true }));
  if (!clientId || !clientSecret) throw new Error("Client ID y Client Secret son obligatorios");
  if (!ctx.run.dryRun && !clientId.endsWith(".apps.googleusercontent.com")) {
    warn("El Client ID no termina en .apps.googleusercontent.com; revisá que sea el correcto");
  }

  writeEnv(ctx, { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret });
  complete(ctx, "google");
}

// ---------------------------------------------------------------------------
// Step 8: local secrets / .env
// ---------------------------------------------------------------------------

function stepEnv(ctx: Context): void {
  step("Secretos y .env local");
  const current = ctx.env.BETTER_AUTH_SECRET;
  const reuse = current && current !== LEAKED_KIT_SECRET && current.length >= 32;
  const secret = reuse ? current : randomBytes(BETTER_AUTH_SECRET_BYTES).toString("base64");
  info(reuse ? "BETTER_AUTH_SECRET existente reutilizado" : "BETTER_AUTH_SECRET generado");
  writeEnv(ctx, { BETTER_AUTH_SECRET: secret, NEXT_PUBLIC_APP_URL: LOCAL_APP_URL });
  complete(ctx, "env");
}

// ---------------------------------------------------------------------------
// Step 9: Vercel env vars
// ---------------------------------------------------------------------------

function stepVercelEnv(ctx: Context): void {
  step("Variables de entorno en Vercel");
  if (isStepDone(ctx.state, "vercel-env")) {
    skipNotice("Variables de Vercel");
    return;
  }
  const plan = buildVercelEnvPlan(ctx.env, prodUrlOf(ctx));
  for (const entry of plan) {
    // Value goes through stdin so it never appears in argv / process lists.
    // --force overwrites an existing value so re-runs update it.
    ctx.run.run("vercel", ["env", "add", entry.name, entry.target, "--force", "--yes"], {
      input: entry.value,
      quiet: true,
    });
    if (!ctx.run.dryRun) info(`${entry.name} -> ${entry.target}`);
  }
  success(`${plan.length} variables cargadas en Vercel`);
  complete(ctx, "vercel-env");
}

// ---------------------------------------------------------------------------
// Step 10: migrations
// ---------------------------------------------------------------------------

function stepMigrate(ctx: Context): void {
  step("Migraciones de base de datos");
  if (isStepDone(ctx.state, "migrate")) {
    skipNotice("Migraciones");
    return;
  }
  const url = ctx.env.POSTGRES_URL;
  if (!url) throw new Error("POSTGRES_URL no está en .env");
  // Passed explicitly: drizzle-kit does not load .env by itself on every setup.
  ctx.run.run("pnpm", ["db:migrate"], {
    env: { POSTGRES_URL: url },
    streamStdout: true,
    streamStderr: true,
  });
  success("Migraciones aplicadas en Neon");
  complete(ctx, "migrate");
}

// ---------------------------------------------------------------------------
// Step 11: deploy
// ---------------------------------------------------------------------------

function stepDeploy(ctx: Context): string | undefined {
  step("Deploy a producción");
  if (ctx.opts.skipDeploy) {
    ctx.skipped.push("Deploy (--skip-deploy): corré `vercel deploy --prod` o hacé git push");
    info("Salteado por --skip-deploy");
    return undefined;
  }
  if (isStepDone(ctx.state, "deploy")) {
    skipNotice("Deploy inicial");
    return undefined;
  }
  // stdout is the deployment URL; progress goes to stderr.
  const url = ctx.run.output("vercel", ["deploy", "--prod", "--yes"], {
    streamStderr: true,
    dryRun: { stdout: "https://<deployment>.vercel.app" },
  });
  success(`Deploy listo: ${url.split(/\s+/).pop() ?? url}`);
  complete(ctx, "deploy");
  return url;
}

// ---------------------------------------------------------------------------
// Step 12: summary
// ---------------------------------------------------------------------------

function printSummary(ctx: Context): void {
  header("Resumen");
  const rows: Array<[string, string]> = [
    ["GitHub", ctx.state.github?.url ?? "-"],
    ["Neon", ctx.state.neon ? `${ctx.state.neon.projectId} (${ctx.state.neon.region})` : "-"],
    ["Vercel", ctx.state.vercel?.prodUrl ?? "-"],
    ["Blob", ctx.state.blob?.storeName ?? "-"],
    ["Google Cloud", ctx.state.google?.projectId ?? "-"],
  ];
  const width = Math.max(...rows.map(([k]) => k.length));
  rows.forEach(([k, v]) => log(`  ${k.padEnd(width)}  ${v}`));

  console.log();
  log("Pendiente (manual):", "bright");
  const todo = [
    "OPENROUTER_API_KEY (chat IA): agregala a .env y a Vercel (`vercel env add OPENROUTER_API_KEY production`)",
    "POLAR_* (pagos), si los usás",
    ...ctx.skipped,
  ];
  if (ctx.state.google) {
    todo.push(
      "Google: la app queda en modo 'Testing'; publicala en Google Cloud > Audience cuando quieras abrirla a todos"
    );
  }
  todo.forEach((t, i) => log(`  ${i + 1}. ${t}`));
  console.log();
  info("Desarrollo local: pnpm dev  ->  http://localhost:3000");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function resolveSlug(
  opts: BootstrapOptions,
  existing: BootstrapState | undefined,
  prompter: Prompter
) {
  let name = opts.appName;
  if (!name && existing) name = existing.slug;
  if (!name) {
    if (opts.yes && !process.stdin.isTTY)
      throw new Error("Falta el nombre de la app: pnpm bootstrap <nombre>");
    name = await prompter.ask("Nombre de la app:");
  }
  const slug = slugify(name);
  if (existing && existing.slug !== slug) {
    throw new Error(
      `.bootstrap.json pertenece a "${existing.slug}", no a "${slug}". Usá el mismo nombre o borrá .bootstrap.json.`
    );
  }
  return slug;
}

async function runStep(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    throw new StepFailure(name, err);
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return;
  }

  const prompt = new Prompter();
  try {
    header(`Bootstrap de nueva app${opts.dryRun ? " (dry-run: no se ejecuta nada)" : ""}`);
    const existing = loadState();
    const slug = await resolveSlug(opts, existing, prompt);
    const ctx: Context = {
      opts,
      slug,
      state: existing ?? createState(slug),
      run: new Runner(ROOT_DIR, opts.dryRun),
      prompt,
      env: readEnvFile(),
      skipped: [],
    };

    info(`App: ${slug} · repo ${opts.visibility} · Neon ${opts.region}`);
    if (existing)
      info(
        `Retomando desde .bootstrap.json (${Object.keys(existing.completed).length} pasos hechos)`
      );

    await runStep("preflight", () => preflight(ctx));

    if (!opts.yes && !opts.dryRun) {
      const ok = await prompt.confirm(
        "Esto crea recursos en GitHub, Neon, Vercel y Google Cloud. ¿Continuar?"
      );
      if (!ok) {
        warn("Cancelado");
        return;
      }
    }

    await runStep("identidad", () => stepIdentity(ctx));
    await runStep("github", () => stepGitHub(ctx));
    await runStep("neon", () => stepNeon(ctx));
    await runStep("vercel", () => stepVercel(ctx));
    await runStep("blob", () => stepBlob(ctx));
    await runStep("google", () => stepGoogle(ctx));
    await runStep("env", () => stepEnv(ctx));
    await runStep("vercel-env", () => stepVercelEnv(ctx));
    await runStep("migraciones", () => stepMigrate(ctx));
    await runStep("deploy", () => {
      stepDeploy(ctx);
    });

    printSummary(ctx);
    success(opts.dryRun ? "Dry-run terminado (no se ejecutó nada)" : "¡Listo!");
  } finally {
    prompt.close();
  }
}

main().catch((err: unknown) => {
  console.log();
  if (err instanceof StepFailure) {
    error(`${err.message}`);
    const cause = err.reason;
    if (cause instanceof CommandError) {
      error(cause.message);
      info(`Comando: ${cause.command}`);
      if (cause.stderr) info(cause.stderr.split("\n").slice(-15).join("\n  "));
    } else {
      error(cause instanceof Error ? cause.message : String(cause));
    }
    log(`\n${RESUME_HINT}`, "yellow");
  } else {
    error(err instanceof Error ? err.message : String(err));
    info("Ayuda: pnpm bootstrap --help");
  }
  process.exit(1);
});
