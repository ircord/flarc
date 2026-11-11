export interface ApiErrorPayload {
  error: {
    code: string;
    message: string;
    details?: Record<string, any>;
  };
}

export class FlaRCError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
    public readonly details?: Record<string, any>,
  ) {
    super(message);
    this.name = "FlaRCError";
  }

  public toJSON(): ApiErrorPayload {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export function createErrorResponse(
  code: string,
  message: string,
  statusCode = 400,
  details?: Record<string, any>,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify(
      {
        error: {
          code,
          message,
          ...(details ? { details } : {}),
        },
      },
      null,
      2,
    ),
    {
      status: statusCode,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Admin-Token, X-Correlation-ID, X-Filename, Soju-Username, X-IRC-Nick, X-Session-ID",
        ...(extraHeaders ?? {}),
      },
    },
  );
}

export function createSuccessResponse(
  data: unknown,
  statusCode = 200,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status: statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, X-Admin-Token, X-Correlation-ID, X-Filename, Soju-Username, X-IRC-Nick, X-Session-ID",
      "Access-Control-Expose-Headers": "Location, X-Correlation-ID",
      ...(extraHeaders ?? {}),
    },
  });
}
