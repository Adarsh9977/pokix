/**
 * Error classification.
 *
 * Section 46 forbids hiding a failure behind "something went wrong". Every
 * external failure gets a category, and the category is what the UI, the
 * retry policy and the analytics all branch on. The human-readable message is
 * for people; the category is for code.
 */

export const ERROR_CATEGORIES = [
  /** Missing or malformed local configuration. Never retry. */
  "CONFIGURATION_ERROR",
  /** The provider rejected our credentials. Never retry. */
  "AUTHENTICATION_ERROR",
  /** The account cannot pay for the request. Never retry. */
  "CREDIT_ERROR",
  /** An account allowance is exhausted. Never retry automatically. */
  "QUOTA_ERROR",
  /** Too many requests too quickly. Retryable with backoff. */
  "RATE_LIMIT_ERROR",
  /** We gave up waiting. Retrying costs another full turn of latency. */
  "TIMEOUT_ERROR",
  /** The request never reached the provider. Retryable. */
  "NETWORK_ERROR",
  /** We got an answer, but it was not one we can use. Never retry blindly. */
  "INVALID_RESPONSE",
  /** A decision arrived for a state that no longer exists. Discard it. */
  "STALE_DECISION",
  /** A structurally valid action the game rules refuse. */
  "INVALID_ACTION",
  /** A bug on our side. */
  "INTERNAL_GAME_ERROR",
  /** The provider failed in a way we have not classified. */
  "PROVIDER_ERROR",
] as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

/**
 * Categories the TypeSafe documentation describes as worth retrying.
 *
 * Only 429 and 529 are documented as retry-with-backoff, plus transport
 * failures that never reached the service. Everything else is deterministic:
 * retrying a bad API key or a malformed request just spends time and money.
 */
const RETRYABLE: ReadonlySet<ErrorCategory> = new Set([
  "RATE_LIMIT_ERROR",
  "NETWORK_ERROR",
]);

export function isRetryableCategory(category: ErrorCategory): boolean {
  return RETRYABLE.has(category);
}

export interface ArenaErrorOptions {
  readonly cause?: unknown;
  /** Provider request id, when one was returned. Useful for support. */
  readonly providerRequestId?: string;
  /** Raw provider text, already checked to be safe to surface. */
  readonly providerMessage?: string;
  /** HTTP status, when the failure came from an HTTP call. */
  readonly status?: number;
}

export class ArenaError extends Error {
  readonly category: ErrorCategory;
  readonly providerRequestId?: string;
  readonly providerMessage?: string;
  readonly status?: number;

  constructor(
    category: ErrorCategory,
    message: string,
    options: ArenaErrorOptions = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "ArenaError";
    this.category = category;
    if (options.providerRequestId !== undefined) {
      this.providerRequestId = options.providerRequestId;
    }
    if (options.providerMessage !== undefined) {
      this.providerMessage = options.providerMessage;
    }
    if (options.status !== undefined) this.status = options.status;
  }

  get retryable(): boolean {
    return isRetryableCategory(this.category);
  }
}

export function isArenaError(value: unknown): value is ArenaError {
  return value instanceof ArenaError;
}

/** Best-effort category for something thrown by code we do not control. */
export function categorize(error: unknown): ErrorCategory {
  if (isArenaError(error)) return error.category;
  return "PROVIDER_ERROR";
}

/** A message safe to log and display. Never includes a credential. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unrecognised error value.";
}
