export interface LogContext {
  correlationId?: string;
  source?: string;
  sessionId?: string;
  username?: string;
  channel?: string;
  [key: string]: any;
}

export class Logger {
  constructor(private readonly defaultContext: LogContext = {}) {}

  private log(level: "info" | "warn" | "error" | "debug", message: string, ctx?: LogContext): void {
    const context: Record<string, any> = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...this.defaultContext,
      ...ctx,
    };

    // Sanitize any sensitive keys
    if (context.password) context.password = "[REDACTED]";
    if (context.token) context.token = "[REDACTED]";
    if (context.auth) context.auth = "[REDACTED]";
    if (context.passwordHash) context.passwordHash = "[REDACTED]";

    const output = JSON.stringify(context);
    if (level === "error") {
      console.error(output);
    } else if (level === "warn") {
      console.warn(output);
    } else {
      console.log(output);
    }
  }

  public info(message: string, ctx?: LogContext): void {
    this.log("info", message, ctx);
  }

  public warn(message: string, ctx?: LogContext): void {
    this.log("warn", message, ctx);
  }

  public error(message: string, ctx?: LogContext): void {
    this.log("error", message, ctx);
  }

  public debug(message: string, ctx?: LogContext): void {
    this.log("debug", message, ctx);
  }

  public withContext(ctx: LogContext): Logger {
    return new Logger({ ...this.defaultContext, ...ctx });
  }
}

export const logger = new Logger({ source: "flarc" });
