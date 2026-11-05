// The spend cap (option `capUsd`, off at 0): what the session may cost, by Claude Code's own
// estimate (`session.measure`'s `cost.usd`, the figure `--max-budget-usd` checks in print mode).
// At WARN_AT of the cap a toast says so, once; at the cap every model step, the main loop's and
// each subagent's, is answered by the mod with no request made, until /spend-cap raises or lifts it.
// A step already running finishes: its cost can pass the cap, so leave headroom.

export const WARN_AT = 0.8

export const cap = {
  /** The cap in dollars; null is off. */
  usd: null as number | null,
  /** The session's cost so far, from the newest measurement; null before the first. */
  spent: null as number | null,
  warned: false,
}

/** Dollars as a person writes them: `5`, `2.50`, `$4`, `.5`. Number() alone also reads `0x10` as 16 and `1e2` as 100. */
const DOLLARS = /^\$?(\d+(\.\d*)?|\.\d+)$/

/** The option's value as a cap: a positive number of dollars, anything else off. */
export function capOf(v: unknown): number | null {
  const text = typeof v === 'string' ? v.trim() : ''
  const n = typeof v === 'number' ? v : DOLLARS.test(text) ? Number(text.replace(/^\$/, '')) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

export const money = (n: number) => `$${n.toFixed(2)}`

/** Whether the next step is held: a cap is set and the cost has reached it. */
export const reached = () => cap.usd !== null && cap.spent !== null && cap.spent >= cap.usd

/** The warning's text once the cost first reaches WARN_AT of the cap (and stays under it), else null; said once per cap. */
export function warnNow(): string | null {
  if (cap.warned || cap.usd === null || cap.spent === null || reached() || cap.spent < cap.usd * WARN_AT) return null
  cap.warned = true
  return `Spend cap: ${money(cap.spent)} of ${money(cap.usd)} used`
}

/** What a held step answers in the chat. */
export const heldText = () =>
  `Spend cap reached: this session has cost ${money(cap.spent ?? 0)} of the ${money(cap.usd ?? 0)} cap ` +
  `(Claude Code's own estimate), so subagent-spend sent no request. ` +
  `To go on, raise it with /spend-cap <dollars>, or lift it with /spend-cap off.`

/** `/spend-cap` with its args: a number sets the cap, `off` lifts it, nothing shows it. The reply's text. */
export function capCommand(args: string): string {
  const a = args.trim().toLowerCase()
  if (a === 'off') {
    cap.usd = null
    cap.warned = false
    return `Spend cap off for this session. ${spentText()}`
  }
  if (a !== '') {
    const n = capOf(a)
    if (n === null) return `Not a cap: "${args.trim()}". Give dollars, like /spend-cap 5, or /spend-cap off.`
    cap.usd = n
    cap.warned = false
    return `Spend cap set to ${money(n)} for this session. ${spentText()}`
  }
  return cap.usd === null ? `No spend cap. ${spentText()}` : `Spend cap ${money(cap.usd)}. ${spentText()}`
}

const spentText = () => (cap.spent === null ? 'No cost reading yet.' : `Cost so far ${money(cap.spent)}.`)
