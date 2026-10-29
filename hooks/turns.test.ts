import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

// Each test stands for the engine beneath the plugin: it answers `$.fs.write`,
// and `$.ui.status`, raises tool calls and turn steps, and reads
// what the plugin wrote. Nothing here touches the real file system.
// Counts are module variables of the plugin; the test runner loads the module
// again for each test, and the tests still assert only on lines they can own.

type Written = { path: string; text: string }

const world = (on: Parameters<TestBody>[1]) => {
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
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
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

const line = (text: string, name: string) => text.split('\n').find(l => l.startsWith(name)) ?? ''

test('one main-loop step writes one file under the turnTallyDir option with the counts, and a status line', { options: { turnTallyDir: '/tally/.turn-tally' } }, async ($, on) => {
  const { writes, statuses } = world(on)
  on('tool.call', () => ({ result: {} }))

  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await step($, 0)

  expect(writes.length).toBe(2)
  expect(writes[1]!.path.startsWith('/tally/.turn-tally/')).toBe(true)
  expect(/\/\d{4}-\d{2}-\d{2}\.txt$/.test(writes[1]!.path)).toBe(true)
  expect(line(writes[1]!.text, 'steps')).toBe('steps 1')
  expect(line(writes[1]!.text, 'tool calls')).toBe('tool calls 1 (0 by subagents)')
  expect(line(writes[1]!.text, 'tool errors')).toBe('tool errors 0, current streak 0, longest streak 0')
  expect(line(writes[1]!.text, 'model')).toBe('model claude-opus-5-5, messages 3')
  expect(statuses[0]).toBe('steps 1 | tools 1 | errors 0 (streak 0)')
})

test('an errored tool result counts and extends the streak; a success resets it; a denied call is not an error', async ($, on) => {
  const { writes } = world(on)
  let answer: 'ok' | 'error' | 'deny' = 'ok'
  on('tool.call', () => (answer === 'deny' ? { deny: 'not here' } : answer === 'error' ? { result: {}, isError: true } : { result: {} }))

  answer = 'error'
  await $.tool.call({ tool: 'Bash', command: 'false' })
  await $.tool.call({ tool: 'Bash', command: 'false' })
  await step($, 1)
  let errors = line(writes.at(-1)!.text, 'tool errors')
  expect(errors).toBe('tool errors 2, current streak 2, longest streak 2')

  answer = 'ok'
  await $.tool.call({ tool: 'Bash', command: 'true' })
  await step($, 2)
  errors = line(writes.at(-1)!.text, 'tool errors')
  expect(errors).toBe('tool errors 2, current streak 0, longest streak 2')

  answer = 'deny'
  await $.tool.call({ tool: 'Bash', command: 'rm -rf /' })
  await step($, 3)
  errors = line(writes.at(-1)!.text, 'tool errors')
  expect(errors).toBe('tool errors 2, current streak 0, longest streak 2')
})

test("a subagent's tool call and step are counted apart and write nothing", async ($, on) => {
  const { writes } = world(on)
  on('tool.call', () => ({ result: {} }))

  const before = writes.length
  await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'a1' })
  await step($, 4, 'a1')
  expect(writes.length).toBe(before)

  await step($, 5)
  const calls = line(writes.at(-1)!.text, 'tool calls')
  expect(/\(1 by subagents\)$/.test(calls)).toBe(true)
})

test('with no folder set the file goes under .turn-tally/ in the project', async ($, on) => {
  const { writes } = world(on)
  await step($, 6)
  // The engine resolves a relative path against the session's folder.
  expect(writes.at(-1)!.path).toMatch(/^\/.*\/\.turn-tally\/\d{4}-\d{2}-\d{2}\.txt$/)
})

test('a failed write does not fail the step', async ($, on) => {
  const statuses: (string | undefined)[] = []
  on('fs.write', () => {
    throw new Error('read-only file system')
  })
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: 'fine', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  const r = await step($, 7)
  expect(r.answer).toBe('fine')
  expect(statuses.length).toBe(1)
})

test('before its first write the mod writes <dir>/.gitignore holding one line, *, once, so git never sees the folder', async ($, on) => {
  const { writes } = world(on)
  on('tool.call', () => ({ result: {} }))
  await step($, 0)
  await step($, 1)
  expect(writes[0]!.path.endsWith('/.turn-tally/.gitignore')).toBe(true)
  expect(writes[0]!.text).toBe('*\n')
  expect(writes.filter(w => w.path.endsWith('/.gitignore')).length).toBe(1)
  expect(writes.filter(w => w.path.endsWith('.txt')).length).toBe(2)
})
