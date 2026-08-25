import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Runtime } from '../src/runtime.js'
import {
  damagedGoodsDetector,
  dataEntryDetector,
  disputeDetector,
  reconciliationClassifierPlugin,
} from '../src/plugins.js'
import type { ReconciliationCase } from '../src/reconciliation.js'

describe('Harness 101 — Stage 2', () => {
  it('waterfall passes a decision through ordered processors', async () => {
    const runtime = new Runtime()

    runtime.mount(reconciliationClassifierPlugin)
    runtime.mount(damagedGoodsDetector)
    runtime.mount(dataEntryDetector)
    runtime.mount(disputeDetector)

    const input: ReconciliationCase = {
      caseId: 'R-001',
      outletId: 'OUT-1',
      invoice: { amount: 340, quantity: 20 },
      payment: { amount: 340 },
      delivery: { quantity: 18 },
    }

    const engine = runtime.get<any>('reconciliation-engine')
    assert.ok(engine)

    const result = await engine.classify(input)

    assert.equal(result.classification, 'damaged-goods')
    assert.equal(result.confidence, 0.9)
  })

  it('trajectory records the execution path', async () => {
    const runtime = new Runtime()

    runtime.mount(reconciliationClassifierPlugin)
    runtime.mount(damagedGoodsDetector)

    const input: ReconciliationCase = {
      caseId: 'R-002',
      outletId: 'OUT-1',
      invoice: { amount: 340, quantity: 20 },
      payment: { amount: 340 },
      delivery: { quantity: 18 },
    }

    const engine = runtime.get<any>('reconciliation-engine')
    await engine.classify(input)

    const types = runtime.trajectory
      .all()
      .map(entry => entry.type)

    assert.ok(types.includes('waterfall.started'))
    assert.ok(types.includes('waterfall.step'))
    assert.ok(types.includes('waterfall.output'))
    assert.ok(types.includes('waterfall.completed'))
  })

  it('removing a processor retracts its effect', async () => {
    const runtime = new Runtime()

    runtime.mount(reconciliationClassifierPlugin)
    const remove = runtime.mount(damagedGoodsDetector)

    const input: ReconciliationCase = {
      caseId: 'R-003',
      outletId: 'OUT-1',
      invoice: { amount: 340, quantity: 20 },
      payment: { amount: 340 },
      delivery: { quantity: 18 },
    }

    const engine = runtime.get<any>('reconciliation-engine')
    const before = await engine.classify(input)

    assert.equal(before.classification, 'damaged-goods')

    remove()

    const after = await engine.classify(input)

    assert.equal(after.classification, 'unresolved')
  })
})
