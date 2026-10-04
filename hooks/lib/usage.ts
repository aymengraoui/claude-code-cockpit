/** Mapping the engine's usage figures onto the pane's state. Pure. */

import type { Cockpit, Window } from '../../types'

/** The shape `$.session.usage()` answers with, and `session.measure` carries. */
export type UsageReading = {
  context: { percent?: number; tokens?: number; window?: number }
  rateLimits: readonly { kind: string; percentUsed: number; resetsAt?: string }[]
  cost?: { usd: number }
}

const windowOf = (rateLimits: UsageReading['rateLimits'], kind: string): Window | null => {
  const found = rateLimits.find(one => one.kind === kind)

  return found === undefined
    ? null
    : { percent: found.percentUsed, resetsAt: found.resetsAt ?? null }
}

/**
 * The usage fields of the state, each figure kept when the reading has none — so a
 * reading taken before the first response never blanks what is already shown.
 */
export const fromUsage = (
  prev: Cockpit,
  reading: UsageReading,
): Pick<Cockpit, 'context' | 'tokens' | 'window' | 'fiveHour' | 'sevenDay' | 'costUsd'> => ({
  context: reading.context.percent ?? prev.context,
  tokens: reading.context.tokens ?? prev.tokens,
  window: reading.context.window ?? prev.window,
  fiveHour: windowOf(reading.rateLimits, 'five_hour') ?? prev.fiveHour,
  sevenDay: windowOf(reading.rateLimits, 'seven_day') ?? prev.sevenDay,
  costUsd: reading.cost?.usd ?? prev.costUsd,
})
