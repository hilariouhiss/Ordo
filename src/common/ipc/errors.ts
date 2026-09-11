/** Error codes produced by the backend (snake_case) or synthesized locally. */
export type AppErrorCode =
  | "database"
  | "migration"
  | "db"
  | "io"
  | "validation"
  | "not_found"
  | "unknown";

/** Normalized error shape consumed by UI layers. */
export interface AppError {
  code: AppErrorCode;
  message: string;
}

const FALLBACK_MESSAGE = "发生未知错误，请重试。";

const KNOWN_CODES: readonly AppErrorCode[] = [
  "database",
  "migration",
  "db",
  "io",
  "validation",
  "not_found",
];

function isErrorCode(value: unknown): value is AppErrorCode {
  return typeof value === "string" && (KNOWN_CODES as readonly string[]).includes(value);
}

function isErrorPayload(value: unknown): value is { code: unknown; message: unknown } {
  return typeof value === "object" && value !== null && "code" in value && "message" in value;
}

/** Whether the value is already a normalized AppError. */
export function isAppError(value: unknown): value is AppError {
  return isErrorPayload(value) && isErrorCode(value.code) && typeof value.message === "string";
}

/** Normalize any rejected IPC value into a uniform `{ code, message }` error. */
export function normalizeError(error: unknown): AppError {
  if (isErrorPayload(error)) {
    return {
      code: isErrorCode(error.code) ? error.code : "unknown",
      message:
        typeof error.message === "string" && error.message.trim()
          ? error.message
          : FALLBACK_MESSAGE,
    };
  }

  if (error instanceof Error) {
    return { code: "unknown", message: error.message || FALLBACK_MESSAGE };
  }

  if (typeof error === "string") {
    return { code: "unknown", message: error || FALLBACK_MESSAGE };
  }

  return { code: "unknown", message: FALLBACK_MESSAGE };
}
