import type { SessionMeasureInput } from 'claude-code'

import type { Shown } from '../types'

// The usage part (option `usageFile`): the session's rate-limit windows, context fill and
// cost, as the engine's `session.measure` event carries them. This file holds the text;
// register.tsx holds the hooks. The file format is the one usage-file 0.4.1 wrote, field
// for field, so a reader of `.usage-file/latest.json` keeps working.

const LABEL: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }
const NAME: Record<string, string> = { five_hour: '5-hour', seven_day: 'Weekly', spend_limit: 'Spend limit' }

/** The usage pane opens itself once, the first time any window reaches this percent. */
export const OPEN_AT = 80

/** A ten-cell bar: `██████░░░░` for 60. */
export const bar = (pct: number) => {
  const full = Math.max(0, Math.min(10, Math.round(pct / 10)))
  return '█'.repeat(full) + '░'.repeat(10 - full)
}

/** Time left to a reset: `2h 05m`, `3d 4h`, `now`; empty when the engine gave no reset time. */
export const untilText = (resetsAt: string | null, now: Date) => {
  if (!resetsAt) return ''
  const ms = Date.parse(resetsAt) - now.getTime()
  if (Number.isNaN(ms)) return ''
  if (ms <= 0) return 'now'
  const min = Math.floor(ms / 60000)
  if (min >= 2880) return `${Math.floor(min / 1440)}d ${Math.floor((min % 1440) / 60)}h`
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`
}

/** One pane line per window: `5-hour   ██░░░░░░░░  23.5%  resets in 2h 05m`. */
export const usageLines = (s: Shown, now: Date) =>
  s.windows.map(w => {
    const left = untilText(w.resetsAt, now)
    return `${(NAME[w.kind] ?? w.kind).padEnd(11)} ${bar(w.percentUsed)}  ${w.percentUsed}%${left ? `  resets in ${left}` : ''}`
  })

/** latest.json's whole text: one JSON object, rewritten whole on every measurement. */
export const fileText = (e: SessionMeasureInput, session: string, now: Date) =>
  JSON.stringify(
    {
      at: now.toISOString(),
      session: session || null,
      changed: e.changed,
      context: {
        tokens: e.context.tokens ?? null,
        window: e.context.window,
        percent: e.context.percent ?? null,
      },
      rateLimits: e.rateLimits.map(w => ({
        kind: w.kind,
        percentUsed: w.percentUsed,
        resetsAt: w.resetsAt ?? null,
      })),
      cost: e.cost ? { usd: e.cost.usd } : null,
    },
    null,
    2,
  ) + '\n'

/** The status line part: only the figures that have a reading; undefined when none has. */
export const usageStatus = (e: SessionMeasureInput) => {
  const parts = e.rateLimits.map(w => `${LABEL[w.kind] ?? w.kind} ${w.percentUsed}%`)
  if (e.context.percent !== undefined) parts.push(`ctx ${e.context.percent}%`)
  if (e.cost) parts.push(`$${e.cost.usd.toFixed(2)}`)
  return parts.length ? parts.join(' | ') : undefined
}

/** The usage part again, from what the pane holds (for the command's answer). */
export const shownStatus = (s: Shown) =>
  usageStatus({
    rateLimits: s.windows.map(w => ({ kind: w.kind, percentUsed: w.percentUsed })),
    context: { window: 0, percent: s.context ?? undefined },
    cost: s.usd === null ? undefined : { usd: s.usd },
    changed: [],
  } as SessionMeasureInput) ?? 'No figures yet.'

/** What the usage pane stores from one measurement. */
export const shownOf = (e: SessionMeasureInput, now: Date): Shown => ({
  at: now.toISOString(),
  windows: e.rateLimits.map(w => ({ kind: w.kind, percentUsed: w.percentUsed, resetsAt: w.resetsAt ?? null })),
  context: e.context.percent ?? null,
  usd: e.cost ? e.cost.usd : null,
})
