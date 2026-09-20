You are building a new project called **Jev Arena**: an experimental, highly visual AI-vs-AI tactical game powered by **TypeSafe AI's Jev model**.

Your job is to build this project incrementally, test-first, and in isolated commits. Do not jump directly into building the polished game. First prove that the TypeSafe/Jev integration works, determine whether API credits are required/available, establish the smallest possible end-to-end decision loop, and only then build the game on top of it.

## 0. IMPORTANT: USE THE TYPESAFE SKILL

Before doing any implementation, install and use the official TypeSafe skill.

If running in Claude Code, use:

```bash
claude plugin marketplace add typesafe-ai/skills
claude plugin install typesafe@typesafe-ai
```

If the environment is another coding agent, use:

```bash
npx skills add typesafe-ai/skills --skill typesafe-ai
```

Use exactly one installation method appropriate to the environment.

The canonical skill is:

```text
https://github.com/typesafe-ai/skills/blob/main/skills/typesafe-ai/SKILL.md
```

Raw version:

```text
https://raw.githubusercontent.com/typesafe-ai/skills/main/skills/typesafe-ai/SKILL.md
```

Read and follow the skill before implementing the TypeSafe integration.

The TypeSafe skill is authoritative for the TypeSafe/Jev programming model, but it explicitly says that the live TypeSafe documentation is the source of truth for current API contracts, SDK usage, models, limits, prompting guidance, and examples.

Therefore, before writing TypeSafe integration code, read the current relevant documentation, especially:

```text
https://docs.typesafe.ai/llms.txt
https://docs.typesafe.ai/api.md
https://docs.typesafe.ai/sdk/javascript.md
https://docs.typesafe.ai/concepts/state.md
https://docs.typesafe.ai/primitives.md
https://docs.typesafe.ai/primitives/choice.md
https://docs.typesafe.ai/confidence.md
https://docs.typesafe.ai/concepts/how-to-build-with-system-one.md
```

Also inspect the closest current cookbook/example for making a typed decision from application state.

Do NOT invent TypeSafe API methods, request formats, SDK methods, model names, authentication mechanisms, or response schemas. If the current documentation differs from assumptions in this prompt, follow the current documentation.

The relevant conceptual principles from the TypeSafe skill are:

* Jev is a System One model intended to provide focused, programmable judgments.
* Code should own the workflow.
* Jev should provide the semantic decision.
* Jev returns typed answers/probabilities rather than being treated like a conventional text-generation model.
* Keep deterministic rules, calculations, state transitions, validation, physics, and execution in code.
* Give each judgment enough relevant state to make the decision.
* Use narrow, coherent judgments.
* Use typed choices when selecting from a bounded action space.
* Use probabilities/confidence as reusable signals rather than treating them as proof of correctness.
* Preserve observed game state separately from inferred/model-generated state.
* Test representative cases and resulting application behavior.
* For failures, distinguish missing evidence, model errors, code errors, and service failures.
* Keep TypeSafe API credentials server-side.
* Measure actual latency, request budgets, cost, and end-to-end behavior.
* Do not assume example thresholds or demo behavior are universal.

---

# 1. PRODUCT VISION

Build a browser-based game where two autonomous AI agents compete inside a tactical arena.

The game should eventually look polished and cinematic, but the first implementation must be extremely small.

The conceptual loop is:

```text
                    GAME STATE
                        |
              +---------+---------+
              |                   |
              v                   v
          AGENT A              AGENT B
           (Jev)                (Jev)
              |                   |
              | typed decision    |
              | + probability     |
              v                   v
          ACTION A             ACTION B
              |                   |
              +---------+---------+
                        |
                        v
                 GAME ENGINE
                        |
                  deterministic
                    resolve
                        |
                        v
                   NEW STATE
                        |
                        +-----> next turn
```

The fundamental design principle is:

> **Jev decides what the agent wants to do. The game engine decides what actually happens.**

Never allow Jev to directly mutate game state.

Never allow an LLM/API response to bypass game rules.

The game engine must remain deterministic.

---

# 2. FIRST GOAL: JEV PLAYGROUND

Before building any game UI, build a tiny **Jev Playground**.

This is the most important first milestone.

The playground exists to answer:

1. Can we authenticate with TypeSafe?
2. Can we successfully call Jev?
3. Is the API key valid?
4. Does the current account require credits?
5. Are credits available?
6. What is the current API latency?
7. What is the exact current TypeSafe request/response format?
8. Can Jev produce a typed bounded decision from structured state?
9. What does the actual probability/confidence response look like?
10. Can we call Jev twice independently?
11. Can we run two decisions concurrently?
12. What happens when authentication, quota, credits, network, or validation fail?

