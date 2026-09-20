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
