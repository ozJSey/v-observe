/**
 * Intersect mode — IntersectionObserver wiring, scroll-direction inference,
 * per-threshold `crossed` events, `once` collapse, and the visible/hidden
 * segment. Also the trigger for the cross-observer gate restore.
 */
import { onIntersectVisibilityRestored } from './gate'
import { getOrCreate, stateMap, type IntersectInternal } from './state'
import { writeStateAttribute } from './state-attribute'
import type { IntersectConfig, IntersectDirection, ObserveOptions } from './types'

function uniqSorted(nums: ReadonlyArray<number>): number[] {
  return Array.from(new Set(nums)).sort((a, b) => a - b)
}
function emitCrossed(
  cfg: IntersectConfig,
  prevRatio: number,
  nextRatio: number,
): void {
  const handler = cfg.crossed
  if (!handler) return
  const thresholds = cfg.thresholds
  if (!thresholds || thresholds.length === 0) return
  if (nextRatio === prevRatio) return

  const sorted = uniqSorted(thresholds)
  if (nextRatio > prevRatio) {
    for (const t of sorted) {
      if (t > prevRatio && t <= nextRatio) {
        handler({ threshold: t, direction: 'up', ratio: nextRatio })
      }
    }
  } else {
    for (let i = sorted.length - 1; i >= 0; i--) {
      const t = sorted[i]
      if (t >= nextRatio && t < prevRatio) {
        handler({ threshold: t, direction: 'down', ratio: nextRatio })
      }
    }
  }
}

function inferDirection(
  prevTop: number | null,
  currTop: number,
  prevIntersecting: boolean,
  currIntersecting: boolean,
  rootBounds: DOMRectReadOnly | null,
): IntersectDirection | null {
  const isTransitionEnter = !prevIntersecting && currIntersecting
  const isTransitionLeave = prevIntersecting && !currIntersecting

  if (!isTransitionEnter && !isTransitionLeave) return null

  if (prevTop === null) {
    // First-tick fallback: compare element top against root center.
    if (!isTransitionEnter) return null
    let rootCenter: number
    if (rootBounds && Number.isFinite(rootBounds.top) && Number.isFinite(rootBounds.height)) {
      rootCenter = rootBounds.top + rootBounds.height / 2
    } else if (typeof window !== 'undefined' && Number.isFinite(window.innerHeight)) {
      rootCenter = window.innerHeight / 2
    } else {
      return null
    }
    return currTop < rootCenter ? 'enter-from-above' : 'enter-from-below'
  }

  const delta = currTop - prevTop
  if (delta === 0) return null

  if (isTransitionEnter) {
    return delta < 0 ? 'enter-from-below' : 'enter-from-above'
  }
  // isTransitionLeave
  return delta < 0 ? 'leave-to-above' : 'leave-to-below'
}

/* ------------------------------------------------------------------ */
/*  Intersect — wiring                                                  */
/* ------------------------------------------------------------------ */

export function setupIntersect(el: HTMLElement, cfg: IntersectConfig, opts: ObserveOptions): void {
  if (typeof IntersectionObserver === 'undefined') return

  const state = getOrCreate(el, opts)
  if (state.intersect) {
    // Already wired; refresh cfg so reactive callback swaps take effect.
    state.intersect.cfg = cfg
    return
  }

  const internal: IntersectInternal = {
    cfg,
    observer: null as unknown as IntersectionObserver,
    lastRatio: 0,
    lastTop: null,
    lastIsIntersecting: false,
    hasFired: false,
  }
  state.intersect = internal

  const observerOptions: IntersectionObserverInit = {}
  if (cfg.root !== undefined) observerOptions.root = cfg.root as Element | null
  if (cfg.rootMargin !== undefined) observerOptions.rootMargin = cfg.rootMargin
  if (cfg.thresholds && cfg.thresholds.length > 0) {
    observerOptions.threshold = uniqSorted(cfg.thresholds)
  }

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.target !== el) continue
      const live = internal.cfg
      const prevRatio = internal.lastRatio
      const prevIntersecting = internal.lastIsIntersecting
      const prevTop = internal.lastTop
      const ratio = entry.intersectionRatio
      const isIntersecting = entry.isIntersecting
      const top = entry.boundingClientRect?.top ?? 0

      const direction = inferDirection(
        prevTop,
        top,
        prevIntersecting,
        isIntersecting,
        entry.rootBounds,
      )

      // Update tracked state BEFORE firing so handlers reading state via
      // queries see the latest values.
      internal.lastRatio = ratio
      internal.lastIsIntersecting = isIntersecting
      internal.lastTop = top

      // Reflect visibility into the CSS hook attribute so consumers can
      // style transitions without subscribing to JS callbacks.
      state.segments.intersect = isIntersecting ? 'visible' : 'hidden'
      writeStateAttribute(el, state.segments)

      // Cross-observer gate restore: any mode with `gateOnIntersect: true`
      // gets its baseline cleared on hidden→visible so the first post-restore
      // dispatch starts fresh (no stale prior baseline, no synthetic delta).
      if (!prevIntersecting && isIntersecting) {
        onIntersectVisibilityRestored(state)
      }

      if (live.on) {
        if (live.once) {
          if (!internal.hasFired && isIntersecting) {
            internal.hasFired = true
            live.on({ isIntersecting, ratio, direction, entry })
          }
        } else {
          live.on({ isIntersecting, ratio, direction, entry })
        }
      }

      // `crossed` always fires regardless of `once` — but `once: true` ALSO
      // disconnects after the on fire, so subsequent ticks won't fire `crossed`
      // either. That is, `once` collapses everything to a single tick.
      emitCrossed(live, prevRatio, ratio)

      if (live.once && internal.hasFired) {
        teardownIntersect(el)
        return
      }
    }
  }, observerOptions)

  internal.observer = observer
  observer.observe(el)
}

export function teardownIntersect(el: HTMLElement): void {
  const state = stateMap.get(el)
  if (!state?.intersect) return
  state.intersect.observer.disconnect()
  state.intersect = undefined
}
