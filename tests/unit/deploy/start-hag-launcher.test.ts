/**
 * Production launcher hygiene — config and secret tracking.
 *
 * The deployment starts HAG through a *committed, secret-free* launcher
 * (`start_hag.sh`) that sources its credentials from deployment-local, 0600,
 * gitignored env files. Two properties matter for a production heating
 * controller and are pinned here:
 *
 *  - no credential lives in a tracked file: the launcher and the production
 *    YAML carry `${ENV_VAR}` placeholders only;
 *  - the launcher still starts exactly the command the deployment needs
 *    (bun at the documented absolute path, `src/main.ts`, the production
 *    config, from the application directory, with the log kept by `tee`), and
 *    it refuses to start with a clear message when a required variable is
 *    missing — without ever printing a value.
 *
 * Fully offline: every runtime test uses a temporary sandbox with a fake `bun`,
 * fake env files and fake tokens. No network, no Home Assistant, no device
 * command, and the real production paths are never read or written.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const LAUNCHER = join(REPO_ROOT, "start_hag.sh");

/** Token-shaped literals: exactly what must never appear in a tracked file. */
const SECRET_PATTERNS = [
  /eyJ[A-Za-z0-9_.-]{10,}/,
  /[0-9]{8,10}:[A-Za-z0-9_-]{30,}/,
];

// Fixtures are assembled at runtime so this file itself stays free of
// token-shaped literals (the tracked-tree scan below is strict on purpose).
const FAKE_HA_TOKEN = ["eyJFAKE", "HA_TOKEN", "LAUNCHER_TEST", "0123456789abcdef"].join(".");
const FAKE_TELEGRAM_TOKEN = [
  "123456789",
  "FAKE-TELEGRAM-TOKEN-FOR-LAUNCHER-TESTS",
].join(":");

const sandboxes: string[] = [];

