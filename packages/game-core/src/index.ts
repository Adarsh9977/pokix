/**
 * @jev-arena/game-core
 *
 * The deterministic game engine. Pure functions over frozen state: no clocks,
 * no randomness, no network, no agents, no TypeSafe. Given the same state and
 * the same two actions it always produces the same next state.
 */

export * from "./actions";
export * from "./observations";
export * from "./resolver";
export * from "./rules";
export * from "./simulation";
export * from "./state";
