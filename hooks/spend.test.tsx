import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

// What the engine stamps on a typed command: the person at the composer.
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const
// What the engine fills in on an Agent tool call beside the three fields a test names.
const SPAWN = { tool_use_id: 'toolu_test', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false } as const

// Each test stands for the engine beneath the plugin: it answers `$.fs.write`,
// `$.ui.status`, `$.session.id`, raises subagent steps with a
// usage of its choosing, and reads what the plugin wrote. Nothing here touches
// the real file system or a model. Each test uses agent ids of its own.

type Written = { path: string; text: string }

type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number; model: string }

const usage = (i: number, o: number, cr: number, cc: number, model = 'claude-opus-5-5'): Usage => ({
  input_tokens: i,
  output_tokens: o,
  cache_read_input_tokens: cr,
  cache_creation_input_tokens: cc,
  model,
})

const world = (on: Parameters<TestBody>[1], answer: () => Usage | null) => {
  const writes: Written[] = []
  const statuses: (string | undefined)[] = []
  on('fs.write', (_, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('session.id', () => ({ value: 'sess-test' }))
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: answer() }
  })
  return { writes, statuses }
}

const step = async ($: Parameters<TestBody>[0], index: number, agentId?: string) => {
  const s = $.turn.step({ turnId: 't1', index, model: 'claude-opus-5-5', messageCount: 3 + index, ...(agentId ? { agentId } : {}) })
  // Drain the stream by hand so the generator's return value is what comes back.
  for (;;) {
    const n = await s.next()
    if (n.done) return n.value
  }
}

const rowsOf = (text: string) => text.split('\n').filter(Boolean).map(l => JSON.parse(l) as Record<string, unknown>)

test('a subagent step writes one row with the four counts, the turn, the model and the session id, and a status line', { options: { dir: '/rows/.subagent-spend' } }, async ($, on) => {
  const { writes, statuses } = world(on, () => usage(100, 40, 3000, 500))

  await step($, 0, 'agent-a')

  expect(writes.length).toBe(2)
  expect(writes[1]!.path).toBe('/rows/.subagent-spend/sess-test.jsonl')
  const rows = rowsOf(writes[1]!.text)
  expect(rows.length).toBe(1)
  const r = rows[0]!
  expect(r.agent_id).toBe('agent-a')
  expect(r.session_id).toBe('sess-test')
  expect(r.input).toBe(100)
  expect(r.output).toBe(40)
  expect(r.cache_read).toBe(3000)
  expect(r.cache_create).toBe(500)
  expect(r.turns).toBe(1)
  expect(r.total).toBe(3640)
  expect(r.context).toBe(3640)
  expect(r.model).toBe('claude-opus-5-5')
  expect(typeof r.ts).toBe('string')
  expect(statuses.at(-1)).toBe('subagents 1 | tok 3640 (out 40)')
})

test('a second step of the same agent updates its row; the file keeps one row per agent', async ($, on) => {
  const { writes } = world(on, () => usage(10, 20, 0, 0))

  await step($, 1, 'agent-b')
  await step($, 2, 'agent-b')

  const rows = rowsOf(writes.at(-1)!.text).filter(r => r.agent_id === 'agent-b')
  expect(rows.length).toBe(1)
  expect(rows[0]!.turns).toBe(2)
  expect(rows[0]!.input).toBe(20)
  expect(rows[0]!.output).toBe(40)
  expect(rows[0]!.total).toBe(60)
  expect(rows[0]!.context).toBe(30) // the last step's prompt and reply, not a sum
})

test('a main-loop step writes no subagent row and changes no total', async ($, on) => {
  const { writes, statuses } = world(on, () => usage(999, 999, 0, 0))

  await step($, 3)

  // the main step is the turn counts' to write (turns.test.ts); the subagent rows stay untouched
  expect(writes.filter(w => w.path.includes('/.subagent-spend/')).length).toBe(0)
  expect(statuses.filter(s => (s ?? '').includes('subagents')).length).toBe(0)
})

test('a subagent step whose response carried no usage adds no row', async ($, on) => {
  const { writes } = world(on, () => null)

  await step($, 4, 'agent-c')

  expect(writes.length).toBe(0)
})