Do not start the arena until this playground works.

The playground should be a simple CLI or minimal local web page.

Input:

```json
{
  "agent": {
    "hp": 80,
    "energy": 40,
    "position": {
      "x": 4,
      "y": 5
    }
  },
  "enemy": {
    "hp": 60,
    "position": {
      "x": 5,
      "y": 5
    }
  },
  "availableActions": [
    "ATTACK",
    "MOVE",
    "DEFEND",
    "DODGE"
  ]
}
```

The exact TypeSafe request must be implemented according to the current TypeSafe documentation, not guessed.

The desired conceptual output is:

```json
{
  "action": "ATTACK",
  "probability": 0.91
}
```

but the actual implementation must use the response shape documented by TypeSafe.

The playground should display:

```text
TypeSafe / Jev Playground

Authentication:      PASS
API connectivity:    PASS
Jev request:         PASS
Typed decision:      PASS
Probability:         available
Latency:             842 ms
Credits/quota:       <detected status>
```

If credits are unavailable, do not fake a successful integration.

Instead provide an extremely clear diagnostic:

```text
Jev request failed.

Category: BILLING / CREDIT / QUOTA
Message: <actual provider error>
```

The project must still have unit tests that can run without making real API calls.

---

# 3. DO NOT COMMIT API CREDENTIALS

Use environment variables.

For example:

```text
.env
```

must never be committed.

Provide:

```text
.env.example
```

with the required variables according to the current TypeSafe documentation.

Never hard-code an API key.

Never print the API key.

Never send the API key to the browser.

The TypeSafe integration must run server-side.

---

# 4. INITIAL TECH STACK

Use TypeScript throughout unless there is a compelling documented reason not to.

Preferred architecture:

```text
TypeScript
Node.js
```

Backend:

```text
Node.js + TypeScript
```

Frontend:

```text
React
```

For the visual game, prefer a lightweight browser game/rendering architecture.

Evaluate:

* Phaser for a 2D tactical arena
* Three.js / React Three Fiber for a more cinematic 3D/2.5D experience

For the initial implementation, choose the simplest option that can later support a polished visual presentation.

Do NOT introduce unnecessary infrastructure.

Do NOT add a database initially.

Do NOT add authentication.

Do NOT add multiplayer networking.

Do NOT add deployment infrastructure.

Do NOT add an elaborate ECS architecture.

First make the simulation work locally.

---

# 5. MONOREPO STRUCTURE

Use a clean structure similar to:

```text
jev-arena/
├── apps/
│   ├── server/
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── api/
│   │   │   ├── agents/
│   │   │   ├── game/
│   │   │   └── config/
│   │   └── tests/
│   │
│   └── web/
│       ├── src/
│       │   ├── components/
│       │   ├── game/
│       │   ├── hooks/
│       │   └── app/
│       └── tests/
│
├── packages/
│   ├── game-core/
│   │   ├── src/
│   │   │   ├── state.ts
│   │   │   ├── actions.ts
│   │   │   ├── rules.ts
│   │   │   ├── resolver.ts
│   │   │   ├── observations.ts
│   │   │   └── simulation.ts
│   │   └── tests/
│   │
│   ├── agent-core/
│   │   ├── src/
│   │   │   ├── agent.ts
│   │   │   ├── observation.ts
│   │   │   └── decision.ts
│   │   └── tests/
│   │
│   └── types/
│       └── src/
│
├── scripts/
│
├── .env.example
├── package.json
├── README.md
└── ...
```

Keep the game engine independent from the Jev implementation.

The game should be able to run entirely with fake/mock agents.

---

# 6. CORE DOMAIN MODEL

Define explicit types.

Conceptually:

```ts
type PlayerId = "A" | "B";

type Position = {
  x: number;
  y: number;
};
```

Game state should contain only authoritative game state.

For example:

```ts
interface GameState {
  turn: number;
  status: "running" | "finished";
  players: Record<PlayerId, PlayerState>;
  environment: EnvironmentState;
}
```

Player:

```ts
interface PlayerState {
  id: PlayerId;
  hp: number;
  energy: number;
  position: Position;
  cooldowns: Record<string, number>;
}
```

Do not prematurely over-engineer these types.

---

# 7. ACTION MODEL

Start with only four actions:

```text
MOVE
ATTACK
DEFEND
DODGE
```

The action should be structured.

Conceptually:

