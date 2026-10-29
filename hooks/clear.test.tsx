import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

// A /clear ends one session and the process goes on under a new session id with no new session.start
// (Claude Code 2.1.310 declarations, SessionEndInput.reason). The old session's agents must not land in
// the new session's rows file, and the pane opens again at the new session's first subagent.

type Written = { path: string; text: string }
const SPAWN = { tool_use_id: 'toolu_test', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false } as const
const u = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' }

const world = (on: Parameters<TestBody>[1], sid: { v: string }) => {
  const writes: Written[] = []
  let opens = 0
  on('fs.write', (_, e) => (writes.push({ path: e.path, text: e.text }), { value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => ((opens += 1), { value: { isPlaced: true } }))
  on('session.id', () => ({ value: sid.v }))
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: u }
  })
  return { writes, opens: () => opens }
}
const step = async ($: Parameters<TestBody>[0], index: number, agentId: string) => {
  const s = $.turn.step({ turnId: 't1', index, model: 'claude-opus-5-5', messageCount: 3, agentId })
  for (;;) {
    const n = await s.next()
    if (n.done) return n.value
  }
}
const rowsOf = (t: string) => t.split('\n').filter(Boolean).map(l => JSON.parse(l) as Record<string, unknown>)

test('comparison: two agents in one session both go into that session\'s rows file', async ($, on) => {
  const sid = { v: 'sess-same' }
  const { writes } = world(on, sid)
  await step($, 0, 'cmp-agent-1')
  await step($, 1, 'cmp-agent-2')
  const last = writes.filter(w => w.path.endsWith('sess-same.jsonl')).at(-1)!
  const ids = rowsOf(last.text).map(r => r.agent_id)
  expect(ids.includes('cmp-agent-1') && ids.includes('cmp-agent-2')).toBe(true)
})

test('after /clear the new session\'s rows file holds only the new session\'s agents', async ($, on) => {
  const sid = { v: 'sess-old' }
  const { writes } = world(on, sid)
  await step($, 0, 'old-agent')
  await $.session.end({ reason: 'clear', sessionId: 'sess-old', resume: { id: 'sess-old' } } as any).catch(() => undefined)
  sid.v = 'sess-new'
  await step($, 0, 'new-agent')
  const last = writes.filter(w => w.path.endsWith('sess-new.jsonl')).at(-1)!
  const rows = rowsOf(last.text)
  expect(rows.map(r => `${r.agent_id}@${r.session_id}`).join(',')).toBe('new-agent@sess-new')
})

test('after /clear the pane opens itself at the first subagent of the new session', async ($, on) => {
  const sid = { v: 'sess-o1' }
  const w = world(on, sid)
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'open-agent' }))
  await $.agent.spawn({ subagentType: 'Explore', prompt: 'a', description: 'a', ...SPAWN })
  const before = w.opens()
  await $.session.end({ reason: 'clear', sessionId: 'sess-o1', resume: { id: 'sess-o1' } } as any).catch(() => undefined)
  sid.v = 'sess-o2'
  await $.agent.spawn({ subagentType: 'Explore', prompt: 'b', description: 'b', ...SPAWN })
  expect(`${before} then ${w.opens()}`).toBe('1 then 2')
})
