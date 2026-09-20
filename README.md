# Jev Arena

An experimental AI-vs-AI tactical arena.

Two autonomous agents observe the same evolving world, make **simultaneous typed
decisions** through TypeSafe's [Jev](https://docs.typesafe.ai) System One model,
and a **deterministic game engine** turns those decisions into consequences.

The guiding principle:

> **Jev decides what an agent wants to do. The game engine decides what actually happens.**

Jev never mutates game state. The engine never calls an LLM. They meet at a
narrow, typed interface.

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

## Status

Early. Built one small, isolated commit at a time. See `spec.md` for the full
plan and `docs/ASSUMPTIONS.md` for every decision that goes beyond the spec.

| Milestone                          | State |
| ---------------------------------- | ----- |
| Repository bootstrap               | done  |
| Game domain types                  | done  |
| Deterministic game engine          | done  |
| Mock agents                        | done  |
| Simultaneous decision orchestrator | done  |
| Jev playground                     | done  |
| JevAgent adapter                   | done  |
| Jev-vs-Jev CLI match               | done  |
| Playable web arena                 | done  |
| Recording and replay               | todo  |
| Fog of war, analytics, polish      | todo  |

## Requirements

- Node.js **20.19+** (see `.nvmrc`)
- npm 10+

## Getting started

```bash
npm install

cp .env.example .env   # then fill in TYPESAFE_API_KEY when you have one

npm test
npm run lint
npm run build

npm run dev             # open http://localhost:5173 and press Start
```

That's the whole setup for the playable version. **No API key needed** — it
opens in Local agents mode, which is deterministic, instant and free.

