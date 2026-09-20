/**
 * @jev-arena/server
 *
 * Everything that touches the TypeSafe API lives behind this boundary. The
 * API key is read in `config/env`, handed to the SDK in `typesafe/gateway`,
 * and exists nowhere else.
 */

// Re-exported so that the Vercel functions in `api/` depend on exactly one
// workspace package. Everything they need arrives through this bundle, which
// is why they never import raw TypeScript at runtime. See ASSUMPTIONS A24.
export { ArenaError } from "@jev-arena/types";
export type {
  AgentDecision,
  AgentObservation,
  ErrorCategory,
} from "@jev-arena/types";

export * from "./agents/jev-agent";
export * from "./agents/jev-decision";
export * from "./config/dotenv";
export * from "./config/env";
export * from "./playground/playground";
export * from "./playground/render";
export * from "./typesafe/errors";
export * from "./typesafe/gateway";
