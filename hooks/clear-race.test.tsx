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
