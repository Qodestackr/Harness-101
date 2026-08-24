export type Money = {
  currency: string
  minor: number
}

export type Quantity = {
  unit: string
  value: number
}

export type Mismatch =
  | {
      kind: 'quantity'
      expected: Quantity
      actual: Quantity
      reason?: string
    }
  | {
      kind: 'amount'
      expected: Money
      actual: Money
      reason?: string
    }
  | {
      kind: 'timing'
      expectedAt: string
      observedAt?: string
      reason?: string
    }

export type ReconciliationCase = {
  id: string
  outletId: string
  invoiceId: string
  paymentId?: string
  occurredAt: string
  mismatches: Mismatch[]
  evidence: Record<string, unknown>
}

export type ReconciliationDecision = {
  classification:
    | 'damaged-goods'
    | 'data-entry-error'
    | 'dispute'
    | 'timing'
    | 'unknown'
  confidence: number
  rationale: string
}
