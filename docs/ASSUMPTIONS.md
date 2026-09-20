# Assumptions and deviations

`spec.md` is the contract. This file records every decision that the spec left
open, plus anything that had to deviate from it and why. It is updated in the
same commit as the decision it describes.

---

## A1 — Repository root name

**Spec:** Section 5 sketches a tree rooted at `jev-arena/`.

**Decision:** The git repository root is the existing `pokiX/` directory; the
project is named `jev-arena` in `package.json`. The spec's tree describes the
_internal_ layout, which is followed exactly.

---

## A2 — npm workspaces, no extra monorepo tooling

**Spec:** Section 4 says "Do NOT introduce unnecessary infrastructure". Section
31 requires `npm install`, `npm test` and `npm run build` to work.

**Decision:** Plain npm workspaces. No Turborepo, Nx, pnpm or Lerna. The spec's
acceptance commands are npm commands, so npm is the package manager.

---

## A3 — Internal packages are consumed as TypeScript source

**Spec:** Silent.

**Decision:** Workspace packages point `exports` at `src/index.ts` rather than a
compiled `dist/`. Nothing here is published to npm, and Vitest, `tsx` and Vite
all consume TypeScript directly. This removes a build step between editing a
package and running a test, which matters for a test-first project.

Consequence: `npm run build` currently means "typecheck the whole workspace"
(`tsc --noEmit`), because nothing emits an artifact yet. It will additionally
delegate to `apps/web`'s Vite build once that app exists.

---

## A4 — Vitest as the test framework

**Spec:** Section 14 — "preferably Vitest unless another framework is already
established". Nothing was established.

**Decision:** Vitest.

---

## A5 — Node version

**Spec:** Silent.

**Decision:** Node 20.19+, pinned in `engines` and `.nvmrc`. The TypeSafe
JavaScript SDK documents "Node.js 20 or newer", and Vite 7 requires 20.19+.

---

## A6 — Live-test opt-in switch

**Spec:** Section 16 shows `RUN_LIVE_JEV_TESTS=true npm test` "or an equivalent
mechanism".

**Decision:** Use exactly that variable name. Live tests self-skip when it is
unset, so the default run is offline and free.

---

## A7 — TypeSafe API surface

**Spec:** Sections 0 and 52 forbid inventing TypeSafe APIs and require the live
docs to win over the spec's own guesses.

**Decision (from the docs read on this date):**

- Endpoint: `POST https://api.typesafe.ai/v1/systemone`, bearer auth.
- JavaScript SDK: `@typesafe-ai/sdk`, `new TypeSafeClient()`, `client.systemOne({ state, questions })`.
- Bounded action selection maps to the **Choice** primitive (`choice(instructions, criteria)`).
- A Choice answer carries `choice`, `probabilities` (sums to 1) and `confidence`.
- Env vars: `TYPESAFE_API_KEY`, `TYPESAFE_BASE_URL`, `TYPESAFE_DEFAULT_MODEL`, `TYPESAFE_LOG_LEVEL`.
- Default model alias: `jev-latest`.
- Errors: `401`, `422`, `429`, `529`. Only `429` and `529` are documented as retryable.
- `GET /v1/models` lists the models an account may use.

The spec's illustrative `{ "action": "ATTACK", "probability": 0.91 }` shape is
therefore produced by _our_ adapter from the documented Choice answer, not taken
from the wire.

---

## A8 — Game balance constants

**Spec:** Section 8 fixes the arena at 20x20, the action set at four actions,
and the rules as "deterministic". Section 26 requires a neutral game. It does
not give HP, damage, energy or range numbers.

**Decision:** All of it lives in `DEFAULT_GAME_CONFIG` so it can be tuned in
one place and varied per experiment.

