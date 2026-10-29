// The turns part (option `turnTally`): the main conversation's model steps, tool calls,
// tool errors and error streak. This file holds the counts and the text; register.tsx
// holds the hooks. The day file's format is the one turn-tally 0.4.0 wrote, line for line.
//
// Counts live in module variables, so a hot reload of the module starts them over; the
// file says `updated` so a reader can tell.

export const tally = { steps: 0, toolCalls: 0, toolErrors: 0, streak: 0, longestStreak: 0, subagentToolCalls: 0 }

const pad = (n: number) => String(n).padStart(2, '0')

export const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

/** Counts one finished tool call. A subagent's call is counted apart. A denied call never ran, so it is
 * not a tool error; an errored result is. */
export const countCall = (agentId: string | undefined, denied: boolean, isError: boolean) => {
  if (agentId) {
    tally.subagentToolCalls++
    return
  }
  tally.toolCalls++
  if (!denied && isError) {
    tally.toolErrors++
    tally.streak++
    if (tally.streak > tally.longestStreak) tally.longestStreak = tally.streak
  } else {
    tally.streak = 0
  }
}

/** The day file's whole text: one fact per line, rewritten whole every step. */
export const tallyText = (model: string, messageCount: number, now: Date) =>
  [
    `steps ${tally.steps}`,
    `tool calls ${tally.toolCalls} (${tally.subagentToolCalls} by subagents)`,
    `tool errors ${tally.toolErrors}, current streak ${tally.streak}, longest streak ${tally.longestStreak}`,
    `model ${model}, messages ${messageCount}`,
    `updated ${localDay(now)} ${localTime(now)}`,
    '',
  ].join('\n')

/** The status line part: `steps 12 | tools 11 | errors 1 (streak 0)`. */
export const turnsStatus = () => `steps ${tally.steps} | tools ${tally.toolCalls} | errors ${tally.toolErrors} (streak ${tally.streak})`
