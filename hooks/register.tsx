import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Row, Shown } from '../types'
import { addStep, fmt, latest, nextStep, rowsText, paneLines, rows, spendStatus, types } from './spend'
import { countCall, localDay, tally, tallyText, turnsStatus } from './turns'
import { OPEN_AT, bar, fileText, shownOf, shownStatus, usageLines, usageStatus } from './usage'

// subagent-spend, the hooks module: a session's meters in one mod.
//
// Three parts, each with its own file folder:
// - spend (always on): on every model step of a subagent's loop (`turn.step` with an
//   `agentId`) the engine hands back the response's usage; it is summed per agent, the
//   session's rows file is rewritten whole under the `dir` option, and a side pane lists
//   every agent, opened at the first subagent of a session or by /subagent-spend.
// - usage (option `usageFile`, was the usage-file mod): on `session.measure` the rate-limit
//   windows, context fill and cost go to `<usageFileDir>/latest.json` and a second pane,
//   opened by /usage-file or once when a window reaches OPEN_AT percent.
// - turns (option `turnTally`, was the turn-tally mod): on each main-loop step the steps,
//   tool calls, tool errors and error streak go to `<turnTallyDir>/<day>.txt`.
// A part whose option is off passes its events to `next` and returns the result untouched.
//
// One status line: three mods each setting the whole line would overwrite each other, so
// each part keeps its own piece and the line shows the pieces that have a reading, in the
// order spend | usage | turns.
//
// DESIGN NOTE, deliberately narrow: it never denies, never rewrites a request or an event,
// reads only the events the engine hands it and sends nothing off the machine. A failed
// write is swallowed (the spend part names it once in the status line): the files are
// advisory, and a gauge that stops the engine would be worse than no gauge.

const SPEND_PANE = 'subagent-spend'
const SPEND_TITLE = 'Subagent spend'
const USAGE_PANE = 'usage-file'
const USAGE_TITLE = 'Usage'

// What the panes draw; the module's own Map stays the rows file's source. Change a tag
// when its type's fields change: it declines what an earlier version stored.
const shownRows = atom({ plugin: 'subagent-spend', key: 'rows' } as const, [] as Row[], { shape: 'rows-2' })
const shownUsage = atom({ plugin: 'subagent-spend', key: 'latest' } as const, null as Shown | null, { shape: 'latest-1' })

let spendOpened = false
let usageOpened = false
// The session the sums belong to. A /clear goes on under a new session id with no new session.start;
// session.end fires for it (declarations, SessionEndInput.reason), and there the sums and the panes'
// opening start over. The first event that sees another id does the same, for a host that sends no end.
let rowsSession: string | null = null
// Asks for the id are numbered. An answer asked before the latest switch that names the session just left
// came back late (asks wait at once); it never switches back. A later ask may name it again (a resume).
let asks = 0
let switchedAt = 0
let leftSession: string | null = null

function startOver(left: string | null) {
  leftSession = left
  switchedAt = asks
  rowsSession = null
  rows.clear()
  latest.clear()
  spendOpened = false
  usageOpened = false
}

/** This session's id ('' on a host with none), or null for a late answer naming the session just left. */
async function sessionNow($: EngineInterface) {
  const mine = ++asks
  let id = ''
  try {
    id = await $.session.id()
  } catch {
    // no session id on this host
  }
  if (mine <= switchedAt && id === leftSession) return null
  if (rowsSession !== null && id !== rowsSession) startOver(rowsSession)
  rowsSession = id
  return id
}

/** One file of one part in this session: whether a write is in flight, whether one is owed, whether
 * `<dir>/.gitignore` is left alone (a folder not of the mod's own name) or was written, and the newest content to write. */
type Out = { writing: boolean; owed: boolean; ignore: boolean; ignored: boolean; newest: { name: string; text: () => string } | null }
const out = (own: boolean): Out => ({ writing: false, owed: false, ignore: !own, ignored: false, newest: null })

/** One write at a time per file, always from the newest content. Two events can wait at once (on
 * `$.session.id()` or on a write); if the earlier one's write landed last, its older figures would sit on
 * top of the newer ones. An event that finds a write in flight marks the file as owed and goes on; the
 * writing one writes again, from the newest content, until nothing is owed. A failed write is made up
 * by the next event. Before each write, when it is missing: `<dir>/.gitignore` holding `*`, so git
 * ignores the folder in every project with no step from the user. */
