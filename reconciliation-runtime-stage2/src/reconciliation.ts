import type { PluginContext } from './runtime.js'

export type ReconciliationCase = {
  caseId: string
  outletId: string
  invoice: {
    amount: number
    quantity: number
  }
  payment: {
    amount: number
  }
  delivery: {
    quantity: number
  }
}

export type Classification =
  | 'damaged-goods'
  | 'data-entry-error'
  | 'dispute'
  | 'unresolved'

export type ClassificationProposal = {
  caseData: ReconciliationCase
  classification: Classification
  confidence: number
  rationale: string
}

export type ResolutionProposal = {
  action: 'credit' | 'correct-invoice' | 'open-dispute' | 'manual-review'
  amount: number
  rationale: string
}

export function createReconciliationEngine(ctx: PluginContext) {
  return {
    async classify(
      input: ReconciliationCase,
    ): Promise<ClassificationProposal> {
      const result = await ctx.waterfall<ClassificationProposal>(
        'reconciliation.classify',
        {
          caseData: input,
          classification: 'unresolved',
          confidence: 0,
          rationale: 'No classifier has claimed the case.',
        },
      )

      return result.value
    },

    async proposeResolution(
      proposal: ClassificationProposal,
    ): Promise<ResolutionProposal> {
      const result = await ctx.waterfall<ResolutionProposal>(
        'reconciliation.resolve',
        {
          action: 'manual-review',
          amount: 0,
          rationale: proposal.rationale,
        },
      )

      return result.value
    },
  }
}