To watch real Jev agents fight, see [Playing with Jev agents](#playing-with-jev-agents).

`npm test`, `npm run lint` and `npm run build` never touch the network and never
spend TypeSafe credits.

## Repository layout

```text
jev-arena/
├── apps/          # runnable applications (server, web)
├── packages/      # reusable libraries (types, game-core, agent-core)
├── scripts/       # developer CLIs
├── tests/         # repository-level guard tests
├── public/        # placeholder status page (replaced by the real app later)
├── .env.example   # required environment variables
└── spec.md        # the product specification this repo implements
```

`packages/` stays free of any TypeSafe dependency. The whole game must be
runnable with mock agents and no API access.

## Credentials

The TypeSafe API key lives in `.env`, is read **server-side only**, and is never
logged, printed, bundled, or sent to the browser. `.env` is git-ignored;
`.env.example` documents the variables and is safe to commit.

## Available scripts

| Script                   | What it does                                            |
| ------------------------ | ------------------------------------------------------- |
| `npm test`               | Runs the offline test suite                             |
| `npm run simulate`       | Plays a full local match and prints it. No API calls    |
| `npm run dev`            | Starts the playable web arena on :5173                  |
| `npm run jev:playground` | Verifies your TypeSafe/Jev setup end to end             |
| `npm run match`          | Plays a full Jev-vs-Jev match in the terminal           |
| `npm run test:watch`     | Runs the test suite in watch mode                       |
| `npm run test:live`      | Also runs the opt-in live TypeSafe API tests            |
| `npm run typecheck`      | Typechecks every workspace                              |
| `npm run build`          | Builds the project (today: a whole-workspace typecheck) |
| `npm run lint`           | ESLint over the repository                              |
| `npm run format`         | Prettier, write mode                                    |
| `npm run format:check`   | Prettier, check mode                                    |

`npm run simulate passive` plays two agents that only defend, which is a quick
way to check the turn limit. `--quiet` skips the per-turn output.
`npm run match -- --mock --turns=5` is a short, free version of the match CLI.

## How the fight works

Four actions — **MOVE**, **ATTACK**, **DEFEND**, **DODGE** — on a 20×20 grid,
resolved simultaneously. Three things make position matter:

**Cover.** An obstacle between two agents blocks the shot. Being in range is
not the same as having a shot, so "step out for an angle" is a real decision.
The arena draws a solid line between the agents when the shot is available and
a broken one when it is not.

**Power nodes.** Four tiles restore a large chunk of energy to whoever ends a
turn on them. Energy regenerates slower than attacking spends it, so a node is
worth a detour — and worth denying.

**Overcharge.** Every turn you _don't_ attack, you store a point of charge —
up to three — and your next hit lands far harder (16 damage becomes 34). Your
robot visibly puffs up and its antenna lights, and **your opponent can see
it**. A wound-up enemy is a telegraphed threat, which turns DEFEND and DODGE
into reads rather than guesses.

**Strategy profiles.** Aggressive, Defensive, Tactical or Neutral. A profile
changes what an agent _wants_, never what it is allowed to do, so the fight
stays fair. Pick one per agent in the UI.

Profiles matter more than they sound. Two agents with identical instructions
reach identical conclusions from identical state and mirror each other into an
exact draw — a good proof that the engine is neutral, and a dull thing to
watch. Give them different instructions and you get a fight:

```text
A (aggressive) → ATTACK    confidence 1.00
B (defensive)  → DODGE     confidence 0.33
```

That confidence gap is the whole point of the project in one line. The
aggressive agent is certain. The defensive one is genuinely torn, and says so
with a number you can act on.

## Playing the game

```bash
npm run dev
```

Open <http://localhost:5173>.

- **Start** runs the match. **Pause** stops between turns, **Step** plays
  exactly one turn, **Reset** starts over.
- **Speed** changes only how long each turn is animated. It cannot change the
  outcome — the simulation and the renderer are independent.
- **Replay** scrubs back through turns already played. It reads recorded
  decisions and never re-asks an agent, so scrubbing costs nothing.
- The side panels show each agent's decision, the probability distribution it
  chose from, its confidence, the measured latency, and a profile selector.

Reading the arena:

| On screen            | Means                                                  |
| -------------------- | ------------------------------------------------------ |
| Tinted floor         | That agent's attack reach. Standing in it is dangerous |
| Solid green line     | Clear shot between the agents                          |
| Broken red line      | Cover is blocking the shot                             |
| Amber diamonds       | Power nodes                                            |
| Ring around an agent | Remaining HP                                           |
| Arc facing the enemy | DEFEND, absorbing the hit                              |
| Trail of ghosts      | MOVE or DODGE                                          |

### Playing with Jev agents

Local mode needs nothing. For real Jev agents you need a key and a running
function to hold it, because the key must never reach the browser.

```bash
cp .env.example .env          # paste your key into TYPESAFE_API_KEY=
npm i -g vercel               # once
vercel dev                    # serves the app and /api/decide together
```

Then open the URL `vercel dev` prints and switch to **Jev agents**.

Plain `npm run dev` also works for Jev mode as long as `vercel dev` is running
on port 3000; Vite proxies `/api` to it.

Cost: two Jev requests per turn, one per agent. A full match is at most 120.

## Deployment

The app deploys to Vercel as a static build plus one serverless function.

- `apps/web` builds to `apps/web/dist` and is served as static files.
- `api/decide.ts` is the only thing that talks to TypeSafe.

To enable Jev mode on a deployment, add `TYPESAFE_API_KEY` in **Vercel →
Project → Settings → Environment Variables** and redeploy. Without it the
site still works: Local agents mode is fully playable, and Jev mode reports a
clear `CONFIGURATION_ERROR` instead of failing silently.

The browser never receives the key. There is a test asserting the web bundle
contains no SDK import, no key reference and no provider URL.

## The Jev playground

Before any of the game is wired to Jev, one command has to answer honestly
whether the integration works:

```bash
npm run jev:playground
```

It reports configuration, authentication, a real typed decision with its
probability distribution, measured latency, token usage, and whether two
decisions can run concurrently the way a real turn needs them to. If anything
fails it names the category - authentication, credit, quota, rate limit,
network, timeout, or our own bad request - and quotes the provider's own
message.

It never claims a credit balance. TypeSafe does not publish one, so the
playground reports only what the API's behaviour actually establishes.

Flags: `--minimal` skips the concurrency check (one request instead of three),
`--timeout=8000` overrides the per-attempt timeout.

Cost: one small request, or three with the concurrency check.

## Testing

```bash
npm test                     # offline, free, never touches the network
RUN_LIVE_JEV_TESTS=true npm test   # additionally runs the live API tests
```

The live tests are the only ones that spend credits, and they self-skip when
the switch is unset. Everything above the SDK boundary is tested against a
fake gateway rather than mocked HTTP, so the default run cannot spend a credit
even by accident.

## Architecture note

The game engine runs in the browser. `/api/decide` is a stateless translator:
an observation goes in, a typed decision comes out. It holds no match state
and cannot change the game — it returns an _intention_, and the engine
validates that intention exactly like a local agent's.

That is a deliberate, documented deviation from the spec's "authoritative
state lives on the server", taken because the alternatives need either a
database (forbidden) or trusting client-supplied state (also forbidden).
See `docs/ASSUMPTIONS.md` A23 for the full reasoning and what it does and
does not cost.

## License

MIT