test('with no folder set the rows file goes under .subagent-spend/ in the project', async ($, on) => {
  const { writes } = world(on, () => usage(1, 1, 0, 0))

  await step($, 5, 'agent-d')

  // The engine resolves a relative path against the session's folder.
  expect(writes.at(-1)!.path).toMatch(/^\/.*\/\.subagent-spend\/sess-test\.jsonl$/)
})

test("the agent type from the spawn is carried into the agent's row", async ($, on) => {
  const { writes } = world(on, () => usage(5, 5, 0, 0))
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'agent-f' }))
  const opens: string[] = []
  on('ui.open', (_, e) => {
    opens.push(e.id)
    return { value: { isPlaced: true } }
  })

  await $.agent.spawn({ subagentType: 'Explore', prompt: 'count the files', description: 'reader', ...SPAWN })
  await step($, 7, 'agent-f')
  // The first subagent of the run opens the pane.
  expect(opens).toEqual(['subagent-spend'])

  const row = rowsOf(writes.at(-1)!.text).find(r => r.agent_id === 'agent-f')
  expect(row?.agent_type).toBe('Explore')
})

test('a failed write does not fail the step and is named in the status line', async ($, on) => {
  const statuses: (string | undefined)[] = []
  on('fs.write', () => {
    throw new Error('read-only file system')
  })
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('session.id', () => ({ value: 'sess-test' }))
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: 'fine', toolUses: [], stopReason: 'end_turn', usage: usage(1, 1, 0, 0) }
  })

  const r = await step($, 6, 'agent-e')
  expect(r.answer).toBe('fine')
  expect(statuses.some(s => (s ?? '').includes('subagent-spend: rows file not written'))).toBe(true)
})

// A rows folder that comes and goes. `hold` keeps every write waiting until it is released.
const flaky = (on: Parameters<TestBody>[1]) => {
  const seen = { fail: true, hold: null as Promise<void> | null, writing: 0, statuses: [] as (string | undefined)[], id: 'sess-test' }
  on('fs.write', async () => {
    seen.writing++
    if (seen.hold) await seen.hold
    if (seen.fail) throw new Error('read-only file system')
    return { value: undefined }
  })
  on('ui.status', (_, e) => {
    seen.statuses.push(e.text)
    return { value: undefined }
  })
  on('session.id', () => ({ value: seen.id }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: e.agentId ? usage(1, 1, 0, 0) : null }
  })
  return seen
}

const NOTICE = 'rows file not written'

const released = () => {
  let open = () => {}
  const hold = new Promise<void>(r => (open = r))
  return { hold, open }
}

test('the unwritten rows notice stays through the main loop until a write lands', async ($, on) => {
  const seen = flaky(on)
  await step($, 0, 'agent-n1')
  await step($, 1)
  expect(seen.statuses.at(-1)).toContain(NOTICE)
  seen.fail = false
  await step($, 2, 'agent-n1')
  expect(seen.statuses.at(-1)).not.toContain(NOTICE)
  expect(seen.statuses.at(-1)).toContain('subagents')
})

test('comparison: with writes landing the notice never shows', async ($, on) => {
  const seen = flaky(on)
  seen.fail = false
  await step($, 0, 'agent-n2')
  await step($, 1)
  expect(seen.statuses.some(s => (s ?? '').includes(NOTICE))).toBe(false)
})

test('a step that only queues its write leaves the notice up until the write in flight lands', async ($, on) => {
  const seen = flaky(on)
  await step($, 0, 'agent-n3')
  seen.fail = false
  const { hold, open } = released()
  seen.hold = hold
  seen.writing = 0
  const first = step($, 1, 'agent-n3')
  for (let i = 0; i < 100000 && seen.writing === 0; i++) await Promise.resolve()
  expect(seen.writing).toBeGreaterThan(0)
  await step($, 2, 'agent-n4') // finds the write in flight, marks it owed, goes on
  expect(seen.statuses.at(-1)).toContain(NOTICE)
  open()
  await first
  expect(seen.statuses.at(-1)).not.toContain(NOTICE)
})

test('a /clear takes the notice off; a new failure brings it back', async ($, on) => {
  const seen = flaky(on)
  await step($, 0, 'agent-n5')
  await $.session.end({ sessionId: 'sess-test', reason: 'clear' } as any)
  expect(seen.statuses.at(-1) ?? '').not.toContain(NOTICE)
  // the process goes on under a new id (declarations, SessionEndInput)
  seen.id = 'sess-next'
  await step($, 1, 'agent-n6')
  expect(seen.statuses.at(-1)).toContain(NOTICE)
})

