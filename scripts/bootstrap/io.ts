/**
 * Terminal I/O for `scripts/bootstrap.ts`: colored logging, prompts (with a
 * masked mode for secrets) and a command runner with dry-run support.
 */

import { createInterface, type Interface } from "readline";
import spawn from "cross-spawn";

// ---------------------------------------------------------------------------
// Logging (same palette and symbols as scripts/setup.ts)
// ---------------------------------------------------------------------------

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};

export function log(message: string, color?: keyof typeof colors) {
  const colorCode = color ? colors[color] : "";
  console.log(`${colorCode}${message}${colors.reset}`);
}

export function header(message: string) {
  console.log();
  log(`${"=".repeat(60)}`, "cyan");
  log(`  ${message}`, "bright");
  log(`${"=".repeat(60)}`, "cyan");
  console.log();
}

export function step(message: string) {
  console.log();
  log(`▶ ${message}`, "cyan");
}

export function success(message: string) {
  log(`✓ ${message}`, "green");
}

export function warn(message: string) {
  log(`⚠ ${message}`, "yellow");
}

export function error(message: string) {
  log(`✗ ${message}`, "red");
}

export function info(message: string) {
  log(`  ${message}`, "dim");
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

/**
 * Line-based prompter backed by ONE readline interface for the whole run.
 *
 * Creating a new interface per question (as setup.ts does) loses buffered
 * input when stdin is a pipe, which breaks non-interactive use such as
 * `printf 'id\nsecret\n' | pnpm bootstrap ...`. A single interface with a
 * queue handles both TTYs and pipes.
 */
export class Prompter {
  private rl: Interface | undefined;
  private readonly buffered: string[] = [];
  private readonly waiting: Array<(line: string | undefined) => void> = [];
  private closed = false;
  private muted = false;

  private ensureInterface(): void {
    if (this.rl || this.closed) return;
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: Boolean(process.stdin.isTTY),
    });

    // readline echoes keystrokes through this private hook; swallow them while
    // reading a secret so it never appears on screen or in terminal scrollback.
    const hooked = rl as unknown as { _writeToOutput: (text: string) => void };
    const originalWrite = hooked._writeToOutput.bind(rl);
    hooked._writeToOutput = (text: string) => {
      if (!this.muted) originalWrite(text);
      else if (text.includes("\n")) process.stdout.write("\n");
    };

    rl.on("line", (line) => {
      const resolve = this.waiting.shift();
      if (resolve) resolve(line);
      else this.buffered.push(line);
    });
    rl.on("close", () => {
      this.closed = true;
      this.rl = undefined;
      while (this.waiting.length > 0) this.waiting.shift()?.(undefined);
    });
    this.rl = rl;
  }

  /** Asks a question; rejects if stdin is closed before an answer arrives. */
  async ask(question: string, options: { mask?: boolean } = {}): Promise<string> {
    this.ensureInterface();
    process.stdout.write(`${colors.cyan}? ${colors.reset}${question} `);
    this.muted = options.mask === true && Boolean(process.stdin.isTTY);

    const line = this.buffered.shift() ?? (await this.nextLine());
    this.muted = false;
    if (!process.stdin.isTTY) process.stdout.write(options.mask ? "********\n" : `${line ?? ""}\n`);
    if (line === undefined) {
      throw new Error("No hay más entrada disponible (stdin cerrado) para responder la pregunta");
    }
    return line.trim();
  }

  async confirm(question: string): Promise<boolean> {
    const answer = (await this.ask(`${question} (s/n)`)).toLowerCase();
    return ["s", "si", "sí", "y", "yes"].includes(answer);
  }

  private nextLine(): Promise<string | undefined> {
    if (this.closed) return Promise.resolve(undefined);
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  close(): void {
    this.rl?.close();
  }
}

// ---------------------------------------------------------------------------
// Command runner
// ---------------------------------------------------------------------------

export interface RunOptions {
  /** Written to the child's stdin (used to pass secrets without exposing them in argv). */
  input?: string;
  /** Stream the child's stdout to the terminal instead of capturing it. */
  streamStdout?: boolean;
  /** Stream the child's stderr to the terminal (default: captured). */
  streamStderr?: boolean;
  /** Don't throw on non-zero exit; the caller inspects `status`. */
  allowFailure?: boolean;
  /** Extra environment variables for the child. */
  env?: Record<string, string>;
  /** Don't echo the command (for noisy probes). */
  quiet?: boolean;
  /** What to pretend the command returned in --dry-run mode. */
  dryRun?: { status?: number; stdout?: string };
}

export interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
  /** The executable was not found on PATH. */
  missing: boolean;
}

export class CommandError extends Error {
  constructor(
    message: string,
    readonly command: string,
    readonly stderr: string
  ) {
    super(message);
    this.name = "CommandError";
  }
}

/** Human-readable rendering of a command for logs. Never pass secrets as args. */
export function formatCommand(command: string, args: readonly string[]): string {
  const quote = (a: string) =>
    a === "" ? '""' : /[\s"'$`\\&|;<>()*?]/.test(a) ? JSON.stringify(a) : a;
  return [command, ...args].map(quote).join(" ");
}

export class Runner {
  /** Every command requested, in order (used by the dry-run output and tests). */
  readonly history: string[] = [];

  constructor(
    private readonly cwd: string,
    readonly dryRun: boolean
  ) {}

  run(command: string, args: readonly string[], options: RunOptions = {}): RunResult {
    const printable = formatCommand(command, args);
    this.history.push(printable);

    if (this.dryRun) {
      log(
        `  [dry-run] $ ${printable}${options.input !== undefined ? "   (valor por stdin)" : ""}`,
        "dim"
      );
      return {
        status: options.dryRun?.status ?? 0,
        stdout: options.dryRun?.stdout ?? "",
        stderr: "",
        missing: false,
      };
    }

    if (!options.quiet) info(`$ ${printable}`);

    // cross-spawn resolves Windows `.cmd` shims (vercel.cmd, neonctl.cmd,
    // pnpm.cmd) and escapes arguments correctly, without routing user input
    // through a shell string.
    const result = spawn.sync(command, [...args], {
      cwd: this.cwd,
      encoding: "utf8",
      input: options.input,
      stdio: [
        options.input !== undefined ? "pipe" : "ignore",
        options.streamStdout ? "inherit" : "pipe",
        options.streamStderr ? "inherit" : "pipe",
      ],
      env: { ...process.env, ...options.env },
      maxBuffer: 64 * 1024 * 1024,
    });

    const missing = (result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
    const runResult: RunResult = {
      status: result.status ?? (missing ? 127 : 1),
      stdout: typeof result.stdout === "string" ? result.stdout : "",
      stderr: typeof result.stderr === "string" ? result.stderr : "",
      missing,
    };

    if (runResult.status !== 0 && !options.allowFailure) {
      const reason = missing
        ? `No se encontró el comando "${command}"`
        : `El comando terminó con código ${runResult.status}`;
      throw new CommandError(reason, printable, runResult.stderr.trim());
    }
    return runResult;
  }

  /** Like `run`, returning trimmed stdout. */
  output(command: string, args: readonly string[], options: RunOptions = {}): string {
    return this.run(command, args, options).stdout.trim();
  }
}
