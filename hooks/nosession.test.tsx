import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

// A host may have no session id: the usage part then writes `session: null`, and a subagent step must
// still be counted (a row) or the failure named in the status line.

const u = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' }
const world = (on: Parameters<TestBody>[1]) => {
  const writes: string[] = []
  const statuses: (string | undefined)[] = []
  on('fs.write', (_, e) => (writes.push(e.path), { value: undefined }))
  on('ui.status', (_, e) => (statuses.push(e.text), { value: undefined }))
  on('session.id', () => {
    throw new Error('no session')
  })
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: u }
  })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  return { writes, statuses }
}

test('comparison: on a host with no session id the usage part still writes latest.json', async ($, on) => {
  const { writes } = world(on)
  await $.session.measure({ context: { window: 200000, percent: 20 }, rateLimits: [], changed: ['context'] } as any)
  expect(writes.some(p => p.endsWith('/latest.json'))).toBe(true)
})

test('on a host with no session id a subagent step still counts: a row, or the failure named in the status line', async ($, on) => {
  const { writes, statuses } = world(on)
  const s = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 3, agentId: 'ns-agent' })
  for (;;) {
    const n = await s.next().catch(() => ({ done: true, value: undefined }))
    if (n.done) break
  }
  const counted = writes.some(p => p.endsWith('.jsonl')) || statuses.some(t => (t ?? '').includes('subagent'))
  expect(counted).toBe(true)
})
