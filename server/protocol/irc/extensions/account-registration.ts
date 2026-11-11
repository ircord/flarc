/**
 * IRCv3 Account Registration Extension (draft/account-registration)
 *
 * Implements pre-connection and in-session account registration:
 *   REGISTER <account> <email|*> <password>
 *   VERIFY <account> <code>
 *
 * Capabilities:
 *   draft/account-registration=before-connect
 *
 * References:
 * - https://ircv3.net/specs/extensions/account-registration
 */

export const ACCOUNT_REGISTRATION_CAP = "draft/account-registration";

export interface RegisterCommandParams {
  account: string;
  email: string | null;
  password?: string;
  subcommand?: string;
}

export function parseRegisterCommand(params: string[]): {
  ok: boolean;
  error?: string;
  data?: RegisterCommandParams;
} {
  if (params.length < 2) {
    return { ok: false, error: "Need more parameters: REGISTER <account> <email|*> <password>" };
  }

  // Subcommand mode: REGISTER SUCCESS, REGISTER VERIFY, etc.
  if (params.length === 2 && ["SUCCESS", "VERIFY"].includes(params[0].toUpperCase())) {
    return {
      ok: true,
      data: {
        subcommand: params[0].toUpperCase(),
        account: params[1],
        email: null,
      },
    };
  }

  const account = params[0].trim();
  const rawEmail = params[1].trim();
  const email = rawEmail === "*" ? null : rawEmail;
  const password = params[2]?.trim();

  return {
    ok: true,
    data: {
      account,
      email,
      password,
    },
  };
}
