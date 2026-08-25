The first thing to notice is that our previous invariant,

```text
Active(P) ⇔ Dependencies(P) ⊆ AvailableServices
```

is correct for a flat dependency list, but it hides something important: a dependency can itself be a computation with dependencies.

Suppose our reconciliation runtime eventually looks like this:

```text
reconciliation
      │
      ├── pricing
      │      │
      │      └── price-list
      │
      └── outlet-history
             │
             └── database
```

Now imagine:

```text
reconciliation.classifier
    requires: pricing, outlet-history

pricing
    requires: price-list

outlet-history
    requires: database
```

The classifier cannot simply ask:

```ts
ctx.has("pricing")
ctx.has("outlet-history")
```

because those services might be *registered* but not actually valid.

We have to distinguish two concepts:

```text
declared capability
        vs.
available capability
```

A provider saying “I provide `pricing`” is not enough. `pricing` itself has to be alive.

So availability becomes recursive.

Something like:

```text
database available
      ↓
outlet-history can activate
      ↓
outlet-history available
      ↓
classifier can activate
```

and simultaneously:

```text
price-list available
      ↓
pricing can activate
      ↓
classifier can activate
```

Now we can derive a better invariant:

```text
A plugin is active iff every capability it requires
is currently provided by an active provider.
```

That sounds simple, but it creates our first genuinely interesting runtime problem.

Consider removal:

```text
database
   ↓
outlet-history
   ↓
classifier
```

If `database` disappears, we cannot merely remove `database`.

We must propagate invalidation:

```text
database disappears
        ↓
outlet-history becomes invalid
        ↓
classifier becomes invalid
```

And teardown needs to happen in the opposite direction:

```text
classifier
   ↓ destroy
outlet-history
   ↓ destroy
database
```

That is already beginning to look like a dependency graph rather than a plugin list.

And now there is an even more interesting case.

Suppose:

```text
database
   ↓
outlet-history ──────┐
                     ↓
                  classifier
                     ↑
                     │
pricing ─────────────┘
```

If `database` disappears, `outlet-history` disappears, but `pricing` remains healthy.

The classifier must disappear, but pricing must remain.

So the runtime isn't simply propagating “shutdown.”

It is recalculating **which nodes remain valid under the current environment**.

That is the deeper meaning of reactive coeffects.

At this point, our naïve `reconcile()` is going to start looking suspicious.

The current implementation effectively asks every mounted plugin:

```ts
can I activate?
```

But a real graph wants something closer to:

```text
Given the current providers:

1. Which providers are intrinsically available?
2. Which dependent plugins become valid?
3. Which newly-valid plugins provide further capabilities?
4. Continue until no new capabilities appear.
5. Conversely, when something disappears:
   which dependents become invalid?
6. Tear those down safely.
```

In other words, we're approaching a **fixed-point computation**.

For activation:

```text
available₀
   ↓
derive newly valid plugins
   ↓
available₁
   ↓
derive newly valid plugins
   ↓
available₂
   ↓
...
   ↓
stable state
```

We stop when:

```text
availableₙ₊₁ = availableₙ
```

That is a surprisingly profound transition from our original little program.

We're no longer writing:

```ts
startA()
startB()
startC()
```

We're describing constraints:

```ts
A requires B
B requires C
C provides D
```

and asking the runtime to find a coherent active configuration.

This is one of the reasons I wanted to encounter the problem through code instead of just reading Cordis. The “dependency injection” abstraction starts revealing itself as something closer to a **constraint solver over a live graph**.

Instead of implementing a sophisticated graph solver, let's make the failure concrete.

Our next laboratory change should introduce exactly three reconciliation plugins:

```text
database
   ↓
outlet-history
   ↓
reconciliation-classifier
```

Then add a fourth independent branch:

```text
pricing
   ↓
margin-analyzer
```

We should test these transitions:

```text
1. Nothing exists

2. database appears
   → outlet-history activates

3. outlet-history becomes available
   → classifier activates

4. pricing appears
   → margin-analyzer activates

5. database disappears
   → classifier deactivates
   → outlet-history deactivates
   → margin-analyzer remains active

6. database returns
   → outlet-history activates
   → classifier activates again
```

And we should inspect the exact ordering.

That last part matters.

If `classifier` owns an effect that uses `outlet-history`, we cannot destroy `outlet-history` first.

We need:

```text
classifier cleanup
        ↓
outlet-history cleanup
        ↓
database withdrawal
```

So the dependency graph is beginning to impose **lifecycle ordering**.

And now we're touching the heart of the Cordis idea:

```text
spatial composability
        +
temporal composability
```

Spatial:

> Which things can coexist given the current dependency graph?

Temporal:

> In what order can those things appear, disappear, and clean up without violating the graph?

That's our next layer.

The experiment is:

```text
database
   ↑
outlet-history
   ↑
classifier

pricing
   ↑
margin-analyzer
```

Make `database` and `pricing` runtime-provided services. Make the other three actual plugins with `inject`.

Then prove the six transitions above with tests. The goal is to make your current `reconcile()` confront a graph.