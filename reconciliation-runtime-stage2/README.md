# Reconciliation Runtime : Stage 2

This stage keeps the Stage-1 reactive capability runtime and adds three things:

1. `registerWaterfall()` : a typed sequential interception pipeline.
2. `Trajectory` : append-only execution records.
3. A small reconciliation decision loop that uses both.

The important architectural boundary is:

```text
capabilities
    ↓
lifecycle
    ↓
waterfall
    ↓
decision
    ↓
trajectory
```

A plugin can register a waterfall handler. The registration itself belongs to
the plugin's Fiber, so removing the plugin automatically removes the handler.

The trajectory is deliberately observational. It is not yet the source of truth
for runtime state. We will make that distinction explicit before building replay.

## Run

```bash
npm install
npx tsx --test test/stage2.test.ts
```

## What to inspect

Start with:

- `src/runtime.ts` : the runtime semantics.
- `src/reconciliation.ts` : domain-facing decision API.
- `src/plugins.ts` : actual decision processors.
- `test/stage2.test.ts` : executable architectural claims.

The three useful ideas to carry forward are:

### 1. A waterfall is not an event bus

An event bus broadcasts:

```text
A → everyone
```

A waterfall transforms:

```text
A → B → C → result
```

Each stage can rewrite the value or stop the pipeline.

### 2. Registration is an effect

This is crucial:

```ts
const unregister = ctx.registerWaterfall(...)
ctx.effect(unregister)
```

The system does not merely remember that a handler exists. The handler is
owned by the plugin lifetime. Remove the plugin and the runtime retracts the
handler.

### 3. Trajectory is evidence

The trajectory records:

```text
what happened
in what order
with what intermediate values
and which component acted
```

It is the beginning of the black-box flight recorder.

It is not yet a durable event-sourced state machine. That is the next conceptual
step, not something to smuggle in prematurely.

## The deliberate limitation

The reconciliation classifiers currently use simple deterministic heuristics.
That is intentional.

We are proving the harness mechanics before introducing an LLM.

The eventual shape is:

```text
real observation
      ↓
decision context
      ↓
candidate alternatives
      ↓
sandbox
      ↓
evaluation
      ↓
authorization
      ↓
external effect
      ↓
verification
      ↓
trajectory
```

The sandbox and external-effect boundary belong in the next stage.
