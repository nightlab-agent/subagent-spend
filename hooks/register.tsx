import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionMeasureInput, SessionUsage } from 'claude-code'

import type { HeldCap, Row, Shown } from '../types'
import { addStep, count, fmt, latest, nextStep, rowsText, paneLines, rows, spendStatus, types } from './spend'
import { countCall, localDay, tally, tallyText, turnsStatus } from './turns'
import { cap, capCommand, capOf, heldText, reached, warnNow } from './cap'
import { OPEN_AT, fileText, shownOf, shownStatus, usageStatus } from './usage'
import { SPEND_PANE, USAGE_PANE, registerPanes } from './panes'
import { out, writeLatest } from './write'
import type { Out } from './write'

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
// order spend | usage | notice | turns.
//
// - cap (option `capUsd`, off by default): at the cap the next model step is answered by the
//   mod with no request made (./cap.ts).
//
// DESIGN NOTE, deliberately narrow: apart from the cap the user sets, it never denies, never rewrites a
// request or an event, reads only the events the engine hands it and sends nothing off the machine. A failed
// write is swallowed (a failed rows write is named in the status line until a write lands): the files are
// advisory, and a gauge that stops the engine would be worse than no gauge.

const SPEND_TITLE = 'Subagent spend'
const USAGE_TITLE = 'Usage'

// What the panes draw (the same plugin, key and shape in hooks/panes.tsx: the engine's scan reads each file's own
// atoms); the module's own Map stays the rows file's source. Change a tag, in both files, when its type's fields change:
// it declines what an earlier version stored.
const shownRows = atom({ plugin: 'subagent-spend', key: 'rows' } as const, [] as Row[], { shape: 'rows-2' })
const shownUsage = atom({ plugin: 'subagent-spend', key: 'latest' } as const, null as Shown | null, { shape: 'latest-1' })
// `/spend-cap`'s last word, held by the host: a reload starts these modules over and runs `register` from the options alone.
const heldCap = atom({ plugin: 'subagent-spend', key: 'cap' } as const, null as HeldCap | null, { shape: 'cap-1' })

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
// The session left at a /clear, until the next end says otherwise: the engine may go on naming it for a moment after
// session.end, and a step in that moment would rewrite its closed rows file with that step alone. Only a resume comes back to it.
let cleared: string | null = null

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
  if (id === cleared || (mine <= switchedAt && id === leftSession)) return null
  if (rowsSession !== null && id !== rowsSession) startOver(rowsSession)
  rowsSession = id
  return id
}

/** Each part's piece of the status line; undefined until that part has a reading. */
type Parts = { usage?: string; turns?: string; spend?: string; notice?: string }

/** The one status line: the pieces that have a reading, spend | usage | notice | turns (the figures first: a narrow window cuts the end). */
function showStatus($: EngineInterface, parts: Parts) {
  const line = [parts.spend, parts.usage, parts.notice, parts.turns].filter(Boolean).join(' | ')
  try {
    $.ui.status(line || undefined)
  } catch {
    // a surface with no status line; the files still get written
  }
}

/** The cap's 80 percent notice, when one is due. */
function showWarning($: EngineInterface) {
  const warning = warnNow()
  if (!warning) return
  try {
    $.ui.toast(warning)
  } catch {
    // a surface with no toasts: the cap still holds
  }
}