| Value         | Setting       | Why                                                                                                                                          |
| ------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| HP / Energy   | 100 / 100     | Round numbers that read well as HUD bars.                                                                                                    |
| Attack damage | 12            | ~9 clean hits to kill: long enough for tactics to show.                                                                                      |
| Attack range  | 2 (manhattan) | Range 1 makes every fight a shoving match. 2 leaves room to approach, trade, and disengage. Manhattan matches the four-directional movement. |
| Attack energy | 15            | Affordable, but spamming attacks runs you dry.                                                                                               |
| Dodge energy  | 20            | Strictly more than attacking, so evasion is a real trade.                                                                                    |
| Move energy   | 0             | Repositioning should never be punished.                                                                                                      |
| Energy regen  | 8/turn        | Slower than attack cost, so sustained aggression forces a pause.                                                                             |
| DEFEND        | -50% damage   | Cheap, always available, never as good as a clean dodge.                                                                                     |
| Grazed DODGE  | -25% damage   | A dodge that fails to break range still helps a little.                                                                                      |
| Max turns     | 60            | Bounds a live match to ~120 Jev calls. Higher HP wins; equal HP draws.                                                                       |

Every damage number stays an integer (12 -> 6 defended, 9 grazed), so there is
no floating-point drift in the authoritative state.

Starting positions are (6,10) and (13,10): mirror-symmetric, 7 tiles apart, so
agents engage after about three turns instead of spending credits walking.

Obstacles are mirror-symmetric about the centre line, and the horizontal
corridor the players start on is left open, so a match can reach contact
without pathfinding.

---

## A9 — Dodge is spatial, not a dice roll

**Spec:** Section 8 — "DODGE can avoid an incoming attack according to
deterministic game rules". It does not say which rules, and Section 8 forbids
randomness.

**Decision:** A DODGE moves the player one tile, like a MOVE. An incoming
attack is negated entirely if the dodge leaves the attacker's range, and
reduced by 25% if it does not. So dodging correctly is a question of geometry
the agent can actually reason about, and there is no hidden dice roll.

This also settles when range is checked. An ATTACK is _validated_ against the
state the agent saw, but _connects_ based on positions after movement resolves.
Without that, dodging could never work.

---

## A10 — Turn resolution order

**Spec:** Section 9 requires simultaneous, order-independent resolution.

**Decision:** Both actions are resolved against one frozen snapshot, in fixed
phases: validate, pay energy, resolve movement, resolve damage, regenerate
energy, check win condition. Because damage for both players is computed from
the same post-movement positions before either HP total is written, swapping A
and B in the input cannot change the output.

Movement conflicts are resolved symmetrically: if both players target the same
tile, neither moves.

---

## A11 — The observation carries a few derived facts

**Spec:** Section 10 gives a starting shape for `AgentObservation` and says
fog of war and friends come later.

**Decision:** The spec's fields are all present. Four things are added:

- `stateVersion`, because section 23 requires every decision to be tied to one
  and the agent has to have seen it.
- `self.id` / `enemy.id`, so an ATTACK can name a target without the agent
  guessing who it is.
- `legalMoveDirections` / `legalDodgeDirections`, computed by the real
  validator rather than a second copy of the rules. These become the option
  lists for Jev's direction questions, so an illegal direction is never even
  offered.
- `distanceToEnemy`, `attackRange`, `enemyInAttackRange`.

The last group matters for the model, not for us. A System One model should be
judging, not doing arithmetic; precomputing the distance removes a calculation
from a question that should only be about intent. `environment` also carries
`width`/`height`, since obstacles alone do not tell an agent where the walls
are.

Everything here is observed fact or arithmetic over observed fact. Enemy energy
is deliberately _not_ included.

---

## A12 — Mock decisions report no confidence

**Spec:** Section 15's illustrative `MockAgent` returns `{ action, confidence: 1 }`,
but the same section says the confidence structure "should not pretend to
represent real Jev confidence".

**Decision:** `AgentDecision.confidence` is optional and mock agents omit it.
A fabricated 1.0 would be indistinguishable from a genuinely certain model
answer in the HUD and in the analytics. `AgentDecision.origin` (`mock` |
`model` | `fallback`) says where the decision came from, so the UI can label it
honestly.

---

## A13 — Where the async match loop lives

**Spec:** Commit 4 is "mock agents"; commit 5 is the orchestrator.

**Decision:** Commit 4 ships the minimum async loop needed for `npm run simulate`
to exist at all: one snapshot, both agents asked through `Promise.all`, resolve
when both answer. Commit 5 layers on what the spec assigns to it — stale
rejection, timeouts, configurable fallbacks and decision traces — rather than
rewriting the loop.
