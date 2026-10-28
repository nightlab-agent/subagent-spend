import { expect, mock, test } from 'claude-code/testing'

// Each test stands for the engine beneath the plugin: it answers `$.fs.write`,
// `$.ui.status`, `$.env.get`, `$.session.id`, raises subagent steps with a
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

const world = (on: Parameters<Parameters<typeof test>[1]>[1], env: Record<string, string>, answer: () => Usage | null) => {
  const writes: Written[] = []
  const statuses: (string | undefined)[] = []
  mock.env(on, env)
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

const step = async ($: Parameters<Parameters<typeof test>[1]>[0], index: number, agentId?: string) => {
  const s = $.turn.step({ turnId: 't1', index, model: 'claude-opus-5-5', messageCount: 3 + index, ...(agentId ? { agentId } : {}) })
  // Drain the stream by hand so the generator's return value is what comes back.
  for (;;) {
    const n = await s.next()
    if (n.done) return n.value
  }
}

const rowsOf = (text: string) => text.split('\n').filter(Boolean).map(l => JSON.parse(l) as Record<string, unknown>)

test('a subagent step writes one ledger row with the four counts, the turn, the model and the session id, and a status line', async ($, on) => {
  const { writes, statuses } = world(on, { SUBAGENT_SPEND_DIR: '/ledger', HOME: '/home/someone' }, () => usage(100, 40, 3000, 500))

  await step($, 0, 'agent-a')

  expect(writes.length).toBe(1)
  expect(writes[0]!.path).toBe('/ledger/sess-test.jsonl')
  const rows = rowsOf(writes[0]!.text)
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
  const { writes } = world(on, { SUBAGENT_SPEND_DIR: '/ledger', HOME: '/home/someone' }, () => usage(10, 20, 0, 0))

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

test('a main-loop step writes nothing and changes no total', async ($, on) => {
  const { writes, statuses } = world(on, { SUBAGENT_SPEND_DIR: '/ledger', HOME: '/home/someone' }, () => usage(999, 999, 0, 0))

  await step($, 3)

  expect(writes.length).toBe(0)
  expect(statuses.length).toBe(0)
})

test('a subagent step whose response carried no usage adds no row', async ($, on) => {
  const { writes } = world(on, { SUBAGENT_SPEND_DIR: '/ledger', HOME: '/home/someone' }, () => null)

  await step($, 4, 'agent-c')

  expect(writes.length).toBe(0)
})

test('without SUBAGENT_SPEND_DIR the ledger goes under $HOME/.subagent-spend/', async ($, on) => {
  const { writes } = world(on, { HOME: '/home/someone' }, () => usage(1, 1, 0, 0))

  await step($, 5, 'agent-d')

  expect(writes.at(-1)!.path).toBe('/home/someone/.subagent-spend/sess-test.jsonl')
})

test("the agent type from the spawn is carried into the agent's row", async ($, on) => {
  const { writes } = world(on, { SUBAGENT_SPEND_DIR: '/ledger', HOME: '/home/someone' }, () => usage(5, 5, 0, 0))
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'agent-f' }))
  const opens: string[] = []
  on('ui.open', (_, e) => {
    opens.push(e.id)
    return { value: { isPlaced: true } }
  })

  await $.agent.spawn({ subagentType: 'Explore', prompt: 'count the files', description: 'reader' })
  await step($, 7, 'agent-f')
  // The first subagent of the run opens the pane.
  expect(opens).toEqual(['subagent-spend'])

  const row = rowsOf(writes.at(-1)!.text).find(r => r.agent_id === 'agent-f')
  expect(row?.agent_type).toBe('Explore')
})

test('a failed write does not fail the step and is named once in the status line', async ($, on) => {
  const statuses: (string | undefined)[] = []
  mock.env(on, { SUBAGENT_SPEND_DIR: '/nowhere' })
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
  expect(statuses.some(s => (s ?? '').startsWith('subagent-spend: ledger not written'))).toBe(true)
})

const PANE = {
  plugin: 'subagent-spend',
  component: 'Pane',
  requestId: 'subagent-spend',
  props: { title: 'Subagent spend', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

test('two spawns in one session open the pane once', async ($, on) => {
  world(on, { SUBAGENT_SPEND_DIR: '/ledger' }, () => usage(1, 1, 0, 0))
  let opens = 0
  on('ui.open', () => {
    opens += 1
    return { value: { isPlaced: true } }
  })
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'agent-o' }))
  await $.agent.spawn({ subagentType: 'Explore', prompt: 'a', description: 'a' })
  await $.agent.spawn({ subagentType: 'Explore', prompt: 'b', description: 'b' })
  expect(opens).toBe(1)
})

test('the pane lists every agent, biggest spender first, on every surface', async ($, on) => {
  world(on, { SUBAGENT_SPEND_DIR: '/ledger' }, () => usage(900000, 2000, 0, 0, 'claude-haiku-5-5'))
  await step($, 1, 'agent-pane-big')
  await step($, 2, 'agent-pane-big')

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const head = await ui.find({ type: 'Text', text: /subagents, / })
    expect(head?.text).toMatch(/^\d+ subagents, \d+k tokens$/)
    const rows = await ui.findAll({ type: 'Text', text: / turns / })
    expect(rows[0]?.text).toBe('agent  agent-  2 turns  1804k (out 4000, ctx 902k)  claude-haiku-5-5')
    await ui.unmount()
  }
})

test('the command opens the pane and answers with the running total', async ($, on) => {
  const opens: string[] = []
  on('ui.open', (_, e) => {
    opens.push(e.id)
    return { value: { isPlaced: true } }
  })
  const out = await $.command.run({ command: 'subagent-spend', args: '' })
  expect(opens).toEqual(['subagent-spend'])
  expect(out.text).toMatch(/^Subagent spend pane opened\. subagents \d+ \| tok /)
})

test('a value an earlier version stored is declined, and the pane says none ran', async ($, on) => {
  on('state.get', () => ({ value: { value: [{ agent: 'x' }], version: 1 } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /yet/ }))?.text).toBe('No subagent has run in this session yet.')
  await ui.unmount()
})
