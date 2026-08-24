A lightweight plugin runtime with DI and automatic lifecycle management.

- `Disposable` is a function that performs a cleanup. It follows the "dispose" pattern; when you call it, it undoes whatever was set up e.g RAII
- `PluginContext` defines the interface that plugins receive when they are activated. Provides a controlled way of plugins to interact with the runtime.
- A `Fiber` represents the lifetime of a single plugin activation. It keeps track of all disposables that were registered during that activation & controls whether the fiber is currently active.
- `Runtime` is the main orchestrator that manages services, event listeners, and mounted plugins. The context methods are designed to automatically register any disposables they return into the active fiber, so they get cleaned up when the plugin deactivates.

Seen concepts (high level): Dynamic plugin activation, service registry with built-in conflict detection, event bus for async communication via named events, resource cleanup (effect/disposer), composable architecture where plugins can provide new services, which may in turn satisfy the dependencies of other plugins/system that boots up in stages.


## Take away

Coeffects are the dual of effects. While effects are what a computation *does to* the world (writes), coeffects are what a computation *needs from* the world(reads). In a runtime like this:
- **Services are coeffects** : they represent the context a plugin needs to run
- **`inject: ['config', 'db', 'logger']`** declares the plugin's coeffect requirements
- **The runtime tracks these dependencies reactively**

Reactive Coeffects Matter because the runtime needs to answer: *"What can run right now, given the current available context?"*

When services change (added or removed), the set of available coeffects changes. Plugins that depend on those coeffects must **react**:

```typescript
// Plugin needs 'db' and 'config' to run
const userPlugin = {
  name: 'users',
  inject: ['db', 'config'],
  apply(ctx) {
    const db = ctx.require('db')
    const config = ctx.require('config')
    // Start user management...
  }
}

// Initially: nothing happens - plugin stays inactive
runtime.mount(userPlugin)

// Provide 'config' - still not enough, plugin stays inactive
runtime.provide('config', { port: 3000 })

// Provide 'db' - NOW the plugin can activate!
runtime.provide('db', databaseConnection)
// then reconcile() fires, sees 'db' + 'config' available, activates userPlugin

// Remove 'db' later - plugin must deactivate!
removeDb()
// now reconcile() fires again, sees 'db' missing, deactivates userPlugin
```

The `reconcile()` method is literally reacting to changes in the coeffect environment. It's like a mini reactivity engine:

1. **Track dependencies** (via `inject`)
2. **Watch for changes** (via `provide`/removal)
3. **Propagate changes** (via `reconcile()`)
4. **Update dependent systems** (activate/deactivate plugins)

We do see such in useEffect with dep array, Vue computed properties & reactions, Functional reactive programming, DI containers with lifecycle management, OS service managers like systemd/launchd

We can likely say: **"This runtime needs reactive coeffects to automatically manage which plugins can and should be running based on the currently available services."** The reactivity is what makes it self-organizing rather than requiring manual orchestration.