import type { Row } from '../types'

// The per-subagent sums: what each subagent of the session cost, as the API counts it.
// Keyed by the exact agent id the engine hands over; two ids that share a prefix or a
// suffix stay two rows, and a type is carried only from a spawn with that exact id.
// Sums live in module variables, so a hot reload starts them over; the row's `ts`
// says when it was last written.

export const rows = new Map<string, Row>()
export const types = new Map<string, string>()

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

export const fmt = (n: number) => (n >= 10000 ? `${Math.round(n / 1000)}k` : String(n))

/** The four counts of one step's usage, as the engine hands them over. */
export type StepUsage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
  model?: string
}

/** Adds one step to the agent's row. Reads the prior row at the moment it adds, never before a wait. */
export const addStep = (agentId: string, sessionId: string, u: StepUsage, model: string, now: Date): Row => {
  const prior = rows.get(agentId)
  const row: Row = {
    ts: localIso(now),
    session_id: sessionId,
    agent_id: agentId,
    agent_type: types.get(agentId) ?? prior?.agent_type ?? '',
    input: (prior?.input ?? 0) + u.input_tokens,
    output: (prior?.output ?? 0) + u.output_tokens,
    cache_read: (prior?.cache_read ?? 0) + u.cache_read_input_tokens,
    cache_create: (prior?.cache_create ?? 0) + u.cache_creation_input_tokens,
    turns: (prior?.turns ?? 0) + 1,
    total: 0,
    context: u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens + u.output_tokens,
    model: u.model || prior?.model || model,
  }
  row.total = row.input + row.output + row.cache_read + row.cache_create
  rows.set(agentId, row)
  return row
}

/** The rows file's whole text: one row per agent, one JSON object per line. */
export const rowsText = () =>
  [...rows.values()].map(r => JSON.stringify(r)).join('\n') + (rows.size ? '\n' : '')

/** The status line part: `subagents 2 | tok 7340 (out 120)`. */
export const spendStatus = () => {
  let tok = 0
  let out = 0
  for (const r of rows.values()) {
    tok += r.total
    out += r.output
  }
  return `subagents ${rows.size} | tok ${fmt(tok)} (out ${fmt(out)})`
}

/** The shortest start of `id`, six characters or more, that no other listed id starts with; the whole id
 * when none is (one id is the start of another). Two agents never share a label. */
export const label = (id: string, all: readonly string[]) => {
  for (let n = Math.min(6, id.length); n < id.length; n++) {
    const head = id.slice(0, n)
    if (!all.some(o => o !== id && o.startsWith(head))) return head
  }
  return id
}

/** The pane's lines, biggest spender first: `Explore  a1b2c3  8 turns  41k (out 2104, ctx 24k)  claude-opus-5-5`. */
export const paneLines = (list: Row[]) => {
  const ids = list.map(r => r.agent_id)
  return [...list]
    .sort((a, b) => b.total - a.total)
    .map(r => `${r.agent_type || 'agent'}  ${label(r.agent_id, ids)}  ${r.turns} turns  ${fmt(r.total)} (out ${fmt(r.output)}, ctx ${fmt(r.context ?? 0)})  ${r.model}`)
}
