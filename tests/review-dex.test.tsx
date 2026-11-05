import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { EngineInterface, Register, SessionMeasureInput, SessionStartInput, SessionStartResult } from 'claude-code'

import { register } from '../hooks/register'
import { cap } from '../hooks/cap'

type Dollar = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]
const context = { tokens: 40000, window: 200000, percent: 20 }
const measure = (usd: number, percentUsed = 20): SessionMeasureInput => ({
  context, rateLimits: [{ kind: 'five_hour', percentUsed }], cost: { usd }, changed: ['cost', 'rateLimits'],
})
const gate = () => {
  let open = () => {}
  const wait = new Promise<void>(r => (open = r))
  return { wait, open }
}
// Timer turns matter: the kit can defer op dispatch beyond a microtask turn.
const tick = () => new Promise<void>(r => (globalThis as unknown as { setTimeout(f: () => void, ms: number): unknown }).setTimeout(r, 2))
const until = async (ready: () => boolean) => {
  for (let i = 0; i < 300 && !ready(); i++) await tick()
  expect(ready()).toBe(true)
}
const world = (on: On) => {
  const seen = {
    id: 'old', startedAt: 1000, usd: 1, reads: 0, requests: 0,
    lines: [] as (string | undefined)[], files: new Map<string, string>(),
    hold: null as Promise<void> | null, waiting: false, fail: false,
  }
  on('fs.exists', () => ({ value: true }))
  on('fs.write', (_, e) => (seen.files.set(e.path, e.text), { value: undefined }))
  on('ui.status', (_, e) => (seen.lines.push(e.text), { value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.id', () => ({ value: seen.id }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('session.usage', async () => {
    seen.reads++
    const hold = seen.hold
    seen.hold = null
    if (hold) {
      seen.waiting = true
      await hold
      if (seen.fail) return { deny: 'usage unavailable' }
    }
    return { value: { startedAt: seen.startedAt, context, rateLimits: [], cost: { usd: seen.usd } } }
  })
  on('turn.step', async function* (_, e) {
    seen.requests++
    return { turnId: e.turnId, index: e.index, answer: 'fine', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  return seen
}
const clear = ($: Dollar, sessionId: string) => $.session.end({ sessionId, reason: 'clear', resume: { id: sessionId } })
const reset = (seen: ReturnType<typeof world>, id = 'new') => {
  seen.id = id
  seen.startedAt += 1000
  seen.usd = 0.01
}
const step = async ($: Dollar) => {
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 3 })
  for (;;) if ((await stream.next()).done) return
}
const capText = async ($: Dollar) => (await $.command.run({
  command: 'spend-cap', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 },
})).text

// The existing review-order test starts at zero dollars and never arms leftStart.
// Here we assert that both measurements really entered the new usage-read branch.
test('Dex D1: overlapping measurements after a positive-cost clear keep the newest status', async ($, on) => {
  const seen = world(on)
  await clear($, 'old')
  reset(seen)
  const g = gate()
  seen.hold = g.wait
  const older = $.session.measure(measure(0.01, 20))
  await until(() => seen.waiting)
  await $.session.measure(measure(0.02, 80))
  g.open()
  await older
  expect(seen.reads).toBe(3)
  const file = [...seen.files].find(([path]) => path.endsWith('/latest.json'))!
  expect(JSON.parse(file[1]).rateLimits[0].percentUsed).toBe(80)
  expect(seen.lines.at(-1)).toBe('5h 80% | ctx 20% | $0.02')
})

test('Dex D1 comparison: in-order measurements after a positive-cost clear keep the newest status', async ($, on) => {
  const seen = world(on)
  await clear($, 'old')
  reset(seen)
  await $.session.measure(measure(0.01, 20))
  await $.session.measure(measure(0.02, 80))
  expect(seen.reads).toBe(3)
  expect(seen.lines.at(-1)).toBe('5h 80% | ctx 20% | $0.02')
})

test('Dex D2: a measurement waiting across clear cannot restore old cost when its usage read fails', { options: { capUsd: 2 } }, async ($, on) => {
  const seen = world(on)
  await clear($, 'old')
  reset(seen)
  seen.usd = 2.5
  const g = gate()
  seen.hold = g.wait
  const older = $.session.measure(measure(2.5))
  await until(() => seen.waiting)
  await clear($, 'new')
  reset(seen, 'third')
  seen.fail = true
  g.open()
  seen.hold = null
  await older
  await step($)
  expect(await capText($)).toBe('Spend cap $2.00. Cost so far $0.01.')
  expect(seen.requests).toBe(1)
})

test('Dex D2 comparison: the same measurement is dropped if its usage read answers', { options: { capUsd: 2 } }, async ($, on) => {
  const seen = world(on)
  await clear($, 'old')
  reset(seen)
  seen.usd = 2.5
  const g = gate()
  seen.hold = g.wait
  const older = $.session.measure(measure(2.5))
  await until(() => seen.waiting)
  await clear($, 'new')
  reset(seen, 'third')
  g.open()
  await older
  await step($)
  expect(await capText($)).toBe('Spend cap $2.00. Cost so far $0.01.')
  expect(seen.requests).toBe(1)
})

// Also reproducible at the base: the new guard fixes the comparison below,
// but still authenticates an old event using a reading taken after its reset.
// Dex's D3 is a known limit, in the CHANGELOG: a measurement raised before the ledger reset whose usage read answers after
// it carries nothing that tells it from a new one, and comparing costs refused real readings in the fakes.
test('Dex D3 comparison: a gap measurement read before the reset leaves the new session counting', { options: { capUsd: 2 } }, async ($, on) => {
  const seen = world(on)
  seen.usd = 2.5
  await clear($, 'old')
  await $.session.measure(measure(2.5))
  reset(seen)
  await step($)
  expect(await capText($)).toBe('Spend cap $2.00. Cost so far $0.01.')
  expect(seen.requests).toBe(1)
})

// The kit has no reload operation. Call the real register/start handlers with a
// host value that survives activations, as the engine declares for $.state.
type StartHook = ($: EngineInterface, e: SessionStartInput, next: (e: SessionStartInput) => Promise<SessionStartResult>) => Promise<SessionStartResult>
type CommandHook = ($: EngineInterface, e: { args: string }) => Promise<{ text: string }>
const reloads = () => {
  let held: unknown = { shape: 'cap-1', value: { usd: 5, option: 2 } }
  let version = 1
  const $ = {
    state: {
      get: async () => ({ value: held, version }),
      set: async (_: unknown, value: unknown) => {
        held = value
        return { isSet: true, version: ++version }
      },
    },
    command: { register: async (e: { name: string }) => ({ command: e.name }) },
  } as unknown as EngineInterface
  return async (option: number, query = false) => {
    let start: StartHook | undefined
    let command: CommandHook | undefined
    const on = ((event: string, ...args: unknown[]) => {
      if (event === 'session.start') start = args.at(-1) as StartHook
      if (event === 'command.run' && (args[0] as { command?: string }).command === 'spend-cap') command = args.at(-1) as CommandHook
      return { catch: () => undefined }
    }) as Parameters<Register>[0]
    register(on, { capUsd: option })
    const e: SessionStartInput = { cwd: '.', surface: 'terminal', isInteractive: true }
    await start!($, e, async e => ({ cwd: e.cwd }))
    if (query) await command!($, { args: '' })
    return cap.usd
  }
}

test('Dex D4: changing capUsd away and back does not revive an obsolete command cap', async () => {
  const load = reloads()
  expect(await load(2)).toBe(5)
  expect(await load(3)).toBe(3)
  expect(await load(2)).toBe(2)
})

test('Dex D4 comparison: querying the cap between option changes prevents the obsolete cap revival', async () => {
  const load = reloads()
  expect(await load(2)).toBe(5)
  expect(await load(3, true)).toBe(3)
  expect(await load(2)).toBe(2)
})
