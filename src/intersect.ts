/**
 * Intersect mode — IntersectionObserver wiring, scroll-direction inference,
 * per-threshold `crossed` events, `once` collapse, and the visible/hidden
 * segment. Also the trigger for the cross-observer gate restore.
 *
 * The observer's CONSTRUCTION options (`root`, `rootMargin`, `thresholds`)
 * cannot be changed on a live observer, so they are kept in `internal.key` and
 * compared on every binding update: a change rebuilds. Without that, `root:
 * scroller` never works at all — Vue evaluates the binding object during
 * render, before template refs are assigned, so the first value is always
 * `null` and the real element only ever arrives via `updated`.
 */
import { onIntersectVisibilityRestored } from './gate'
import { getOrCreate, stateMap, type IntersectInternal, type IntersectObserverKey, type ObserveState } from './state'
import { writeStateAttribute } from './state-attribute'
import type { IntersectConfig, IntersectDirection } from './types'

function uniqSorted(nums: ReadonlyArray<number>): number[] {
  return Array.from(new Set(nums)).sort((a, b) => a - b)
}

/**
 * Emit one event per threshold crossed between two ratios.
 *
 * `prevRatio` is `null` on the very first callback: there is no earlier ratio,
 * so nothing has been crossed. Reporting crossings there would announce that
 * an element which merely mounted 60% visible had just been scrolled in.
 *
 * Threshold `0` is special-cased on the way up. The general rule "crossed
 * upward when `prev < t <= next`" can never fire for `t === 0`, because a
 * ratio is never negative, while the downward rule fires on every full exit —
 * so `thresholds: [0]`, the natural way to ask "tell me when it enters at
 * all", would emit unpaired `down` events.
 */
function emitCrossed(cfg: IntersectConfig, prevRatio: number | null, nextRatio: number): void {
  const handler = cfg.crossed
  if (!handler) return
  const thresholds = cfg.thresholds
  if (!thresholds || thresholds.length === 0) return
  if (prevRatio === null || nextRatio === prevRatio) return

  const sorted = uniqSorted(thresholds)
  if (nextRatio > prevRatio) {
    for (const t of sorted) {
      const crossed = t === 0 ? prevRatio === 0 : t > prevRatio && t <= nextRatio
      if (crossed) {
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

function observerKey(cfg: IntersectConfig): IntersectObserverKey {
  return {
    root: cfg.root,
    rootMargin: cfg.rootMargin,
    thresholds: cfg.thresholds && cfg.thresholds.length > 0 ? uniqSorted(cfg.thresholds).join(',') : '',
  }
}

function sameKey(a: IntersectObserverKey, b: IntersectObserverKey): boolean {
  return a.root === b.root && a.rootMargin === b.rootMargin && a.thresholds === b.thresholds
}

function observerInit(cfg: IntersectConfig): IntersectionObserverInit {
  const init: IntersectionObserverInit = {}
  if (cfg.root !== undefined) init.root = cfg.root as Element | null
  if (cfg.rootMargin !== undefined) init.rootMargin = cfg.rootMargin
  if (cfg.thresholds && cfg.thresholds.length > 0) init.threshold = uniqSorted(cfg.thresholds)
  return init
}

function handleEntry(el: HTMLElement, state: ObserveState, entry: IntersectionObserverEntry): void {
  const internal = state.intersect
  if (!internal) return
  const live = internal.cfg
  const prevRatio = internal.lastRatio
  const prevIntersecting = state.visibility === 'visible'
  const prevTop = internal.lastTop
  const ratio = entry.intersectionRatio
  const isIntersecting = entry.isIntersecting
  const top = entry.boundingClientRect.top

  const direction = inferDirection(prevTop, top, prevIntersecting, isIntersecting, entry.rootBounds)

  // Update tracked state BEFORE firing so handlers reading state via
  // queries see the latest values.
  internal.lastRatio = ratio
  internal.lastTop = top
  state.visibility = isIntersecting ? 'visible' : 'hidden'
  if (live.once && isIntersecting) state.intersectCollapsed = true

  // Reflect visibility into the CSS hook attribute so consumers can
  // style transitions without subscribing to JS callbacks.
  writeStateAttribute(el, state)

  // Cross-observer gate restore: any mode with `gateOnIntersect: true`
  // gets its baseline cleared on hidden→visible so the first post-restore
  // dispatch starts fresh (no stale prior baseline, no synthetic delta).
  if (!prevIntersecting && isIntersecting) {
    onIntersectVisibilityRestored(state)
  }

  if (live.on && (!live.once || isIntersecting)) {
    live.on({ isIntersecting, ratio, direction, entry })
  }

  emitCrossed(live, prevRatio, ratio)

  // `once` collapses everything to that single visible tick — the callbacks
  // above run for it, and the observer is gone before the next one. It stays
  // gone: `state.intersectCollapsed` outlives the internal, so a later
  // `updated` cannot quietly build a second observer.
  if (state.intersectCollapsed) teardownIntersect(el, 'collapse')
}

function createObserver(el: HTMLElement, state: ObserveState, cfg: IntersectConfig): void {
  // Constructed BEFORE anything is published on `state`: a bad `thresholds` or
  // `rootMargin` throws here, and the consumer gets that one error rather than
  // that error plus a null-dereference from teardown.
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) handleEntry(el, state, entry)
  }, observerInit(cfg))

  const internal: IntersectInternal = {
    cfg,
    observer,
    key: observerKey(cfg),
    lastRatio: null,
    lastTop: null,
  }
  state.intersect = internal
  if (state.visibility === 'unwired') state.visibility = 'hidden'
  observer.observe(el)
}

export function setupIntersect(el: HTMLElement, cfg: IntersectConfig, state?: ObserveState): void {
  if (typeof IntersectionObserver === 'undefined') return
  const s = state ?? getOrCreate(el)

  const existing = s.intersect
  if (existing) {
    existing.cfg = cfg
    const next = observerKey(cfg)
    if (sameKey(existing.key, next)) return
    // A construction option changed. The old observer cannot be reconfigured,
    // and the ratios it reported were measured against the old root, so the
    // crossing baseline goes with it.
    existing.observer.disconnect()
    s.intersect = undefined
    createObserver(el, s, cfg)
    return
  }

  // `once` already fired. Rebuilding here is what used to make `once` mean
  // "once per parent render".
  if (s.intersectCollapsed) return
  createObserver(el, s, cfg)
}

/**
 * `'collapse'` — `once` fired; the last known visibility stays, so the CSS
 * segment keeps its value.
 * `'unwire'` — the binding no longer asks for intersect (or the host is going
 * away); everything intersect knew is forgotten.
 */
export function teardownIntersect(el: HTMLElement, reason: 'collapse' | 'unwire' = 'unwire'): void {
  const state = stateMap.get(el)
  if (!state) return
  state.intersect?.observer.disconnect()
  state.intersect = undefined
  if (reason === 'unwire') {
    state.visibility = 'unwired'
    state.intersectCollapsed = false
  }
}
