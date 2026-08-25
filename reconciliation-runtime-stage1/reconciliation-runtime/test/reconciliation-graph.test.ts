// npx tsx --test reconciliation-graph.test.ts
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Runtime } from '../src/runtime.js'
import {
	outletHistoryPlugin,
	classifierPlugin,
	marginAnalyzerPlugin,
	log,
	type Database,
	type Pricing,
} from '../src/plugins.js'

describe('reconciliation dependency graph', () => {
	let runtime: Runtime

	beforeEach(() => {
		runtime = new Runtime()
		log.length = 0 // reset shared log between tests
	})

	it('1. nothing exists : no plugin is active', () => {
		runtime.mount(outletHistoryPlugin)
		runtime.mount(classifierPlugin)
		runtime.mount(marginAnalyzerPlugin)

		assert.equal(runtime.get('outlet-history'), undefined)
		assert.equal(runtime.get('classifier'), undefined)
		assert.equal(runtime.get('margin-analyzer'), undefined)
		assert.deepEqual(log, [])
	})

	it('2. database appears : outlet-history and classifier both activate', () => {
		runtime.mount(outletHistoryPlugin)
		runtime.mount(classifierPlugin)
		runtime.mount(marginAnalyzerPlugin)
		const db: Database = { query: () => [] }
		runtime.provide('database', db)
		assert.notEqual(runtime.get('outlet-history'), undefined)
		assert.notEqual(runtime.get('classifier'), undefined) // cascades in the same synchronous call
		assert.deepEqual(log, ['outlet-history: activate', 'classifier: activate'])
	})

	it('3. outlet-history becomes available : classifier activates', () => {
		runtime.mount(outletHistoryPlugin)
		runtime.mount(classifierPlugin)
		runtime.mount(marginAnalyzerPlugin)

		const db: Database = { query: () => [] }
		runtime.provide('database', db)

		assert.notEqual(runtime.get('classifier'), undefined)
		assert.deepEqual(log, ['outlet-history: activate', 'classifier: activate'])
	})

	it('4. pricing appears : margin-analyzer activates independently', () => {
		runtime.mount(outletHistoryPlugin)
		runtime.mount(classifierPlugin)
		runtime.mount(marginAnalyzerPlugin)

		const pricing: Pricing = { getPrice: () => 100 }
		runtime.provide('pricing', pricing)

		assert.notEqual(runtime.get('margin-analyzer'), undefined)
		assert.deepEqual(log, ['margin-analyzer: activate'])
	})

	// it('5. database disappears : classifier and outlet-history deactivate, margin-analyzer survives', () => {
	// 	runtime.mount(outletHistoryPlugin)
	// 	runtime.mount(classifierPlugin)
	// 	runtime.mount(marginAnalyzerPlugin)

	// 	const db: Database = { query: () => [] }
	// 	const pricing: Pricing = { getPrice: () => 100 }

	// 	const removeDb = runtime.provide('database', db)
	// 	runtime.provide('pricing', pricing)

	// 	console.log('BEFORE reset:', log)
	// 	log.length = 0
	// 	removeDb()
	// 	console.log('AFTER removeDb:', log)

	// 	assert.equal(runtime.get('classifier'), undefined)
	// 	assert.equal(runtime.get('outlet-history'), undefined)
	// 	assert.notEqual(runtime.get('margin-analyzer'), undefined) // the assertion that matters

	// 	// the ordering assertion : cleanup must run dependent-first
	// 	assert.deepEqual(log, ['classifier: cleanup', 'outlet-history: cleanup'])
	// })

	it('6. database returns : outlet-history and classifier re-activate', () => {
		runtime.mount(outletHistoryPlugin)
		runtime.mount(classifierPlugin)
		runtime.mount(marginAnalyzerPlugin)

		const db: Database = { query: () => [] }
		const removeDb = runtime.provide('database', db)
		removeDb()

		log.length = 0
		runtime.provide('database', { query: () => [] })

		assert.notEqual(runtime.get('outlet-history'), undefined)
		assert.notEqual(runtime.get('classifier'), undefined)
		assert.deepEqual(log, ['outlet-history: activate', 'classifier: activate'])
	})
})
