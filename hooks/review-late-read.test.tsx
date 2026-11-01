import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { SessionMeasureInput } from 'claude-code'

// Out of order: with a cap, the cost is read before each step, and two subagents step at once.
// The read that began first can answer last, with the older (lower) cost. It must not bring the
// older figure back: not on the status line, and not in the cap's count, where a lower figure
// would let a step through after the cap was reached.

type On = Parameters<TestBody>[1]
type Dollar = Parameters<TestBody>[0]

const world = (on: On, answers: { usd: number; wait?: Promise<void> }[]) => {
  const seen = { lines: [] as (string | undefined)[], engineSteps: 0, reads: 0 }
  on('fs.write', () => ({ value: undefined }))
  on('ui.status', (_, e) => {
    seen.lines.push(e.text)
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'sess-late' }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('session.usage', async () => {
    const a = answers[Math.min(seen.reads++, answers.length - 1)]!
    if (a.wait) await a.wait
    return { value: { startedAt: 0, context: { tokens: 40000, window: 200000, percent: 20 }, rateLimits: [], cost: { usd: a.usd } } }
  })
  on('turn.step', async function* (_, e) {
    seen.engineSteps++
    return { turnId: e.turnId, index: e.index, answer: 'tool', toolUses: [], stopReason: 'tool_use', usage: null }
  })
  return seen
}

const step = async ($: Dollar, turnId: string, index: number, agentId?: string) => {
  const s = $.turn.step({ turnId, index, model: 'claude-opus-5-5', messageCount: 3 + index, ...(agentId ? { agentId } : {}) } as never)
  for (;;) {
    const n = await s.next()
    if (n.done) return n.value as { answer: string }
  }
}

const cost = (usd: number): SessionMeasureInput => ({ context: { tokens: 40000, window: 200000, percent: 20 }, rateLimits: [], cost: { usd }, changed: ['cost'] })

const gate = () => {
  let open = () => {}
  const wait = new Promise<void>(r => (open = r))
  return { wait, open }
}

test('out of order: the first read answers last with $0.10; the line keeps $0.30', { options: { capUsd: 5 } }, async ($, on) => {
  const g = gate()
  const seen = world(on, [{ usd: 0.1, wait: g.wait }, { usd: 0.3 }])
  await $.session.measure(cost(0))
  const a = step($, 't1', 0, 'agent-a')
  await step($, 't1', 0, 'agent-b')
  g.open()
  await a
  expect(seen.lines.at(-1)).toContain('$0.30')
  expect(seen.lines.at(-1)).not.toContain('$0.10')
})

test('out of order: a late $0.10 read does not undo a cap of $0.25 reached at $0.30', { options: { capUsd: 0.25 } }, async ($, on) => {
  const g = gate()
  const seen = world(on, [{ usd: 0.1, wait: g.wait }, { usd: 0.3 }])
  await $.session.measure(cost(0))
  const a = step($, 't1', 0, 'agent-a')
  await step($, 't1', 0, 'agent-b') // held: $0.30 is past the cap
  g.open()
  await a // its read began before, but it ends after the cap was reached: held too
  expect(seen.engineSteps).toBe(0)
})

test('out of order: a measurement of $0.50 that lands while a step reads $0.40 stays on the line', { options: { capUsd: 5 } }, async ($, on) => {
  const g = gate()
  const seen = world(on, [{ usd: 0.4, wait: g.wait }])
  await $.session.measure(cost(0))
  const a = step($, 't1', 0)
  for (let i = 0; i < 1000 && seen.reads < 1; i++) await Promise.resolve() // the read has begun
  expect(seen.reads).toBe(1)
  await $.session.measure(cost(0.5))
  g.open()
  await a
  expect(seen.lines.at(-1)).toContain('$0.50')
})

test('comparison: the same reads in order, $0.10 then $0.30: the line shows $0.30', { options: { capUsd: 5 } }, async ($, on) => {
  const seen = world(on, [{ usd: 0.1 }, { usd: 0.3 }])
  await $.session.measure(cost(0))
  await step($, 't1', 0, 'agent-a')
  await step($, 't1', 0, 'agent-b')
  expect(seen.lines.at(-1)).toContain('$0.30')
})

test('comparison: in order, a cap of $0.25: the step after a $0.30 read is held', { options: { capUsd: 0.25 } }, async ($, on) => {
  const seen = world(on, [{ usd: 0.1 }, { usd: 0.3 }])
  await $.session.measure(cost(0))
  await step($, 't1', 0)
  const before = seen.engineSteps
  await step($, 't1', 1)
  expect(seen.engineSteps).toBe(before)
})
