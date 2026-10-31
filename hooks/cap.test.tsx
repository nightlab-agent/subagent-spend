import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { SessionMeasureInput } from 'claude-code'

// The spend cap (`capUsd`). Each test stands for the engine beneath the plugin, as in the other
// test files: `requests` counts the model requests that reached the engine.

type On = Parameters<TestBody>[1]
type Dollar = Parameters<TestBody>[0]

const world = (on: On) => {
  const seen = { requests: 0, toasts: [] as string[] }
  on('fs.write', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', (_, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('session.id', () => ({ value: 'sess-c' }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('turn.step', async function* (_, e) {
    seen.requests++
    const usage = e.agentId ? { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' } : null
    return { turnId: e.turnId, index: e.index, answer: 'fine', toolUses: [], stopReason: 'end_turn', usage }
  })
  return seen
}

const step = async ($: Dollar, index: number, agentId?: string) => {
  const s = $.turn.step({ turnId: 't1', index, model: 'claude-opus-5-5', messageCount: 3 + index, ...(agentId ? { agentId } : {}) })
  const texts: string[] = []
  for (;;) {
    const n = await s.next()
    if (n.done) return { result: n.value, texts }
    if (n.value.kind === 'text') texts.push(n.value.text)
  }
}

const cost = (usd: number): SessionMeasureInput => ({
  context: { tokens: 40000, window: 200000, percent: 20 },
  rateLimits: [],
  cost: { usd },
  changed: ['cost'],
})

test('at the cap the next main step makes no request and says why, in the transcript', { options: { capUsd: 2 } }, async ($, on) => {
  const seen = world(on)
  await $.session.measure(cost(1.5))
  expect((await step($, 0)).result.answer).toBe('fine')
  expect(seen.requests).toBe(1)
  await $.session.measure(cost(2.01))
  const held = await step($, 1)
  expect(seen.requests).toBe(1)
  expect(held.result.toolUses).toEqual([])
  expect(held.result.answer).toContain('Spend cap reached: this session has cost $2.01 of the $2.00 cap')
  expect(held.texts.join('')).toBe(held.result.answer)
})

test("a subagent's step at the cap is held too", { options: { capUsd: 2 } }, async ($, on) => {
  const seen = world(on)
  await $.session.measure(cost(2))
  const held = await step($, 0, 'agent-c')
  expect(seen.requests).toBe(0)
  expect(held.result.answer).toContain('Spend cap reached')
})

test('control: under the cap every step goes out, main and subagent', { options: { capUsd: 2 } }, async ($, on) => {
  const seen = world(on)
  await $.session.measure(cost(1.99))
  await step($, 0)
  await step($, 1, 'agent-c')
  expect(seen.requests).toBe(2)
})

test('control: with no capUsd nothing is held, whatever the cost', async ($, on) => {
  const seen = world(on)
  await $.session.measure(cost(500))
  await step($, 0)
  expect(seen.requests).toBe(1)
  expect(seen.toasts).toEqual([])
})

test('a toast at 80 percent of the cap, once; none under it', { options: { capUsd: 5 } }, async ($, on) => {
  const seen = world(on)
  await $.session.measure(cost(3.99))
  expect(seen.toasts).toEqual([])
  await $.session.measure(cost(4))
  await $.session.measure(cost(4.5))
  expect(seen.toasts).toEqual(['Spend cap: $4.00 of $5.00 used'])
})

test('/spend-cap raises the cap and the held session goes on; off lifts it; a bad value changes nothing', { options: { capUsd: 1 } }, async ($, on) => {
  const seen = world(on)
  await $.session.measure(cost(1.2))
  await step($, 0)
  expect(seen.requests).toBe(0)
  expect((await $.command.run({ command: 'spend-cap', args: 'lots' })).text).toBe('Not a cap: "lots". Give dollars, like /spend-cap 5, or /spend-cap off.')
  await step($, 1)
  expect(seen.requests).toBe(0)
  expect((await $.command.run({ command: 'spend-cap', args: '3' })).text).toBe('Spend cap set to $3.00 for this session. Cost so far $1.20.')
  await step($, 2)
  expect(seen.requests).toBe(1)
  await $.session.measure(cost(3.1))
  await step($, 3)
  expect(seen.requests).toBe(1)
  expect((await $.command.run({ command: 'spend-cap', args: 'off' })).text).toBe('Spend cap off for this session. Cost so far $3.10.')
  await step($, 4)
  expect(seen.requests).toBe(2)
  expect((await $.command.run({ command: 'spend-cap', args: '' })).text).toBe('No spend cap. Cost so far $3.10.')
})

test('a cap of 0 is off; /spend-cap takes "$4" as four dollars and refuses 0', { options: { capUsd: 0 } }, async ($, on) => {
  const seen = world(on)
  await $.session.measure(cost(9))
  await step($, 0)
  expect(seen.requests).toBe(1)
  expect((await $.command.run({ command: 'spend-cap', args: '0' })).text).toContain('Not a cap')
  expect((await $.command.run({ command: 'spend-cap', args: '$4' })).text).toBe('Spend cap set to $4.00 for this session. Cost so far $9.00.')
  await step($, 1)
  expect(seen.requests).toBe(1)
})

test('a /clear starts the cost over: the new session is not held on the old cost', { options: { capUsd: 2 } }, async ($, on) => {
  const seen = world(on)
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.measure(cost(2.5))
  await step($, 0)
  expect(seen.requests).toBe(0)
  await $.session.end({ sessionId: 'sess-c', reason: 'clear' } as any)
  await step($, 1)
  expect(seen.requests).toBe(1)
})
