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
    lines: [] as (string | undefined)[],
    writes: [] as { path: string; text: string }[],
    ledger: 0,
    fail: false,
    hold: null as Promise<void> | null,
    writing: 0,
    redraw: null as Promise<void> | null,
    redrawing: false,
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
  on('ui.toast', () => ({ value: undefined }))
  on('session.id', () => ({ value: seen.sid }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
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
  on('session.usage', () => ({ value: { startedAt: 0, context: CTX, rateLimits: [], cost: { usd: seen.ledger } } }))
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
const end = ($: Dollar) => $.session.end({ sessionId: 'old', reason: 'clear', resume: { id: 'old' } } as any)
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
