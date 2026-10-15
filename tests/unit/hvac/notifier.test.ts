/**
 * Issue 2 — fault-notification transport.
 *
 * The transport is the Hermes home-assistant profile's Telegram route. Two
 * properties matter for a heating controller and are pinned here:
 *
 *  - alerts are *disabled* unless the deployment enables them: an unconfigured
 *    deployment delivers nothing ("no message can be delivered by an
 *    unconfigured deployment or by an offline test");
 *  - a delivery failure is logged and swallowed — `send()` never rejects, so a
 *    broken route can never break HVAC control.
 *
 * Fully offline: every test injects a fake poster. No network is contacted and
 * no real token is ever used.
 */

import { describe, expect, test } from "bun:test";
import {
  NullNotifier,
  TelegramNotifier,
  selectNotifier,
  type AlertPoster,
} from "../../../src/hvac/notifier.ts";
import { LoggerService } from "../../../src/core/logging.ts";

const FAKE_TOKEN = "111111:FAKE-TELEGRAM-TOKEN-FOR-TESTS";
const FAKE_CHAT = "424242";

/**
 * Captures what the transport logs, independent of the process log level (a
 * global level set by another test file must not change this assertion).
 */
class SpyLogger extends LoggerService {
  readonly calls: unknown[][] = [];

  override warning(message: string, context?: Record<string, unknown>): void {
    this.calls.push(["WARN", message, context]);
  }

  override error(message: string, error?: unknown, context?: Record<string, unknown>): void {
    this.calls.push(["ERROR", message, error, context]);
  }
}

interface Posted {
  url: string;
  body: unknown;
}

const recordingPoster = (
  result: { ok: boolean; status: number; body: string } = {
    ok: true,
    status: 200,
    body: '{"ok":true}',
  },
): { posts: Posted[]; post: AlertPoster } => {
  const posts: Posted[] = [];
  return {
    posts,
    post: async (url, body) => {
      posts.push({ url, body });
      return result;
    },
  };
};

describe("Issue 2 - alerts are off unless the deployment enables them", () => {
  test("no alert configuration at all selects the null transport", async () => {
    const notifier = selectNotifier(undefined, new LoggerService("test.notifier"));
    expect(notifier).toBeInstanceOf(NullNotifier);

    const { posts, post } = recordingPoster();
    // Even if a transport were reachable, nothing was selected to deliver with.
    expect(post).toBeDefined();
    await notifier.send("HAG: hall temperature sensor fault");
    expect(posts).toEqual([]);
  });

  test("an explicitly disabled Telegram transport delivers nothing", async () => {
    const notifier = selectNotifier(
      { telegram: { enabled: false, botToken: FAKE_TOKEN, chatId: FAKE_CHAT } },
      new LoggerService("test.notifier"),
    );
    expect(notifier).toBeInstanceOf(NullNotifier);
  });

  test("enabled but unconfigured credentials deliver nothing", async () => {
    const { posts, post } = recordingPoster();
    const notifier = new TelegramNotifier(
      { botToken: "", chatId: "" },
      new LoggerService("test.notifier"),
      post,
    );

    await notifier.send("HAG: hall temperature sensor fault");
    expect(posts).toEqual([]);
  });

  test("enabled with credentials posts exactly one message to the configured chat", async () => {
    const { posts, post } = recordingPoster();
    const notifier = selectNotifier(
      { telegram: { enabled: true, botToken: FAKE_TOKEN, chatId: FAKE_CHAT } },
      new LoggerService("test.notifier"),
      post,
    );

    await notifier.send("HAG: outdoor temperature sensor fault (silent)");

    expect(posts.length).toBe(1);
    expect(posts[0].url).toBe(
      `https://api.telegram.org/bot${FAKE_TOKEN}/sendMessage`,
    );
    expect(posts[0].body).toEqual({
      chat_id: FAKE_CHAT,
      text: "HAG: outdoor temperature sensor fault (silent)",
    });
  });
});

describe("Issue 2 - a failing transport never breaks control", () => {
  test("a thrown transport error is swallowed", async () => {
    const notifier = new TelegramNotifier(
      { botToken: FAKE_TOKEN, chatId: FAKE_CHAT },
      new LoggerService("test.notifier"),
      async () => {
        throw new Error("network unreachable");
      },
    );

    await expect(notifier.send("HAG: fault")).resolves.toBeUndefined();
  });

  test("a non-ok response is logged and swallowed", async () => {
    const { posts, post } = recordingPoster({
      ok: false,
      status: 401,
      body: '{"ok":false,"description":"Unauthorized"}',
    });
    const logger = new SpyLogger("test.notifier");
    const notifier = new TelegramNotifier(
      { botToken: FAKE_TOKEN, chatId: FAKE_CHAT },
      logger,
      post,
    );

    await expect(notifier.send("HAG: fault")).resolves.toBeUndefined();
    expect(posts.length).toBe(1);

    // The failure is logged (status only — response bodies can echo the
    // request) and never surfaced to the caller.
    const logged = logger.calls.map((call) => JSON.stringify(call)).join("\n");
    expect(logged).toContain("delivery failed");
    expect(logged).toContain("401");
    // The token is never echoed into logs or alert bodies.
    expect(logged).not.toContain(FAKE_TOKEN);
    expect(JSON.stringify(posts[0].body)).not.toContain(FAKE_TOKEN);
  });
});
