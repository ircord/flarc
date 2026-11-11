export * from "./authorization";

export interface CustomRoleDefinition {
  id: string;
  channelId: string;
  name: string;
  color?: string | null;
  position: number;
  ircMode?: "q" | "a" | "o" | "h" | "v" | null;
  permissions: {
    sendMessages: boolean;
    changeTopic: boolean;
    kickMembers: boolean;
    banMembers: boolean;
    manageRoles: boolean;
    manageChannel: boolean;
    attachFiles: boolean;
  };
}

export const DEFAULT_ROLE_MODES = {
  OWNER: "q",
  ADMIN: "a",
  OPERATOR: "o",
  HALFOP: "h",
  VOICED: "v",
} as const;

export function modeToDefaultPermissions(mode: string): CustomRoleDefinition["permissions"] {
  switch (mode) {
    case "q":
      return {
        sendMessages: true,
        changeTopic: true,
        kickMembers: true,
        banMembers: true,
        manageRoles: true,
        manageChannel: true,
        attachFiles: true,
      };
    case "a":
      return {
        sendMessages: true,
        changeTopic: true,
        kickMembers: true,
        banMembers: true,
        manageRoles: true,
        manageChannel: true,
        attachFiles: true,
      };
    case "o":
      return {
        sendMessages: true,
        changeTopic: true,
        kickMembers: true,
        banMembers: true,
        manageRoles: false,
        manageChannel: false,
        attachFiles: true,
      };
    case "h":
      return {
        sendMessages: true,
        changeTopic: true,
        kickMembers: true,
        banMembers: false,
        manageRoles: false,
        manageChannel: false,
        attachFiles: true,
      };
    case "v":
      return {
        sendMessages: true,
        changeTopic: false,
        kickMembers: false,
        banMembers: false,
        manageRoles: false,
        manageChannel: false,
        attachFiles: true,
      };
    default:
      return {
        sendMessages: true,
        changeTopic: false,
        kickMembers: false,
        banMembers: false,
        manageRoles: false,
        manageChannel: false,
        attachFiles: true,
      };
  }
}
