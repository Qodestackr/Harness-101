# Reconciliation Runtime :Stage 1

The experiment derives a small set of runtime primitives from one real domain: reconciliation exceptions.

Stage 1 establishes:

- a domain object (`ReconciliationCase`) rather than an artificial clock/logger example;
- a service registry;
- plugin dependency declarations (`inject`);
- activation/deactivation when a dependency arrives/disappears;
- fiber-owned effects/listeners;
- a basic event bus.

Waterfall is intentionally absent. We add it only after the basic lifecycle semantics are understood and tested.

The important modeling decision is that `reconciliation` is one capability containing a complete case. Quantity, amount, and timing are mismatch variants inside that case. They are not three independent services.

Later, services such as `pricing`, `creditExposure`, `outletHistory`, or `inventory` can become separate coeffects when a classifier actually requires them. The runtime should not invent those dependencies before the domain requires them.