const PANE = {
  plugin: 'subagent-spend',
  component: 'Pane',
  requestId: 'subagent-spend',
  props: { title: 'Subagent spend', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

test('two spawns in one session open the pane once', async ($, on) => {
  world(on, () => usage(1, 1, 0, 0))
  let opens = 0
  on('ui.open', () => {
    opens += 1
    return { value: { isPlaced: true } }
  })
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'agent-o' }))
  await $.agent.spawn({ subagentType: 'Explore', prompt: 'a', description: 'a', ...SPAWN })
  await $.agent.spawn({ subagentType: 'Explore', prompt: 'b', description: 'b', ...SPAWN })
  expect(opens).toBe(1)
})

test('the pane lists every agent, biggest spender first, on every surface', async ($, on) => {
  world(on, () => usage(900000, 2000, 0, 0, 'claude-haiku-5-5'))
  await step($, 1, 'agent-pane-big')
  await step($, 2, 'agent-pane-big')

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const head = await ui.find({ type: 'Text', text: /subagents?, / })
    expect(head?.text).toBe('1 subagent, 1804k tokens')
    const rows = await ui.findAll({ type: 'Text', text: / turns / })
    expect(rows[0]?.text).toBe('agent  agent-  2 turns  1804k (out 4000, ctx 902k)  claude-haiku-5-5')
    await ui.unmount()
  }
})

test('one agent with one step reads 1 subagent and 1 turn; a second agent and step read 2 subagents and 2 turns', async ($, on) => {
  world(on, () => usage(1000, 20, 0, 0))
  await step($, 1, 'agent-one')
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /subagents?, / }))?.text).toBe('1 subagent, 1020 tokens')
  expect((await ui.find({ type: 'Text', text: / turns? / }))?.text).toContain('  1 turn  ')
  await ui.unmount()
  await step($, 2, 'agent-one')
  await step($, 3, 'agent-two')
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /subagents?, / }))?.text).toBe('2 subagents, 3060 tokens')
  expect((await ui.findAll({ type: 'Text', text: / turns? / })).map(t => (t.text ?? '').split('  ')[2])).toEqual(['2 turns', '1 turn'])
  await ui.unmount()
})

test('the command opens the pane and answers with the running total', async ($, on) => {
  const opens: string[] = []
  on('ui.open', (_, e) => {
    opens.push(e.id)
    return { value: { isPlaced: true } }
  })
  const out = await $.command.run({ command: 'subagent-spend', args: '', ...RUN })
  expect(opens).toEqual(['subagent-spend'])
  expect(out.text).toMatch(/^Subagent spend pane opened\. subagents \d+ \| tok /)
})

test('a value an earlier version stored is declined, and the pane says none ran', async ($, on) => {
  on('state.get', () => ({ value: { value: [{ agent: 'x' }], version: 1 } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /yet/ }))?.text).toBe('No subagent has run in this session yet.')
  await ui.unmount()
})

test('with dir set to the project itself, the project\'s own .gitignore is left alone', { options: { dir: '.' } }, async ($, on) => {
  const { writes } = world(on, () => usage(1, 1, 0, 0))
  await step($, 0, 'agent-a')
  expect(writes.filter(w => w.path.endsWith('.gitignore') && !w.path.includes('/.usage-file/') && !w.path.includes('/.turn-tally/')).length).toBe(0)
  expect(writes.filter(w => w.path.endsWith('.jsonl')).length).toBe(1)
})

test('before its first write the mod writes <dir>/.gitignore holding one line, *, once, so git never sees the folder', async ($, on) => {
  const { writes } = world(on, () => usage(1, 1, 0, 0))
  await step($, 0, 'agent-a')
  await step($, 1, 'agent-a')
  expect(writes[0]!.path.endsWith('/.subagent-spend/.gitignore')).toBe(true)
  expect(writes[0]!.text).toBe('*\n')
  expect(writes.filter(w => w.path.endsWith('/.gitignore')).length).toBe(1)
  expect(writes.filter(w => w.path.endsWith('.jsonl')).length).toBe(2)
})
