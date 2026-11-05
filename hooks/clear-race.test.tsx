import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

// two subagent steps wait on $.session.id() at once across a /clear. The one that asked
// first (old id) answers last; it must not switch back to the old id and clear the rows.

type Written = { path: string; text: string }
const u = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' }
const world = (on: Parameters<TestBody>[1], sid: { v: string }, slow: { hold: Promise<void> | null; held?: boolean }) => {
  const writes: Written[] = []
  on('fs.write', (_, e) => (writes.push({ path: e.path, text: e.text }), { value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  // the id as it was when asked, answered once `slow.hold` (if any, when asked) is released
  on('session.id', async () => {
    const v = sid.v
    const hold = slow.hold
    if (hold) {
      slow.held = true
      await hold
    }
    return { value: v }
  })
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: u }
  })
  return { writes }
}
const step = async ($: Parameters<TestBody>[0], index: number, agentId: string) => {
  const s = $.turn.step({ turnId: 't1', index, model: 'claude-opus-5-5', messageCount: 3, agentId })
  for (;;) {
    const n = await s.next()
    if (n.done) return n.value
  }
}
const rowsOf = (t: string) => t.split('\n').filter(Boolean).map(l => JSON.parse(l) as Record<string, unknown>)
const lastOf = (w: Written[], name: string) => rowsOf(w.filter(x => x.path.endsWith(name)).at(-1)!.text)

test('comparison: /clear with no overlap keeps the old file whole and the new agent counting', async ($, on) => {
  const sid = { v: 'r-old' }
  const slow: { hold: Promise<void> | null; held?: boolean } = { hold: null }
  const { writes } = world(on, sid, slow)
  await step($, 0, 'r-a')
  await step($, 0, 'r-b')
  await step($, 1, 'r-a')
  sid.v = 'r-new'
  await step($, 0, 'r-c')
  await step($, 1, 'r-c')
  const oldIds = lastOf(writes, 'r-old.jsonl').map(r => r.agent_id).sort().join(',')
  const c = lastOf(writes, 'r-new.jsonl').find(r => r.agent_id === 'r-c')!
  expect(`old=${oldIds} c.turns=${c.turns}`).toBe('old=r-a,r-b c.turns=2')
})

test('a late old session id across /clear leaves the old rows file whole and the new agent counting', async ($, on) => {
  const sid = { v: 'q-old' }
  const slow: { hold: Promise<void> | null; held?: boolean } = { hold: null }
  const { writes } = world(on, sid, slow)
  await step($, 0, 'q-a')
  await step($, 0, 'q-b')
  // q-a's next step asks for the id while it is still q-old, and the answer comes late
  let release = () => {}
  slow.hold = new Promise<void>(r => (release = r))
  const late = step($, 1, 'q-a')
  while (!slow.held) await Promise.resolve()
  // /clear: the new session's first subagent step asks and is answered at once
  sid.v = 'q-new'
  slow.hold = null
  await step($, 0, 'q-c')
  release()
  await late
  await step($, 1, 'q-c')
  const oldIds = lastOf(writes, 'q-old.jsonl').map(r => r.agent_id).sort().join(',')
  const c = lastOf(writes, 'q-new.jsonl').find(r => r.agent_id === 'q-c')!
  expect(`old=${oldIds} c.turns=${c.turns}`).toBe('old=q-a,q-b c.turns=2')
})

test('a resume back into the session left at /clear counts there again', async ($, on) => {
  const sid = { v: 's-a' }
  const slow: { hold: Promise<void> | null; held?: boolean } = { hold: null }
  const { writes } = world(on, sid, slow)
  await step($, 0, 's-x')
  await $.session.end({ reason: 'clear', sessionId: 's-a', resume: { id: 's-a' } } as any).catch(() => undefined)
  sid.v = 's-b'
  await step($, 0, 's-y')
  await $.session.end({ reason: 'resume', sessionId: 's-b', resume: { id: 's-b' } } as any).catch(() => undefined)
  sid.v = 's-a'
  await step($, 0, 's-z')
  expect(lastOf(writes, 's-a.jsonl').map(r => r.agent_id).join(',')).toBe('s-z')
})

test('a step between /clear and the id switch leaves the left rows file whole', async ($, on) => {
  const sid = { v: 'g-old' }
  const slow: { hold: Promise<void> | null; held?: boolean } = { hold: null }
  const { writes } = world(on, sid, slow)
  await step($, 0, 'g-a')
  await step($, 0, 'g-b')
  await $.session.end({ reason: 'clear', sessionId: 'g-old' } as any).catch(() => undefined)
  // the id has not switched yet: the engine still answers the session left
  await step($, 1, 'g-a')
  const oldIds = lastOf(writes, 'g-old.jsonl').map(r => r.agent_id).sort().join(',')
  sid.v = 'g-new'
  await step($, 0, 'g-c')
  const newIds = lastOf(writes, 'g-new.jsonl').map(r => r.agent_id).join(',')
  expect(`old=${oldIds} new=${newIds}`).toBe('old=g-a,g-b new=g-c')
})

test('comparison: a resume back to a session left at /clear counts there, with no step between', async ($, on) => {
  const sid = { v: 'h-old' }
  const slow: { hold: Promise<void> | null; held?: boolean } = { hold: null }
  const { writes } = world(on, sid, slow)
  await step($, 0, 'h-a')
  await $.session.end({ reason: 'clear', sessionId: 'h-old' } as any).catch(() => undefined)
  sid.v = 'h-new'
  await $.session.end({ reason: 'resume', sessionId: 'h-new' } as any).catch(() => undefined)
  sid.v = 'h-old'
  await step($, 1, 'h-a')
  expect(lastOf(writes, 'h-old.jsonl').map(r => r.agent_id).join(',')).toBe('h-a')
})

test('comparison: a host with no session id keeps counting after /clear', async ($, on) => {
  const sid = { v: '' }
  const slow: { hold: Promise<void> | null; held?: boolean } = { hold: null }
  const { writes } = world(on, sid, slow)
  await step($, 0, 'n-a')
  await $.session.end({ reason: 'clear', sessionId: '' } as any).catch(() => undefined)
  await step($, 0, 'n-b')
  expect(lastOf(writes, 'no-session.jsonl').map(r => r.agent_id).join(',')).toBe('n-b')
})