async function writeLatest($: EngineInterface, dir: string, f: Out) {
  if (f.writing) {
    f.owed = true
    return
  }
  f.writing = true
  try {
    do {
      f.owed = false
      if (!f.ignore) {
        // checked before every write, not once: a user who deletes the folder mid-session gets it back ignored
        let has = f.ignored
        try {
          has = await $.fs.exists(`${dir}/.gitignore`)
        } catch {
          // a host that cannot answer: once per session, as before
        }
        if (!has) await $.fs.write(`${dir}/.gitignore`, '*\n')
        f.ignored = true
      }
      const n = f.newest
      if (n) await $.fs.write(`${dir}/${n.name}`, n.text())
    } while (f.owed)
  } finally {
    f.writing = false
  }
}

/** Each part's piece of the status line; undefined until that part has a reading. */
type Parts = { usage?: string; turns?: string; spend?: string }

/** The one status line: the pieces that have a reading, spend | usage | turns (spend first: a narrow window cuts the end). */
function showStatus($: EngineInterface, parts: Parts) {
  const line = [parts.spend, parts.usage, parts.turns].filter(Boolean).join(' | ')
  try {
    $.ui.status(line || undefined)
  } catch {
    // a surface with no status line; the files still get written
  }
}

export const register: Register = (on, options) => {
  const usageOn = options.usageFile !== false
  const turnsOn = options.turnTally !== false
  const spendDir = String(options.dir || '.subagent-spend')
  const usageDir = String(options.usageFileDir || '.usage-file')
  const turnsDir = String(options.turnTallyDir || '.turn-tally')
  // Only a folder of the mod's own name is its own; any other may hold the user's files (even be the
  // project itself, `.`), so no .gitignore is written there.
  const own = (dir: string, name: string) => dir.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) === name
  const files = { spend: out(own(spendDir, '.subagent-spend')), usage: out(own(usageDir, '.usage-file')), turns: out(own(turnsDir, '.turn-tally')) }
  const parts: Parts = {}
  let spendWarned = false
  // Numbers each measurement in the order the engine raised them; latest.json is written from the newest.
  let seq = 0

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'subagent-spend', description: 'Show what each subagent of this session costs, in a pane' })
      if (usageOn) await $.command.register({ name: 'usage-file', description: 'Show the rate-limit windows, context and cost of this session, in a pane' })
    } catch {
      // a surface with no commands; the panes still open by themselves
    }
    return next(e)
  })

  on('command.run', { command: 'subagent-spend' }, async $ => {
    await $.ui.open({ id: SPEND_PANE, title: SPEND_TITLE })
    return { text: `Subagent spend pane opened. ${spendStatus()}` }
  })

  on('command.run', { command: 'usage-file' }, async ($, e, next) => {
    if (!usageOn) return next(e)
    await $.ui.open({ id: USAGE_PANE, title: USAGE_TITLE })
    const s = await read($, shownUsage)
    return { text: `Usage pane opened. ${s ? shownStatus(s) : 'No measurement yet in this session.'}` }
  })

  on('ui.render', { component: 'Pane', requestId: SPEND_PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, shownRows)
    const room = Math.max(1, (e.viewport?.rows ?? 24) - 4)
    let tok = 0
    for (const r of list) tok += r.total
    return (
      <Box flexDirection="column">
        <Text bold>
          {list.length} subagents, {fmt(tok)} tokens
        </Text>
        {list.length === 0 && <Text dimColor>No subagent has run in this session yet.</Text>}
        {paneLines(list)
          .slice(0, room)
          .map(line => (
            <Text>{line}</Text>
          ))}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: USAGE_PANE }, async ($, e, next) => {
    if (!usageOn) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const s = await read($, shownUsage)
    if (!s) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No measurement yet in this session.</Text>
        </Box>
      )
    }
    const now = new Date()
    return (
      <Box flexDirection="column">
        {s.windows.length === 0 && <Text dimColor>No rate-limit windows (not on a subscription).</Text>}
        {usageLines(s, now).map((line, i) => (
          <Text color={s.windows[i]!.percentUsed >= OPEN_AT ? 'red' : undefined}>{line}</Text>
        ))}
        {s.context !== null && <Text>{`Context     ${bar(s.context)}  ${s.context}%`}</Text>}
        {s.usd !== null && <Text>{`Cost        $${s.usd.toFixed(2)}`}</Text>}
        <Text dimColor>{`measured ${s.at.slice(11, 19)} UTC`}</Text>
      </Box>
    )
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.agentId) types.set(started.agentId, e.subagentType)
    await sessionNow($)
    if (!spendOpened) {
      spendOpened = true
      // a surface that seats no panes refuses; the status line and rows file go on
      $.ui.open({ id: SPEND_PANE, title: SPEND_TITLE }).catch(() => undefined)
    }
    return started
  }).catch(($, e, next) => next(e)) // an observer: whatever breaks here, the spawn goes on

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (turnsOn) countCall(e.agentId, ran.deny !== undefined, ran.isError === true)
    return ran
  })

  on('session.end', async ($, e, next) => {
    startOver(e.sessionId)
    parts.spend = undefined
    // cost and context belong to the session left: the panes and the line wait for the new one's first reading
    parts.usage = undefined
    showStatus($, parts)
    try {
      await update($, shownRows, () => [])
      await update($, shownUsage, () => null)
    } catch {
      // the panes miss one redraw; the next step or measurement draws them
    }
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (!usageOn) return next(e)
    const mine = ++seq
    parts.usage = usageStatus(e)
    showStatus($, parts)
    try {
      // a newer measurement already shown keeps the pane; this one's figures are behind it
      await update($, shownUsage, s => (mine !== seq ? s : shownOf(e, new Date())))
    } catch {
      // the pane misses one redraw; the file is the record
    }
    if (!usageOpened && e.rateLimits.some(w => w.percentUsed >= OPEN_AT)) {
      usageOpened = true
      // a surface that seats no panes refuses; the status line and file go on
      $.ui.open({ id: USAGE_PANE, title: USAGE_TITLE }).catch(() => undefined)
    }
    try {
      let session = ''
      try {
        session = await $.session.id()
      } catch {
        // no session id on this host: the file says null
      }
      // a newer measurement already came while this one waited; its figures are the ones to write
      if (mine === seq) files.usage.newest = { name: 'latest.json', text: () => fileText(e, session, new Date()) }
      await writeLatest($, usageDir, files.usage)
    } catch {
      // unwritable folder: the file is advisory, the session goes on
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) {
      if (!turnsOn) return yield* next(e)
      // A main-loop step: counted as it starts, its file named and filled before any wait, so an
      // older step can never land on top of a newer one.
      tally.steps++
      const now = new Date()
      parts.turns = turnsStatus()
      showStatus($, parts)
      files.turns.newest = { name: `${localDay(now)}.txt`, text: () => tallyText(e.model, e.messageCount, now) }
      try {
        await writeLatest($, turnsDir, files.turns)
      } catch {
        // unwritable folder: the tally is advisory, the session goes on
      }
      return yield* next(e)
    }
    const response = yield* next(e)
    if (!response.usage) return response
    const agentId = e.agentId
    const order = nextStep()
    const sessionId = await sessionNow($)
    // a step whose id came back after its session ended: its rows file is closed
    if (sessionId === null) return response
    addStep(agentId, sessionId, response.usage, e.model, new Date(), order)
    try {
      await update($, shownRows, () => [...rows.values()])
    } catch {
      // the pane misses one redraw; the rows file is the record
    }
    parts.spend = spendStatus()
    showStatus($, parts)
    try {
      // the text is taken now, not at the write: a /clear while a write waits empties the Map it reads
      const text = rowsText()
      files.spend.newest = { name: `${sessionId || 'no-session'}.jsonl`, text: () => text }
      await writeLatest($, spendDir, files.spend)
    } catch (err) {
      // unwritable folder: say so once, then the session goes on
      if (!spendWarned) {
        spendWarned = true
        try {
          $.ui.status(`subagent-spend: rows file not written (${err instanceof Error ? err.message : String(err)})`)
        } catch {
          // nothing left to tell it on
        }
      }
    }
    return response
  })
}
