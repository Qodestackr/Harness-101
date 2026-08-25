export type Disposable = () => void

export type PluginContext = {
  get<T>(key: string): T | undefined
  require<T>(key: string): T
  provide<T>(key: string, value: T): Disposable
  on<T>(event: string, listener: (value: T) => void): Disposable
  effect(dispose: Disposable): Disposable
}

export type Plugin = {
  name: string
  inject?: readonly string[]
  provides?: readonly string[]
  apply(ctx: PluginContext): void | Disposable
}

class Fiber {
  private disposers: Disposable[] = []
  private active = false

  activate(): void {
    this.active = true
  }

  add(disposer: Disposable): void {
    if (!this.active) throw new Error('fiber is inactive')
    this.disposers.push(disposer)
  }

  get isActive(): boolean {
    return this.active
  }

  dispose(): void {
    if (!this.active) return

    this.active = false

    for (const dispose of this.disposers.reverse()) {
      dispose()
    }

    this.disposers = []
  }
}

type MountedPlugin = {
  plugin: Plugin
  fiber: Fiber
}

export class Runtime {
  private services = new Map<string, unknown>()
  private listeners = new Map<string, Set<(value: unknown) => void>>()
  private plugins = new Map<string, MountedPlugin>()

  private reconciling = false
  private reconcilePending = false

  provide<T>(key: string, value: T): Disposable {
    if (this.services.has(key)) {
      throw new Error(`service already exists: ${key}`)
    }

    this.services.set(key, value)
    this.reconcile()

    return () => {
      if (!this.services.has(key)) return

      this.services.delete(key)
      this.reconcile()
    }
  }

  get<T>(key: string): T | undefined {
    return this.services.get(key) as T | undefined
  }

  mount(plugin: Plugin): Disposable {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`plugin already mounted: ${plugin.name}`)
    }

    this.plugins.set(plugin.name, {
      plugin,
      fiber: new Fiber(),
    })

    this.reconcile()

    return () => {
      const entry = this.plugins.get(plugin.name)
      if (!entry) return

      entry.fiber.dispose()
      this.plugins.delete(plugin.name)
    }
  }

  emit<T>(event: string, value: T): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(value)
    }
  }

  private reconcile(): void {
    if (this.reconciling) {
      this.reconcilePending = true
      return
    }

    this.reconciling = true

    try {
      const shouldBeActive = this.computeActivePlugins()

      const activeNames = [...this.plugins.entries()]
        .filter(([, entry]) => entry.fiber.isActive)
        .map(([name]) => name)

      // Dependents must die before their providers.
      const toDeactivate = activeNames.filter(
        name => !shouldBeActive.has(name)
      )

      for (const name of this.deactivationOrder(toDeactivate)) {
        const entry = this.plugins.get(name)
        if (!entry) continue

        entry.fiber.dispose()
        entry.fiber = new Fiber()
      }

      // Providers must become available before their dependents.
      for (const [name, entry] of this.plugins) {
        if (
          shouldBeActive.has(name) &&
          !entry.fiber.isActive
        ) {
          this.activate(entry.plugin, entry.fiber)
        }
      }
    } finally {
      this.reconciling = false
    }

    if (this.reconcilePending) {
      this.reconcilePending = false
      this.reconcile()
    }
  }

  private computeActivePlugins(): Set<string> {
    const active = new Set<string>()

    // Services provided directly by the outside world.
    const available = new Set(this.services.keys())

    let changed = true

    while (changed) {
      changed = false

      for (const [name, entry] of this.plugins) {
        if (active.has(name)) continue

        const required = entry.plugin.inject ?? []

        if (!required.every(key => available.has(key))) {
          continue
        }

        active.add(name)

        for (const provided of entry.plugin.provides ?? []) {
          available.add(provided)
        }

        changed = true
      }
    }

    return active
  }

  private deactivationOrder(names: string[]): string[] {
    const remaining = new Set(names)
    const result: string[] = []

    while (remaining.size > 0) {
      let removed = false

      for (const name of remaining) {
        const hasActiveDependent = [...remaining].some(other => {
          if (other === name) return false

          const dependencies =
            this.plugins.get(other)?.plugin.inject ?? []

          return dependencies.includes(
            this.plugins.get(name)?.plugin.provides?.[0] ?? ''
          )
        })

        if (!hasActiveDependent) {
          result.push(name)
          remaining.delete(name)
          removed = true
          break
        }
      }

      if (!removed) {
        throw new Error(
          `cyclic plugin dependency detected: ${[...remaining].join(', ')}`
        )
      }
    }

    return result
  }

  private activate(plugin: Plugin, fiber: Fiber): void {
    fiber.activate()

    const ctx: PluginContext = {
      get: <T>(key: string) =>
        this.get<T>(key),

      require: <T>(key: string) => {
        const value = this.get<T>(key)

        if (value === undefined) {
          throw new Error(`missing service: ${key}`)
        }

        return value
      },

      provide: (key, value) => {
        const dispose = this.provide(key, value)
        fiber.add(dispose)
        return dispose
      },

      on: (event, listener) => {
        const hooks =
          this.listeners.get(event) ??
          new Set<(value: unknown) => void>()

        this.listeners.set(event, hooks)

        const wrapped = listener as (value: unknown) => void
        hooks.add(wrapped)

        const dispose = () => {
          hooks.delete(wrapped)

          if (hooks.size === 0) {
            this.listeners.delete(event)
          }
        }

        fiber.add(dispose)

        return dispose
      },

      effect: dispose => {
        fiber.add(dispose)
        return dispose
      },
    }

    const cleanup = plugin.apply(ctx)

    if (cleanup) {
      fiber.add(cleanup)
    }
  }
}