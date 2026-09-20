/**
 * npm run simulate
 *
 * Plays a full match between two deterministic local agents and prints it.
 * Makes no network calls and spends nothing. This is the command to reach for
 * when you want to see the engine work, or to sanity-check a balance change.
 */

import {
  DEFAULT_GAME_CONFIG,
  PLAYER_IDS,
  STRATEGY_PROFILES,
  STRATEGY_PROFILE_IDS,
  describeAction,
  isStrategyProfileId,
  type GameConfig,
  type PlayerId,
} from "@jev-arena/types";
import {
  HeuristicAgent,
  MockAgent,
  runAgentMatch,
  type Agent,
  type AgentTurnRecord,
} from "@jev-arena/agent-core";

const BAR_WIDTH = 12;

function bar(value: number, max: number): string {
  const filled = Math.round((Math.max(0, value) / max) * BAR_WIDTH);
  return "#".repeat(filled) + ".".repeat(BAR_WIDTH - filled);
}

function renderArena(record: AgentTurnRecord, config: GameConfig): string {
  const state = record.resolution.next;
  const blocked = new Set(
    state.environment.obstacles.map((tile) => `${tile.x},${tile.y}`),
  );
  const occupants = new Map<string, string>();
  for (const id of PLAYER_IDS) {
    const { x, y } = state.players[id].position;
    occupants.set(`${x},${y}`, id);
  }

  const rows: string[] = [];
  for (let y = 0; y < config.arena.height; y += 1) {
    let row = "";
    for (let x = 0; x < config.arena.width; x += 1) {
      const key = `${x},${y}`;
      row += occupants.get(key) ?? (blocked.has(key) ? "#" : ".");
    }
    rows.push(`  ${row}`);
  }
  return rows.join("\n");
}

function printTurn(record: AgentTurnRecord, config: GameConfig): void {
  const { resolution } = record;
  console.log(`\nTurn ${record.turn}`);

  for (const id of PLAYER_IDS) {
    const player = resolution.players[id];
    const after = resolution.next.players[id];
    const parts = [`  ${id} -> ${describeAction(player.submitted)}`];

    if (player.rejection) {
      parts.push(`REJECTED (${player.rejection.reason}) -> DEFEND`);
    } else if (player.attackOutcome) {
      parts.push(player.attackOutcome);
    } else if (player.movementBlocked) {
      parts.push("BLOCKED");
    }
    if (player.damageDealt > 0) parts.push(`${player.damageDealt} dmg`);

    console.log(
      `${parts.join("  ")}\n     hp ${bar(after.hp, config.player.maxHp)} ${String(after.hp).padStart(3)}` +
        `   energy ${bar(after.energy, config.player.maxEnergy)} ${String(after.energy).padStart(3)}` +
        `   @ (${after.position.x},${after.position.y})`,
    );
  }
}

function agentFor(id: PlayerId, profile: string): Agent {
  if (profile === "passive") {
    return new MockAgent({ type: "DEFEND" }, `Passive ${id}`);
  }
  const resolved = isStrategyProfileId(profile) ? profile : "neutral";
  return new HeuristicAgent({
    profile: resolved,
    maxHp: DEFAULT_GAME_CONFIG.player.maxHp,
    maxEnergy: DEFAULT_GAME_CONFIG.player.maxEnergy,
    name: `${STRATEGY_PROFILES[resolved].label} ${id}`,
  });
}

async function main(): Promise<void> {
  // Different profiles by default. Two identical agents starting
  // mirror-symmetrically always draw - a good neutrality property, and a
  // deeply boring thing to watch.
  const profileA = process.argv[2] ?? "aggressive";
  const profileB = process.argv[3] ?? "tactical";
  const verbose = !process.argv.includes("--quiet");
  const config = DEFAULT_GAME_CONFIG;

  const agents = { A: agentFor("A", profileA), B: agentFor("B", profileB) };

  console.log("==============================================");
  console.log("            JEV ARENA :: SIMULATION");
  console.log("==============================================");
  console.log(`  Agents      ${agents.A.name}  vs  ${agents.B.name}`);
  console.log(`  Arena       ${config.arena.width}x${config.arena.height}`);
  console.log(`  Turn limit  ${config.maxTurns}`);
  console.log(
    `  Profiles    ${STRATEGY_PROFILE_IDS.join(", ")}  (pass two as arguments)`,
  );
  console.log("  API calls   0 (local agents only)");

  let last: AgentTurnRecord | undefined;
  const startedAt = Date.now();

  const result = await runAgentMatch(agents, {
    config,
    onTurn: (record) => {
      last = record;
      if (verbose) printTurn(record, config);
    },
  });

  if (last) {
    console.log("\nFinal arena");
    console.log(renderArena(last, config));
  }

  console.log("\n----------------------------------------------");
  console.log(`  Winner      ${result.winner ?? "draw"}`);
  console.log(`  Turns       ${result.turnCount}`);
  for (const id of PLAYER_IDS) {
    const player = result.finalState.players[id];
    console.log(`  ${id} final     hp ${player.hp}  energy ${player.energy}`);
  }
  console.log(`  Wall clock  ${Date.now() - startedAt} ms`);
  console.log("----------------------------------------------");
}

main().catch((error: unknown) => {
  console.error("Simulation failed:", error);
  process.exitCode = 1;
});