```ts
type Action =
  | {
      type: "MOVE";
      direction: Direction;
    }
  | {
      type: "ATTACK";
      target: PlayerId;
    }
  | {
      type: "DEFEND";
    }
  | {
      type: "DODGE";
      direction: Direction;
    };
```

The exact schema may be adjusted based on what TypeSafe's current typed-decision API supports most naturally.

Do not ask Jev to generate arbitrary code or arbitrary natural-language commands.

Use a bounded action space.

---

# 8. GAME ENGINE RULES

The first game should be extremely simple.

Arena:

```text
20 × 20 grid
```

Two players:

```text
A
B
```

Each has:

```text
HP
Energy
Position
```

Rules:

```text
MOVE
- moves one tile
- cannot leave arena
- cannot occupy an invalid blocked tile

ATTACK
- only works within attack range
- deals deterministic damage
- consumes energy

DEFEND
- reduces incoming damage for this turn

DODGE
- can avoid an incoming attack according to deterministic game rules
- consumes energy
```

Keep all of this deterministic.

No random behavior in the first version.

If randomness is introduced later, use a seeded deterministic RNG.

---

# 9. SIMULTANEOUS TURN MODEL

This is a central architectural requirement.

Do NOT run:

```text
A thinks
A acts
B thinks
B acts
```

Instead:

```text
STATE N
   |
   +---------> Agent A
   |
   +---------> Agent B
                  |
             both decide
                  |
             WAIT FOR BOTH
                  |
                  v
            VALIDATE ACTIONS
                  |
                  v
             RESOLVE ACTIONS
                  |
                  v
                STATE N+1
```

Both agents must receive the exact same logical snapshot for the same turn.

Each decision must reference a state/turn identifier.

Conceptually:

```ts
interface DecisionRequest {
  turn: number;
  stateVersion: number;
  observation: AgentObservation;
}
```

A decision generated for an old state must never be applied to a newer state.

This protects the system from stale asynchronous API responses.

---

# 10. OBSERVATION LAYER

Do not send raw `GameState` directly to Jev.

Create:

```ts
AgentObservation
```

This represents what an agent is allowed to know.

Initially:

```ts
interface AgentObservation {
  turn: number;

  self: {
    hp: number;
    energy: number;
    position: Position;
  };

  enemy: {
    hp: number;
    position: Position;
  };

  availableActions: ActionType[];

  environment: {
    obstacles: Position[];
  };
}
```

Later introduce:

```text
fog of war
hidden information
sound
last known enemy position
line of sight
```

The observation layer is important because eventually Agent A and Agent B should be able to receive different information.

---

# 11. JEV AGENT ABSTRACTION

Create an interface:

```ts
interface Agent {
  decide(
    observation: AgentObservation
  ): Promise<AgentDecision>;
}
```

The game engine should not know anything about TypeSafe.

Implement:

```text
MockAgent
JevAgent
```

Initially only `MockAgent` is used for most tests.

The Jev implementation should live behind an adapter.

Conceptually:

```text
Game Engine
     |
     v
Agent interface
     |
     +------ MockAgent
     |
     +------ JevAgent
```

This allows deterministic testing without API calls.

---

# 12. JEV DECISION DESIGN

Follow the TypeSafe skill closely.

Do not treat Jev like a conventional chat model.

The decision should be a bounded semantic judgment:

> Given the current observation and available actions, which action should the agent take?

The model should not be responsible for:

* calculating damage
* moving entities
* validating actions
* checking collision
* applying cooldowns
* determining victory
* changing HP
* maintaining authoritative state

The model decides.

Code executes.

Use the TypeSafe primitive/API that is currently recommended for a bounded choice.

If the current documentation recommends a different primitive or API shape, use it.

---

# 13. AGENT PERSONALITIES

Do not implement these initially.

Prepare the architecture so they can later exist as policy/configuration.

Examples:

```text
AGGRESSIVE
DEFENSIVE
TACTICAL
RISKY
```

Eventually the system prompt/instructions supplied to the decision primitive can differ.

But the first playground should use one simple policy.

Do not over-prompt.

The model should receive structured state and a narrow decision problem.

---

# 14. FIRST TEST SUITE

The project must be test-driven.

Use the project's chosen TypeScript testing framework, preferably Vitest unless another framework is already established.

Tests should exist before implementation whenever practical.

Start with pure tests.

### Test: movement

```text
given player at (5,5)
when MOVE_NORTH
then player becomes (5,4)
```

### Test: arena boundaries

```text
given player at (0,0)
when MOVE_WEST
then position remains (0,0)
```

