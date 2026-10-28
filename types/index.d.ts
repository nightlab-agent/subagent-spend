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

declare module 'claude-code' {
  interface PluginState {
    'subagent-spend': { rows: Shaped<Row[]> }
  }
}
