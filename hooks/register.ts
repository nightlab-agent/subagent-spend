import type { Register } from 'claude-code'

// subagent-spend, the hooks module: what each subagent costs, as the API counts it.
//
// On every model step of a subagent's loop (`turn.step` with an `agentId`) the
// engine hands back the response's usage: the four token counts and the model
// that answered. This module sums them per agent, writes the session's ledger
// whole after each step (one JSON row per agent, the same row the command hook
// and `subagent_spend.py` use), and puts the running total in the status line.
//
// DESIGN NOTE, deliberately narrow: it never denies, never rewrites a request,
// never reads a transcript, settings or credentials, never touches the network.
// A failed write is swallowed after one status line names the folder: the
// ledger is advisory, and a gauge that stops the engine would be worse than no
// gauge. Steady state is one status line and one file per session.
//
// Sums live in module variables, so a hot reload starts them over; the row's
// `ts` says when it was last written.

type Row = {
  ts: string
  session_id: string
  agent_id: string
  agent_type: string
  input: number
  output: number
  cache_read: number
  cache_create: number
  turns: number
  total: number
  model: string
}

const rows = new Map<string, Row>()
const types = new Map<string, string>()
let warned = false

const pad = (n: number) => String(n).padStart(2, '0')

/** Local time with offset, the shape the command hook writes (`2026-10-27T16:40:02-04:00`). */
export const localIso = (d: Date) => {
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const abs = Math.abs(off)
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  )
}

const fmt = (n: number) => (n >= 10000 ? `${Math.round(n / 1000)}k` : String(n))

/** The ledger's whole text: one row per agent, one JSON object per line. */
export const ledgerText = () =>
  [...rows.values()].map(r => JSON.stringify(r)).join('\n') + (rows.size ? '\n' : '')

/** The status line: `subagents 2 | tok 7340 (out 120)`. */
export const statusText = () => {
  let tok = 0
  let out = 0
  for (const r of rows.values()) {
    tok += r.total
    out += r.output
  }
  return `subagents ${rows.size} | tok ${fmt(tok)} (out ${fmt(out)})`
}

export const register: Register = on => {
  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.agentId) types.set(started.agentId, e.subagentType)
    return started
  }).catch(($, e, next) => next(e)) // an observer: whatever breaks here, the spawn goes on

  on('turn.step', async function* ($, e, next) {
    const response = yield* next(e)
    if (!e.agentId || !response.usage) return response
    const u = response.usage
    const sessionId = await $.session.id()
    const prior = rows.get(e.agentId)
    const row: Row = {
      ts: localIso(new Date()),
      session_id: sessionId,
      agent_id: e.agentId,
      agent_type: types.get(e.agentId) ?? prior?.agent_type ?? '',
      input: (prior?.input ?? 0) + u.input_tokens,
      output: (prior?.output ?? 0) + u.output_tokens,
      cache_read: (prior?.cache_read ?? 0) + u.cache_read_input_tokens,
      cache_create: (prior?.cache_create ?? 0) + u.cache_creation_input_tokens,
      turns: (prior?.turns ?? 0) + 1,
      total: 0,
      model: u.model || prior?.model || e.model,
    }
    row.total = row.input + row.output + row.cache_read + row.cache_create
    rows.set(e.agentId, row)
    try {
      $.ui.status(statusText())
    } catch {
      // a surface with no status line; the ledger still gets written
    }
    try {
      const dir = (await $.env.get('SUBAGENT_SPEND_DIR')) || `${await $.env.get('HOME')}/.subagent-spend`
      await $.fs.write(`${dir}/${sessionId}.jsonl`, ledgerText())
    } catch (err) {
      // unwritable folder or no HOME: say so once, then the session goes on
      if (!warned) {
        warned = true
        try {
          $.ui.status(`subagent-spend: ledger not written (${err instanceof Error ? err.message : String(err)})`)
        } catch {
          // nothing left to tell it on
        }
      }
    }
    return response
  })
}