### Test: attack range

```text
given players are adjacent
when A attacks B
then damage is applied
```

### Test: invalid attack

```text
given players are far apart
when A attacks B
then attack is rejected
```

### Test: simultaneous actions

```text
A attacks B
B dodges

resolve both simultaneously
```

### Test: state immutability

Ensure a resolution produces a new valid state and doesn't accidentally mutate the previous authoritative snapshot.

### Test: deterministic resolution

Same:

```text
state + actionA + actionB
```

must always produce the same result.

---

# 15. MOCK AGENT TESTING

Build a deterministic `MockAgent`.

Example:

```ts
class MockAgent implements Agent {
  constructor(private readonly action: Action) {}

  async decide(): Promise<AgentDecision> {
    return {
      action: this.action,
      confidence: 1
    };
  }
}
```

The exact confidence structure should follow the internal domain model and not pretend to represent real Jev confidence.

Tests:

```text
MockAgent A → ATTACK
MockAgent B → DODGE
```

Then assert the engine's result.

This means 95%+ of game-engine tests can run without TypeSafe API calls.

---

# 16. JEV INTEGRATION TESTS

Separate these from unit tests.

Have:

```text
unit tests
integration tests
live API tests
```

Live Jev tests should be explicitly opt-in, for example:

```bash
RUN_LIVE_JEV_TESTS=true npm test
```

or an equivalent mechanism.

Normal test execution must never require API credits.

The live integration test should:

1. Load the API key from environment.
2. Construct a minimal valid state.
3. Call Jev.
4. Validate the response against the expected typed shape.
5. Print latency.
6. Print provider/API error categories clearly.
7. Never expose credentials.
8. Exit successfully only when a valid decision was received.

If the account has no credits/quota, the test should report that accurately instead of failing with an opaque error.

---

# 17. CREDIT / BILLING PLAYGROUND

The playground must explicitly help determine whether the current TypeSafe account can actually execute Jev requests.

Add a command such as:

```bash
npm run jev:playground
```

It should:

```text
1. Validate configuration
2. Validate API key presence
3. Make one minimal Jev request
4. Measure latency
5. Parse the response
6. Print the decision
7. Print probability/confidence if available
8. Classify errors
```

Possible result:

```text
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       JEV PLAYGROUND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Configuration       ✓
Authentication      ✓
API Request         ✓
Typed Decision      ✓

Decision:
  ATTACK

Probability:
  0.91

Latency:
  742 ms

Credits:
  Request accepted
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

If billing/credits prevent the request:

```text
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       JEV PLAYGROUND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Configuration       ✓
Authentication      ✓
API Request         ✗

Provider response:
  <actual error>

Category:
  CREDIT / QUOTA / BILLING

The game implementation will remain usable with MockAgent.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Do not fabricate a "credits available" status if TypeSafe doesn't expose that information.

Only report what can actually be established from the API response/documentation.

---

# 18. OBSERVABILITY

Every decision should eventually be traceable.

Internally record:

```ts
interface DecisionTrace {
  turn: number;
  agentId: PlayerId;
  stateVersion: number;
  requestStartedAt: number;
  requestCompletedAt: number;
  latencyMs: number;
  action: Action;
  probability?: number;
  providerRequestId?: string;
  error?: string;
}
```

Do not store sensitive credentials.

Do not log raw secrets.

Do not log unnecessary full prompts in production.

For development, structured debug logs are acceptable.

---

# 19. FRONTEND ARCHITECTURE

Only build the frontend after the simulation and Jev playground work.

The frontend should eventually contain:

```text
                 JEV ARENA

┌──────────────────────────────────────────────┐
│                                              │
│                 GAME ARENA                   │
│                                              │
│        🤖 A                    🤖 B          │
│                                              │
│                  obstacles                   │
│                                              │
│                                              │
└──────────────────────────────────────────────┘

┌────────────────────┐   ┌────────────────────┐
│      AGENT A       │   │      AGENT B       │
│                    │   │                    │
│ HP ████████░       │   │ HP ██████░░        │
│ ENERGY █████░      │   │ ENERGY ████░        │
│                    │   │                    │
│ Decision: ATTACK   │   │ Decision: DODGE    │
│ Probability: 91%   │   │ Probability: 83%   │
└────────────────────┘   └────────────────────┘

                  TURN 42
```

Do not expose raw API internals to users.

Expose the meaningful game-level information.

---

# 20. VISUAL DESIGN

The final game should feel like a polished futuristic AI arena rather than a developer dashboard.

Visual direction:

