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
| Jev playground                     | todo  |
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

| Script                 | What it does                                            |
| ---------------------- | ------------------------------------------------------- |
| `npm test`             | Runs the offline test suite                             |
| `npm run simulate`     | Plays a full local match and prints it. No API calls    |
| `npm run test:watch`   | Runs the test suite in watch mode                       |
| `npm run test:live`    | Also runs the opt-in live TypeSafe API tests            |
| `npm run typecheck`    | Typechecks every workspace                              |
| `npm run build`        | Builds the project (today: a whole-workspace typecheck) |
| `npm run lint`         | ESLint over the repository                              |
| `npm run format`       | Prettier, write mode                                    |
| `npm run format:check` | Prettier, check mode                                    |

`npm run simulate passive` plays two agents that only defend, which is a quick
way to check the turn limit. `--quiet` skips the per-turn output.

More scripts (`jev:playground`, `match`, `dev`) arrive with the milestones that
implement them. This table only lists commands that exist today.

## License

MIT
