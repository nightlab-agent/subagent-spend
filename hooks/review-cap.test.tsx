import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { SessionMeasureInput } from 'claude-code'

// Critic pass 0.8.0, kind 4. The engine raises session.measure "after each main-thread turn, and when a
// rate-limit window moves a whole point" (declarations, Claude Code 2.1.310, index.d.ts:4543-4544), not after
// each step. Off a subscription (the API-key user a spend cap is for) there are no windows, so within one turn
// no measurement comes. `engineCost` stands for what `$.session.usage()` would answer at each moment.

type On = Parameters<TestBody>[1]
type Dollar = Parameters<TestBody>[0]

const world = (on: On) => {
  const seen = { requests: 0, engineCost: 1.9 }
  on('fs.write', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'sess-r' }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 40000, window: 200000, percent: 20 }, rateLimits: [], cost: { usd: seen.engineCost } } }))
  on('turn.step', async function* (_, e) {
    seen.requests++
    seen.engineCost += 0.5 // each request costs 50 cents
    const usage = e.agentId ? { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' } : null
    return { turnId: e.turnId, index: e.index, answer: 'tool', toolUses: [], stopReason: 'tool_use', usage }
  })
  return seen
}

const step = async ($: Dollar, turnId: string, index: number, agentId?: string) => {
  const s = $.turn.step({ turnId, index, model: 'claude-opus-5-5', messageCount: 3 + index, ...(agentId ? { agentId } : {}) })
  for (;;) {
    const n = await s.next()
    if (n.done) return n.value
  }
}

const cost = (usd: number): SessionMeasureInput => ({ context: { tokens: 40000, window: 200000, percent: 20 }, rateLimits: [], cost: { usd }, changed: ['cost'] })

test('review: a turn of 5 tool-loop steps that starts under a $2 cap is not held once its cost passes $2', { options: { capUsd: 2 } }, async ($, on) => {
  const seen = world(on)
  await $.session.measure(cost(1.9)) // after the previous turn
  for (let i = 0; i < 5; i++) await step($, 't1', i) // one turn, as the engine raises it: no measurement inside
  // the cap promises: step 0 goes out ($2.40), every later step is held
  expect(seen.engineCost).toBeLessThanOrEqual(2.4)
  expect(seen.requests).toBe(1)
})

test("review: a subagent's 5 steps inside one main turn are not held once the cost passes the cap", { options: { capUsd: 2 } }, async ($, on) => {
  const seen = world(on)
  await $.session.measure(cost(1.9))
  for (let i = 0; i < 5; i++) await step($, 't1', i, 'agent-r')
  expect(seen.requests).toBe(1)
})

test('review control: the same 5 steps with a measurement after each step are held after the first', { options: { capUsd: 2 } }, async ($, on) => {
  const seen = world(on)
  await $.session.measure(cost(1.9))
  for (let i = 0; i < 5; i++) {
    await step($, 't1', i)
    await $.session.measure(cost(seen.engineCost))
  }
  expect(seen.requests).toBe(1)
})

test('review control: subagent steps with a measurement after each are held after the first', { options: { capUsd: 2 } }, async ($, on) => {
  const seen = world(on)
  await $.session.measure(cost(1.9))
  for (let i = 0; i < 5; i++) {
    await step($, 't1', i, 'agent-r')
    await $.session.measure(cost(seen.engineCost))
  }
  expect(seen.requests).toBe(1)
})
