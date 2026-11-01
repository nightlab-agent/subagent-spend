import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { SessionMeasureInput } from 'claude-code'


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


// The session's cost only grows (declarations: SessionCost "summed over every priced API response",
// SessionMeasureInput.changed "cost: the total grew"). A read that answers HIGHER than the figure
// applied cannot be older; the start-order guard drops it anyway.

test('finding: a read begun before a $0.50 measurement answers $0.60; a $0.55 cap holds the step', { options: { capUsd: 0.55 } }, async ($, on) => {
  const g = gate()
  const seen = world(on, [{ usd: 0.6, wait: g.wait }])
  await $.session.measure(cost(0))
  const a = step($, 't1', 0)
  for (let i = 0; i < 1000 && seen.reads < 1; i++) await Promise.resolve()
  await $.session.measure(cost(0.5))
  g.open()
  await a
  expect(seen.engineSteps).toBe(0)
})

test('comparison: in order, a $0.50 measurement then a read of $0.60: a $0.55 cap holds the step', { options: { capUsd: 0.55 } }, async ($, on) => {
  const seen = world(on, [{ usd: 0.6 }])
  await $.session.measure(cost(0))
  await $.session.measure(cost(0.5))
  await step($, 't1', 0)
  expect(seen.engineSteps).toBe(0)
})

test('finding: two subagent reads, the first answers last with the higher $0.40; the line shows $0.40', { options: { capUsd: 5 } }, async ($, on) => {
  const g = gate()
  const seen = world(on, [{ usd: 0.4, wait: g.wait }, { usd: 0.3 }])
  await $.session.measure(cost(0))
  const a = step($, 't1', 0, 'agent-a')
  await step($, 't1', 0, 'agent-b')
  g.open()
  await a
  expect(seen.lines.at(-1)).toContain('$0.40')
})

test('comparison: the same two reads in order, $0.30 then $0.40: the line shows $0.40', { options: { capUsd: 5 } }, async ($, on) => {
  const seen = world(on, [{ usd: 0.3 }, { usd: 0.4 }])
  await $.session.measure(cost(0))
  await step($, 't1', 0, 'agent-a')
  await step($, 't1', 0, 'agent-b')
  expect(seen.lines.at(-1)).toContain('$0.40')
})

// (c) probe: a read with no cost leaves the cap and the line as the last cost reading left them
test('probe: a read with no cost between two costed reads leaves the line on the newest cost', { options: { capUsd: 5 } }, async ($, on) => {
  const seen = { lines: [] as (string | undefined)[], reads: 0 }
  on('fs.write', () => ({ value: undefined }))
  on('ui.status', (_, e) => (seen.lines.push(e.text), { value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.id', () => ({ value: 's' }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  const usd = [0.2, undefined, 0.3]
  on('session.usage', () => {
    const u = usd[seen.reads++]
    return { value: { startedAt: 0, context: { tokens: 1, window: 200000, percent: 0 }, rateLimits: [], ...(u === undefined ? {} : { cost: { usd: u } }) } }
  })
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: 'x', toolUses: [], stopReason: 'tool_use', usage: null }
  })
  await $.session.measure(cost(0))
  await step($, 't1', 0)
  await step($, 't1', 1)
  expect(seen.lines.at(-1)).toContain('$0.20')
  await step($, 't1', 2)
  expect(seen.lines.at(-1)).toContain('$0.30')
})
