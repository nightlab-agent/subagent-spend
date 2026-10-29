import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { SessionMeasureInput } from 'claude-code'

// The two switches, `usageFile` and `turnTally`, and the one status line the three parts
// share. Each test stands for the engine beneath the plugin, as in the other test files;
// nothing here touches the real file system or a model.

type Written = { path: string; text: string }
type On = Parameters<TestBody>[1]
type Dollar = Parameters<TestBody>[0]

const world = (on: On) => {
  const writes: Written[] = []
  const statuses: (string | undefined)[] = []
  const opens: string[] = []
  on('fs.write', (_, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.open', (_, e) => {
    opens.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('session.id', () => ({ value: 'sess-o' }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('tool.call', () => ({ result: {}, isError: true }))
  on('turn.step', async function* (_, e) {
    const usage = e.agentId ? { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' } : null
    return { turnId: e.turnId, index: e.index, answer: 'fine', toolUses: [], stopReason: 'end_turn', usage }
  })
  return { writes, statuses, opens }
}

const step = async ($: Dollar, index: number, agentId?: string) => {
  const s = $.turn.step({ turnId: 't1', index, model: 'claude-opus-5-5', messageCount: 3 + index, ...(agentId ? { agentId } : {}) })
  for (;;) {
    const n = await s.next()
    if (n.done) return n.value
  }
}

const measurement = (pct: number): SessionMeasureInput => ({
  context: { tokens: 40000, window: 200000, percent: 20 },
  rateLimits: [{ kind: 'five_hour', percentUsed: pct }],
  cost: { usd: 1.234 },
  changed: ['context', 'rateLimits', 'cost'],
})

test('with usageFile off a measurement passes through untouched: no file, no status line, no pane even at 95 percent, no /usage-file', { options: { usageFile: false } }, async ($, on) => {
  const { writes, statuses, opens } = world(on)
  const named: string[] = []
  on('command.register', (_, e) => {
    named.push(e.name)
    return { value: { command: e.name } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const r = await $.session.measure(measurement(95))
  expect(r.changed).toEqual(['context', 'rateLimits', 'cost'])
  expect(writes.length).toBe(0)
  expect(statuses.length).toBe(0)
  expect(opens.length).toBe(0)
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
  expect(named).toEqual(['subagent-spend'])
})

test('control: with usageFile on, session start registers both commands', async ($, on) => {
  world(on)
  const named: string[] = []
  on('command.register', (_, e) => {
    named.push(e.name)
    return { value: { command: e.name } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
  expect(named).toEqual(['subagent-spend', 'usage-file'])
})

test('with turnTally off a main step and a tool call pass through untouched and nothing is counted; subagent rows go on', { options: { turnTally: false } }, async ($, on) => {
  const { writes, statuses } = world(on)
  const call = await $.tool.call({ tool: 'Bash', command: 'false' })
  expect(call.isError).toBe(true)
  const r = await step($, 0)
  expect(r.answer).toBe('fine')
  expect(writes.length).toBe(0)
  expect(statuses.length).toBe(0)
  await step($, 1, 'agent-o')
  expect(writes.some(w => w.path.includes('/.turn-tally/'))).toBe(false)
  expect(writes.some(w => w.path.endsWith('/.subagent-spend/sess-o.jsonl'))).toBe(true)
  expect(statuses.at(-1)).toBe('subagents 1 | tok 15 (out 5)')
})

test('all three parts on: one status line, subagents first, then usage, then turns, each piece as its own mod showed it', async ($, on) => {
  const { statuses } = world(on)
  await $.session.measure(measurement(23.5))
  expect(statuses.at(-1)).toBe('5h 23.5% | ctx 20% | $1.23')
  await $.tool.call({ tool: 'Bash', command: 'false' })
  await step($, 0)
  expect(statuses.at(-1)).toBe('5h 23.5% | ctx 20% | $1.23 | steps 1 | tools 1 | errors 1 (streak 1)')
  await step($, 1, 'agent-o')
  expect(statuses.at(-1)).toBe('subagents 1 | tok 15 (out 5) | 5h 23.5% | ctx 20% | $1.23 | steps 1 | tools 1 | errors 1 (streak 1)')
})
