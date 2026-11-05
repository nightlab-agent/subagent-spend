import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { SessionMeasureInput } from 'claude-code'

// What is still running while a session ends. At a /clear the engine (2.1.312, clearConversation) runs the
// session.end chain, then later resets the cost ledger and moves to the new session id; subagents live through it.

type On = Parameters<TestBody>[1]
type Dollar = Parameters<TestBody>[0]
const u = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' }
const CTX = { tokens: 40000, window: 200000, percent: 20 }
const cost = (usd: number): SessionMeasureInput => ({ context: CTX, rateLimits: [], cost: { usd }, changed: ['cost'] })

const world = (on: On) => {
  const seen = {
    requests: 0,
    toasts: [] as string[],
    started: 1000 as number | undefined,
    lines: [] as (string | undefined)[],
    writes: [] as { path: string; text: string }[],
    ledger: 0,
    fail: false,
    hold: null as Promise<void> | null,
    writing: 0,
    redraw: null as Promise<void> | null,
    redrawing: false,
    endHold: null as Promise<void> | null,
    ending: false,
    sid: 'old',
  }
  on('fs.write', async (_, e) => {
    seen.writing++
    if (seen.hold) await seen.hold
    if (seen.fail) throw new Error('read-only file system')
    seen.writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('ui.status', (_, e) => (seen.lines.push(e.text), { value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', (_, e) => (seen.toasts.push(e.text), { value: undefined }))
  on('session.id', () => ({ value: seen.sid }))
  on('session.end', async (_, e) => {
    seen.ending = true
    if (seen.endHold) await seen.endHold
    return { sessionId: e.sessionId }
  })
  on('state.set', async () => {
    const hold = seen.redraw
    seen.redraw = null
    if (hold) {
      seen.redrawing = true
      await hold
    }
    return { value: { isSet: true, version: 1 } }
  })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('session.usage', () => ({ value: { startedAt: seen.started, context: CTX, rateLimits: [], cost: { usd: seen.ledger } } as any }))
  on('turn.step', async function* (_, e) {
    seen.requests++
    return { turnId: e.turnId, index: e.index, answer: 'fine', toolUses: [], stopReason: 'end_turn', usage: e.agentId ? u : null }
  })
  return seen
}
const step = async ($: Dollar, index: number, agentId?: string) => {
  const s = $.turn.step({ turnId: 't1', index, model: 'claude-opus-5-5', messageCount: 3 + index, ...(agentId ? { agentId } : {}) })
  for (;;) {
    const n = await s.next()
    if (n.done) return n.value
  }
}
const end = ($: Dollar, reason = 'clear') => $.session.end({ sessionId: 'old', reason, resume: { id: 'old' } } as any)
// the engine's reset, past the end of the chain: the cost and the start move at once, the id right after
const engineResets = (seen: ReturnType<typeof world>, usd: number) => {
  seen.ledger = usd
  seen.started = 2000
  seen.sid = 'new'
}
const spendCap = async ($: Dollar) => (await $.command.run({ command: 'spend-cap', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })).text
const gate = () => {
  let open = () => {}
  const hold = new Promise<void>(r => (open = r))
  return { hold, open }
}
const until = async (f: () => boolean) => {
  for (let i = 0; i < 300 && !f(); i++) await new Promise(r => (globalThis as any).setTimeout(r, 2))
  expect(f()).toBe(true)
}

test('a rows write that fails after /clear leaves no notice on the new session', async ($, on) => {
  const seen = world(on)
  seen.fail = true
  const g = gate()
  seen.hold = g.hold
  const out = step($, 0, 'bg')
  await until(() => seen.writing > 0)
  await end($)
  g.open()
  await out
  seen.sid = 'new'
  seen.fail = false
  await step($, 1) // the new session's main loop: no subagent, so no write would ever take the notice off
  expect(seen.lines.at(-1) ?? '').not.toContain('not written')
})

test('comparison: a rows write that fails with no /clear puts the notice up', async ($, on) => {
  const seen = world(on)
  seen.fail = true
  const g = gate()
  seen.hold = g.hold
  const out = step($, 0, 'bg')
  await until(() => seen.writing > 0)
  g.open()
  await out
  expect(seen.lines.at(-1) ?? '').toContain('not written')
})

test('a /clear while a step redraws the pane leaves the session its rows file', async ($, on) => {
  const seen = world(on)
  await step($, 0, 'a')
  const g = gate()
  seen.redraw = g.hold
  const out = step($, 1, 'a')
  await until(() => seen.redrawing)
  await end($)
  seen.sid = 'new'
  g.open()
  await out
  const last = seen.writes.filter(w => w.path.endsWith('old.jsonl')).at(-1)!
  expect(last.text).toContain('"turns":2')
})

test('comparison: with no /clear the same held redraw writes the step', async ($, on) => {
  const seen = world(on)
  await step($, 0, 'a')
  const g = gate()
  seen.redraw = g.hold
  const out = step($, 1, 'a')
  await until(() => seen.redrawing)
  g.open()
  await out
  const last = seen.writes.filter(w => w.path.endsWith('old.jsonl')).at(-1)!
  expect(last.text).toContain('"turns":2')
})

test('a step that reads the cost while the end step runs does not hold the new session on the old cost', { options: { capUsd: 2 } }, async ($, on) => {
  const seen = world(on)
  seen.ledger = 2.5
  const g = gate()
  seen.endHold = g.hold
  const ending = end($)
  await until(() => seen.ending)
  await step($, 0, 'late') // a subagent of the old session
  g.open()
  await ending
  seen.sid = 'new'
  seen.ledger = 0.01
  seen.requests = 0
  await step($, 0)
  expect(seen.requests).toBe(1)
})

test('comparison: with no read while the end step runs the new session steps', { options: { capUsd: 2 } }, async ($, on) => {
  const seen = world(on)
  seen.ledger = 2.5
  await step($, 0)
  await end($)
  seen.sid = 'new'
  seen.ledger = 0.01
  seen.requests = 0
  await step($, 0)
  expect(seen.requests).toBe(1)
})

test('a subagent step between session.end and the ledger reset leaves the new session its own cost', { options: { capUsd: 2 } }, async ($, on) => {
  const seen = world(on)
  seen.ledger = 1.7
  await $.session.measure(cost(1))
  await end($)
  await step($, 0, 'bg')
  engineResets(seen, 0.01)
  await step($, 1)
  expect(await spendCap($)).toBe('Spend cap $2.00. Cost so far $0.01.')
})

test('comparison: the same step after the ledger reset counts', { options: { capUsd: 2 } }, async ($, on) => {
  const seen = world(on)
  seen.ledger = 1.7
  await $.session.measure(cost(1))
  await end($)
  engineResets(seen, 0.01)
  await step($, 0, 'bg')
  expect(await spendCap($)).toBe('Spend cap $2.00. Cost so far $0.01.')
})

test('an old cost past the cap, read in that gap, does not hold the new session', { options: { capUsd: 2 } }, async ($, on) => {
  const seen = world(on)
  seen.ledger = 2.05
  await $.session.measure(cost(1))
  await end($)
  await step($, 0, 'bg')
  engineResets(seen, 0.01)
  seen.requests = 0
  await step($, 1)
  expect(seen.requests).toBe(1)
})

test("a read in that gap does not spend the new session's 80 percent notice", { options: { capUsd: 2 } }, async ($, on) => {
  const seen = world(on)
  seen.ledger = 1.7
  await $.session.measure(cost(1))
  await end($)
  await step($, 0, 'bg')
  engineResets(seen, 1.65)
  seen.toasts.length = 0
  await step($, 1)
  expect(seen.toasts).toEqual(['Spend cap: $1.65 of $2.00 used'])
})

test('a measurement raised in that gap leaves the new session its own cost, and the line alone', { options: { capUsd: 2 } }, async ($, on) => {
  const seen = world(on)
  seen.ledger = 1.7
  await $.session.measure(cost(1.7))
  await end($)
  await $.session.measure(cost(1.7))
  expect(seen.lines.at(-1) ?? '').not.toContain('$1.70')
  engineResets(seen, 0.01)
  await step($, 1)
  expect(await spendCap($)).toBe('Spend cap $2.00. Cost so far $0.01.')
})

test('comparison: a measurement after the ledger reset counts, and every one after', { options: { capUsd: 2 } }, async ($, on) => {
  const seen = world(on)
  await $.session.measure(cost(1.7))
  await end($)
  engineResets(seen, 0.2)
  await $.session.measure(cost(0.2))
  expect(seen.lines.at(-1)).toContain('$0.20')
  seen.ledger = 0.3
  await $.session.measure(cost(0.3))
  expect(seen.lines.at(-1)).toContain('$0.30')
})

test('comparison: another reason for ending keeps no key, so a session with the same start still counts', { options: { capUsd: 2 } }, async ($, on) => {
  const seen = world(on)
  seen.ledger = 1
  await end($, 'resume') // a fork of the same session keeps its first launch's start
  await step($, 0)
  expect(await spendCap($)).toBe('Spend cap $2.00. Cost so far $1.00.')
})

test('comparison: a build that reports no start still counts the cost after a /clear', { options: { capUsd: 2 } }, async ($, on) => {
  const seen = world(on)
  seen.started = undefined
  await end($)
  engineResets(seen, 0.5)
  seen.started = undefined
  await step($, 0)
  expect(await spendCap($)).toBe('Spend cap $2.00. Cost so far $0.50.')
})

test("a /clear takes the old session's figures off the line, and a read after it brings none of them back", { options: { capUsd: 5 } }, async ($, on) => {
  const seen = world(on)
  await step($, 0, 'bg')
  await $.session.measure(cost(1))
  expect(seen.lines.at(-1)).toContain('subagents 1')
  expect(seen.lines.at(-1)).toContain('ctx 20%')
  await end($)
  expect(seen.lines.at(-1) ?? '').not.toContain('subagents')
  expect(seen.lines.at(-1) ?? '').not.toContain('ctx')
  engineResets(seen, 0.01)
  await step($, 1)
  expect(seen.lines.at(-1) ?? '').not.toContain('subagents')
  expect(seen.lines.at(-1) ?? '').not.toContain('ctx')
})

test('a rows write that fails while the end step runs leaves no notice either', async ($, on) => {
  const seen = world(on)
  seen.fail = true
  const g = gate()
  seen.endHold = g.hold
  const ending = end($)
  await until(() => seen.ending)
  await step($, 0, 'late')
  g.open()
  await ending
  seen.sid = 'new'
  seen.fail = false
  await step($, 1)
  expect(seen.lines.at(-1) ?? '').not.toContain('not written')
})

test('a read while a resume ends, which has no key, does not hold the session resumed', { options: { capUsd: 2 } }, async ($, on) => {
  const seen = world(on)
  seen.ledger = 2.5
  const g = gate()
  seen.endHold = g.hold
  const ending = end($, 'resume')
  await until(() => seen.ending)
  await step($, 0, 'late')
  g.open()
  await ending
  seen.ledger = 0.01
  seen.requests = 0
  await step($, 0)
  expect(seen.requests).toBe(1)
})