* dark futuristic arena
* strong silhouettes
* readable characters
* subtle neon/high-tech aesthetic
* clean HUD
* satisfying attack animations
* movement trails
* shields
* hit effects
* camera movement
* clear AI decision visualization

Do not make the UI visually noisy.

The arena itself should remain the primary focus.

The AI panels should provide context without overwhelming the game.

---

# 21. GAMEPLAY LOOP

Final target:

```text
MATCH START
    ↓
INITIAL STATE
    ↓
OBSERVATION GENERATION
    ↓
JEV A + JEV B CALLED IN PARALLEL
    ↓
DECISIONS RETURN
    ↓
VALIDATE
    ↓
SHOW DECISIONS
    ↓
SIMULTANEOUS RESOLUTION
    ↓
ANIMATE RESULT
    ↓
NEW STATE
    ↓
CHECK WIN CONDITION
    ↓
REPEAT
```

Never allow rendering speed to determine game state.

Never wait on browser animation to determine authoritative simulation state.

The simulation must be independent from the visual layer.

---

# 22. LATENCY HANDLING

Jev/API latency is expected.

The game must not freeze while waiting for the API.

Use:

```text
Game state N
       ↓
"Agents deciding..."
       ↓
A request ──────┐
                │
B request ──────┤
                │
                ↓
         Both responses
                ↓
             Resolve
```

The two requests should be launched concurrently.

Do not sequentially wait for Agent A before requesting Agent B.

Add a configurable timeout.

For example:

```text
decisionTimeoutMs
```

Do not hard-code a timeout without measuring actual behavior.

If an agent times out, implement a deterministic fallback policy.

For example:

```text
TIMEOUT → DEFEND
```

The fallback should be configurable.

A timeout should never corrupt the game state.

---

# 23. STALE DECISION PROTECTION

Every decision should be tied to:

```text
turn
stateVersion
agentId
```

Before applying a decision:

```ts
if (decision.stateVersion !== currentState.version) {
  rejectAsStale(decision);
}
```

Never apply a decision produced for an outdated state.

This is especially important because API calls are asynchronous.

---

# 24. REPLAY SYSTEM

After the basic game works, implement a replay log.

Every turn records:

```text
state before
observation A
observation B
decision A
decision B
resolution
state after
```

The replay should be deterministic.

This allows:

```bash
npm run replay <match>
```

or equivalent functionality.

The browser should eventually be able to replay a completed match without calling Jev again.

This is important because replay must not incur API costs.

---

# 25. NO API CALLS DURING REPLAY

A replay contains all decisions required to reconstruct the match.

Therefore:

```text
LIVE MATCH
    Jev → decisions → record

REPLAY
    recorded decisions → game engine
```

not:

```text
REPLAY
    → call Jev again
```

This also guarantees that the replay is identical to the original.

---

# 26. GAME BALANCE

Do not optimize for model performance initially.

Build a neutral game.

The first version should avoid hidden advantages.

Both agents should:

* receive equivalent information
* receive decisions for the same state
* have identical capabilities
* have the same action space
* act simultaneously

Only later introduce asymmetric abilities.

---

# 27. FIRST-MOVER ADVANTAGE EXPERIMENT

After the base game works, explicitly test first-mover bias.

Run many simulated games.

Compare:

```text
A starts first
vs
B starts first
```

But because actions are simultaneous, the expected architecture should minimize this issue.

Also test:

```text
Jev A latency = 500ms
Jev B latency = 2000ms
```

and ensure latency does not change the turn order.

The engine must wait for both decisions before resolving the turn.

Record:

```text
match id
winner
turn count
average decision latency
agent A latency
agent B latency
```

Do not draw conclusions from a handful of matches.

Build the instrumentation first.

---

# 28. TESTING PYRAMID

Maintain this hierarchy:

```text
                    E2E
                   /   \
              Integration
             /           \
          Simulation    Jev API
         /                   \
      Unit Tests          Contract Tests
```

Most tests should be pure unit/simulation tests.

Very few tests should make real Jev calls.

E2E tests should be minimal.

---

# 29. REQUIRED TEST CATEGORIES

Implement tests for:

### Domain

* state creation
* state validation
* action validation
* movement
* attack
* defense
* dodge
* win conditions

### Simulation

* simultaneous actions
* conflicting actions
* invalid actions
* deterministic resolution
* turn advancement
* stale decisions
* timeouts
* fallback actions

### Observation

* correct self state
* correct enemy state
* available actions
* later: fog of war

### Agent

