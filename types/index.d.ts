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
  model: string
}

declare module 'claude-code' {
  interface PluginState {
    'subagent-spend': { rows: Shaped<Row[]> }
  }
}
