/**
 * IRCv3 Roleplay Extension (draft/roleplay, flarc.chat/roleplay)
 *
 * Implements NPC, NPCA, SCENE, and AMBIANCE roleplay commands.
 *
 * Syntax:
 *   NPC <target> <character_name> <message...>
 *   NPCA <target> <character_name> <action...>
 *   SCENE <target> <description...>
 *   AMBIANCE <target> <mood_description...>
 *
 * Capabilities:
 *   draft/roleplay
 *   flarc.chat/roleplay
 */

export const ROLEPLAY_CAP = "draft/roleplay";
export const ROLEPLAY_VENDOR_CAP = "flarc.chat/roleplay";

export type RoleplayKind = "npc" | "npca" | "scene" | "ambiance";

export interface ParsedRoleplayCommand {
  kind: RoleplayKind;
  target: string;
  characterName?: string;
  text: string;
}

export function isRoleplayCommand(cmd: string): boolean {
  const upper = cmd.toUpperCase();
  return upper === "NPC" || upper === "NPCA" || upper === "SCENE" || upper === "AMBIANCE";
}

export function parseRoleplayCommand(
  cmd: string,
  params: string[],
): { ok: boolean; error?: string; data?: ParsedRoleplayCommand } {
  const kind = cmd.toLowerCase() as RoleplayKind;

  if (kind === "scene" || kind === "ambiance") {
    if (params.length < 2) {
      return {
        ok: false,
        error: `Need more parameters: ${cmd.toUpperCase()} <target> <description...>`,
      };
    }
    return {
      ok: true,
      data: {
        kind,
        target: params[0],
        text: params.slice(1).join(" "),
      },
    };
  }

  // NPC / NPCA requires target, character_name, text
  if (params.length < 3) {
    return {
      ok: false,
      error: `Need more parameters: ${cmd.toUpperCase()} <target> <character_name> <text...>`,
    };
  }

  return {
    ok: true,
    data: {
      kind,
      target: params[0],
      characterName: params[1],
      text: params.slice(2).join(" "),
    },
  };
}

export function formatRoleplayNotice(data: ParsedRoleplayCommand): {
  prefix: string;
  text: string;
  tags: Record<string, string | true>;
} {
  const tags: Record<string, string | true> = {
    "+draft/roleplay": data.kind,
  };

  switch (data.kind) {
    case "npc":
      return {
        prefix: `*${data.characterName}*`,
        text: `<${data.characterName}> ${data.text}`,
        tags,
      };
    case "npca":
      return {
        prefix: `*${data.characterName}*`,
        text: `* ${data.characterName} ${data.text}`,
        tags,
      };
    case "scene":
      return {
        prefix: "=Scene=",
        text: `--- [Scene] ${data.text} ---`,
        tags,
      };
    case "ambiance":
      return {
        prefix: "=Ambiance=",
        text: `~~~ [Ambiance] ${data.text} ~~~`,
        tags,
      };
  }
}
