/**
 * The cross-observer `gateOnIntersect` contract — suppression check, the
 * baseline reset on hidden→visible, and the option validator that enforces
 * "a gate needs an intersect config to gate on".
 */
import type { ObserveState } from './state'
import type { ObserveOptions } from './types'

/**
 * Returns `true` when a mode configured with `gateOnIntersect: true` should
 * be suppressed at dispatch time. Falls back to `false` (no gate) when:
 * - the cfg has no `gateOnIntersect` flag; or
 * - intersect setup never wired up (e.g. `IntersectionObserver` unavailable)
 *   — graceful degradation prefers "always fire" over silently swallowing
 *   every event for the lifetime of the directive.
 */
export function isGated(
  state: ObserveState,
  cfg: { gateOnIntersect?: boolean },
): boolean {
  if (!cfg.gateOnIntersect) return false
  const i = state.intersect
  if (!i) return false
  return !i.lastIsIntersecting
}

/**
 * Called when intersect flips hidden→visible. Clears the baseline of any
 * mode running with `gateOnIntersect: true` so the first dispatch after
 * restore starts as a fresh "first tick" (`from: null`, no synthetic
 * orientation flip, no missed-bracket crossings).
 */
export function onIntersectVisibilityRestored(state: ObserveState): void {
  const r = state.resize
  if (r && r.cfg.gateOnIntersect) {
    r.lastDispatched = null
    r.lastOrientation = null
    if (r.timer !== null) {
      clearTimeout(r.timer)
      r.timer = null
    }
    r.pending = null
  }
  const m = state.mutate
  if (m && m.cfg.gateOnIntersect) {
    if (m.timer !== null) {
      clearTimeout(m.timer)
      m.timer = null
    }
    m.pending.clear()
  }
}

export function validateOptions(opts: ObserveOptions): void {
  if (opts.resize?.gateOnIntersect && !opts.intersect) {
    throw new Error(
      "[v-observe] resize.gateOnIntersect requires an intersect config — set `intersect: { ... }` alongside `resize: { gateOnIntersect: true }`.",
    )
  }
  if (opts.mutate?.gateOnIntersect && !opts.intersect) {
    throw new Error(
      "[v-observe] mutate.gateOnIntersect requires an intersect config — set `intersect: { ... }` alongside `mutate: { gateOnIntersect: true }`.",
    )
  }
}
