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

---

## A14 — There is no default decision timeout

**Spec:** Section 22 asks for a configurable `decisionTimeoutMs` and says
explicitly: "Do not hard-code a timeout without measuring actual behavior."

**Decision:** `decisionTimeoutMs` defaults to `undefined`, meaning wait
indefinitely. That is correct for local agents, and for live runs it forces
the value to be supplied by a caller who has measured. A number will be
chosen once the playground reports real Jev latency, and it will be recorded
here with the measurement that justified it.

The fallback is `DEFEND` by default and is configurable, per section 22.

---

## A15 — Two extra error categories

**Spec:** Section 46 lists eleven categories.

**Decision:** All eleven exist. `PROVIDER_ERROR` is added as the landing spot
for a provider failure we have not classified, so that an unrecognised throw
is still categorised rather than silently becoming something it is not.

`isRetryableCategory` treats only `RATE_LIMIT_ERROR` and `NETWORK_ERROR` as
retryable, following the TypeSafe docs: 429 and 529 are the documented
retry-with-backoff cases. Retrying a bad key or a malformed request is just a
slower way to fail.

---

## A16 — Structural validity vs game legality

**Spec:** Sections 11 and 46 both touch on bad agent output without drawing
the line.

**Decision:** Two different checks, in two different places.

- The orchestrator rejects _structurally_ invalid output: something that is
  not an `Action` at all, such as `{ type: "TELEPORT" }`. That is an
  `INVALID_RESPONSE` and the agent gets the fallback.
- The engine rejects _illegal_ actions: a well-formed ATTACK from out of
  range. That is not a failure. It is a legitimate thing for an agent to
  attempt, it is recorded as a game-level rejection, and it collapses to
  DEFEND.

Conflating them would either let malformed data reach the engine or would
report an ordinary tactical mistake as a provider error.

---

## A17 — Everything sits behind one gateway interface

**Spec:** Sections 11 and 33 require Jev to live behind an adapter.

**Decision:** `apps/server/src/typesafe/gateway.ts` is the only file in the
repository that imports `@typesafe-ai/sdk`. Everything above it depends on the
`JevGateway` interface.

The practical payoff is testing. Every test above that line runs against a
fake gateway rather than mocked HTTP, which is why the default `npm test` run
cannot spend a credit even by accident.

---

## A18 — Authentication is probed with `GET /v1/models`

**Spec:** Section 17 wants authentication checked separately from the Jev
request.

**Decision:** The playground calls `client.models.list()` first. It proves the
key works without spending input tokens, and it cleanly separates "your key is
wrong" from "your key is fine but the request failed".

---

## A19 — What the playground will and will not say about credit

**Spec:** Section 17 — "Do not fabricate a 'credits available' status if
TypeSafe doesn't expose that information."

**Decision:** TypeSafe publishes no balance endpoint, so the playground never
reports one. It reports exactly three states, each backed by evidence:

- **accepted** — a request went through and was metered. It quotes the actual
  input-token count from `usage` and says outright that a remaining balance
  cannot be reported.
- **blocked** — the provider refused for a billing or quota reason, quoting
  the provider's own message.
- **unknown** — nothing reached the model, so nothing can be established.

---

## A20 — Status-code-driven error classification

**Spec:** Section 46 requires a category for every external failure.

**Decision:** Classification keys off the HTTP status rather than the SDK's
error subclass, so the mapping lives in one readable table and stays correct
if the SDK adds a subclass. Two refinements beyond the status code:

- A `429` whose body talks about a quota or a balance is a `QUOTA_ERROR` or
  `CREDIT_ERROR`, not a `RATE_LIMIT_ERROR`. Backing off does not refill an
  allowance, so getting this wrong means retrying forever.
- `400` and `422` map to `CONFIGURATION_ERROR` with a message saying plainly
  that it is a bug on our side. The spec's category list has no
  "invalid request" entry, and calling it an authentication or credit problem
  would send a developer hunting in the wrong place.

---

## A21 — The playground checks concurrency by default

**Spec:** Section 2 asks "Can we run two decisions concurrently?" among the
questions the playground exists to answer.

**Decision:** It does, by firing two requests at once. That is two extra small
requests; `--minimal` skips them. A match depends on this working, so it is
worth proving before the match is built.

---

## A22 — Vercel config (a knowing deviation from section 4)

**Spec:** Section 4 says "Do NOT add deployment infrastructure."

**What happened:** A Vercel project was connected to the repository outside
of this plan. It ran `npm run build`, which is a typecheck and emits nothing,
then failed looking for an output directory. Every push now fails.

**Decision:** Add the minimum to make that stop, and record it as a deviation
rather than pretending it is in scope.

- `vercel.json` pins `buildCommand` to `npm run build` and `outputDirectory`
  to `public`. Keeping the real build as the build command means a broken
  typecheck still fails the deploy, so this is a small CI gate rather than
  dead weight.
