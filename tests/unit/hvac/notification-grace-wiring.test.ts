/**
 * Notification-grace wiring (approved debounce policy).
 *
 * The validated configuration (`hvacOptions.sensorHealth.
 * notificationGraceMinutes`) must reach the monitor the *production* module
 * builds, converted to milliseconds, and the approved default (one hour) must
 * apply when the configuration does not set it.
 *
 * The module builds its own monitor with the real timer scheduler, so this
 * test uses a millisecond-scale configured window, an explicitly enabled
 * Telegram transport with fake credentials and a stubbed `fetch`: no Home
 * Assistant, no network and no device is contacted, and nothing is delivered.
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { HvacModule } from "../../../src/hvac/hvac-module.ts";
import { EventBus } from "../../../src/core/event-system.ts";
import { LoggerService } from "../../../src/core/logging.ts";
import { LogLevel } from "../../../src/types/common.ts";
import type { ApplicationOptions } from "../../../src/config/config.ts";
import type { HomeAssistantClient } from "../../../src/home-assistant/client.ts";
import { makeOptions, waitUntil } from "./harness.ts";

const FAKE_TOKEN = "111111:FAKE-TELEGRAM-TOKEN-FOR-TESTS";
const FAKE_CHAT = "424242";

const appOptions = {
  logLevel: LogLevel.ERROR,
  useAi: false,
  aiModel: "test",
  aiTemperature: 0,
} as unknown as ApplicationOptions;

/** The module never dereferences the client unless a probe/reconcile runs. */
const haClient = {} as unknown as HomeAssistantClient;

let module: HvacModule | undefined;
let restoreFetch: (() => void) | undefined;

afterEach(async () => {
  restoreFetch?.();
  restoreFetch = undefined;
  module?.getSensorHealth().dispose();
  module = undefined;
});

/** Intercept the Telegram transport's HTTP call: nothing leaves the process. */
const interceptTelegram = (): Array<{ url: string; body: string }> => {
  const posted: Array<{ url: string; body: string }> = [];
  const spy = spyOn(globalThis, "fetch").mockImplementation(((
    url: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    posted.push({ url: String(url), body: String(init?.body ?? "") });
    return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
  }) as typeof fetch);
  restoreFetch = () => spy.mockRestore();
  return posted;
};

const buildModule = (sensorHealth: unknown): HvacModule => {
  module = new HvacModule(
    makeOptions({
      sensorHealth: sensorHealth as never,
      alerts: {
        telegram: { enabled: true, botToken: FAKE_TOKEN, chatId: FAKE_CHAT },
      },
    } as never),
    appOptions,
    haClient,
    new EventBus(new LoggerService("test.events")),
  );
  return module;
};

const reportHallFault = (mod: HvacModule): void => {
  mod.getSensorHealth().report("hall", {
    entityId: "sensor.1st_floor_hall_multisensor_temperature",
    rawState: "unavailable",
    reportedAt: new Date(),
  });
};

describe("Notification grace - the configured window is wired into the production module", () => {
  test("a configured window delays the Telegram alert until it elapses", async () => {
    const posted = interceptTelegram();
    // 0.01 min = 600 ms: the smallest honest window that the millisecond
    // conversion can be observed with.
    const mod = buildModule({ notificationGraceMinutes: 0.01 });

    reportHallFault(mod);
    // Detection is immediate; the alert is not.
    expect(mod.getSensorHealth().isDegraded("hall")).toBe(true);
    expect(posted).toEqual([]);

    await waitUntil(() => posted.length === 1, 600, 10);
    expect(posted[0].url).toContain(`/bot${FAKE_TOKEN}/sendMessage`);
    expect(JSON.parse(posted[0].body)).toEqual({
      chat_id: FAKE_CHAT,
      text: expect.stringContaining("hall temperature sensor fault"),
    });
  });

  test("without configuration the production default keeps the alert from being immediate", async () => {
    const posted = interceptTelegram();
    const mod = buildModule(undefined);

    reportHallFault(mod);
    expect(mod.getSensorHealth().isDegraded("hall")).toBe(true);

    // An unconfigured deployment uses the approved one-hour default: no alert
    // inside the (much shorter) observation window.
    for (let i = 0; i < 40; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(posted).toEqual([]);
  });
});