export const register: Register = (on, options) => {
  const usageOn = options.usageFile !== false
  const capOption = capOf(options.capUsd)
  cap.usd = capOption
  cap.spent = null
  cap.warned = false
  const turnsOn = options.turnTally !== false
  const spendDir = String(options.dir || '.subagent-spend')
  const usageDir = String(options.usageFileDir || '.usage-file')
  const turnsDir = String(options.turnTallyDir || '.turn-tally')
  // Only a folder of the mod's own name is its own; any other may hold the user's files (even be the
  // project itself, `.`), so no .gitignore is written there.
  const own = (dir: string, name: string) => dir.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) === name
  const files = { spend: out(own(spendDir, '.subagent-spend')), usage: out(own(usageDir, '.usage-file')), turns: out(own(turnsDir, '.turn-tally')) }
  const parts: Parts = {}
  // Numbers each measurement in the order the engine raised them; latest.json is written from the newest.
  let seq = 0
  /** The last measurement, whose windows and context the status line keeps between measurements. */
  let measured: SessionMeasureInput | undefined
  // A session's cost only grows (SessionCost: summed over every priced response), so the highest
  // reading is the newest: a read that answers late with a lower figure never brings it back. Each
  // session end starts a new count, and a read still out for the session left is dropped.
  let costSession = 0
  // A /clear can reset the cost ledger after session.end is over (seen in the 2.1.312 bundle; the declarations name no
  // order), and a step or measurement can land between. Cost and start reset together (SessionUsage.startedAt: what the figures count from), so a reading
  // with the left session's start is the left session's. A fork or resume may keep that start: only a /clear sets this.
  let leftStart: number | null = null
  /** Whether a usage read made while `costSession` stood at `session` belongs to a session already left. */
  const ofLeft = (session: number, usage: SessionUsage) => session !== costSession || usage.startedAt === leftStart
  /** The next cost reading is the new session's; the cap the user set stays. */
  const startCost = () => {
    cap.spent = null
    cap.warned = false
    costSession++
  }

  on('session.start', async ($, e, next) => {
    try {
      // fires again at a reload; a cap set over another option gives way to the new one
      const held = await read($, heldCap)
      if (held?.option === capOption) cap.usd = held.usd
      // the new option replaced it for good: changing back brings the option, not this
      else if (held) await update($, heldCap, () => null)
    } catch {
      // nothing held on this surface: the option stands
    }
    try {
      await $.command.register({ name: 'subagent-spend', description: 'Show what each subagent of this session costs, in a pane' })
      await $.command.register({ name: 'spend-cap', description: 'Show, set (/spend-cap 5) or lift (/spend-cap off) the spend cap of this session' })
      if (usageOn) await $.command.register({ name: 'usage-file', description: 'Show the rate-limit windows, context and cost of this session, in a pane' })
    } catch {
      // a surface with no commands; the panes still open by themselves
    }
    return next(e)
  })

  on('command.run', { command: 'spend-cap' }, async ($, e) => {
    const text = capCommand(e.args ?? '')
    try {
      await update($, heldCap, () => ({ usd: cap.usd, option: capOption }))
    } catch {
      // the cap holds in memory; only a reload would lose it
    }
    return { text }
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

  registerPanes(on, usageOn)

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
    cleared = e.reason === 'clear' && e.sessionId ? e.sessionId : null
    const held = cap.spent
    startCost()
    // a key outlives no end: a resume may come back to the session it names
    leftStart = null
    if (e.reason === 'clear') {
      // asked before the end step, not waited for: this chain shares one short bound. No answer, no key: a cost read
      // before the ledger's reset then counts for the new session
      const asked = costSession
      try {
        $.session.usage().then(u => {
          const usd = u.cost?.usd ?? 0
          // an answer after the end step, or a figure below the one held, may be of a ledger already reset
          if (asked === costSession && usd > 0 && usd >= (held ?? 0)) leftStart = u.startedAt ?? null
        }, () => undefined)
      } catch {
        // no answer, no key
      }
    }
    parts.spend = undefined
    parts.notice = undefined
    // cost and context belong to the session left: the panes and the line wait for the new one's first reading
    parts.usage = undefined
    measured = undefined
    showStatus($, parts)
    try {
      await update($, shownRows, () => [])
      await update($, shownUsage, () => null)
    } catch {
      // the panes miss one redraw; the next step or measurement draws them
    }
    try {
      return await next(e)
    } finally {
      // a step can read the old cost, or fail a write, while the end step runs; both go with the session too
      startCost()
      parts.notice = undefined
      showStatus($, parts)
    }
  })

  on('session.measure', async ($, e, next) => {
    // numbered before any wait: two at once keep the order the engine raised them in
    const mine = ++seq
    if (leftStart !== null) {
      // a measurement carries no start, so it asks
      const session = costSession
      let left = false
      try {
        left = ofLeft(session, await $.session.usage())
      } catch {
        // no answer: the measurement stands, unless /clear came during the read
        left = session !== costSession
      }
      if (left) return next(e)
    }
    if (e.cost) cap.spent = Math.max(cap.spent ?? 0, e.cost.usd)
    showWarning($)
    if (!usageOn) return next(e)
    if (mine === seq) {
      measured = e
      // the highest reading, as the cap: a measurement can land after a read that went past it
      parts.usage = usageStatus(e, e.cost ? (cap.spent ?? undefined) : undefined)
      showStatus($, parts)
    }
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
    if (cap.usd !== null) {
      // session.measure comes after a turn, not after each step: a tool loop or a subagent inside one
      // turn is held only if the cost is read here, before each step
      const session = costSession
      try {
        const usage = await $.session.usage()
        const usd = ofLeft(session, usage) ? undefined : usage.cost?.usd
        if (usd !== undefined && usd >= (cap.spent ?? 0)) cap.spent = usd
        if (usd !== undefined && usd === cap.spent && usageOn && measured) {
          // the line's dollar figure is the one the cap holds on, not the last turn's
          parts.usage = usageStatus(measured, usd)
          showStatus($, parts)
        }
      } catch {
        // no cost here: the last measurement stands
      }
      showWarning($)
    }
    if (reached()) {
      // answered here, no request made: the turn (or the subagent) ends on this text
      const text = heldText()
      yield { kind: 'text' as const, index: 0, text }
      yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage: null }
      return { turnId: e.turnId, index: e.index, answer: text, toolUses: [], stopReason: 'end_turn' as const, usage: null }
    }
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
    // the file's content and session are taken now, before any wait: a /clear during one empties the Map
    const writing = costSession
    const text = rowsText()
    files.spend.newest = { name: `${sessionId || 'no-session'}.jsonl`, text: () => text }
    try {
      await update($, shownRows, () => [...rows.values()])
    } catch {
      // the pane misses one redraw; the rows file is the record
    }
    parts.spend = spendStatus()
    showStatus($, parts)
    try {
      if ((await writeLatest($, spendDir, files.spend)) && parts.notice) {
        parts.notice = undefined
        showStatus($, parts)
      }
    } catch (err) {
      // a write of the session left: on the new session nothing would take its notice off
      if (writing !== costSession) return response
      // unwritable folder: the line says so until a write lands, and the session goes on
      parts.notice = `subagent-spend: rows file not written (${err instanceof Error ? err.message : String(err)})`
      showStatus($, parts)
    }
    return response
  })
}
