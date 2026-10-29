import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

// Three kinds of collision: out of order (an older event finishes after a newer one), two at
// once (two subagents step while the main turn is still open), and look-alikes (ids that share
// a start or an end, or agents that share a type name). The usage file's out-of-order case is in usage.test.tsx ("two
// measurements at once: the first one's session id comes back late ..."). Each test stands for
// the engine beneath the plugin; nothing here touches the real file system or a model.

type Written = { path: string; text: string }
type On = Parameters<TestBody>[1]
type Dollar = Parameters<TestBody>[0]
type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number; model: string }

const usage = (i: number): Usage => ({ input_tokens: i, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' })

const held = () => {
  let release!: () => void
  const wait = new Promise<void>(resolve => {
    release = resolve
  })
  return { wait, release }
}

const step = async ($: Dollar, index: number, agentId?: string) => {
  const s = $.turn.step({ turnId: 't1', index, model: 'claude-opus-5-5', messageCount: 3 + index, ...(agentId ? { agentId } : {}) })
  for (;;) {
    const n = await s.next()
    if (n.done) return n.value
  }
}

const rowsOf = (text: string) => text.split('\n').filter(Boolean).map(l => JSON.parse(l) as Record<string, any>)
const lastRows = (writes: Written[]) => rowsOf(writes.filter(w => w.path.endsWith('.jsonl')).at(-1)!.text)
const line = (text: string, name: string) => text.split('\n').find(l => l.startsWith(name)) ?? ''

const PANE = {
  plugin: 'subagent-spend',
  component: 'Pane',
  requestId: 'subagent-spend',
  surface: 'terminal',
  props: { title: 'Subagent spend', isFocused: false, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

const quiet = (on: On) => {
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
}

test('out of order: a main step whose write is held lands first, and the newer message count and step count stay in the file', async ($, on) => {
  quiet(on)
  const writes: Written[] = []
  const latch = held()
  let calls = 0
  on('fs.write', async (_, e) => {
    if (++calls === 1) await latch.wait
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  const older = step($, 1) // messages 4
  const newer = step($, 2) // messages 5
  await newer
  latch.release()
  await older
  const days = writes.filter(w => w.path.endsWith('.txt'))
  expect(line(days.at(-1)!.text, 'model')).toBe('model claude-opus-5-5, messages 5')
  expect(line(days.at(-1)!.text, 'steps')).toBe('steps 2')
})

test("out of order: a subagent step whose session id comes back late still adds to the newer row, in the pane's state and the file", async ($, on) => {
  quiet(on)
  const writes: Written[] = []
  on('fs.write', (_, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  const latch = held()
  let reads = 0
  on('session.id', async () => {
    if (++reads === 1) await latch.wait
    return { value: 'sess-c' }
  })
  let n = 0
  on('turn.step', async function* (_, e) {
    n += 1
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: usage(n * 10) }
  })
  const older = step($, 1, 'agent-q')
  const newer = step($, 2, 'agent-q')
  await newer
  latch.release()
  await older
  const row = lastRows(writes).find(r => r.agent_id === 'agent-q')!
  expect(row.turns).toBe(2)
  expect(row.input).toBe(30)
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: / turns / }))?.text).toContain('  2 turns  ')
  await ui.unmount()
})

test('two at once: two subagents step and call tools while the main turn is open; each keeps its own tally', async ($, on) => {
  quiet(on)
  const writes: Written[] = []
  on('fs.write', (_, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('session.id', async () => {
    await Promise.resolve()
    return { value: 'sess-c' }
  })
  on('tool.call', () => ({ result: {} }))
  const main = held()
  on('turn.step', async function* (_, e) {
    if (!e.agentId) await main.wait
    const u = e.agentId === 'agent-x' ? usage(100) : e.agentId === 'agent-y' ? usage(7) : null
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: u }
  })
  const open = step($, 0)
  await Promise.all([
    step($, 1, 'agent-x'),
    step($, 1, 'agent-y'),
    $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'agent-x' }),
    $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'agent-y' }),
    step($, 2, 'agent-y'),
    step($, 2, 'agent-x'),
  ])
  main.release()
  await open
  const rows = lastRows(writes)
  const x = rows.find(r => r.agent_id === 'agent-x')!
  const y = rows.find(r => r.agent_id === 'agent-y')!
  expect([x.turns, x.input, y.turns, y.input]).toEqual([2, 200, 2, 14])
  const day = writes.filter(w => w.path.endsWith('.txt')).at(-1)!.text
  expect(line(day, 'steps')).toBe('steps 1')
  expect(line(day, 'tool calls')).toBe('tool calls 0 (2 by subagents)')
})

test('look-alikes: ids that share a start or an end stay apart, a type is never taken from a near id, and the pane never shows two the same', async ($, on) => {
  quiet(on)
  const writes: Written[] = []
  on('fs.write', (_, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('session.id', () => ({ value: 'sess-c' }))
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'agent-0001' }))
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: usage(e.index) }
  })
  await $.agent.spawn({ subagentType: 'Explore', prompt: 'a', description: 'a', tool_use_id: 'toolu_test', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false })
  const ids = ['agent-0001', 'agent-0001-x', 'agent-0001-y', 'aaaaaa-tail', 'bbbbbb-tail']
  for (const [i, id] of ids.entries()) await step($, i + 1, id)
  const rows = lastRows(writes)
  expect(rows.map(r => r.agent_id).sort()).toEqual([...ids].sort())
  expect(rows.find(r => r.agent_id === 'agent-0001')!.agent_type).toBe('Explore')
  expect(rows.find(r => r.agent_id === 'agent-0001-x')!.agent_type).toBe('')
  const ui = await $.ui.mount(PANE)
  const shown = (await ui.findAll({ type: 'Text', text: / turns / })).map(t => (t.text ?? '').split('  ')[1])
  expect(shown.length).toBe(5)
  expect(new Set(shown).size).toBe(5)
  // each label is a whole id, or the start of exactly one id
  for (const s of shown) expect(ids.includes(s!) || ids.filter(id => id.startsWith(s!)).length === 1).toBe(true)
  await ui.unmount()
})

test('look-alikes: two agents of the same type stay two rows, each with its own counts, and the pane lists both', async ($, on) => {
  quiet(on)
  const writes: Written[] = []
  on('fs.write', (_, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('session.id', () => ({ value: 'sess-c' }))
  let spawned = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: ++spawned === 1 ? 'agent-e1' : 'agent-e2' }))
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: usage(e.agentId === 'agent-e1' ? 100 : 7) }
  })
  const spawn = () => $.agent.spawn({ subagentType: 'Explore', prompt: 'a', description: 'a', tool_use_id: 'toolu_test', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false })
  await spawn()
  await spawn()
  await step($, 1, 'agent-e1')
  await step($, 1, 'agent-e2')
  await step($, 2, 'agent-e1')
  const rows = lastRows(writes)
  expect(rows.length).toBe(2)
  const a = rows.find(r => r.agent_id === 'agent-e1')!
  const b = rows.find(r => r.agent_id === 'agent-e2')!
  expect([a.agent_type, a.turns, a.input, b.agent_type, b.turns, b.input]).toEqual(['Explore', 2, 200, 'Explore', 1, 7])
  const ui = await $.ui.mount(PANE)
  expect((await ui.findAll({ type: 'Text', text: /^Explore / })).length).toBe(2)
  await ui.unmount()
})
