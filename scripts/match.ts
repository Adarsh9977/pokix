/**
 * npm run match
 *
 * A complete Jev-vs-Jev match in the terminal. This is the CLI proof that the
 * whole loop works end to end before any of it is put behind a UI.
 *
 * Costs two Jev requests per turn. Use `--turns=N` to cap it while
 * experimenting, and `--mock` to watch the same output shape for free.
 */

import {
  DEFAULT_GAME_CONFIG,
  PLAYER_IDS,
  describeAction,
  type GameConfig,
  type PlayerId,
} from "@jev-arena/types";
import {
  HeuristicAgent,
  MatchOrchestrator,
  type Agent,
  type AgentTurnRecord,
} from "@jev-arena/agent-core";
import {
  JevAgent,
  createTypeSafeGateway,
  hasApiKey,
  loadAgentMode,
  loadDotEnv,
  loadTypeSafeConfig,
} from "@jev-arena/server";

function flag(name: string): string | undefined {
  const match = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return match?.split("=")[1];
}

function bar(value: number, max: number, width = 14): string {
  const filled = Math.max(
    0,
    Math.min(width, Math.round((value / max) * width)),
  );
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function printTurn(record: AgentTurnRecord, config: GameConfig): void {
  console.log(`\n── Turn ${record.turn} ${"─".repeat(46)}`);

  for (const id of PLAYER_IDS) {
    const trace = record.traces[id];
    const resolved = record.resolution.players[id];
    const after = record.resolution.next.players[id];

    const bits: string[] = [`  ${id} → ${describeAction(resolved.submitted)}`];

    if (trace.confidence !== undefined) {
      bits.push(`conf ${trace.confidence.toFixed(2)}`);
    }
    if (trace.probability !== undefined) {
      bits.push(`p ${trace.probability.toFixed(2)}`);
    }
    bits.push(`${trace.latencyMs}ms`);
    if (trace.origin !== "model") bits.push(`[${trace.origin}]`);
    if (trace.errorCategory) bits.push(`!${trace.errorCategory}`);

    console.log(bits.join("  "));

    const outcome = resolved.rejection
      ? `REJECTED ${resolved.rejection.reason} → DEFEND`
      : (resolved.attackOutcome ?? (resolved.movementBlocked ? "BLOCKED" : ""));

    console.log(
      `      hp ${bar(after.hp, config.player.maxHp)} ${String(after.hp).padStart(3)}` +
        `   en ${bar(after.energy, config.player.maxEnergy)} ${String(after.energy).padStart(3)}` +
        `   (${after.position.x},${after.position.y})` +
        (outcome ? `   ${outcome}` : "") +
        (resolved.damageDealt > 0 ? `   -${resolved.damageDealt}hp` : ""),
    );
  }
}

async function main(): Promise<void> {
  loadDotEnv();

  // AGENT_MODE is the default; an explicit flag overrides it for one run.
  const mode = process.argv.includes("--mock")
    ? "mock"
    : process.argv.includes("--jev")
      ? "jev"
      : loadAgentMode();
  const useMock = mode === "mock";
  const maxTurns = Number.parseInt(flag("turns") ?? "", 10);
  const timeoutMs = Number.parseInt(flag("timeout") ?? "", 10);

  const config: GameConfig = {
    ...DEFAULT_GAME_CONFIG,
    ...(Number.isNaN(maxTurns) ? {} : { maxTurns }),
  };

  let agents: Record<PlayerId, Agent>;

  if (useMock) {
    agents = { A: new HeuristicAgent(), B: new HeuristicAgent() };
  } else {
    if (!hasApiKey()) {
      console.error(
        "\nAGENT_MODE=jev, but TYPESAFE_API_KEY is not set, so a real match cannot run.\n" +
          "  cp .env.example .env   and paste your key, then try again.\n" +
          "  Or run a free local match:  npm run match -- --mock\n",
      );
      process.exit(1);
    }
    const gateway = createTypeSafeGateway(loadTypeSafeConfig(), {
      ...(Number.isNaN(timeoutMs) ? {} : { timeoutMs }),
    });
    agents = {
      A: new JevAgent(gateway, { name: "Jev A" }),
      B: new JevAgent(gateway, { name: "Jev B" }),
    };
  }

  console.log("═".repeat(58));
  console.log("                     JEV ARENA");
  console.log("═".repeat(58));
  console.log(`  ${agents.A.name}   vs   ${agents.B.name}`);
  console.log(`  Agent mode  ${mode}`);
  console.log(
    `  Arena ${config.arena.width}x${config.arena.height}   turn limit ${config.maxTurns}`,
  );
  if (!useMock) {
    console.log(
      `  Cost  2 Jev requests per turn, up to ${config.maxTurns * 2}`,
    );
  }

  const orchestrator = new MatchOrchestrator(agents, {
    config,
    onTurn: (record) => printTurn(record, config),
  });

  const result = await orchestrator.playMatch();

  const latencies = result.turns.flatMap((turn) =>
    PLAYER_IDS.map((id) => turn.traces[id].latencyMs),
  );
  const mean =
    latencies.length === 0
      ? 0
      : Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
  const fallbacks = result.turns.flatMap((turn) =>
    PLAYER_IDS.filter((id) => turn.decisions[id].origin === "fallback"),
  ).length;

  console.log(`\n${"═".repeat(58)}`);
  console.log(`  Winner            ${result.winner ?? "draw"}`);
  console.log(`  Turns             ${result.turnCount}`);
  console.log(`  Decisions         ${result.turnCount * 2}`);
  console.log(`  Mean latency      ${mean} ms`);
  for (const id of PLAYER_IDS) {
    const own = result.turns.map((turn) => turn.traces[id].latencyMs);
    const ownMean =
      own.length === 0
        ? 0
        : Math.round(own.reduce((a, b) => a + b, 0) / own.length);
    const player = result.finalState.players[id];
    console.log(
      `  ${id}                 hp ${player.hp}  energy ${player.energy}  mean ${ownMean} ms`,
    );
  }
  console.log(`  Fallbacks         ${fallbacks}`);
  console.log(`  Wall clock        ${(result.durationMs / 1000).toFixed(1)} s`);
  console.log("═".repeat(58));
}

main().catch((error: unknown) => {
  console.error("\nMatch failed:", error);
  process.exitCode = 1;
});
