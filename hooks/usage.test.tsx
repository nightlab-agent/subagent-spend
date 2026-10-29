import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

// What the engine stamps on a typed command: the person at the composer.
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const
import type { SessionMeasureInput } from 'claude-code'

// Each test stands for the engine beneath the plugin: it answers `$.fs.write`,
// `$.ui.status` and `$.session.id`, raises `session.measure`,
// and reads what the plugin wrote. Nothing here touches the real file system.

type Written = { path: string; text: string }
type On = Parameters<TestBody>[1]
type Dollar = Parameters<TestBody>[0]

const world = (on: On, opts: { writeFails?: boolean; noSession?: boolean } = {}) => {
  const writes: Written[] = []
  const statuses: (string | undefined)[] = []
  on('fs.write', (_, e) => {
    if (opts.writeFails) throw new Error('read-only file system')
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('session.id', () => {
    if (opts.noSession) throw new Error('no session')
    return { value: 'sess-1' }
  })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  return { writes, statuses }
}

const measurement = (over: Partial<SessionMeasureInput> = {}): SessionMeasureInput => ({
  context: { tokens: 40000, window: 200000, percent: 20 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 23.5, resetsAt: '2026-10-27T22:00:00Z' },
    { kind: 'seven_day', percentUsed: 61 },
  ],
  cost: { usd: 1.234 },
  changed: ['context', 'rateLimits', 'cost'],
  ...over,
})

const parsed = (w: Written) => JSON.parse(w.text) as Record<string, any>

test('off a subscription (no rate-limit windows) the file is still written, with an empty list and no window in the status line', async ($, on) => {
  const { writes, statuses } = world(on)
  await $.session.measure(measurement({ rateLimits: [], cost: undefined, changed: ['context'] }))
  expect(writes.length).toBe(2)
  const got = parsed(writes[1]!)
  expect(got.rateLimits.length).toBe(0)
  expect(got.cost).toBe(null)
  expect(statuses.at(-1)).toBe('ctx 20%')
})

test('a failed write does not fail the measurement and still updates the status line', async ($, on) => {
  const { writes, statuses } = world(on, { writeFails: true })
  const r = await $.session.measure(measurement())
  expect(writes.length).toBe(0)
  expect(r.changed.length).toBe(3)
  expect(statuses.at(-1)).toBe('5h 23.5% | 7d 61% | ctx 20% | $1.23')
})


test('a host with no session id writes the file with session null', async ($, on) => {
  const { writes } = world(on, { noSession: true })
  await $.session.measure(measurement())
  expect(parsed(writes[1]!).session).toBe(null)
})

test('one measurement writes one JSON file under the usageFileDir option with the windows, the context, the cost and what changed', { options: { usageFileDir: '/usage/.usage-file' } }, async ($, on) => {
  const { writes, statuses } = world(on)
  await $.session.measure(measurement())
  expect(writes.length).toBe(2)
  expect(writes[1]!.path).toBe('/usage/.usage-file/latest.json')
  const got = parsed(writes[1]!)
  expect(got.session).toBe('sess-1')
  expect(got.rateLimits[0].kind).toBe('five_hour')
  expect(got.rateLimits[0].percentUsed).toBe(23.5)
  expect(got.rateLimits[0].resetsAt).toBe('2026-10-27T22:00:00Z')
  expect(got.rateLimits[1].resetsAt).toBe(null)
  expect(got.context.percent).toBe(20)
  expect(got.context.window).toBe(200000)
  expect(got.cost.usd).toBe(1.234)
  expect(got.changed.length).toBe(3)
  expect(/^\d{4}-\d{2}-\d{2}T/.test(got.at)).toBe(true)
  expect(writes[1]!.text.endsWith('}\n')).toBe(true)
  expect(statuses.at(-1)).toBe('5h 23.5% | 7d 61% | ctx 20% | $1.23')
})

test('with no folder set the file goes under .usage-file/ in the project, and a second measurement rewrites it whole', async ($, on) => {
  const { writes } = world(on)
  await $.session.measure(measurement())
  await $.session.measure(measurement({ context: { window: 200000, percent: 35 }, changed: ['context'] }))
  expect(writes.length).toBe(3)
  // The engine resolves a relative path against the session's folder.
  expect(writes[1]!.path).toMatch(/^\/.*\/\.usage-file\/latest\.json$/)
  expect(writes[2]!.path).toBe(writes[1]!.path)
  const got = parsed(writes[2]!)
  expect(got.context.percent).toBe(35)
  expect(got.context.tokens).toBe(null)
  expect(got.changed.length).toBe(1)
})

const PANE = {
  plugin: 'subagent-spend',
  component: 'Pane',
  requestId: 'usage-file',
  props: { title: 'Usage', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

test('the pane draws one bar per window with the time to its reset, on every surface', async ($, on) => {
  world(on)
  const soon = new Date(Date.now() + (2 * 60 + 5) * 60000 + 30000).toISOString()
  await $.session.measure(measurement({ rateLimits: [{ kind: 'five_hour', percentUsed: 23.5, resetsAt: soon }, { kind: 'seven_day', percentUsed: 61 }] }))
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const five = await ui.find({ type: 'Text', text: /^5-hour/ })
    expect(five?.text).toBe('5-hour      ██░░░░░░░░  23.5%  resets in 2h 05m')
    const week = await ui.find({ type: 'Text', text: /^Weekly/ })
    expect(week?.text).toBe('Weekly      ██████░░░░  61%')
    expect((await ui.find({ type: 'Text', text: /^Context/ }))?.text).toBe('Context     ██░░░░░░░░  20%')
    expect((await ui.find({ type: 'Text', text: /^Cost/ }))?.text).toBe('Cost        $1.23')
    await ui.unmount()
  }
})

test('the pane opens itself once, at the first window that reaches 80 percent, and never below it', async ($, on) => {
  world(on)
  const opens: string[] = []
  on('ui.open', (_, e) => {
    opens.push(e.id)
    return { value: { isPlaced: true } }
  })
  await $.session.measure(measurement())
  expect(opens.length).toBe(0)
  await $.session.measure(measurement({ rateLimits: [{ kind: 'five_hour', percentUsed: 80 }] }))
  await $.session.measure(measurement({ rateLimits: [{ kind: 'five_hour', percentUsed: 91 }] }))
  expect(opens).toEqual(['usage-file'])
})

test('a surface that seats no panes refuses the open, and the file is still written', async ($, on) => {
  const { writes } = world(on)
  on('ui.open', () => {
    throw new Error('no panes on this surface')
  })
  const r = await $.session.measure(measurement({ rateLimits: [{ kind: 'seven_day', percentUsed: 95 }] }))
  expect(writes.length).toBe(2)
  expect(r.changed.length).toBe(3)
})

test('the command opens the pane and answers with the figures, or says none came yet', async ($, on) => {
  world(on)
  const opens: string[] = []
  on('ui.open', (_, e) => {
    opens.push(e.id)
    return { value: { isPlaced: true } }
  })
  const before = await $.command.run({ command: 'usage-file', args: '', ...RUN })
  expect(before.text).toBe('Usage pane opened. No measurement yet in this session.')
  await $.session.measure(measurement())
  const after = await $.command.run({ command: 'usage-file', args: '', ...RUN })
  expect(after.text).toBe('Usage pane opened. 5h 23.5% | 7d 61% | ctx 20% | $1.23')
  expect(opens).toEqual(['usage-file', 'usage-file'])
})

test('a value an earlier version stored is declined, and the pane says no measurement yet', async ($, on) => {
  on('state.get', () => ({ value: { value: { old: 1 }, version: 1 } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /yet/ }))?.text).toBe('No measurement yet in this session.')
  await ui.unmount()
})

test('before its first write the mod writes <dir>/.gitignore holding one line, *, once, so git never sees the folder', async ($, on) => {
  const { writes } = world(on)
  await $.session.measure(measurement())
  await $.session.measure(measurement())
  expect(writes[0]!.path.endsWith('/.usage-file/.gitignore')).toBe(true)
  expect(writes[0]!.text).toBe('*\n')
  expect(writes.filter(w => w.path.endsWith('/.gitignore')).length).toBe(1)
  expect(writes.filter(w => w.path.endsWith('/latest.json')).length).toBe(2)
})

test('two measurements at once: the first one\'s session id comes back late, and the newer figures stay in the file', async ($, on) => {
  const writes: Written[] = []
  on('fs.write', (_, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  // the first session id read waits until the second measurement has written
  let release!: () => void
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  let reads = 0
  on('session.id', async () => {
    if (++reads === 1) await held
    return { value: 'sess-1' }
  })
  const older = $.session.measure(measurement({ rateLimits: [{ kind: 'five_hour', percentUsed: 20 }] }))
  const newer = $.session.measure(measurement({ rateLimits: [{ kind: 'five_hour', percentUsed: 80 }] }))
  await newer
  release()
  await older
  const files = writes.filter(w => w.path.endsWith('/latest.json'))
  expect(parsed(files.at(-1)!).rateLimits[0].percentUsed).toBe(80)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^5-hour/ }))?.text).toContain('80%')
  await ui.unmount()
})

