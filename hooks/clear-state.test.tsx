import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

// a /clear goes on under a new session id with no session.start (declarations 4464). The
// usage pane's one-time opening and the spend figures must start over even when no subagent runs after it.

const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const
const u = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' }
const hot = { context: { window: 200000, percent: 20 }, rateLimits: [{ kind: 'five_hour', percentUsed: 85 }], changed: ['rateLimits'] } as any

const world = (on: Parameters<TestBody>[1], sid: { v: string }) => {
  const opens: string[] = []
  on('fs.write', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', (_, e) => (opens.push(e.id), { value: { isPlaced: true } }))
  on('session.id', () => ({ value: sid.v }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: u }
  })
  return { opens }
}
const step = async ($: Parameters<TestBody>[0], index: number, agentId: string) => {
  const s = $.turn.step({ turnId: 't1', index, model: 'claude-opus-5-5', messageCount: 3, agentId })
  for (;;) {
    const n = await s.next()
    if (n.done) return n.value
  }
}
const clear = ($: Parameters<TestBody>[0], sid: { v: string }, next: string) =>
  $.session.end({ reason: 'clear', sessionId: sid.v, resume: { id: sid.v } } as any).catch(() => undefined).then(() => { sid.v = next })

test('comparison: after /clear and a subagent, an 85% window opens the usage pane again', async ($, on) => {
  const sid = { v: 'k-old' }
  const { opens } = world(on, sid)
  await step($, 0, 'k-first')
  await $.session.measure(hot)
  await clear($, sid, 'k-new')
  await step($, 0, 'k-agent')
  await $.session.measure(hot)
  expect(opens.filter(o => o === 'usage-file').length).toBe(2)
})

test('after /clear with no subagent, an 85% window opens the usage pane again', async ($, on) => {
  const sid = { v: 'm-old' }
  const { opens } = world(on, sid)
  await step($, 0, 'm-first')
  await $.session.measure(hot)
  await clear($, sid, 'm-new')
  await $.session.measure(hot)
  expect(opens.filter(o => o === 'usage-file').length).toBe(2)
})

test('comparison: a session with no subagent answers /subagent-spend with subagents 0', async ($, on) => {
  const sid = { v: 'n-only' }
  world(on, sid)
  const out = (await $.command.run({ command: 'subagent-spend', args: '', ...RUN })) as { text: string }
  expect(out.text.includes('subagents 0 ')).toBe(true)
})

test('after /clear with no subagent yet, /subagent-spend answers subagents 0', async ($, on) => {
  const sid = { v: 'p-old' }
  world(on, sid)
  await step($, 0, 'p-a')
  await step($, 0, 'p-b')
  await clear($, sid, 'p-new')
  const out = (await $.command.run({ command: 'subagent-spend', args: '', ...RUN })) as { text: string }
  expect(out.text).toBe('Subagent spend pane opened. subagents 0 | tok 0 (out 0)')
})