* MockAgent
* JevAgent response parsing
* malformed response
* provider error
* timeout
* retry behavior if supported/appropriate

### API

* authentication error
* credit/quota error
* malformed response
* successful response
* latency measurement

### Frontend

* game state rendering
* action animation
* health updates
* decision panel
* match completion
* replay

---

# 30. COMMIT STRATEGY

Work in small isolated commits.

Do NOT create one giant commit.

Each commit must:

1. Have one clear purpose.
2. Include tests.
3. Keep the project runnable.
4. Avoid unrelated refactors.
5. Have a concise commit message.
6. Explain what was implemented.
7. Explain how it was tested.

Use commit messages like:

```text
chore: initialize typescript workspace
test: define game state invariants
feat: add deterministic arena state
feat: add action validation
feat: add simultaneous action resolver
feat: add mock agent
feat: add typesafe playground
feat: add jev agent adapter
test: add live jev integration test
feat: add match orchestrator
feat: add websocket game stream
feat: add arena renderer
feat: add agent decision HUD
feat: add replay system
feat: add fog of war
```

---

# 31. EXACT IMPLEMENTATION ORDER

Follow this order.

## Commit 1 — Repository bootstrap

Create:

* TypeScript project
* package manager configuration
* workspace structure
* linting
* formatting
* test framework
* `.gitignore`
* `.env.example`
* README

Acceptance:

```bash
npm install
npm test
npm run build
```

all work.

No game code yet.

---

## Commit 2 — Game domain types

Implement:

* PlayerId
* Position
* PlayerState
* GameState
* Action types
* Game configuration

Write tests first.

Acceptance:

```text
All domain invariants are tested.
```

---

## Commit 3 — Deterministic game engine

Implement:

* initial state
* movement
* attack
* defense
* dodge
* validation
* deterministic resolution

No Jev.

No network.

No UI.

Write tests before implementation.

Acceptance:

```text
A complete match can run entirely in memory.
```

---

## Commit 4 — Mock agents

Implement:

```text
Agent interface
MockAgent
```

Create a simple simulation:

```text
MockAgent A
vs
MockAgent B
```

Acceptance:

```bash
npm test
```

and:

```bash
npm run simulate
```

produces a complete match.

---

## Commit 5 — Simultaneous decision orchestrator

Implement:

```text
Game state
    ↓
observation
    ↓
Promise.all(agent decisions)
    ↓
validation
    ↓
resolution
```

Add tests proving both agents receive the same state version.

Add stale decision protection.

Add timeout handling.

Acceptance:

```text
Artificially delay Agent A.
Artificially delay Agent B.

Verify turn resolution does not depend on who responds first.
```

---

# 32. COMMIT 6 — TYPESAFE/JEV PLAYGROUND

This is the most important integration checkpoint.

Before connecting it to the game:

1. Read the current TypeSafe docs.
2. Read the current JavaScript SDK documentation.
3. Read the current relevant primitive documentation.
4. Read the relevant cookbook.
5. Implement the smallest possible Jev request.
6. Verify authentication.
7. Verify the request succeeds.
8. Determine whether credits/quota permit execution.
9. Record actual latency.
10. Parse the typed result.
11. Write tests around the adapter.

Create:

```bash
npm run jev:playground
```

Acceptance:

```text
A developer can run one command and determine whether
their TypeSafe/Jev setup works.
```

This commit should NOT yet modify the game.

---

# 33. COMMIT 7 — JevAgent adapter

Implement:

```text
JevAgent implements Agent
```

Responsibilities:

* convert `AgentObservation` into TypeSafe state
* construct the narrow decision
* call Jev
* parse typed output
* map result to internal `AgentDecision`
* expose latency
* preserve probability/confidence if available
* classify provider errors

Do not put game rules inside `JevAgent`.

Acceptance:

```text
JevAgent can produce a valid Action.
```

---

# 34. COMMIT 8 — JEV vs JEV CLI MATCH

Connect:

```text
JevAgent A
JevAgent B
```

to:

```text
Game Engine
```

Run a complete match from the terminal.

Output:

```text
Turn 1
A → MOVE
B → SCAN

Turn 2
A → ATTACK
B → DODGE

...

Winner: A
```

Also print:

```text
latency
probability/confidence where available
```

Do not build the visual interface yet.

Acceptance:

```bash
npm run match
```

runs an entire real Jev-vs-Jev match when valid API access is available.

---

# 35. COMMIT 9 — Match recording and replay

Record every turn.

Implement replay without Jev.

Tests must prove:

```text
original match
==
replayed match
```

