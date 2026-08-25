import type { Plugin } from './runtime.js'
import {
  createReconciliationEngine,
  type ClassificationProposal,
  type ReconciliationCase,
  type ResolutionProposal,
} from './reconciliation.js'

export type Database = {
  query(sql: string): unknown[]
}

export type OutletHistory = {
  getHistory(outletId: string): unknown[]
}

export type Pricing = {
  getPrice(sku: string): number
}

export const log: string[] = []

export const outletHistoryPlugin: Plugin = {
  name: 'outlet-history',
  inject: ['database'],
  provides: ['outlet-history'],

  apply(ctx) {
    log.push('outlet-history: activate')
    const db = ctx.require<Database>('database')

    ctx.provide('outlet-history', {
      getHistory: (outletId: string) =>
        db.query(`SELECT * FROM history WHERE outlet = ${outletId}`),
    })

    return () => log.push('outlet-history: cleanup')
  },
}

export const classifierPlugin: Plugin = {
  name: 'classifier',
  inject: ['outlet-history'],
  provides: ['classifier'],

  apply(ctx) {
    log.push('classifier: activate')

    const history = ctx.require<OutletHistory>('outlet-history')

    ctx.provide('classifier', {
      classify: (caseId: string) =>
        history.getHistory(caseId).length > 0
          ? 'has-history'
          : 'no-history',
    })

    return () => log.push('classifier: cleanup')
  },
}

export const marginAnalyzerPlugin: Plugin = {
  name: 'margin-analyzer',
  inject: ['pricing'],
  provides: ['margin-analyzer'],

  apply(ctx) {
    log.push('margin-analyzer: activate')

    const pricing = ctx.require<Pricing>('pricing')

    ctx.provide('margin-analyzer', {
      analyze: (sku: string) => pricing.getPrice(sku) * 0.3,
    })

    return () => log.push('margin-analyzer: cleanup')
  },
}

// A clean Stage-2 plugin: the business pipeline is ordinary application code
// and the runtime only supplies lifecycle, capabilities, and interception.
export const reconciliationClassifierPlugin: Plugin = {
  name: 'reconciliation-classifier',
  provides: ['reconciliation-engine'],

  apply(ctx) {
    const engine = createReconciliationEngine(ctx)
    ctx.provide('reconciliation-engine', engine)

    return () => log.push('reconciliation-engine: cleanup')
  },
}

export const damagedGoodsDetector: Plugin = {
  name: 'damaged-goods-detector',
  inject: ['reconciliation-engine'],

  apply(ctx) {
    const unregister = ctx.registerWaterfall(
      'reconciliation.classify',
      (proposal: ClassificationProposal) => {
        const c = proposal.caseData
        const quantityGap = c.invoice.quantity - c.delivery.quantity

        if (quantityGap > 0 && c.payment.amount >= c.invoice.amount) {
          return {
            ...proposal,
            classification: 'damaged-goods',
            confidence: 0.9,
            rationale:
              'Delivered quantity is below the invoice while payment covers the invoice.',
          }
        }

        return proposal
      },
    )

    ctx.effect(unregister)
  },
}

export const dataEntryDetector: Plugin = {
  name: 'data-entry-detector',
  inject: ['reconciliation-engine'],

  apply(ctx) {
    const unregister = ctx.registerWaterfall(
      'reconciliation.classify',
      (proposal: ClassificationProposal) => {
        const c = proposal.caseData

        if (
          c.invoice.quantity === c.delivery.quantity &&
          c.payment.amount !== c.invoice.amount
        ) {
          return {
            ...proposal,
            classification: 'data-entry-error',
            confidence: 0.8,
            rationale:
              'Quantity reconciles but monetary value does not.',
          }
        }

        return proposal
      },
    )

    ctx.effect(unregister)
  },
}

export const disputeDetector: Plugin = {
  name: 'dispute-detector',
  inject: ['reconciliation-engine'],

  apply(ctx) {
    const unregister = ctx.registerWaterfall(
      'reconciliation.classify',
      (proposal: ClassificationProposal) => {
        const c = proposal.caseData

        if (c.payment.amount < c.invoice.amount * 0.5) {
          return {
            ...proposal,
            classification: 'dispute',
            confidence: 0.6,
            rationale:
              'Payment is materially below the invoiced amount.',
          }
        }

        return proposal
      },
    )

    ctx.effect(unregister)
  },
}
