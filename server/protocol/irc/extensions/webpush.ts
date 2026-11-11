/**
 * IRCv3 WebPush Protocol Extension (draft/webpush)
 *
 * Implements push notification subscription over IRC:
 *   WEBPUSH REGISTER <endpoint> <p256dh> <auth>
 *   WEBPUSH UNREGISTER <endpoint>
 *
 * Capabilities:
 *   draft/webpush
 *
 * References:
 * - https://ircv3.net/specs/extensions/webpush
 */

export const WEBPUSH_CAP = "draft/webpush";

export type WebPushSubcommand = "REGISTER" | "UNREGISTER" | "SUBSCRIBE" | "UNSUBSCRIBE";

export interface WebPushParams {
  subcommand: WebPushSubcommand;
  endpoint: string;
  p256dh?: string;
  auth?: string;
}

export function parseWebPushCommand(params: string[]): {
  ok: boolean;
  error?: string;
  data?: WebPushParams;
} {
  if (params.length < 2) {
    return { ok: false, error: "Need more parameters for WEBPUSH" };
  }

  const subcommand = params[0].toUpperCase() as WebPushSubcommand;
  const endpoint = params[1].trim();

  if (subcommand === "UNREGISTER" || subcommand === "UNSUBSCRIBE") {
    return {
      ok: true,
      data: { subcommand, endpoint },
    };
  }

  if (params.length < 4) {
    return {
      ok: false,
      error: "Need more parameters: WEBPUSH REGISTER <endpoint> <p256dh> <auth>",
    };
  }

  const p256dh = params[2].trim();
  const auth = params[3].trim();

  return {
    ok: true,
    data: {
      subcommand,
      endpoint,
      p256dh,
      auth,
    },
  };
}