Acceptance:

```text
A completed match can be replayed without any API calls.
```

---

# 36. COMMIT 10 — Backend API

Expose the simulation to the frontend.

Use WebSocket or another suitable real-time mechanism.

Events should be explicit.

Conceptually:

```text
MATCH_STARTED
STATE_UPDATED
AGENTS_THINKING
DECISIONS_READY
TURN_RESOLVED
MATCH_FINISHED
```

Do not expose provider-specific implementation details.

---

# 37. COMMIT 11 — Minimal frontend

Create the simplest playable visualization.

Show:

* arena
* A
* B
* HP
* turn
* basic movement
* basic attacks

Do not worry about visual polish yet.

Acceptance:

```text
A real Jev-vs-Jev match is visible in the browser.
```

---

# 38. COMMIT 12 — Decision visualization

Add:

```text
Agent A
Decision
Probability/confidence
Latency

Agent B
Decision
Probability/confidence
Latency
```

Add a "thinking" state while requests are pending.

The UI should clearly communicate that both agents are deciding from the same state.

---

# 39. COMMIT 13 — Visual polish

Now make the game beautiful.

Add:

* character designs
* arena environment
* animations
* attack effects
* dodge effects
* shields
* camera movement
* HUD
* transitions
* sound only if useful
* responsive layout

Do not modify game logic while doing visual polish unless necessary.

---

# 40. COMMIT 14 — Fog of war

Introduce agent-specific observations.

Agent A should not necessarily know everything Agent B knows.

Add:

```text
line of sight
hidden positions
last known position
scan
```

Update Jev observations accordingly.

Add tests proving:

```text
hidden enemy information is not passed to Jev.
```

---

# 41. COMMIT 15 — Strategy profiles

Add configurable strategy profiles:

```text
Aggressive
Defensive
Tactical
```

Keep the actual game mechanics unchanged.

The profile should affect the decision instructions/configuration supplied to Jev.

Add a UI selector.

---

# 42. COMMIT 16 — Match analytics

Record:

```text
winner
turns
decision count
average latency
A latency
B latency
action distribution
probability/confidence distribution
timeouts
fallback actions
```

Display a post-match summary.

Do not call this an evaluation of model intelligence unless the experiment actually supports that conclusion.

It is simply match telemetry.

---

# 43. COMMIT 17 — First-mover/latency experiment

Create a deterministic experiment runner.

Run many matches with controlled conditions.

Compare:

```text
A/B assignment
latency distributions
starting positions
strategies
```

Make the simulation reproducible.

Do not manually inspect a few matches and declare that one configuration is better.

Collect data.

---

# 44. COMMIT 18 — Replay viewer

Build a polished replay interface.

Features:

```text
Play
Pause
Step forward
Step backward
Timeline
Turn number
Agent decisions
Game state
```

The replay must use stored decisions and never call Jev.

---

# 45. COMMIT 19 — Demo mode

Create a one-click demo.

The audience should be able to open the application and immediately see:

```text
JEV ARENA

Jev Agent A
vs
Jev Agent B

START MATCH
```

The demo should explain the concept visually:

```text
OBSERVE
   ↓
JEV DECIDES
   ↓
ACTION
   ↓
GAME ENGINE
   ↓
RESULT
```

Keep the demo understandable without reading documentation.

---

# 46. ERROR HANDLING

Every external failure must have a clear category.

At minimum:

```text
CONFIGURATION_ERROR
AUTHENTICATION_ERROR
CREDIT_ERROR
QUOTA_ERROR
RATE_LIMIT_ERROR
TIMEOUT_ERROR
NETWORK_ERROR
INVALID_RESPONSE
STALE_DECISION
INVALID_ACTION
INTERNAL_GAME_ERROR
```

Do not hide errors behind generic:

```text
Something went wrong.
```

For provider errors, preserve the actual provider message where safe.

Never expose secrets.

---

# 47. RETRY POLICY

Do not blindly retry every TypeSafe error.

Only retry errors where the current TypeSafe documentation indicates retrying is appropriate.

Never retry a deterministic invalid request indefinitely.

Do not duplicate a game turn.

Every decision should have a unique request/turn identity where practical.

---

# 48. PERFORMANCE REQUIREMENTS

The rendering layer should be capable of smooth animation independently from AI request latency.

Do not block the browser rendering thread waiting for Jev.

The simulation should be event-driven.

The AI decision loop should be asynchronous.

Do not call Jev every animation frame.

One turn should correspond to one decision cycle.

---

# 49. COST CONTROL

API usage must be consciously designed.

