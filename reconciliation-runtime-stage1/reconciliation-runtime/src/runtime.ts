export type Disposable = () => void

export type PluginContext = {
  get<T>(key: string): T | undefined
  require<T>(key: string): T
  provide<T>(key: string, value: T): Disposable
  on<T>(event: string, listener: (value: T) => void): Disposable
  effect(dispose: Disposable): Disposable
}

type Plugin = {
  name: string
  inject?: readonly string[]
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
    
    // Run cleanup functions in reverse order
    for (const dispose of this.disposers.reverse()) dispose()
    this.disposers = []
  }
}

export class Runtime {
  private services = new Map<string, unknown>()
  private listeners = new Map<string, Set<(value: unknown) => void>>()
  private plugins = new Map<string, { plugin: Plugin; fiber: Fiber }>()

  provide<T>(key: string, value: T): Disposable {
    if (this.services.has(key)) throw new Error(`service already exists: ${key}`)
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
    if (this.plugins.has(plugin.name)) throw new Error(`plugin already mounted: ${plugin.name}`)
    this.plugins.set(plugin.name, { plugin, fiber: new Fiber() })
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
    for (const entry of this.plugins.values()) {
      const required = entry.plugin.inject ?? []
      const ready = required.every(key => this.services.has(key))
      const active = this.isFiberActive(entry.fiber)

      if (ready && !active) {
        this.activate(entry.plugin, entry.fiber)
      } else if (!ready && active) {
        entry.fiber.dispose()
        entry.fiber = new Fiber()
      }
    }
  }

  private isFiberActive(fiber: Fiber): boolean {
    return fiber.isActive
  }

  private activate(plugin: Plugin, fiber: Fiber): void {
    fiber.activate()
    const ctx: PluginContext = {
      get: <T>(key: string): T | undefined => this.get(key) as T | undefined,
      require: <T>(key: string):T => {
        const value = this.get(key)
        if (value === undefined) throw new Error(`missing service: ${key}`)
        return value as T
      },
      provide: (key, value) => {
        const dispose = this.provide(key, value)
        fiber.add(dispose)
        return dispose
      },
      on: (event, listener) => {
        const hooks = this.listeners.get(event) ?? new Set()
        this.listeners.set(event, hooks)
        const wrapped = listener as (value: unknown) => void
        hooks.add(wrapped)
        const dispose = () => hooks.delete(wrapped)
        fiber.add(dispose)
        return dispose
      },
      effect: dispose => {
        fiber.add(dispose)
        return dispose
      },
    }

    const cleanup = plugin.apply(ctx)
    if (cleanup) fiber.add(cleanup)
  }
}
