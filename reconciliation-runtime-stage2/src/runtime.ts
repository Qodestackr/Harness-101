export type Disposable = () => void

export type PluginContext = {
  get<T>(key: string): T | undefined
  require<T>(key: string): T
  provide<T>(key: string, value: T): Disposable
  on<T>(event: string, listener: (value: T) => void): Disposable
  waterfall<T>(event: string, value: T): Promise<WaterfallResult<T>>
  effect(dispose: Disposable): Disposable
  trajectory: Trajectory
  registerWaterfall<T>(
    event: string,
    handler: (value: T) => T | null | undefined | Promise<T | null | undefined>,
  ): Disposable
}

export type Plugin = {
  name: string
  inject?: readonly string[]
  provides?: readonly string[]
  apply(ctx: PluginContext): void | Disposable
}

export type WaterfallResult<T> = {
  value: T
  stopped: boolean
  stoppedBy?: string
}

export type TrajectoryEntry = {
  seq: number
  time: number
  type: string
  data: Record<string, unknown>
}

export class Trajectory {
  private entries: TrajectoryEntry[] = []
  private seq = 0

  record(type: string, data: Record<string, unknown> = {}): TrajectoryEntry {
    const entry = {
      seq: ++this.seq,
      time: Date.now(),
      type,
      data,
    }
    this.entries.push(entry)
    return entry
  }

  all(): readonly TrajectoryEntry[] {
    return this.entries
  }

  snapshot(): TrajectoryEntry[] {
    return [...this.entries]
  }

  clear(): void {
    this.entries = []
    this.seq = 0
  }
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

type WaterfallHandler<T> = {
  plugin: string
  handler: (value: T) => T | null | undefined | Promise<T | null | undefined>
}

export class Runtime {
  private services = new Map<string, unknown>()
  private listeners = new Map<string, Set<(value: unknown) => void>>()
  private waterfalls = new Map<string, WaterfallHandler<unknown>[]>()
  private plugins = new Map<string, MountedPlugin>()

  readonly trajectory = new Trajectory()

  private reconciling = false
  private reconcilePending = false
  private currentPlugin: string | undefined

  provide<T>(key: string, value: T): Disposable {
    if (this.services.has(key)) {
      throw new Error(`service already exists: ${key}`)
    }

    this.services.set(key, value)
    this.trajectory.record('service.provided', { key })
    this.reconcile()

    return () => {
      if (!this.services.has(key)) return

      this.services.delete(key)
      this.trajectory.record('service.removed', { key })
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

    this.trajectory.record('plugin.mounted', { plugin: plugin.name })
    this.reconcile()

    return () => {
      const entry = this.plugins.get(plugin.name)
      if (!entry) return

      entry.fiber.dispose()
      this.plugins.delete(plugin.name)

      this.trajectory.record('plugin.unmounted', {
        plugin: plugin.name,
      })
    }
  }

  emit<T>(event: string, value: T): void {
    this.trajectory.record('event.emitted', {
      event,
      value,
    })

    for (const listener of this.listeners.get(event) ?? []) {
      listener(value)
    }
  }

  onWaterfall<T>(
    event: string,
    plugin: string,
    handler: (value: T) => T | null | undefined | Promise<T | null | undefined>,
    fiber: Fiber,
  ): Disposable {
    const handlers = this.waterfalls.get(event) ?? []
    const entry: WaterfallHandler<unknown> = {
      plugin,
      handler: handler as WaterfallHandler<unknown>['handler'],
    }

    handlers.push(entry)
    this.waterfalls.set(event, handlers)

    const dispose = () => {
      const current = this.waterfalls.get(event)
      if (!current) return

      const index = current.indexOf(entry)
      if (index >= 0) current.splice(index, 1)

      if (current.length === 0) {
        this.waterfalls.delete(event)
      }
    }

    fiber.add(dispose)
    return dispose
  }

  async waterfall<T>(
    event: string,
    value: T,
  ): Promise<WaterfallResult<T>> {
    const handlers = [...(this.waterfalls.get(event) ?? [])]

    this.trajectory.record('waterfall.started', {
      event,
      handlers: handlers.map(h => h.plugin),
      input: value,
    })

    let current = value

    for (const handler of handlers) {
      this.trajectory.record('waterfall.step', {
        event,
        plugin: handler.plugin,
        input: current,
      })

      const next = await handler.handler(current)

      if (next === null || next === undefined) {
        this.trajectory.record('waterfall.stopped', {
          event,
          plugin: handler.plugin,
          input: current,
        })

        return {
          value: current,
          stopped: true,
          stoppedBy: handler.plugin,
        }
      }

      current = next as T

      this.trajectory.record('waterfall.output', {
        event,
        plugin: handler.plugin,
        output: current,
      })
    }

    this.trajectory.record('waterfall.completed', {
      event,
      output: current,
    })

    return {
      value: current,
      stopped: false,
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

      const toDeactivate = activeNames.filter(
        name => !shouldBeActive.has(name),
      )

      for (const name of this.deactivationOrder(toDeactivate)) {
        const entry = this.plugins.get(name)
        if (!entry) continue

        this.trajectory.record('plugin.deactivating', {
          plugin: name,
        })

        entry.fiber.dispose()
        entry.fiber = new Fiber()

        this.trajectory.record('plugin.deactivated', {
          plugin: name,
        })
      }

      for (const [name, entry] of this.plugins) {
        if (shouldBeActive.has(name) && !entry.fiber.isActive) {
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

    const provides = (name: string) =>
      this.plugins.get(name)?.plugin.provides ?? []

    const requires = (name: string) =>
      this.plugins.get(name)?.plugin.inject ?? []

    while (remaining.size > 0) {
      let removed = false

      for (const name of remaining) {
        const provided = new Set(provides(name))

        const hasDependent = [...remaining].some(other => {
          if (other === name) return false
          return requires(other).some(key => provided.has(key))
        })

        if (!hasDependent) {
          result.push(name)
          remaining.delete(name)
          removed = true
          break
        }
      }

      if (!removed) {
        throw new Error(
          `cyclic plugin dependency detected: ${[...remaining].join(', ')}`,
        )
      }
    }

    return result
  }

  private activate(plugin: Plugin, fiber: Fiber): void {
    fiber.activate()
    this.currentPlugin = plugin.name

    this.trajectory.record('plugin.activating', {
      plugin: plugin.name,
    })

    const ctx: PluginContext = {
      get: <T>(key: string) => this.get<T>(key),

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
          if (hooks.size === 0) this.listeners.delete(event)
        }

        fiber.add(dispose)
        return dispose
      },

      waterfall: <T>(event: string, value: any) =>
        this.waterfall(event, value),

      effect: dispose => {
        fiber.add(dispose)
        return dispose
      },

      registerWaterfall: (event, handler) =>
        this.onWaterfall(event, plugin.name, handler, fiber),

      trajectory: this.trajectory,
    }

    const cleanup = plugin.apply(ctx)

    if (cleanup) fiber.add(cleanup)

    this.trajectory.record('plugin.activated', {
      plugin: plugin.name,
    })

    this.currentPlugin = undefined
  }
}