Never call Jev at 60 FPS.

Never call Jev once per rendered frame.

Never call Jev repeatedly just to animate something.

One meaningful decision should produce one API call per agent unless the current TypeSafe architecture/documentation provides a more efficient mechanism.

Make it possible to run the entire game with:

```text
MockAgent
```

for development.

Add a configuration:

```text
AGENT_MODE=mock
```

and:

```text
AGENT_MODE=jev
```

or an equivalent clean architecture.

This allows frontend development without consuming API credits.

---

# 50. SECURITY

API keys must remain server-side.

The browser must never receive:

```text
TYPESAFE_API_KEY
```

or equivalent credentials.

The backend should expose only game-level operations.

Validate every action before applying it.

Never trust client-provided game state.

The authoritative game state exists on the server/game engine.

---

# 51. DEVELOPER EXPERIENCE

The README should eventually provide:

```text
1. Install dependencies
2. Configure environment
3. Run tests
4. Run mock match
5. Run Jev playground
6. Run Jev match
7. Start development server
8. Start frontend
```

Example:

```bash
npm install

cp .env.example .env

npm test

npm run simulate

npm run jev:playground

npm run match

npm run dev
```

Use the actual scripts that are implemented.

Do not document commands that do not exist.

---

# 52. DEVELOPMENT RULES

Follow these rules throughout implementation:

1. **Do not skip the playground.**
2. **Do not start with the frontend.**
3. **Do not invent TypeSafe APIs.**
4. **Always read the current TypeSafe docs before integration work.**
5. **Use the TypeSafe skill.**
6. **Keep Jev behind an adapter.**
7. **Keep the game engine deterministic.**
8. **Use simultaneous decisions.**
9. **Never let Jev mutate game state directly.**
10. **Keep API credentials server-side.**
11. **Use mocks for most tests.**
12. **Keep live API tests opt-in.**
13. **Record latency.**
14. **Handle credit/quota failures explicitly.**
15. **Do not burn API credits during normal unit testing.**
16. **Commit isolated changes.**
17. **Do not perform unrelated refactors inside feature commits.**
18. **Run tests before every commit.**
19. **Do not proceed to the next major milestone if the current acceptance criteria are failing.**
20. **When an assumption about TypeSafe conflicts with current documentation, the documentation wins.**

---

# 53. DEFINITION OF DONE FOR THE MVP

The first real MVP is NOT the polished game.

The MVP is:

```text
                    JEV ARENA MVP

             ┌──────────────────┐
             │   Game Engine    │
             │   deterministic  │
             └────────┬─────────┘
                      │
             ┌────────┴────────┐
             ▼                 ▼
          Jev Agent A       Jev Agent B
             │                 │
             └────────┬────────┘
                      │
                simultaneous
                  decisions
                      │
                      ▼
                   resolve
                      │
                      ▼
                  next turn
```

And the following must work:

```text
✓ TypeSafe skill installed/read
✓ Current TypeSafe docs consulted
✓ Jev playground works
✓ API authentication works
✓ Credit/quota status is observable through actual provider behavior
✓ Jev produces typed decisions
✓ Mock agents work without API access
✓ Game engine is deterministic
✓ Both agents decide concurrently
✓ Stale decisions are rejected
✓ Invalid actions are rejected
✓ Timeouts have deterministic fallback behavior
✓ Complete Jev-vs-Jev match can run
✓ Match can be replayed without API calls
✓ Tests pass
```

Only after this is stable should visual polish become the priority.

---

# 54. FINAL PRODUCT DIRECTION

The final experience should feel like:

> **Two autonomous AI systems entering a tactical arena and making live decisions against each other.**

The audience should be able to see:

```text
WORLD STATE
     ↓
OBSERVATION
     ↓
JEV
     ↓
TYPED DECISION
     ↓
PROBABILITY
     ↓
ACTION
     ↓
GAME ENGINE
     ↓
CONSEQUENCE
     ↓
NEW WORLD STATE
```

The game itself should be visually impressive, but the technical story should remain obvious.

The key differentiator is not:

> "We made a game that uses an AI API."

The differentiator is:

> **"We built a deterministic game world and gave autonomous Jev agents a structured decision-making interface into that world. Two agents independently observe the same evolving environment, make simultaneous typed decisions, and the game engine turns those decisions into consequences."**

Build toward that.

Start with the playground.

Do not build anything else until the playground proves that the Jev API integration works and the project can clearly distinguish successful inference from authentication, credit/quota, network, and response failures.

Then proceed one commit at a time.
