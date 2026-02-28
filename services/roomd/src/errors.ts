export type RoomdErrorCode =
  | "INVALID_PAYLOAD"
  | "IDEMPOTENCY_CONFLICT"
  | "ROOM_EXISTS"
  | "ROOM_NOT_FOUND"
  | "INSTANCE_EXISTS"
  | "INSTANCE_NOT_FOUND"
  | "SERVER_NOT_ALLOWLISTED"
  | "UNSUPPORTED_CAPABILITY"
  | "NO_UI_RESOURCE"
  | "UI_RESOURCE_INVALID"
  | "INVALID_COMMAND"
  | "UPSTREAM_TRANSPORT_ERROR"
  | "INTERNAL_ERROR";

interface HttpErrorOptions {
  details?: Record<string, unknown>;
  hint?: string;
}

export interface RoomdErrorResponse {
  ok: false;
  error: string;
  code: RoomdErrorCode;
  details?: Record<string, unknown>;
  hint?: string;
}

export class HttpError extends Error {
  readonly details?: Record<string, unknown>;
  readonly hint?: string;

  constructor(
    readonly statusCode: number,
    readonly code: RoomdErrorCode,
    message: string,
    options: HttpErrorOptions = {},
  ) {
    super(message);
    this.name = "HttpError";
    this.details = options.details;
    this.hint = options.hint;
  }

  toResponseBody(): RoomdErrorResponse {
    return {
      ok: false,
      error: this.message,
      code: this.code,
      ...(this.details ? { details: this.details } : {}),
      ...(this.hint ? { hint: this.hint } : {}),
    };
  }
}

export function invalidPayloadError(details?: Record<string, unknown>): HttpError {
  return new HttpError(400, "INVALID_PAYLOAD", "Invalid payload", {
    details,
  });
}

export function mapUnknownError(error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error;
  }

  if (error instanceof Error) {
    return new HttpError(
      502,
      "UPSTREAM_TRANSPORT_ERROR",
      "Upstream MCP request failed",
      { details: { cause: error.message } },
    );
  }

  return new HttpError(500, "INTERNAL_ERROR", "Unexpected internal error");
}
