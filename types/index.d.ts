export type Row = {
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
  /** the last step's prompt and reply: input + cache read + cache creation + output; equals Claude Code's own subagent_tokens */
  context: number
  model: string
}

/** What the usage pane draws: the newest measurement of the session (was usage-file's `latest`). */
export type Shown = {
  at: string
  windows: { kind: string; percentUsed: number; resetsAt: string | null }[]
  context: number | null
  usd: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'subagent-spend': { rows: Shaped<Row[]>; latest: Shaped<Shown | null> }
  }
}
