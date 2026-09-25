/**
 * Unit tests for the pure bootstrap helpers.
 * Run with: pnpm test:bootstrap
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_NEON_REGION,
  blobStoreName,
  buildGoogleOAuthConfig,
  buildVercelEnvPlan,
  createState,
  ensureSslModeRequire,
  extractNeonProjectId,
  extractVercelProductionUrl,
  findBlobStore,
  findNeonProjectIdByName,
  formatEnvValue,
  generateGcpProjectId,
  googleConsoleUrls,
  isProvisionedNeonUrl,
  isSafeUrlToOpen,
  isStarterKitRemote,
  isStepDone,
  isValidGcpProjectId,
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
  type BootstrapState,
} from "./lib";

/** Deterministic "random": always picks index 0 ("a"). */
const zero = () => 0;

describe("slugify", () => {
  it("lowercases, strips accents and collapses separators", () => {
    assert.equal(slugify("Mi App Ñandú"), "mi-app-nandu");
    assert.equal(slugify("  --Hello__World!!  "), "hello-world");
    assert.equal(slugify("mi-app"), "mi-app");
  });
  it("caps at 100 chars without a trailing hyphen", () => {
    const slug = slugify(`${"a".repeat(99)} b`);
    assert.ok(slug.length <= 100);
    assert.ok(!slug.endsWith("-"));
  });
  it("throws when nothing usable remains", () => {
    assert.throws(() => slugify("¡¡!!"));
  });
});

describe("Google Cloud project IDs", () => {
  it("generates <slug>-<6 chars> within 30 chars", () => {
    assert.equal(generateGcpProjectId("mi-app", zero), "mi-app-aaaaaa");
    const long = generateGcpProjectId("a-really-long-application-name-here", zero);
    assert.ok(long.length <= 30, long);
    assert.ok(isValidGcpProjectId(long), long);
  });
  it("prefixes slugs that don't start with a letter", () => {
    assert.equal(generateGcpProjectId("123app", zero), "app-123app-aaaaaa");
  });
  it("pads very short slugs to the 6-char minimum", () => {
    const id = generateGcpProjectId("a", zero);
    assert.ok(isValidGcpProjectId(id), id);
  });
  it("uses the injected randomness", () => {
    let i = 0;
    const seq = () => i++ % 36;
    assert.equal(generateGcpProjectId("app", seq), "app-abcdef");
  });
  it("validates the Google rules", () => {
    assert.ok(isValidGcpProjectId("my-app-123"));
    assert.ok(!isValidGcpProjectId("short"));
    assert.ok(!isValidGcpProjectId("1starts-with-digit"));
    assert.ok(!isValidGcpProjectId("ends-with-hyphen-"));
    assert.ok(!isValidGcpProjectId("Upper-case-id"));
    assert.ok(!isValidGcpProjectId("a".repeat(31)));
  });
});

