import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { SessionMeasureInput } from 'claude-code'

// Review gate 0.8.4: what the start-time key and the new await in session.measure do beyond the cases the PR tests.

type On = Parameters<TestBody>[1]
type Dollar = Parameters<TestBody>[0]
const u = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' }
const CTX = { tokens: 40000, window: 200000, percent: 20 }
const cost = (usd: number): SessionMeasureInput => ({ context: CTX, rateLimits: [], cost: { usd }, changed: ['cost'] })
const window = (pct: number): SessionMeasureInput => ({ context: CTX, rateLimits: [{ kind: 'five_hour', percentUsed: pct }], changed: ['rateLimits'] })

const world = (on: On) => {
  const seen = {
    requests: 0,
    started: 1000 as number | undefined,
    lines: [] as (string | undefined)[],
    writes: [] as { path: string; text: string }[],
    ledger: 0,
    sid: 'old',
    usageCalls: 0,
    /** the usage call numbers (1-based) that wait on `hold` before answering */
    slow: new Set<number>(),
    hold: null as Promise<void> | null,
  }
  on('fs.write', async (_, e) => (seen.writes.push({ path: e.path, text: e.text }), { value: undefined }))
  on('ui.status', (_, e) => (seen.lines.push(e.text), { value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.id', () => ({ value: seen.sid }))
  on('session.end', async (_, e) => ({ sessionId: e.sessionId }))
  on('state.set', async () => ({ value: { isSet: true, version: 1 } }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('session.usage', async () => {
    const n = ++seen.usageCalls
    if (seen.slow.has(n) && seen.hold) await seen.hold
    return { value: { startedAt: seen.started, context: CTX, rateLimits: [], cost: { usd: seen.ledger } } as any }
  })
  on('turn.step', async function* (_, e) {
    seen.requests++
    return { turnId: e.turnId, index: e.index, answer: 'fine', toolUses: [], stopReason: 'end_turn', usage: e.agentId ? u : null }
  })
  return seen
}
const step = async ($: Dollar, index: number, agentId?: string) => {
  const s = $.turn.step({ turnId: 't1', index, model: 'claude-opus-5-5', messageCount: 3 + index, ...(agentId ? { agentId } : {}) })
  for (;;) {
    const n = await s.next()
    if (n.done) return n.value
  }
}
const end = ($: Dollar, sessionId: string, reason = 'clear', resume = sessionId) => $.session.end({ sessionId, reason, resume: { id: resume } } as any)
const spendCap = async ($: Dollar) => (await $.command.run({ command: 'spend-cap', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })).text
const gate = () => {
  let open = () => {}
  const hold = new Promise<void>(r => (open = r))
  return { hold, open }
}
const parsed = (w: { text: string }) => JSON.parse(w.text) as { rateLimits: { percentUsed: number }[] }

// G1. The start time is the key for "the session left at /clear". A resume back into that session (SessionUsage.startedAt:
// "for a resumed session its first launch") carries the same start, so every cost reading of the resumed session is
// taken for the left one's: the cap never holds, the line's cost never moves.
test('a resume back into the session left at /clear counts its cost again, and the cap holds there', { options: { capUsd: 2 } }, async ($, on) => {
  const seen = world(on)
  seen.ledger = 1
  await $.session.measure(cost(1))
  await end($, 'old') // /clear: the key is old's start, 1000
  seen.started = 2000
  seen.ledger = 0.01
  seen.sid = 'new'
  await step($, 0)
  // the user resumes old: the engine ends new, goes on under old, whose figures count from its first launch
  await end($, 'new', 'resume', 'old')
  seen.started = 1000
  seen.ledger = 2.5
  seen.sid = 'old'
  seen.requests = 0
  await step($, 0)
  expect(`${await spendCap($)} requests=${seen.requests}`).toBe('Spend cap $2.00. Cost so far $2.50. requests=0')
})

test('comparison: a resume into a third session, with its own start, counts and is held', { options: { capUsd: 2 } }, async ($, on) => {
  const seen = world(on)
  seen.ledger = 1
  await $.session.measure(cost(1))
  await end($, 'old')
  seen.started = 2000
  seen.ledger = 0.01
  seen.sid = 'new'
  await step($, 0)
  await end($, 'new', 'resume', 'third')
  seen.started = 3000
  seen.ledger = 2.5
  seen.sid = 'third'
  seen.requests = 0
  await step($, 0)
  expect(`${await spendCap($)} requests=${seen.requests}`).toBe('Spend cap $2.00. Cost so far $2.50. requests=0')
})

// G2. After any /clear, session.measure awaits $.session.usage() before it takes its order number. Two measurements
// at once (the repo's own model: usage.test "two measurements at once") then number themselves by when the usage
// answer came, not by when the engine raised them: an older window reading lands on top of the newer one.
test('after a /clear, two measurements at once with the older usage answer late keep the newer window figure', async ($, on) => {
  const seen = world(on)
  await end($, 'old')
  seen.started = 2000
  seen.sid = 'new'
  const g = gate()
  seen.hold = g.hold
  seen.slow.add(seen.usageCalls + 1) // the older measurement's usage read waits
  const older = $.session.measure(window(20))
  const newer = $.session.measure(window(80))
  await newer
  g.open()
  await older
  const files = seen.writes.filter(w => w.path.endsWith('/latest.json'))
  expect(`file=${parsed(files.at(-1)!).rateLimits[0]!.percentUsed} line=${seen.lines.at(-1)}`).toBe('file=80 line=5h 80% | ctx 20%')
})

test('comparison: with no /clear before them the same two measurements keep the newer figure', async ($, on) => {
  const seen = world(on)
  const g = gate()
  seen.hold = g.hold
  seen.slow.add(seen.usageCalls + 1)
  const older = $.session.measure(window(20))
  const newer = $.session.measure(window(80))
  await newer
  g.open()
  await older
  const files = seen.writes.filter(w => w.path.endsWith('/latest.json'))
  expect(`file=${parsed(files.at(-1)!).rateLimits[0]!.percentUsed} line=${seen.lines.at(-1)}`).toBe('file=80 line=5h 80% | ctx 20%')
})

// G3. The /clear's own usage read is fired and forgotten. If its answer lands after the engine's reset, the key is the
// NEW session's start, and every reading of the new session is dropped: no cap, no cost on the line, no latest.json.
test('the /clear usage read answering after the ledger reset does not freeze the new session', { options: { capUsd: 2 } }, async ($, on) => {
  const seen = world(on)
  seen.ledger = 1
  const g = gate()
  seen.hold = g.hold
  seen.slow.add(seen.usageCalls + 1) // the read session.end makes
  await end($, 'old')
  seen.started = 2000
  seen.ledger = 2.5
  seen.sid = 'new'
  g.open()
  await new Promise(r => (globalThis as any).setTimeout(r, 5))
  seen.requests = 0
  await step($, 0)
  expect(`${await spendCap($)} requests=${seen.requests}`).toBe('Spend cap $2.00. Cost so far $2.50. requests=0')
})

test('comparison: the same read answered before the reset leaves the new session counting', { options: { capUsd: 2 } }, async ($, on) => {
  const seen = world(on)
  seen.ledger = 1
  await end($, 'old')
  seen.started = 2000
  seen.ledger = 2.5
  seen.sid = 'new'
  seen.requests = 0
  await step($, 0)
  expect(`${await spendCap($)} requests=${seen.requests}`).toBe('Spend cap $2.00. Cost so far $2.50. requests=0')
})

// G4 (at the base too). One held session id answer that spans two id switches: the guards remember only the last
// session left, so the late answer naming the first one starts over on the current session and writes the first
// one's rows file with that step alone.
const held = (on: On, sid: { v: string }, slow: { hold: Promise<void> | null; held?: boolean }) => {
  const writes: { path: string; text: string }[] = []
  on('fs.write', (_, e) => (writes.push({ path: e.path, text: e.text }), { value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('state.set', async () => ({ value: { isSet: true, version: 1 } }))
  on('session.id', async () => {
    const v = sid.v
    const hold = slow.hold
    if (hold) {
      slow.held = true
      await hold
    }
    return { value: v }
  })
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: u }
  })
  return writes
}
const rowsOf = (t: string) => t.split('\n').filter(Boolean).map(l => JSON.parse(l) as Record<string, unknown>)
const lastOf = (w: { path: string; text: string }[], name: string) => rowsOf(w.filter(x => x.path.endsWith(name)).at(-1)!.text)