test('control: two measurements one after the other each write the file, the second with the newer figures', async ($, on) => {
  const { writes } = world(on)
  await $.session.measure(measurement({ rateLimits: [{ kind: 'five_hour', percentUsed: 20 }] }))
  await $.session.measure(measurement({ rateLimits: [{ kind: 'five_hour', percentUsed: 80 }] }))
  const files = writes.filter(w => w.path.endsWith('/latest.json'))
  expect(files.length).toBe(2)
  expect(parsed(files[0]!).rateLimits[0].percentUsed).toBe(20)
  expect(parsed(files[1]!).rateLimits[0].percentUsed).toBe(80)
})

test('three measurements at once share one writer, the figures never going back; a failed write is made up by the next', async ($, on) => {
  const writes: Written[] = []
  let fail = false
  on('session.id', () => ({ value: 'sess-1' }))
  on('ui.status', () => ({ value: undefined }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  // every write takes a few turns of the event loop, so measurements overlap it
  on('fs.write', async (_, e) => {
    for (let i = 0; i < 5; i++) await Promise.resolve()
    if (fail) throw new Error('disk full')
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  await Promise.all([
    $.session.measure(measurement({ rateLimits: [{ kind: 'five_hour', percentUsed: 20 }] })),
    $.session.measure(measurement({ rateLimits: [{ kind: 'five_hour', percentUsed: 50 }] })),
    $.session.measure(measurement({ rateLimits: [{ kind: 'five_hour', percentUsed: 80 }] })),
  ])
  const files = writes.filter(w => w.path.endsWith('/latest.json')).map(w => parsed(w).rateLimits[0].percentUsed as number)
  expect(files.at(-1)).toBe(80)
  for (let i = 1; i < files.length; i++) expect(files[i]!).toBeGreaterThanOrEqual(files[i - 1]!)
  expect(writes.filter(w => w.path.endsWith('/.gitignore')).length).toBe(1)
  fail = true
  await $.session.measure(measurement({ rateLimits: [{ kind: 'five_hour', percentUsed: 85 }] }))
  fail = false
  await $.session.measure(measurement({ rateLimits: [{ kind: 'five_hour', percentUsed: 90 }] }))
  expect(parsed(writes.filter(w => w.path.endsWith('/latest.json')).at(-1)!).rateLimits[0].percentUsed).toBe(90)
})
