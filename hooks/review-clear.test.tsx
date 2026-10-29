import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

// Review tests (critic pass, 2026-10-29). Not product tests.

type Written = { path: string; text: string }
const u = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' }
const PANE = {
  plugin: 'subagent-spend',
  component: 'Pane',
  requestId: 'subagent-spend',
  props: { title: 'Subagent spend', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const
const UPANE = { ...PANE, requestId: 'usage-file', props: { ...PANE.props, title: 'Usage' } } as const

const world = (on: Parameters<TestBody>[1], sid: { v: string }, gate: { hold: Promise<void> | null; held?: boolean }) => {
  const writes: Written[] = []
  on('fs.write', (_, e) => (writes.push({ path: e.path, text: e.text }), { value: undefined }))
  // the .gitignore check: a slow disk answers late when `gate.hold` is set
  on('fs.exists', async () => {
    const hold = gate.hold
    if (hold) {
      gate.held = true
      await hold
    }
    return { value: true }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.id', () => ({ value: sid.v }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
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
const clear = ($: Parameters<TestBody>[0], sid: { v: string }, next: string) =>
  $.session.end({ reason: 'clear', sessionId: sid.v, resume: { id: sid.v } } as any).catch(() => undefined).then(() => { sid.v = next })
const lastOf = (w: Written[], name: string) => w.filter(x => x.path.endsWith(name)).at(-1)?.text ?? '(none)'

test('review comparison: a rows-file write held on a slow .gitignore check, no /clear, keeps both rows', async ($, on) => {
  const sid = { v: 'rv1-old' }
  const gate: { hold: Promise<void> | null; held?: boolean } = { hold: null }
  const { writes } = world(on, sid, gate)
  await step($, 0, 'rv1-a')
  let release = () => {}
  gate.hold = new Promise<void>(r => (release = r))
  const pending = step($, 0, 'rv1-b')
  while (!gate.held) await Promise.resolve()
  gate.hold = null
  release()
  await pending
  expect(lastOf(writes, 'rv1-old.jsonl').split('\n').filter(Boolean).length).toBe(2)
})

test('review kind 1/2: a rows-file write held on a slow .gitignore check across /clear does not empty the old session file', async ($, on) => {
  const sid = { v: 'rv2-old' }
  const gate: { hold: Promise<void> | null; held?: boolean } = { hold: null }
  const { writes } = world(on, sid, gate)
  await step($, 0, 'rv2-a')
  let release = () => {}
  gate.hold = new Promise<void>(r => (release = r))
  const pending = step($, 0, 'rv2-b')
  while (!gate.held) await Promise.resolve()
  await clear($, sid, 'rv2-new')
  gate.hold = null
  release()
  await pending
  expect(lastOf(writes, 'rv2-old.jsonl').split('\n').filter(Boolean).length).toBe(2)
})

test('review comparison: /clear then a subagent step, the spend pane lists only the new agent', async ($, on) => {
  const sid = { v: 'rv3-old' }
  world(on, sid, { hold: null })
  await step($, 0, 'rv3-a')
  await clear($, sid, 'rv3-new')
  await step($, 0, 'rv3-n')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /subagents, / }))?.text).toBe('1 subagents, 15 tokens')
  expect((await ui.findAll({ type: 'Text', text: / turns / })).map(t => t.text.split('  ')[1])).toEqual(['rv3-n'])
  await ui.unmount()
})

test('review kind 1: after /clear with no subagent yet, the spend pane agrees with /subagent-spend (0 subagents)', async ($, on) => {
  const sid = { v: 'rv4-old' }
  world(on, sid, { hold: null })
  await step($, 0, 'rv4-a')
  await clear($, sid, 'rv4-new')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /subagents, / }))?.text).toBe('0 subagents, 0 tokens')
  await ui.unmount()
})

test('review kind 1: after /clear with no measurement yet, the usage pane does not show the old session figures', async ($, on) => {
  const sid = { v: 'rv5-old' }
  world(on, sid, { hold: null })
  await $.session.measure({ context: { window: 200000, percent: 20 }, rateLimits: [{ kind: 'five_hour', percentUsed: 40 }], cost: { usd: 3.5 }, changed: ['rateLimits'] } as any)
  await clear($, sid, 'rv5-new')
  const ui = await $.ui.mount({ ...UPANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Cost/ }))?.text ?? 'no cost line').toBe('no cost line')
  await ui.unmount()
})
