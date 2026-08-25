import assert from 'node:assert/strict'
import { Runtime } from '../src/runtime.js'
import type { ReconciliationCase } from '../src/domain.js'

const runtime = new Runtime()
const seen: string[] = []

const disposePlugin = runtime.mount({
  name: 'reconciliation-observer',
  inject: ['reconciliation'],
  apply(ctx) {
    const reconciliation = ctx.require<ReconciliationCase>('reconciliation')
    assert.equal(reconciliation.id, 'rec-001')
    ctx.on<ReconciliationCase>('reconciliation/observed', value => {
      seen.push(value.id)
    })
  },
})

runtime.emit('reconciliation/observed', { id: 'ignored' } as ReconciliationCase)
assert.deepEqual(seen, [])

const disposeCase = runtime.provide<ReconciliationCase>('reconciliation', {
  id: 'rec-001',
  outletId: 'outlet-7',
  invoiceId: 'inv-42',
  occurredAt: '2026-08-24T10:00:00Z',
  mismatches: [
    {
      kind: 'quantity',
      expected: { unit: 'case', value: 20 },
      actual: { unit: 'case', value: 18 },
    },
  ],
  evidence: { source: 'delivery-note' },
})

runtime.emit('reconciliation/observed', runtime.get<ReconciliationCase>('reconciliation')!)
assert.deepEqual(seen, ['rec-001'])

disposeCase()
runtime.emit('reconciliation/observed', { id: 'rec-002' } as ReconciliationCase)
assert.deepEqual(seen, ['rec-001'])

disposePlugin()
console.log('ok')
