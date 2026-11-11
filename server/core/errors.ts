export class IRCProtocolError extends Error {
  constructor(
    message: string,
    public readonly numeric?: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "IRCProtocolError";
  }
}

export class AuthorizationError extends Error {
  constructor(
    message: string,
    public readonly numeric: string = "482",
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}
