import { SERVER_CONFIG } from "../config";

const ASCII_NICK_REGEX = /^[A-Za-z_\-[\]\\^{}|`][A-Za-z0-9_\-[\]\\^{}|`]*$/;
const PRECIS_NICK_REGEX = /^[\p{L}_\-[\]\\^{}|`][\p{L}\p{N}_\-[\]\\^{}|`]*$/u;
const CHANNEL_REGEX = /^[#&][^\x00\x07\r\n ,:]+$/;

export function isReservedServiceNickname(nick: string): boolean {
  return [
    "nickserv",
    "chanserv",
    "hostserv",
    "histserv",
    "f",
    "flareserv",
    "q",
    "ns",
    "cs",
    "hs",
  ].includes(nick.toLowerCase());
}

export function isValidNickname(nick: string): boolean {
  if (!nick || nick.length < 1 || nick.length > SERVER_CONFIG.maxNickLength) {
    return false;
  }
  if (SERVER_CONFIG.caseMapping === "precis") {
    return PRECIS_NICK_REGEX.test(nick);
  }
  return ASCII_NICK_REGEX.test(nick);
}

export function isValidChannelName(channel: string): boolean {
  if (!channel || channel.length < 2 || channel.length > SERVER_CONFIG.maxChannelLength) {
    return false;
  }
  return CHANNEL_REGEX.test(channel);
}

export function isValidUsername(user: string): boolean {
  if (!user || user.length < 1 || user.length > 32) {
    return false;
  }
  return !/[\x00\r\n @:!]/g.test(user);
}
