/**
 * Mutate mode, stateful half — observer attachment (host + parent for
 * self-removal), debounce-window event merging, dispatch, the
 * `mutate:active` cooldown, and setup / rebuild / teardown.
 */
import { isGated } from './gate'
import {
  buildMutateInit,
  buildMutateInitKey,
  initHasAnyHostSignal,
  mergePendingEvent,
  normalizeMutate,
  recordsToEvents,
} from './mutate-records'
import { getOrCreate, stateMap, type MutateInternal, type ObserveState } from './state'
import { writeStateAttribute } from './state-attribute'
import type { MutateConfig, MutateEvent, ObserveOptions } from './types'

const MUTATE_ACTIVE_COOLDOWN_MS = 150

function dispatchMutateEvents(
  el: HTMLElement,
  state: ObserveState,
  internal: MutateInternal,
  events: MutateEvent[],
): void {
  if (events.length === 0) return
  const debounce = internal.cfg.debounce ?? 0
  if (debounce > 0) {
    for (const ev of events) {
      const existing = internal.pending.get(ev.type)
      if (existing) {
        mergePendingEvent(existing, ev)
      } else {
        internal.pending.set(ev.type, { ...ev })
      }
    }
    if (internal.timer !== null) clearTimeout(internal.timer)
    internal.timer = setTimeout(() => {
      internal.timer = null
      const flushable = Array.from(internal.pending.values())
      internal.pending.clear()
      flushMutateEvents(el, state, internal, flushable)
    }, debounce) as unknown as number
    return
  }
  flushMutateEvents(el, state, internal, events)
}

function flushMutateEvents(
  el: HTMLElement,
  state: ObserveState,
  internal: MutateInternal,
  events: MutateEvent[],
): void {
  const handler = internal.cfg.handler
  if (handler) {
    for (const ev of events) handler(ev)
  }
  state.segments.mutate = 'active'
  writeStateAttribute(el, state.segments)
  if (internal.activeTimer !== null) clearTimeout(internal.activeTimer)
  internal.activeTimer = setTimeout(() => {
    internal.activeTimer = null
    // Only revert to 'idle' if we still have a live mutate segment (not torn down).
    const live = stateMap.get(el)
    if (live && live.segments.mutate === 'active') {
      live.segments.mutate = 'idle'
      writeStateAttribute(el, live.segments)
    }
  }, MUTATE_ACTIVE_COOLDOWN_MS) as unknown as number
}

function handleSelfRemoval(
  el: HTMLElement,
  state: ObserveState,
  internal: MutateInternal,
  records: ReadonlyArray<MutationRecord>,
): void {
  for (const r of records) {
    if (r.type !== 'childList') continue
    const removed = r.removedNodes
    for (let i = 0; i < removed.length; i++) {
      if (removed[i] === el) {
        dispatchMutateEvents(el, state, internal, [{ type: 'removed', target: el }])
        if (internal.parentObserver) {
          internal.parentObserver.disconnect()
          internal.parentObserver = null
        }
        return
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Mutate — setup + teardown + rebuild                                */
/* ------------------------------------------------------------------ */

function attachMutateObservers(
  el: HTMLElement,
  state: ObserveState,
  internal: MutateInternal,
): void {
  const norm = internal.normalized
  const init = buildMutateInit(norm)

  if (initHasAnyHostSignal(init)) {
    const observer = new MutationObserver((records) => {
      // Cross-observer gate: skip host signals (attr / childList / text)
      // while intersect is hidden. `removed` flows through the parent
      // observer and stays terminal-by-default (see handleSelfRemoval).
      if (isGated(state, internal.cfg)) return
      const events = recordsToEvents(el, records, internal.normalized)
      dispatchMutateEvents(el, state, internal, events)
    })
    observer.observe(el, init)
    internal.observer = observer
  }

  if (norm.removed) {
    const parent = el.parentNode
    if (parent) {
      const parentObserver = new MutationObserver((records) => {
        handleSelfRemoval(el, state, internal, records)
      })
      parentObserver.observe(parent, { childList: true })
      internal.parentObserver = parentObserver
    }
  }
}

export function setupMutate(el: HTMLElement, cfg: MutateConfig, opts: ObserveOptions): void {
  if (typeof MutationObserver === 'undefined') return
  const state = getOrCreate(el, opts)
  const normalized = normalizeMutate(cfg)
  const initKey = buildMutateInitKey(normalized)

  if (state.mutate) {
    state.mutate.cfg = cfg
    state.mutate.normalized = normalized
    if (state.mutate.initKey !== initKey) {
      // Init shape changed — rebuild observers.
      if (state.mutate.observer) state.mutate.observer.disconnect()
      if (state.mutate.parentObserver) state.mutate.parentObserver.disconnect()
      state.mutate.observer = null
      state.mutate.parentObserver = null
      state.mutate.initKey = initKey
      attachMutateObservers(el, state, state.mutate)
    }
    return
  }

  const internal: MutateInternal = {
    cfg,
    normalized,
    observer: null,
    parentObserver: null,
    initKey,
    pending: new Map(),
    timer: null,
    activeTimer: null,
  }
  state.mutate = internal
  state.segments.mutate = 'idle'
  writeStateAttribute(el, state.segments)
  attachMutateObservers(el, state, internal)
}

export function teardownMutate(el: HTMLElement): void {
  const state = stateMap.get(el)
  if (!state?.mutate) return
  if (state.mutate.timer !== null) clearTimeout(state.mutate.timer)
  if (state.mutate.activeTimer !== null) clearTimeout(state.mutate.activeTimer)
  if (state.mutate.observer) state.mutate.observer.disconnect()
  if (state.mutate.parentObserver) state.mutate.parentObserver.disconnect()
  state.mutate = undefined
}
