import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { SessionMeasureInput } from 'claude-code'

import type { HeldCap } from '../types'
import { capOf } from './cap'

const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const

// The spend cap (`capUsd`). Each test stands for the engine beneath the plugin, as in the other
// test files: `requests` counts the model requests that reached the engine.

type On = Parameters<TestBody>[1]
type Dollar = Parameters<TestBody>[0]

const world = (on: On, opts: { noToasts?: boolean } = {}) => {
  const seen = { requests: 0, toasts: [] as string[] }
  on('fs.write', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', (_, e) => {
    if (opts.noToasts) throw new Error('no toasts here')
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('session.id', () => ({ value: 'sess-c' }))
  on('session.start', () => ({ cwd: '.' }))
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
  expect((await $.command.run({ command: 'spend-cap', args: 'lots', ...RUN })).text).toBe('Not a cap: "lots". Give dollars, like /spend-cap 5, or /spend-cap off.')
  await step($, 1)
  expect(seen.requests).toBe(0)
  expect((await $.command.run({ command: 'spend-cap', args: '3', ...RUN })).text).toBe('Spend cap set to $3.00 for this session. Cost so far $1.20.')
  await step($, 2)
  expect(seen.requests).toBe(1)
  await $.session.measure(cost(3.1))
  await step($, 3)
  expect(seen.requests).toBe(1)
  expect((await $.command.run({ command: 'spend-cap', args: 'off', ...RUN })).text).toBe('Spend cap off for this session. Cost so far $3.10.')
  await step($, 4)
  expect(seen.requests).toBe(2)
  expect((await $.command.run({ command: 'spend-cap', args: '', ...RUN })).text).toBe('No spend cap. Cost so far $3.10.')
})

test('a cap of 0 is off; /spend-cap takes "$4" as four dollars and refuses 0', { options: { capUsd: 0 } }, async ($, on) => {
  const seen = world(on)
  await $.session.measure(cost(9))
  await step($, 0)
  expect(seen.requests).toBe(1)
  expect((await $.command.run({ command: 'spend-cap', args: '0', ...RUN })).text).toContain('Not a cap')
  expect((await $.command.run({ command: 'spend-cap', args: '$4', ...RUN })).text).toBe('Spend cap set to $4.00 for this session. Cost so far $9.00.')
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

// Cost that crosses 80 percent inside one turn: the read before each step is the only reading there is
// until the turn ends. `reads` is what `$.session.usage()` answers, one figure per step; the last repeats.
const reads = (on: On, usd: number[]) => {
  let n = 0
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 40000, window: 200000, percent: 20 }, rateLimits: [], cost: { usd: usd[Math.min(n++, usd.length - 1)]! } } }))
}

test('a tool loop crossing 80 percent inside a turn gets the notice, before the cap holds it', { options: { capUsd: 2 } }, async ($, on) => {
  const seen = world(on)
  reads(on, [1, 1.35, 1.7, 2.05])
  await $.session.measure(cost(1))
  for (let i = 0; i < 4; i++) await step($, i)
  expect(seen.requests).toBe(3)
  await $.session.measure(cost(2.05))
  expect(seen.toasts).toEqual(['Spend cap: $1.70 of $2.00 used'])
})

test('comparison: a step under 80 percent says nothing', { options: { capUsd: 2 } }, async ($, on) => {
  const seen = world(on)
  reads(on, [1.59])
  await step($, 0)
  expect(seen.toasts).toEqual([])
})

test('the notice is said once: by later steps, by two steps at once, and by the measurement after', { options: { capUsd: 2 } }, async ($, on) => {
  const seen = world(on)
  reads(on, [1.7, 1.75, 1.8])
  await Promise.all([step($, 0, 'agent-a'), step($, 0, 'agent-b')])
  await step($, 1)
  await $.session.measure(cost(1.9))
  expect(seen.toasts).toEqual(['Spend cap: $1.70 of $2.00 used'])
})

test('a surface that refuses the toast still gets its step', { options: { capUsd: 2 } }, async ($, on) => {
  const seen = world(on, { noToasts: true })
  reads(on, [1.7])
  expect((await step($, 0)).result.answer).toBe('fine')
  expect(seen.requests).toBe(1)
})

