/**
 * Turning a TypeSafe SDK failure into something the rest of the app can act
 * on.
 *
 * The mapping is driven by the SDK's own error classes and the status codes
 * the HTTP API documents (401, 422, 429, 529). Where the documentation is
 * silent, this errs towards an honest "unclassified provider error" rather
 * than guessing, because the spec forbids fabricating a billing status.
 */

// The SDK's error subclasses (AuthenticationError, RateLimitError and so on)
// all carry the same `status`, so classification keys off the status code
// rather than the class. That keeps the mapping table in one readable place
// and stays correct if the SDK adds a subclass we have not heard of.
import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
} from "@typesafe-ai/sdk";
import { ArenaError, type ErrorCategory } from "@jev-arena/types";

const BILLING_WORDS = /credit|billing|payment|insufficient funds|subscription/i;
const QUOTA_WORDS = /quota|allowance|limit reached|exceeded your/i;

/** Pulls readable text out of whatever the provider put in the body. */
export function providerMessageOf(error: unknown): string | undefined {
  if (!(error instanceof APIError)) return undefined;
  const { body } = error;

  if (typeof body === "string" && body.trim() !== "") return body.trim();
  if (body !== null && typeof body === "object") {
    const record = body as Record<string, unknown>;
    for (const key of ["message", "error", "detail", "detatil"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim() !== "") return value.trim();
      if (value !== null && typeof value === "object") {
        const nested = (value as Record<string, unknown>).message;
        if (typeof nested === "string" && nested.trim() !== "")
          return nested.trim();
      }
    }
    try {
      return JSON.stringify(body);
    } catch {
      return undefined;
    }
  }
  return error.message;
}

function categoryForStatus(status: number, text: string): ErrorCategory {
  if (status === 401) return "AUTHENTICATION_ERROR";
  // 402 is not in the documented list, but if it ever appears it means
  // exactly one thing.
  if (status === 402) return "CREDIT_ERROR";
  if (status === 403) {
    if (BILLING_WORDS.test(text)) return "CREDIT_ERROR";
    if (QUOTA_WORDS.test(text)) return "QUOTA_ERROR";
    return "AUTHENTICATION_ERROR";
  }
  if (status === 429) {
    // A 429 is normally a rate limit, which is transient. If the body says it
    // is an allowance rather than a rate, backing off will not help.
    if (BILLING_WORDS.test(text)) return "CREDIT_ERROR";
    if (QUOTA_WORDS.test(text)) return "QUOTA_ERROR";
    return "RATE_LIMIT_ERROR";
  }
  if (status === 400 || status === 422) return "CONFIGURATION_ERROR";
  return "PROVIDER_ERROR";
}

/**
 * Normalises anything thrown by the SDK into an ArenaError.
 *
 * The provider's own message is preserved where it is safe to do so, per
 * section 46. Credentials never appear in an ArenaError: the SDK does not put
 * them in its messages, and we do not add them.
 */
export function classifyTypeSafeError(error: unknown): ArenaError {
  if (error instanceof ArenaError) return error;

  if (error instanceof APITimeoutError) {
    return new ArenaError(
      "TIMEOUT_ERROR",
      `The TypeSafe request did not complete within ${error.timeoutMs} ms.`,
      { cause: error, retryable: true },
    );
  }

  if (error instanceof APIUserAbortError) {
    return new ArenaError(
      "TIMEOUT_ERROR",
      "The TypeSafe request was aborted.",
      {
        cause: error,
        retryable: false,
      },
    );
  }

  if (error instanceof APIConnectionError) {
    return new ArenaError(
      "NETWORK_ERROR",
      `Could not reach the TypeSafe API: ${error.message}`,
      { cause: error, retryable: true },
    );
  }

  if (error instanceof APIError) {
    const providerMessage = providerMessageOf(error);
    const category = categoryForStatus(
      error.status,
      `${error.message} ${providerMessage ?? ""}`,
    );

    return new ArenaError(category, headlineFor(category, error.status), {
      cause: error,
      status: error.status,
      retryable: retryableForStatus(error.status, category),
      ...(providerMessage === undefined ? {} : { providerMessage }),
      ...(error.requestId === undefined
        ? {}
        : { providerRequestId: error.requestId }),
    });
  }

  if (error instanceof Error) {
    return new ArenaError("PROVIDER_ERROR", error.message, { cause: error });
  }

  return new ArenaError(
    "PROVIDER_ERROR",
    "The TypeSafe SDK threw a value that is not an Error.",
    { cause: error },
  );
}

function retryableForStatus(status: number, category: ErrorCategory): boolean {
  // The docs name 429 and 529 as the retry-with-backoff cases. A 529 arrives
  // as a generic server error, so it is matched on status rather than class.
  if (status === 529 || status === 503) return true;
  if (category === "RATE_LIMIT_ERROR") return true;
  // A credit or quota failure dressed up as a 429 will not fix itself.
  if (category === "CREDIT_ERROR" || category === "QUOTA_ERROR") return false;
  return false;
}

function headlineFor(category: ErrorCategory, status: number): string {
  switch (category) {
    case "AUTHENTICATION_ERROR":
      return `TypeSafe rejected the API key (HTTP ${status}). Check TYPESAFE_API_KEY.`;
    case "CREDIT_ERROR":
      return `TypeSafe refused the request for billing reasons (HTTP ${status}).`;
    case "QUOTA_ERROR":
      return `TypeSafe refused the request because an account allowance is exhausted (HTTP ${status}).`;
    case "RATE_LIMIT_ERROR":
      return `TypeSafe rate-limited the request (HTTP ${status}). Back off and retry.`;
    case "CONFIGURATION_ERROR":
      return `TypeSafe rejected the request body as invalid (HTTP ${status}). This is a bug on our side, not a credentials or credit problem.`;
    default:
      return `TypeSafe returned HTTP ${status}.`;
  }
}

/** True for the categories that mean "the account cannot pay for this". */
export function isBillingCategory(category: ErrorCategory): boolean {
  return category === "CREDIT_ERROR" || category === "QUOTA_ERROR";
}