- `public/index.html` is a single dependency-free page. It states plainly
  that there is no playable build yet, and sets the visual direction section
  20 asks for (dark, neon, strong silhouettes, clean type).

The ordering the spec cares about is untouched: no frontend framework, no
`apps/web`, no game code on the client. At spec commit 11 the real Vite app
lands and this becomes `outputDirectory: "apps/web/dist"`, with the
placeholder deleted.

`tests/repository.test.ts` now asserts the build command is a real script and
the output directory exists, so this class of failure is caught by `npm test`
instead of by a failed deploy.

**Superseded by A23:** the placeholder is gone; `apps/web` is the real output.

---

## A23 — Frontend built early, and where the authoritative state lives

**Spec:** Section 19 and rule 2 of section 52 put the frontend last, after
commits 9 and 10. Section 50 says the authoritative game state exists on the
server and the client is never trusted.

**What happened:** A playable deployed build was requested directly.

**Decision on ordering:** `apps/web` is built now, out of order. The two
things the spec was protecting against have already happened, so the risk it
was guarding is spent: the simulation works and is covered by 280+ tests, and
the Jev integration exists behind an adapter with a playground to prove it.
The frontend is a renderer over an engine that was finished first, which is
the outcome the ordering rule wanted. Commits 9 (replay) and 10 (streaming
API) are still outstanding and come next.

**Decision on authority:** the engine runs in the browser, and
`/api/decide` is a stateless translator: observation in, typed decision out.
It holds no match state.

This is a genuine deviation from "the authoritative game state exists on the
server", and the reason is that the alternatives are worse here. Holding
server-side match state needs either a database (section 4 forbids one) or
round-tripping the whole state through the client (which section 50 forbids
trusting). Vercel functions are stateless by nature.

What the deviation does _not_ cost:

- The API key never reaches the browser. That is the part of section 50 that
  actually matters, and it is enforced by tests asserting the web bundle
  contains no SDK import, no key reference and no provider URL.
- Jev still cannot mutate state. `/api/decide` returns an _intention_; the
  engine in the tab validates it exactly like a local agent's, and rejects it
  if the rules say so. The endpoint cannot produce an illegal move because it
  does not decide legality.
- Determinism is untouched. The engine is the same package the CLI and the
  tests use.

What it does cost: a user who tampers with their own client can mislead only
themselves. There is no multiplayer, no persistence, no score and no
adversary, so there is nothing to gain by it. If any of those change, the
authoritative loop moves server-side behind the section 10 streaming API.

**Decision on rendering:** a 2D canvas, drawn on `requestAnimationFrame` and
interpolating between the turn's before and after snapshots. Section 21 says
rendering speed must never determine game state: the orchestrator resolves a
turn as fast as the agents allow, and the UI then spends a fixed wall-clock
budget animating it. The renderer only ever reads state.

---

## A24 — The serverless functions are bundled, not traced

**Context:** two production outages in a row, both from the same root cause,
both invisible locally.

1. `FUNCTION_INVOCATION_FAILED`. A3 has workspace packages export
   `./src/index.ts`. Vite and Vitest resolve that happily; Node throws
   `ERR_UNKNOWN_FILE_EXTENSION`, because it cannot execute TypeScript.
2. A non-JSON `HTTP 500`. Vercel does not bundle a function's dependencies,
   it traces the import graph and copies what it thinks is needed. With npm
   workspaces those are symlinks into the repo, and whether the right files
   land in the lambda depends on resolution behaviour we cannot see, cannot
   test, and only learn about from production.

**Decision:** stop relying on tracing. `scripts/build-vercel.ts` emits the
documented **Build Output API** layout, and bundles each handler into a
single self-contained file with no imports left to resolve except Node
builtins. Nothing is traced, so nothing can be missed.

Consequences:

- Handlers live in `apps/server/src/api/`, matching the tree in section 5.
  There is no top-level `api/`, so Vercel's zero-config detection cannot
  produce a second, competing definition of the same route. A test asserts
  the directory stays absent.
- `vercel.json` no longer sets `outputDirectory` or `functions`; both would
  conflict with `.vercel/output`. A test asserts they stay unset.
- An unmatched `/api/*` returns a JSON 404 rather than the SPA shell.
  Serving HTML to a `fetch()` is what turned the second failure into a
  confusing "non-JSON response" instead of a clear status.

**The real lesson, and the actual fix:** both outages shipped because the
functions were verified by _building_ them. Building proves the code
compiles. Only running proves it loads. So there are now two commands that
run the built artifacts:

- `npm run verify:functions` loads each bundle out of `.vercel/output` and
  invokes it, asserting that no key yields a classified JSON 503 and a bad
  key yields a classified JSON 401 from the real provider.
- `npm run serve:output` serves the whole deployment over HTTP with Vercel's
  routing, so the deployed behaviour can be curl-ed before deploying. Unlike
  `vercel dev` it needs no account, login or project link.