test('a read still out when the session ends gives the new session no notice', { options: { capUsd: 2 } }, async ($, on) => {
  const seen = world(on)
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  let answer = () => {}
  const held = new Promise<void>(r => (answer = r))
  let asked = false
  on('session.usage', async () => {
    asked = true
    await held
    return { value: { startedAt: 0, context: { tokens: 40000, window: 200000, percent: 20 }, rateLimits: [], cost: { usd: 1.7 } } }
  })
  await $.session.measure(cost(0))
  const out = step($, 0)
  for (let i = 0; i < 1000 && !asked; i++) await Promise.resolve()
  expect(asked).toBe(true)
  await $.session.end({ sessionId: 'sess-c', reason: 'clear' } as any)
  answer()
  await out
  expect(seen.toasts).toEqual([])
})

test('/spend-cap takes plain dollars only: hex, octal, binary and exponent forms change nothing', { options: { capUsd: 3 } }, async ($, on) => {
  world(on)
  for (const args of ['0x10', '0X10', '0b11', '0o7', '1e2', '1E2', '+5', '-5', '5 5', '$', '.', 'Infinity']) {
    expect((await $.command.run({ command: 'spend-cap', args, ...RUN })).text).toBe(`Not a cap: "${args}". Give dollars, like /spend-cap 5, or /spend-cap off.`)
  }
  expect((await $.command.run({ command: 'spend-cap', args: '', ...RUN })).text).toBe('Spend cap $3.00. No cost reading yet.')
})

test('comparison: every plain way to write dollars still sets the cap', () => {
  const plain: [string, number][] = [['5', 5], ['2.50', 2.5], ['$4', 4], ['$0.50', 0.5], ['.5', 0.5], ['$.5', 0.5], ['5.', 5], [' 7 ', 7]]
  for (const [text, usd] of plain) expect(capOf(text)).toBe(usd)
})

test('the option stays a number first: a number in any notation is that number', () => {
  expect(capOf(1e2)).toBe(100)
  expect(capOf(0x10)).toBe(16)
  expect(capOf(0)).toBe(null)
  expect(capOf(-1)).toBe(null)
  expect(capOf(Number.NaN)).toBe(null)
  expect(capOf(undefined)).toBe(null)
})

// A reload: the module starts over, `register` takes the cap from the options, and session.start fires again; what
// the host holds stays. The kit has no reload, but each test loads the module fresh, so `host` holding a value at the
// start stands for what a reload finds.
const host = (on: On, cap?: HeldCap) => {
  const held = new Map<string, unknown>(cap ? [['cap', { shape: 'cap-1', value: cap }]] : [])
  on('state.get', (_, e) => ({ value: { value: held.get(e.key), version: 1 } }) as any)
  on('state.set', (_, e) => (held.set(e.key, e.value), { value: { isSet: true, version: 1 } }))
  return held
}
const reloaded = async ($: Dollar) => {
  await $.session.start({ cwd: '.' } as any)
  return (await $.command.run({ command: 'spend-cap', args: '', ...RUN })).text
}

test('/spend-cap leaves the cap with the host, and the option it was set over', { options: { capUsd: 2 } }, async ($, on) => {
  world(on)
  const held = host(on)
  await $.command.run({ command: 'spend-cap', args: '5', ...RUN })
  expect(held.get('cap')).toEqual({ shape: 'cap-1', value: { usd: 5, option: 2 } })
  await $.command.run({ command: 'spend-cap', args: 'off', ...RUN })
  expect(held.get('cap')).toEqual({ shape: 'cap-1', value: { usd: null, option: 2 } })
})

test('after a reload a cap set with /spend-cap is still the cap', async ($, on) => {
  world(on)
  host(on, { usd: 5, option: null })
  expect(await reloaded($)).toContain('Spend cap $5.00.')
})

test('after a reload a cap lifted with /spend-cap off stays lifted', { options: { capUsd: 2 } }, async ($, on) => {
  world(on)
  host(on, { usd: null, option: 2 })
  expect(await reloaded($)).toContain('No spend cap.')
})

test('comparison: a new capUsd in /config beats a cap set over the old one', { options: { capUsd: 3 } }, async ($, on) => {
  world(on)
  host(on, { usd: 5, option: 2 })
  expect(await reloaded($)).toContain('Spend cap $3.00.')
})

test('comparison: with nothing held a session starts on its option', { options: { capUsd: 3 } }, async ($, on) => {
  world(on)
  host(on)
  expect(await reloaded($)).toContain('Spend cap $3.00.')
})
