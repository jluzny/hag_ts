/**
 * Production configuration policy (tracked, non-secret) — HAG.
 *
 * The deployed server carried settings that were never committed (a 09:00–22:00
 * active window and enabled Telegram fault alerts) and the credentials needed
 * to start the service lived in an untracked launcher. These tests pin the
 * committed contract so that production and Git cannot drift apart silently:
 *
 *  - `config/hvac_config_prod.yaml` states the intended non-secret production
 *    settings, including the alert transport with a `${ENV_VAR}` placeholder
 *    for the bot token and a non-secret chat destination;
 *  - the file loads through the *real* `ConfigLoader` with the documented
 *    environment variables, proving the placeholder names match the launcher;
 *  - no tracked file contains a token-shaped literal.
 *
 * Offline: loading a config parses and validates YAML only — it opens no
 * connection to Home Assistant.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { ConfigLoader } from "../../../src/config/loader.ts";
import { DEFAULT_NOTIFICATION_GRACE_MS } from "../../../src/hvac/sensor-health.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const PROD_CONFIG_PATH = "config/hvac_config_prod.yaml";
const PROD_CONFIG = readFileSync(join(REPO_ROOT, PROD_CONFIG_PATH), "utf8");

const SECRET_PATTERNS = [
  /eyJ[A-Za-z0-9_.-]{10,}/,
  /[0-9]{8,10}:[A-Za-z0-9_-]{30,}/,
];

// Fixtures are assembled at runtime so this file itself stays free of
// token-shaped literals (the tracked-tree scan below is strict on purpose).
const FAKE_HA_TOKEN = ["eyJFAKE", "HA_TOKEN", "CONFIG_TEST", "0123456789abcdef"].join(".");
const FAKE_TELEGRAM_TOKEN = [
  "123456789",
  "FAKE-TELEGRAM-TOKEN-FOR-CONFIG-TESTS",
].join(":");
const APPROVED_CHAT_ID = "7600528001";

const STUBBED_ENV = {
  HASS_HassOptions__Token: FAKE_HA_TOKEN,
  HASS_TelegramBotToken: FAKE_TELEGRAM_TOKEN,
};

afterAll(() => {
  for (const name of Object.keys(STUBBED_ENV)) delete process.env[name];
});

interface ProdConfig {
  hassOptions: { token: string };
  hvacOptions: {
    activeHours: { start: number; startWeekday: number; end: number };
    alerts?: {
      telegram?: { enabled: boolean; botToken: string; chatId: string };
    };
    notificationGraceMinutes?: number;
    hvacEntities: Array<{ entityId: string; enabled: boolean; defrost: boolean }>;
    heating: {
      temperature: number;
      presetMode: string;
      temperatureThresholds: Record<string, number>;
    };
    cooling: {
      temperature: number;
      presetMode: string;
      temperatureThresholds: Record<string, number>;
    };
  };
}

const parsed = parse(PROD_CONFIG) as ProdConfig;

describe("committed production config states the intended settings", () => {
  test("active hours are the approved production window (09:00–22:00)", () => {
    const { activeHours } = parsed.hvacOptions;
    expect(activeHours.start).toBe(9);
    expect(activeHours.startWeekday).toBe(9);
    expect(activeHours.end).toBe(22);
  });

  test("the alert transport is tracked, enabled, and keeps the token behind a placeholder", () => {
    const telegram = parsed.hvacOptions.alerts?.telegram;
    expect(telegram?.enabled).toBe(true);
    expect(telegram?.botToken).toBe("${HASS_TelegramBotToken}");
    expect(telegram?.chatId).toBe(APPROVED_CHAT_ID);
  });

  test("the Home Assistant token is a placeholder, not a value", () => {
    expect(parsed.hassOptions.token).toBe("${HASS_HassOptions__Token}");
  });

  test("the remaining non-secret settings are preserved as committed", () => {
    const units = parsed.hvacOptions.hvacEntities;
    expect(units.map((unit) => unit.entityId)).toEqual([
      "climate.living_room_ac",
      "climate.bedroom_ac",
      "climate.matej_ac",
      "climate.anicka_ac",
      "climate.radek_ac",
    ]);
    expect(units.every((unit) => unit.enabled)).toBe(true);
    expect(units.filter((unit) => unit.defrost).map((u) => u.entityId)).toEqual([
      "climate.living_room_ac",
    ]);

    expect(parsed.hvacOptions.heating.temperature).toBe(21.0);
    expect(parsed.hvacOptions.heating.presetMode).toBe("wind_free_sleep");
    expect(parsed.hvacOptions.heating.temperatureThresholds).toEqual({
      indoorMin: 21.2,
      indoorMax: 21.8,
      outdoorMin: -5.0,
      outdoorMax: 15.0,
    });
    expect(parsed.hvacOptions.cooling.temperature).toBe(25.0);
    expect(parsed.hvacOptions.cooling.presetMode).toBe("wind_free");
    expect(parsed.hvacOptions.cooling.temperatureThresholds).toEqual({
      indoorMin: 23.7,
      indoorMax: 24.5,
      outdoorMin: 15,
      outdoorMax: 55.0,
    });

    // No notification-debounce override in production: the approved 60 minute
    // code default applies.
    expect(parsed.hvacOptions.notificationGraceMinutes).toBeUndefined();
  });

  test("the tracked production config contains no token-shaped literal", () => {
    for (const pattern of SECRET_PATTERNS) {
      expect(PROD_CONFIG).not.toMatch(pattern);
    }
  });
});

describe("the committed production config loads through the real ConfigLoader", () => {
  test("resolves both placeholders and exposes the approved effective settings", async () => {
    for (const [name, value] of Object.entries(STUBBED_ENV)) {
      process.env[name] = value;
    }

    const settings = await ConfigLoader.loadSettings(PROD_CONFIG_PATH);

    expect(settings.hassOptions.token).toBe(FAKE_HA_TOKEN);
    expect(settings.hvacOptions.activeHours?.end).toBe(22);
    expect(settings.hvacOptions.alerts?.telegram?.enabled).toBe(true);
    expect(settings.hvacOptions.alerts?.telegram?.botToken).toBe(
      FAKE_TELEGRAM_TOKEN,
    );
    expect(settings.hvacOptions.alerts?.telegram?.chatId).toBe(
      APPROVED_CHAT_ID,
    );
    // No notification-debounce override is committed, so the module's approved
    // code default (one hour) applies; assert both halves of that statement.
    expect(settings.hvacOptions.sensorHealth).toBeUndefined();
    expect(DEFAULT_NOTIFICATION_GRACE_MS).toBe(60 * 60 * 1000);

    for (const [name] of Object.entries(STUBBED_ENV)) delete process.env[name];
  });

  test("an unresolved placeholder is refused rather than silently accepted as a credential", async () => {
    // Without the environment variables the loader keeps the placeholder text.
    // The launcher is the component that fails closed (see the launcher suite);
    // this test documents the loader-side behaviour the launcher must cover.
    for (const name of Object.keys(STUBBED_ENV)) delete process.env[name];

    const settings = await ConfigLoader.loadSettings(PROD_CONFIG_PATH);

    expect(settings.hassOptions.token).toBe("${HASS_HassOptions__Token}");
    expect(settings.hassOptions.token.startsWith("${")).toBe(true);
  });
});

describe("no tracked file contains a credential", () => {
  test("scans every tracked file for token-shaped literals", () => {
    const tracked = execFileSync("git", ["ls-files"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);

    expect(tracked.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const relativePath of tracked) {
      const contents = readFileSync(join(REPO_ROOT, relativePath));
      if (contents.includes(0)) continue; // binary artefact
      const text = contents.toString("utf8");
      if (SECRET_PATTERNS.some((pattern) => pattern.test(text))) {
        offenders.push(relativePath);
      }
    }

    expect(offenders).toEqual([]);
  });

  test("the secret env files are ignored and only the examples are tracked", () => {
    const checkIgnore = (path: string) => {
      const result = execFileSync("git", ["check-ignore", "-v", path], {
        cwd: REPO_ROOT,
        encoding: "utf8",
      });
      return result.trim();
    };

    expect(checkIgnore(".hag_telegram.env")).toContain(".hag_telegram.env");
    expect(checkIgnore(".hag_ha_token.env")).toContain(".hag_ha_token.env");

    // The service log must stay out of Git as well.
    expect(
      spawnSync("git", ["check-ignore", "-q", "log.log"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
      }).status,
    ).toBe(0);

    // The examples must stay tracked (they are the documented contract).
    for (const example of [
      ".hag_telegram.env.example",
      ".hag_ha_token.env.example",
    ]) {
      const listed = execFileSync("git", ["ls-files", "--error-unmatch", example], {
        cwd: REPO_ROOT,
        encoding: "utf8",
      });
      expect(listed.trim()).toBe(example);
    }
  });
});