afterAll(() => {
  for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

interface Sandbox {
  dir: string;
  appDir: string;
  bunPath: string;
  configPath: string;
  logPath: string;
  haEnvPath: string;
  telegramEnvPath: string;
  recordPath: string;
}

interface SandboxOptions {
  haToken?: string;
  telegramToken?: string;
  createBun?: boolean;
  createConfig?: boolean;
}

function createSandbox(options: SandboxOptions = {}): Sandbox {
  const dir = mkdtempSync(join(tmpdir(), "hag-launcher-"));
  sandboxes.push(dir);

  const appDir = join(dir, "apps", "hag_ts");
  mkdirSync(join(appDir, "config"), { recursive: true });
  mkdirSync(join(appDir, "src"), { recursive: true });

  const configPath = join(appDir, "config", "hvac_config_prod.yaml");
  if (options.createConfig !== false) {
    writeFileSync(configPath, "# sandbox production config\n");
  }

  const bunPath = join(dir, "fake-bun");
  const recordPath = join(dir, "bun-record.txt");
  if (options.createBun !== false) {
    // Records how the launcher invoked the runtime, then exits. It never runs
    // the real application: this suite must not touch Home Assistant.
    writeFileSync(
      bunPath,
      [
        "#!/bin/sh",
        "{",
        '  printf "argv=%s\\n" "$*"',
        '  printf "cwd=%s\\n" "$(pwd)"',
        '  printf "ha_token_present=%s\\n" "${HASS_HassOptions__Token:+yes}"',
        '  printf "telegram_token_present=%s\\n" "${HASS_TelegramBotToken:+yes}"',
        '} > "$FAKE_BUN_RECORD"',
        'printf "fake-bun-started\\n"',
        "",
      ].join("\n"),
    );
    chmodSync(bunPath, 0o755);
  }

  const haEnvPath = join(dir, ".hag_ha_token.env");
  const telegramEnvPath = join(dir, ".hag_telegram.env");
  if (options.haToken !== undefined) {
    writeFileSync(
      haEnvPath,
      `export HASS_HassOptions__Token="${options.haToken}"\n`,
    );
    chmodSync(haEnvPath, 0o600);
  }
  if (options.telegramToken !== undefined) {
    writeFileSync(
      telegramEnvPath,
      `export HASS_TelegramBotToken="${options.telegramToken}"\n`,
    );
    chmodSync(telegramEnvPath, 0o600);
  }

  return {
    dir,
    appDir,
    bunPath,
    configPath,
    logPath: join(appDir, "log.log"),
    haEnvPath,
    telegramEnvPath,
    recordPath,
  };
}

/**
 * Runs the real launcher under `sh` with a clean environment: the deployment
 * paths are redirected into the sandbox, so production files are never
 * touched and no real secret is ever read.
 */
function runLauncher(
  sandbox: Sandbox,
  extraEnv: Record<string, string> = {},
) {
  return spawnSync("sh", [LAUNCHER], {
    cwd: sandbox.dir,
    encoding: "utf8",
    timeout: 15_000,
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: sandbox.dir,
      HAG_APP_DIR: sandbox.appDir,
      HAG_BUN_BIN: sandbox.bunPath,
      HAG_CONFIG_FILE: sandbox.configPath,
      HAG_LOG_FILE: sandbox.logPath,
      HAG_HA_TOKEN_ENV_FILE: sandbox.haEnvPath,
      HAG_TELEGRAM_ENV_FILE: sandbox.telegramEnvPath,
      FAKE_BUN_RECORD: sandbox.recordPath,
      ...extraEnv,
    },
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(20);
  }
  return predicate();
}

function recordContents(sandbox: Sandbox): Record<string, string> {
  const record: Record<string, string> = {};
  for (const line of readFileSync(sandbox.recordPath, "utf8").split("\n")) {
    const index = line.indexOf("=");
    if (index > 0) record[line.slice(0, index)] = line.slice(index + 1);
  }
  return record;
}

describe("tracked production launcher", () => {
  test("exists at the deployed path, is executable and uses a POSIX sh shebang", () => {
    expect(existsSync(LAUNCHER)).toBe(true);
    const stats = statSync(LAUNCHER);
    expect(stats.isFile()).toBe(true);
    expect(stats.mode & 0o111).not.toBe(0);

    const text = readFileSync(LAUNCHER, "utf8");
    expect(text.startsWith("#!/bin/sh\n")).toBe(true);
  });

  test("carries no credential: placeholders and env-file paths only", () => {
    const text = readFileSync(LAUNCHER, "utf8");

    for (const pattern of SECRET_PATTERNS) {
      expect(text).not.toMatch(pattern);
    }
    // No token variable may be assigned a literal value in the launcher.
    expect(text).not.toMatch(/HASS_HassOptions__Token\s*=\s*["'][^"']+/);
    expect(text).not.toMatch(/HASS_TelegramBotToken\s*=\s*["'][^"']+/);

    // The documented deployment contract must stay in the file.
    for (const expected of [
      "/home/jiri/apps/hag_ts",
      "/home/jiri/.bun/bin/bun",
      "config/hvac_config_prod.yaml",
      "/home/jiri/.hag_ha_token.env",
      "/home/jiri/.hag_telegram.env",
    ]) {
      expect(text).toContain(expected);
    }
  });

  test("the secret scan used above actually catches token-shaped values", () => {
    // Negative control: without this, the assertions above could pass vacuously.
    expect(FAKE_HA_TOKEN).toMatch(SECRET_PATTERNS[0]);
    expect(FAKE_TELEGRAM_TOKEN).toMatch(SECRET_PATTERNS[1]);
  });

  test("stays portable to Alpine's busybox ash (/bin/sh)", () => {
    const text = readFileSync(LAUNCHER, "utf8");
    for (const bashism of [
      "[[",
      "function ",
      "source ",
      "declare ",
      "+=",
      "$RANDOM",
      "BASH_SOURCE",
      "shopt",
    ]) {
      expect(text).not.toContain(bashism);
    }
  });
});

describe("launcher runtime contract (sandboxed, offline)", () => {
  test("refuses to start when a required variable is missing, never printing a value", () => {
    const sandbox = createSandbox();

    const result = runLauncher(sandbox);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("HASS_HassOptions__Token");
    expect(result.stderr).toContain("HASS_TelegramBotToken");
    // Nothing was launched and no log was started.
    expect(existsSync(sandbox.recordPath)).toBe(false);
    expect(existsSync(sandbox.logPath)).toBe(false);
  });

  test("missing-variable failure output contains no token-shaped value", () => {
    const sandbox = createSandbox({
      haToken: FAKE_HA_TOKEN,
      telegramToken: FAKE_TELEGRAM_TOKEN,
    });
    // The env files exist but are not sourced by this run: variables are
    // absent, which is the case that must fail closed.
    writeFileSync(sandbox.haEnvPath, `export HASS_HassOptions__Token=""\n`);

    const result = runLauncher(sandbox);

    expect(result.status).not.toBe(0);
    const output = `${result.stdout}${result.stderr}`;
    expect(output).not.toContain(FAKE_HA_TOKEN);
    expect(output).not.toContain(FAKE_TELEGRAM_TOKEN);
  });

  test("sources the protected env files and starts the documented command", async () => {
    const sandbox = createSandbox({
      haToken: FAKE_HA_TOKEN,
      telegramToken: FAKE_TELEGRAM_TOKEN,
    });

    const result = runLauncher(sandbox);

    expect(result.status).toBe(0);
    expect(`${result.stdout}${result.stderr}`).not.toContain(FAKE_HA_TOKEN);
    expect(`${result.stdout}${result.stderr}`).not.toContain(
      FAKE_TELEGRAM_TOKEN,
    );

    expect(await waitFor(() => existsSync(sandbox.recordPath))).toBe(true);
    const record = recordContents(sandbox);

    expect(record.argv).toBe(
      `run ${sandbox.appDir}/src/main.ts --config ${sandbox.configPath}`,
    );
    expect(record.cwd).toBe(sandbox.appDir);
    expect(record.ha_token_present).toBe("yes");
    expect(record.telegram_token_present).toBe("yes");

    // `tee` keeps the service log, as before the migration.
    expect(
      await waitFor(() => {
        if (!existsSync(sandbox.logPath)) return false;
        return readFileSync(sandbox.logPath, "utf8").includes(
          "fake-bun-started",
        );
      }),
    ).toBe(true);
    const log = readFileSync(sandbox.logPath, "utf8");
    expect(log).not.toContain(FAKE_HA_TOKEN);
    expect(log).not.toContain(FAKE_TELEGRAM_TOKEN);
  });

  test("dry run resolves the deployment without launching anything", () => {
    const sandbox = createSandbox({
      haToken: FAKE_HA_TOKEN,
      telegramToken: FAKE_TELEGRAM_TOKEN,
    });

    const result = runLauncher(sandbox, { HAG_DRY_RUN: "1" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(sandbox.bunPath);
    expect(result.stdout).toContain(sandbox.configPath);
    expect(result.stdout).toContain(sandbox.appDir);
    expect(result.stdout).not.toContain(FAKE_HA_TOKEN);
    expect(result.stdout).not.toContain(FAKE_TELEGRAM_TOKEN);
    expect(existsSync(sandbox.recordPath)).toBe(false);
    expect(existsSync(sandbox.logPath)).toBe(false);
  });

  test("the required-variable list is overridable for a deployment without alert delivery", async () => {
    const sandbox = createSandbox({ haToken: FAKE_HA_TOKEN });

    const result = runLauncher(sandbox, {
      HAG_REQUIRED_VARS: "HASS_HassOptions__Token",
    });

    expect(result.status).toBe(0);
    expect(await waitFor(() => existsSync(sandbox.recordPath))).toBe(true);
    expect(recordContents(sandbox).ha_token_present).toBe("yes");
    expect(recordContents(sandbox).telegram_token_present).toBe("");
  });

  test("fails clearly when the bun runtime is missing", () => {
    const sandbox = createSandbox({
      haToken: FAKE_HA_TOKEN,
      telegramToken: FAKE_TELEGRAM_TOKEN,
      createBun: false,
    });

    const result = runLauncher(sandbox);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(sandbox.bunPath);
    expect(result.stderr).not.toContain(FAKE_HA_TOKEN);
  });

  test("fails clearly when the production config is missing", () => {
    const sandbox = createSandbox({
      haToken: FAKE_HA_TOKEN,
      telegramToken: FAKE_TELEGRAM_TOKEN,
      createConfig: false,
    });

    const result = runLauncher(sandbox);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(sandbox.configPath);
    expect(result.stderr).not.toContain(FAKE_HA_TOKEN);
  });
});

/**
 * Rehearsal of the server-side migration the deploy step performs: the Home
 * Assistant token embedded in the untracked launcher moves into a 0600 env
 * file and the launcher becomes the tracked, secret-free file. The recipe is
 * executed here against fake values only.
 */
describe("credential migration recipe rehearsal", () => {
  test("moves the token to a 0600 env file, keeps a backup and installs the tracked launcher", async () => {
    const sandbox = createSandbox({ telegramToken: FAKE_TELEGRAM_TOKEN });

    const legacyLauncher = join(sandbox.dir, "old_start_hag.sh");
    const legacyBackup = join(sandbox.dir, "start_hag.sh.pre-migration");
    const newLauncher = join(sandbox.dir, "start_hag.sh");
    writeFileSync(
      legacyLauncher,
      [
        "#!/bin/sh",
        `. ${sandbox.telegramEnvPath} 2>/dev/null || true`,
        `export HASS_HassOptions__Token="${FAKE_HA_TOKEN}"`,
        `/home/jiri/.bun/bin/bun run ${sandbox.appDir}/src/main.ts --config ${sandbox.configPath} 2>&1 | tee ${sandbox.logPath} &`,
        "",
      ].join("\n"),
    );
    chmodSync(legacyLauncher, 0o644);

    const recipe = [
      "set -eu",
      `env_file="${sandbox.haEnvPath}"`,
      `tmp="$env_file.new"`,
      `legacy="${legacyLauncher}"`,
      "(umask 077; : > \"$tmp\")",
      "grep '^export HASS_HassOptions__Token=' \"$legacy\" > \"$tmp\"",
      "test -s \"$tmp\"",
      "chmod 600 \"$tmp\"",
      "mv \"$tmp\" \"$env_file\"",
      `cp "$legacy" "${legacyBackup}"`,
      "chmod 600 \"" + legacyBackup + "\"",
      `cp "${LAUNCHER}" "${newLauncher}"`,
      `chmod 755 "${newLauncher}"`,
    ].join("\n");

    const migration = spawnSync("sh", ["-c", recipe], {
      encoding: "utf8",
      timeout: 15_000,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
    });
    expect(migration.status).toBe(0);

    // The value survived, byte for byte, and only in protected files.
    const envContents = readFileSync(sandbox.haEnvPath, "utf8");
    expect(envContents).toBe(
      `export HASS_HassOptions__Token="${FAKE_HA_TOKEN}"\n`,
    );
    expect(statSync(sandbox.haEnvPath).mode & 0o777).toBe(0o600);
    const backupContents = readFileSync(legacyBackup, "utf8");
    expect(backupContents).toContain(FAKE_HA_TOKEN);
    expect(statSync(legacyBackup).mode & 0o777).toBe(0o600);

    // The installed launcher is the tracked file and carries no credential.
    const installed = readFileSync(newLauncher, "utf8");
    expect(installed).toBe(readFileSync(LAUNCHER, "utf8"));
    for (const pattern of SECRET_PATTERNS) {
      expect(installed).not.toMatch(pattern);
    }

    // And the installed launcher really does pick the migrated token up.
    const run = runLauncher(sandbox, {
      HAG_DRY_RUN: "1",
      HAG_HA_TOKEN_ENV_FILE: sandbox.haEnvPath,
      HAG_TELEGRAM_ENV_FILE: sandbox.telegramEnvPath,
    });
    // (dry run proves resolution; the sandbox paths are what the launcher uses)
    expect(run.status).toBe(0);

    const live = runLauncher(sandbox, {
      HAG_HA_TOKEN_ENV_FILE: sandbox.haEnvPath,
      HAG_TELEGRAM_ENV_FILE: sandbox.telegramEnvPath,
    });
    expect(live.status).toBe(0);
    expect(await waitFor(() => existsSync(sandbox.recordPath))).toBe(true);
    expect(recordContents(sandbox).ha_token_present).toBe("yes");
  });
});
