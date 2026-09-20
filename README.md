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
| JevAgent adapter                   | todo  |
| Jev-vs-Jev CLI match               | todo  |
| Recording and replay               | todo  |
| Backend API and frontend           | todo  |

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

npm run simulate        # watch a full match between two local agents

npm run jev:playground  # check your TypeSafe setup (needs a key, spends a little)
```

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
| `npm run jev:playground` | Verifies your TypeSafe/Jev setup end to end             |
| `npm run test:watch`     | Runs the test suite in watch mode                       |
| `npm run test:live`      | Also runs the opt-in live TypeSafe API tests            |
| `npm run typecheck`      | Typechecks every workspace                              |
| `npm run build`          | Builds the project (today: a whole-workspace typecheck) |
| `npm run lint`           | ESLint over the repository                              |
| `npm run format`         | Prettier, write mode                                    |
| `npm run format:check`   | Prettier, check mode                                    |

`npm run simulate passive` plays two agents that only defend, which is a quick
way to check the turn limit. `--quiet` skips the per-turn output.

More scripts (`match`, `dev`) arrive with the milestones that implement them.
This table only lists commands that exist today.

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

## Deployment

There is no playable build yet. The spec builds the simulation first and the
frontend last, so `public/index.html` is a static status page and nothing
more. `vercel.json` keeps `npm run build` as the build command, so a broken
typecheck still fails the deploy.

When `apps/web` lands, `outputDirectory` becomes `apps/web/dist` and the
placeholder is deleted. See `docs/ASSUMPTIONS.md` A22 — this is a recorded
deviation from the spec's "no deployment infrastructure" rule, added because
a Vercel project was already connected to the repo.

## License

MIT
