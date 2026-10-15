/**
 * Fault/degraded-mode notification transport (issue 2).
 *
 * Alerts are delivered through the Hermes home-assistant profile's Telegram
 * route (the bot token of that profile's Telegram connection and the allowed
 * DM chat). Delivery is deliberately decoupled from HVAC control:
 *
 *  - a notification failure is logged and swallowed — it must never break
 *    HVAC control, which is why `send()` never rejects;
 *  - the transport is disabled unless configuration enables it, so no message
 *    can be delivered by an unconfigured deployment or by an offline test.
 *
 * The implementation is fully testable offline: tests inject a fake Notifier
 * (or a fake poster) and never touch the network.
 */

import type { LoggerService } from "../core/logging.ts";

/** Message transport for degraded-mode alerts. `send` must never throw. */
export interface Notifier {
  send(message: string): Promise<void>;
}

/** Drops every message. Used when no transport is configured/enabled. */
export class NullNotifier implements Notifier {
  async send(_message: string): Promise<void> {
    // Intentionally empty: no transport configured.
  }
}

export interface TelegramAlertOptions {
  botToken: string;
  chatId: string;
}

/** Minimal HTTP poster so tests can inject a fake without a network. */
export type AlertPoster = (
  url: string,
  body: unknown,
) => Promise<{ ok: boolean; status: number; body: string }>;

const defaultPoster: AlertPoster = async (url, body) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    ok: response.ok,
    status: response.status,
    body: await response.text(),
  };
};

/**
 * Telegram Bot API transport.
 *
 * The token identifies the Hermes home-assistant profile's Telegram bot; it is
 * never logged and never echoed into an alert body.
 */
export class TelegramNotifier implements Notifier {
  private readonly post: AlertPoster;

  constructor(
    private readonly options: TelegramAlertOptions,
    private readonly logger: LoggerService,
    post: AlertPoster = defaultPoster,
  ) {
    this.post = post;
  }

  async send(message: string): Promise<void> {
    if (!this.options.botToken || !this.options.chatId) {
      this.logger.warning(
        "⚠️ Telegram alert transport not configured - alert not delivered",
        { chatIdConfigured: !!this.options.chatId },
      );
      return;
    }

    try {
      const result = await this.post(
        `https://api.telegram.org/bot${this.options.botToken}/sendMessage`,
        { chat_id: this.options.chatId, text: message },
      );

      if (!result.ok) {
        this.logger.warning("⚠️ Telegram alert delivery failed", {
          status: result.status,
          // Response bodies can echo the request back; keep only the status.
        });
      }
    } catch (error) {
      // Isolated on purpose: HVAC control must keep working without alerts.
      this.logger.warning(
        "⚠️ Telegram alert transport error - alert not delivered",
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  }
}

/**
 * Select a transport from configuration.
 *
 * Alerts stay disabled (and therefore silent) unless the deployment explicitly
 * enables them and provides the token for the configured chat.
 */
export const selectNotifier = (
  alerts: { telegram?: { enabled?: boolean; botToken?: string; chatId?: string } } | undefined,
  logger: LoggerService,
  post?: AlertPoster,
): Notifier => {
  const telegram = alerts?.telegram;
  if (!telegram?.enabled) return new NullNotifier();
  return new TelegramNotifier(
    { botToken: telegram.botToken ?? "", chatId: telegram.chatId ?? "" },
    logger,
    post,
  );
};