describe("URLs", () => {
  it("builds the OAuth origins and redirect URIs", () => {
    assert.deepEqual(buildGoogleOAuthConfig("https://mi-app.vercel.app/"), {
      javascriptOrigins: ["http://localhost:3000", "https://mi-app.vercel.app"],
      redirectUris: [
        "http://localhost:3000/api/auth/callback/google",
        "https://mi-app.vercel.app/api/auth/callback/google",
      ],
    });
  });
  it("normalizes origins and rejects non-http URLs", () => {
    assert.equal(normalizeOrigin("https://x.dev/path?q=1"), "https://x.dev");
    assert.throws(() => normalizeOrigin("ftp://x.dev"));
    assert.throws(() => normalizeOrigin("not a url"));
  });
  it("builds console URLs", () => {
    const urls = googleConsoleUrls("mi-app-abc123");
    assert.equal(
      urls.branding,
      "https://console.cloud.google.com/auth/branding?project=mi-app-abc123"
    );
    assert.equal(
      urls.createClient,
      "https://console.cloud.google.com/auth/clients/create?project=mi-app-abc123"
    );
    assert.ok(isSafeUrlToOpen(urls.branding));
  });
  it("refuses to open URLs with shell metacharacters", () => {
    assert.ok(!isSafeUrlToOpen("https://x.dev/?a=1&calc.exe"));
    assert.ok(!isSafeUrlToOpen("http://x.dev"));
  });
  it("picks the OS opener", () => {
    assert.deepEqual(openUrlCommand("win32", "https://x.dev"), {
      command: "cmd",
      args: ["/c", "start", "", "https://x.dev"],
    });
    assert.equal(openUrlCommand("darwin", "https://x.dev").command, "open");
    assert.equal(openUrlCommand("linux", "https://x.dev").command, "xdg-open");
  });
  it("forces sslmode=require and keeps other params", () => {
    assert.equal(
      ensureSslModeRequire("postgresql://u:p@ep-1-pooler.neon.tech/db"),
      "postgresql://u:p@ep-1-pooler.neon.tech/db?sslmode=require"
    );
    assert.equal(
      ensureSslModeRequire(
        "postgresql://u:p@h.neon.tech/db?sslmode=disable&channel_binding=require\n"
      ),
      "postgresql://u:p@h.neon.tech/db?sslmode=require&channel_binding=require"
    );
    assert.throws(() => ensureSslModeRequire("mysql://x"));
  });
  it("detects real Neon URLs vs placeholders", () => {
    assert.ok(isProvisionedNeonUrl("postgresql://u:p@ep-cool-1-pooler.sa-east-1.aws.neon.tech/db"));
    assert.ok(
      !isProvisionedNeonUrl("postgresql://USER:PASSWORD@ep-xxxx-pooler.REGION.aws.neon.tech/db")
    );
    assert.ok(!isProvisionedNeonUrl("postgresql://dev:dev@localhost:5432/db"));
    assert.ok(!isProvisionedNeonUrl(undefined));
  });
  it("recognizes the starter kit remote in https and ssh form", () => {
    assert.ok(isStarterKitRemote("https://github.com/Julianchoo/agentic-coding-starter-kit"));
    assert.ok(isStarterKitRemote("git@github.com:leonvanzyl/agentic-coding-starter-kit.git\n"));
    assert.ok(!isStarterKitRemote("https://github.com/Julianchoo/mi-app.git"));
  });
});

describe("parseArgs", () => {
  it("has sane defaults", () => {
    const o = parseArgs(["mi-app"]);
    assert.equal(o.appName, "mi-app");
    assert.equal(o.visibility, "private");
    assert.equal(o.region, DEFAULT_NEON_REGION);
    assert.equal(o.dryRun, false);
    assert.equal(o.yes, false);
  });
  it("parses every flag, in both --flag value and --flag=value forms", () => {
    const o = parseArgs([
      "--public",
      "mi-app",
      "--region",
      "aws-us-east-1",
      "--skip-google",
      "--skip-blob",
      "--skip-deploy",
      "--dry-run",
      "-y",
      "--prod-url=https://app.example.com/",
      "--google-project",
      "mi-proyecto-1",
      "--neon-org=org-123",
    ]);
    assert.equal(o.visibility, "public");
    assert.equal(o.region, "aws-us-east-1");
    assert.ok(o.skipGoogle && o.skipBlob && o.skipDeploy && o.dryRun && o.yes);
    assert.equal(o.prodUrl, "https://app.example.com");
    assert.equal(o.googleProjectId, "mi-proyecto-1");
    assert.equal(o.neonOrgId, "org-123");
  });
  it("allows a missing app name (prompted later)", () => {
    assert.equal(parseArgs([]).appName, undefined);
  });
  it("rejects unknown flags, missing values and extra positionals", () => {
    assert.throws(() => parseArgs(["--nope"]), /desconocida/);
    assert.throws(() => parseArgs(["--region"]), /Falta el valor/);
    assert.throws(() => parseArgs(["--region", "--yes"]), /Falta el valor/);
    assert.throws(() => parseArgs(["a", "b"]), /un solo nombre/);
    assert.throws(() => parseArgs(["--yes=1"]), /no acepta valor/);
    assert.throws(() => parseArgs(["--region", "bad region"]), /Región/);
    assert.throws(() => parseArgs(["--google-project", "X"]), /inválido/);
  });
});

