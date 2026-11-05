import { atom, read } from 'claude-code'
import type { Register } from 'claude-code'

import type { Row, Shown } from '../types'
import { count, fmt, paneLines } from './spend'
import { OPEN_AT, bar, usageLines } from './usage'

export const SPEND_PANE = 'subagent-spend'
export const USAGE_PANE = 'usage-file'

// What the panes draw: the same atoms as hooks/register.tsx. Change a tag in both files.
const shownRows = atom({ plugin: 'subagent-spend', key: 'rows' } as const, [] as Row[], { shape: 'rows-2' })
const shownUsage = atom({ plugin: 'subagent-spend', key: 'latest' } as const, null as Shown | null, { shape: 'latest-1' })

/** The two panes. With the usage part off, its pane passes on. */
export const registerPanes = (on: Parameters<Register>[0], usageOn: boolean) => {
  on('ui.render', { component: 'Pane', requestId: SPEND_PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, shownRows)
    const room = Math.max(1, (e.viewport?.rows ?? 24) - 4)
    let tok = 0
    for (const r of list) tok += r.total
    return (
      <Box flexDirection="column">
        <Text bold>
          {count(list.length, 'subagent')}, {fmt(tok)} tokens
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
}
