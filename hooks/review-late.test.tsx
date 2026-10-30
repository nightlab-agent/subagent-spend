import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

// One subagent (one agentId), two runs (turn t1, then a resume as turn t2). (a) run 1's last step
// end comes late, after run 2's first step was counted. (b) run 2 starts after run 1 ended.

type Written = { path: string; text: string }
const use = (input: number, output: number) => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' })
// run 1's steps carry a big context (9000 in), run 2's a small one (100 in)
const usageOf = (turnId: string) => (turnId === 't1' ? use(9000, 10) : use(100, 5))
const world = (on: Parameters<TestBody>[1], slow: { hold: Promise<void> | null; held?: boolean }) => {
  const writes: Written[] = []
  on('fs.write', (_, e) => (writes.push({ path: e.path, text: e.text }), { value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.id', async () => {
    const hold = slow.hold
    if (hold) {
      slow.held = true
      await hold
    }
    return { value: 'late-s' }
  })
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: usageOf(e.turnId) }
  })
  return { writes }
}
const step = async ($: Parameters<TestBody>[0], turnId: string, index: number, agentId: string) => {
  const s = $.turn.step({ turnId, index, model: 'claude-opus-5-5', messageCount: 3, agentId })
  for (;;) {
    const n = await s.next()
    if (n.done) return n.value
  }
}
const rowsOf = (t: string) => t.split('\n').filter(Boolean).map(l => JSON.parse(l) as Record<string, unknown>)
const lastRow = (w: Written[], id: string) => rowsOf(w.filter(x => x.path.endsWith('late-s.jsonl')).at(-1)!.text).find(r => r.agent_id === id)!
const said = (r: Record<string, unknown>) => `turns=${r.turns} total=${r.total} ctx=${r.context}`

test('comparison (a): run 1 ends, then run 2 steps; the row sums both and shows run 2 context', async ($, on) => {
  const slow: { hold: Promise<void> | null; held?: boolean } = { hold: null }
  const { writes } = world(on, slow)
  await step($, 't0', 0, 'ra-warm')
  await step($, 't1', 0, 'ra-x')
  await step($, 't2', 0, 'ra-x')
  expect(said(lastRow(writes, 'ra-x'))).toBe('turns=2 total=9115 ctx=105')
})

test('(a) a late step end of run 1 lands after run 2 started: the row keeps run 2 context', async ($, on) => {
  const slow: { hold: Promise<void> | null; held?: boolean } = { hold: null }
  const { writes } = world(on, slow)
  await step($, 't0', 0, 'rb-warm') // as clear-race.test.tsx does: one step before the held one
  let release = () => {}
  slow.hold = new Promise<void>(r => (release = r))
  const late = step($, 't1', 0, 'rb-x')
  while (!slow.held) await Promise.resolve()
  slow.hold = null
  await step($, 't2', 0, 'rb-x')
  release()
  await late
  expect(said(lastRow(writes, 'rb-x'))).toBe('turns=2 total=9115 ctx=105')
})

test('(b) a new run after the earlier one ended carries nothing open: each step counted once', async ($, on) => {
  const slow: { hold: Promise<void> | null; held?: boolean } = { hold: null }
  const { writes } = world(on, slow)
  await step($, 't1', 0, 'rc-x')
  await step($, 't1', 1, 'rc-x')
  await step($, 't2', 0, 'rc-x')
  await step($, 't2', 1, 'rc-x')
  expect(said(lastRow(writes, 'rc-x'))).toBe('turns=4 total=18230 ctx=105')
})
