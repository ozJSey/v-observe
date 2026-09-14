/**
 * The cross-observer `gateOnIntersect` contract: the suppression check, and
 * the baseline reset when the host becomes visible again.
 *
 * Both read `state.visibility`, which is the single record of what intersect
 * last reported — not `state.intersect`, which disappears when `once`
 * collapses the observer. The reset itself is delegated to each mode's own
 * `resetGateBaseline`, defined in the module that owns those fields, so this
 * file never has to keep a hand-maintained list of somebody else's state.
 */
import type { ObserveState } from './state'

/**
 * Returns `true` when a mode configured with `gateOnIntersect: true` should be
 * suppressed at dispatch time.
 *
 * Fails OPEN (no gate) when the cfg has no flag, and when visibility is
 * `'unwired'` — no `IntersectionObserver` on this engine. Graceful degradation
 * prefers "always fire" over swallowing every event for the directive's
 * lifetime, and the CSS hook degrades the same way (`state-attribute.ts`).
 */
export function isGated(state: ObserveState, cfg: { gateOnIntersect?: boolean }): boolean {
  if (!cfg.gateOnIntersect) return false
  return state.visibility === 'hidden'
}

/**
 * Called when intersect flips hidden→visible. Each gated mode forgets its
 * baseline so the first dispatch after restore is a fresh "first tick"
 * (`from: null`, no synthetic orientation flip, no missed-bracket crossings)
 * and — for resize — asks the observer for a measurement it would otherwise
 * never re-send.
 */
export function onIntersectVisibilityRestored(state: ObserveState): void {
  state.resize?.resetGateBaseline()
  state.mutate?.resetGateBaseline()
}
