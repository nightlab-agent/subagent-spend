import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

// A file system the test can delete a folder from, as the README's "To forget" step tells a user to do.
const world = (on: Parameters<TestBody>[1]) => {
  const files = new Map<string, string>()
  on('fs.write', (_, e) => { files.set(e.path, e.text); return { value: undefined } })
  on('fs.exists', (_, e) => ({ value: files.has(e.path) }))
  on('ui.status', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'sess-test' }))
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'm' } }
  })
  return files
}
const step = async ($: Parameters<TestBody>[0], index: number, agentId?: string) => {
  const s = $.turn.step({ turnId: 't1', index, model: 'm', messageCount: 3, ...(agentId ? { agentId } : {}) })
  for (;;) { const n = await s.next(); if (n.done) return n.value }
}
const rm = (files: Map<string, string>, dir: string) => { for (const k of [...files.keys()]) if (k.includes(dir)) files.delete(k) }

test('comparison: first write puts .gitignore beside the rows file', async ($, on) => {
  const files = world(on)
  await step($, 0, 'agent-a')
  const keys = [...files.keys()]
  expect(keys.some(k => k.endsWith('/.subagent-spend/.gitignore'))).toBe(true)
})

test('after the user deletes the folder (README "To forget"), the next write brings back the .gitignore', async ($, on) => {
  const files = world(on)
  await step($, 0, 'agent-a')
  rm(files, '/.subagent-spend/')
  await step($, 1, 'agent-a')
  const keys = [...files.keys()]
  expect(keys.some(k => k.endsWith('/.subagent-spend/sess-test.jsonl'))).toBe(true)
  expect(keys.some(k => k.endsWith('/.subagent-spend/.gitignore'))).toBe(true)
})

test('same for the turn-tally day file', async ($, on) => {
  const files = world(on)
  await step($, 0)
  rm(files, '/.turn-tally/')
  await step($, 1)
  const keys = [...files.keys()]
  expect(keys.some(k => /\/\.turn-tally\/\d{4}-\d\d-\d\d\.txt$/.test(k))).toBe(true)
  expect(keys.some(k => k.endsWith('/.turn-tally/.gitignore'))).toBe(true)
})