describe(".env parsing and merging", () => {
  const template = [
    "# Database",
    "POSTGRES_URL=postgresql://placeholder",
    "",
    "BETTER_AUTH_SECRET=",
    'OPENROUTER_MODEL="openai/gpt-5-mini"',
    "GOOGLE_CLIENT_ID=",
    "",
  ].join("\n");

  it("parses quotes, comments and export prefixes", () => {
    assert.deepEqual(parseEnv("A=1\n# c\nexport B=\"two words\"\nC='x'\nD=val # comment\nE=\r\n"), {
      A: "1",
      B: "two words",
      C: "x",
      D: "val",
      E: "",
    });
  });

  it("fills a fresh .env from the template with provisioned values", () => {
    const out = mergeEnvFile(template, "", {
      POSTGRES_URL: "postgresql://u:p@h.neon.tech/db?sslmode=require",
      BETTER_AUTH_SECRET: "abc+/=",
    });
    assert.equal(
      out,
      [
        "# Database",
        "POSTGRES_URL=postgresql://u:p@h.neon.tech/db?sslmode=require",
        "",
        "BETTER_AUTH_SECRET=abc+/=",
        "OPENROUTER_MODEL=openai/gpt-5-mini",
        "GOOGLE_CLIENT_ID=",
        "",
      ].join("\n")
    );
  });

  it("keeps the user's non-empty values and extra keys", () => {
    const existing = "OPENROUTER_MODEL=my/model\nGOOGLE_CLIENT_ID=\nMY_KEY=keep me\n";
    const env = parseEnv(mergeEnvFile(template, existing, { GOOGLE_CLIENT_ID: "id.apps" }));
    assert.equal(env.OPENROUTER_MODEL, "my/model");
    assert.equal(env.GOOGLE_CLIENT_ID, "id.apps");
    assert.equal(env.MY_KEY, "keep me");
    assert.equal(env.POSTGRES_URL, "postgresql://placeholder");
  });

  it("provisioned values win over existing ones; empty provisioned values don't erase", () => {
    const existing = "POSTGRES_URL=postgresql://old\nBETTER_AUTH_SECRET=keep\n";
    const env = parseEnv(
      mergeEnvFile(template, existing, { POSTGRES_URL: "postgresql://new", BETTER_AUTH_SECRET: "" })
    );
    assert.equal(env.POSTGRES_URL, "postgresql://new");
    assert.equal(env.BETTER_AUTH_SECRET, "keep");
  });

  it("appends provisioned keys missing from the template", () => {
    const env = parseEnv(mergeEnvFile(template, "", { BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_x" }));
    assert.equal(env.BLOB_READ_WRITE_TOKEN, "vercel_blob_rw_x");
  });

  it("round-trips values that need quoting", () => {
    const values = [
      'a "quoted" # value',
      "it's",
      "with spaces",
      "back\\slash",
      "multi\nline",
      `'"x`,
    ];
    for (const value of values) {
      assert.equal(parseEnv(`K=${formatEnvValue(value)}`).K, value, value);
    }
    assert.throws(() => formatEnvValue(`'"\``));
  });

  it("is idempotent", () => {
    const once = mergeEnvFile(template, "", { POSTGRES_URL: "postgresql://x" });
    assert.equal(mergeEnvFile(template, once, {}), once);
  });
});

describe("Vercel env plan", () => {
  it("sends shared secrets to all targets and URLs to production only", () => {
    const plan = buildVercelEnvPlan(
      {
        POSTGRES_URL: "pg",
        BETTER_AUTH_SECRET: "s",
        GOOGLE_CLIENT_ID: "",
        OPENROUTER_API_KEY: "ignored",
      },
      "https://mi-app.vercel.app/"
    );
    const summary = plan.map((e) => `${e.name}@${e.target}`);
    assert.deepEqual(summary, [
      "POSTGRES_URL@production",
      "POSTGRES_URL@preview",
      "POSTGRES_URL@development",
      "BETTER_AUTH_SECRET@production",
      "BETTER_AUTH_SECRET@preview",
      "BETTER_AUTH_SECRET@development",
      "NEXT_PUBLIC_APP_URL@production",
      "BETTER_AUTH_URL@production",
    ]);
    assert.equal(plan.at(-1)?.value, "https://mi-app.vercel.app");
  });
});

describe("CLI output parsing", () => {
  it("reads the Neon project id from create output", () => {
    assert.equal(extractNeonProjectId({ project: { id: "p-1" }, connection_uris: [] }), "p-1");
    assert.equal(extractNeonProjectId({ id: "p-2" }), "p-2");
    assert.equal(extractNeonProjectId("nope"), undefined);
  });
  it("finds a Neon project by name in list output", () => {
    const list = [
      { id: "a", name: "other" },
      { id: "b", name: "mi-app" },
    ];
    assert.equal(findNeonProjectIdByName(list, "mi-app"), "b");
    assert.equal(findNeonProjectIdByName({ projects: list }, "mi-app"), "b");
    assert.equal(findNeonProjectIdByName(list, "missing"), undefined);
  });
  it("extracts the production URL from project JSON", () => {
    const json = {
      targets: {
        production: { alias: ["mi-app-abc123-team.vercel.app", "mi-app-team.vercel.app"] },
      },
    };
    assert.equal(extractVercelProductionUrl(json, "mi-app"), "https://mi-app-team.vercel.app");
    assert.equal(
      extractVercelProductionUrl({ link: "https://mi-app.vercel.app" }, "mi-app"),
      "https://mi-app.vercel.app"
    );
    assert.equal(extractVercelProductionUrl({}, "mi-app"), undefined);
  });
  it("finds blob stores", () => {
    assert.ok(findBlobStore([{ name: "mi-app-blob" }], "mi-app-blob"));
    assert.ok(findBlobStore({ stores: [{ name: "mi-app-blob" }] }, "mi-app-blob"));
    assert.ok(!findBlobStore([], "mi-app-blob"));
  });
});

describe("naming helpers", () => {
  it("derives a short blob store name", () => {
    assert.equal(blobStoreName("mi-app"), "mi-app-blob");
    assert.ok(blobStoreName("x".repeat(80)).length <= 32);
  });
  it("maps Neon regions to nearby Vercel regions", () => {
    assert.equal(vercelRegionForNeonRegion("aws-sa-east-1"), "gru1");
    assert.equal(vercelRegionForNeonRegion("unknown"), "iad1");
  });
  it("gives OS-specific install hints", () => {
    assert.match(toolHint("gh", "win32").install, /winget/);
    assert.match(toolHint("gh", "darwin").install, /brew/);
    assert.equal(toolHint("vercel", "linux").login, "vercel login");
    assert.equal(toolHint("git", "linux").login, undefined);
  });
});

describe("state", () => {
  const now = new Date("2026-01-02T03:04:05.000Z");

  it("marks steps done immutably", () => {
    const s0 = createState("mi-app");
    const s1 = markStepDone(s0, "neon", now);
    assert.ok(!isStepDone(s0, "neon"));
    assert.ok(isStepDone(s1, "neon"));
    assert.equal(s1.completed.neon, now.toISOString());
  });

  it("round-trips through JSON", () => {
    const state: BootstrapState = {
      ...markStepDone(createState("mi-app"), "github", now),
      github: { url: "https://github.com/u/mi-app" },
      neon: { projectId: "p-1", region: "aws-sa-east-1" },
      vercel: { projectName: "mi-app", prodUrl: "https://mi-app.vercel.app" },
      blob: { storeName: "mi-app-blob" },
      google: { projectId: "mi-app-abc123" },
    };
    assert.deepEqual(parseState(serializeState(state)), state);
  });

  it("drops unknown steps and rejects garbage", () => {
    const parsed = parseState(
      JSON.stringify({ version: 1, slug: "x", completed: { neon: "t", bogus: "t", github: 5 } })
    );
    assert.deepEqual(parsed?.completed, { neon: "t" });
    assert.equal(parseState("{not json"), undefined);
    assert.equal(parseState(JSON.stringify({ version: 99, slug: "x" })), undefined);
  });

  it("refuses to serialize secrets", () => {
    const bad = { ...createState("x"), POSTGRES_URL: "x" } as unknown as BootstrapState;
    assert.throws(() => serializeState(bad), /secret-like/);
    const leaky = {
      ...createState("x"),
      github: { url: "postgresql://u:pw@h/db" },
    } as BootstrapState;
    assert.throws(() => serializeState(leaky), /connection string/);
  });
});
