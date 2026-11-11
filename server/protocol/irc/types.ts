export interface IRCMessage {
  tags: Record<string, string | true>;
  prefix: string | null;
  command: string;
  params: string[];
}

export interface ParsedPrefix {
  nick: string;
  user?: string;
  host?: string;
}
