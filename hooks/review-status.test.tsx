import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { SessionMeasureInput } from 'claude-code'

// With a cap, the cost is read before each step (./cap.ts) but the status line's dollar figure came only
// from session.measure, after a turn: mid-turn the line said $0.00 while the cap counted $0.11 (preview
// 20261031-202638). The line must show the figure the cap holds on.

type On = Parameters<TestBody>[1]
type Dollar = Parameters<TestBody>[0]

const world = (on: On) => {
  const seen = { lines: [] as (string | undefined)[], engineCost: 0, fail: false }
  on('fs.write', () => {
    if (seen.fail) throw new Error('read-only file system')
    return { value: undefined }
  })
  on('ui.status', (_, e) => {
    seen.lines.push(e.text)
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'sess-s' }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 40000, window: 200000, percent: 20 }, rateLimits: [], cost: { usd: seen.engineCost } } }))
  on('turn.step', async function* (_, e) {
    seen.engineCost += 0.11
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

test('review: with a cap, the status line cost follows the cost read before each step', { options: { capUsd: 5 } }, async ($, on) => {
  const seen = world(on)
  await $.session.measure(cost(0))
  for (let i = 0; i < 3; i++) await step($, 't1', i) // one turn: no measurement inside it
  expect(seen.lines.at(-1)).toContain('$0.22')
  expect(seen.lines.at(-1)).not.toContain('$0.00')
})

test('review control: with a cap, after a measurement the line shows that measurement', { options: { capUsd: 5 } }, async ($, on) => {
  const seen = world(on)
  await $.session.measure(cost(1.5))
  expect(seen.lines.at(-1)).toContain('$1.50')
})

const usage5h = { ...cost(1), rateLimits: [{ kind: 'five_hour', percentUsed: 40 }, { kind: 'seven_day', percentUsed: 12 }] } as SessionMeasureInput

test('the unwritten rows notice stands beside the rows figures, with the cost inside 80 columns', { options: { capUsd: 5 } }, async ($, on) => {
  const seen = world(on)
  seen.fail = true
  await $.session.measure(usage5h)
  await step($, 't1', 0, 'agent-s')
  await step($, 't1', 1)
  const line = seen.lines.at(-1) ?? ''
  expect(line).toContain('rows file not written')
  expect(line).toContain('subagents 1')
  expect(line.slice(0, 80)).toContain('$1.00')
})

test('comparison: with writes landing the line has the same figures and no notice', { options: { capUsd: 5 } }, async ($, on) => {
  const seen = world(on)
  await $.session.measure(usage5h)
  await step($, 't1', 0, 'agent-s')
  await step($, 't1', 1)
  const line = seen.lines.at(-1) ?? ''
  expect(line).not.toContain('rows file not written')
  expect(line).toContain('subagents 1')
  expect(line.slice(0, 80)).toContain('$1.00')
})

test('a measurement older than the read before a step leaves the line on the figure the cap holds on', { options: { capUsd: 5 } }, async ($, on) => {
  const seen = world(on)
  await $.session.measure(cost(0.5))
  seen.engineCost = 1.5
  await step($, 't1', 0)
  await $.session.measure(cost(1))
  expect(seen.lines.at(-1)).toContain('$1.50')
})

test('comparison: a measurement above the read moves the line up', { options: { capUsd: 5 } }, async ($, on) => {
  const seen = world(on)
  await $.session.measure(cost(0.5))
  seen.engineCost = 1.5
  await step($, 't1', 0)
  await $.session.measure(cost(2))
  expect(seen.lines.at(-1)).toContain('$2.00')
})

test('comparison: a measurement with no cost shows none, whatever was read before', { options: { capUsd: 5 } }, async ($, on) => {
  const seen = world(on)
  await $.session.measure(cost(0.5))
  seen.engineCost = 1.5
  await step($, 't1', 0)
  await $.session.measure({ context: { tokens: 40000, window: 200000, percent: 20 }, rateLimits: [], changed: ['context'] })
  expect(seen.lines.at(-1)).not.toContain('$')
})
