import type { Plugin } from "./runtime.js";

export type Database = {
	query(sql: string): unknown[]
}

export type OutletHistory = {
	getHistory(outletId: string): unknown[]
}

export type Pricing = {
	getPrice(sku: string): number
}

export type Classifier = {
	classify(caseId: string): string
}

export type MarginAnalyzer = {
	analyze(sku: string): number
}

// instrument ... coz service assertions on service presence 
// tells you what happened but only the log tells you in what order
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
				db.query(
					`SELECT * FROM history WHERE outlet = ${outletId}`
				),
		})

		return () => {
			log.push('outlet-history: cleanup')
		}
	},
}

export const classifierPlugin: Plugin = {
	name: 'classifier',
	inject: ['outlet-history'],
	provides: ['classifier'],

	apply(ctx) {
		log.push('classifier: activate')

		const history =
			ctx.require<OutletHistory>('outlet-history')

		ctx.provide('classifier', {
			classify: (caseId: string) => {
				const h = history.getHistory(caseId)
				return h.length > 0 ? 'has-history' : 'no-history'
			},
		})

		return () => {
			log.push('classifier: cleanup')
		}
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

		return () => {
			log.push('margin-analyzer: cleanup')
		}
	},
}