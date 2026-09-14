/**
 * Mutate mode, stateful half — observer attachment (host + parent for
 * self-removal), debounce-window event merging, dispatch, the
 * `mutate:active` cooldown, and setup / rebuild / teardown.
 *
 * The host's `textContent` as of the last dispatch lives here (`lastText`)
 * rather than in the record translator, because a `text` event is a diff of
 * the WHOLE host across a flush — not of whichever text node the browser
 * happened to report last.
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
import type { MutateConfig, MutateEvent } from './types'

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
    }, debounce)
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
  internal.segment = 'active'
  writeStateAttribute(el, state)
  if (internal.activeTimer !== null) clearTimeout(internal.activeTimer)
  internal.activeTimer = setTimeout(() => {
    internal.activeTimer = null
    // Only revert to 'idle' if this internal is still the live one.
    if (stateMap.get(el)?.mutate !== internal) return
    internal.segment = 'idle'
    writeStateAttribute(el, state)
  }, MUTATE_ACTIVE_COOLDOWN_MS)
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
      const events = recordsToEvents(el, records, internal.normalized, internal.lastText)
      // Baseline moves whether or not a `text` event was emitted: the next
      // diff has to start from what the host says now.
      internal.lastText = el.textContent
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

export function setupMutate(el: HTMLElement, cfg: MutateConfig, state?: ObserveState): void {
  if (typeof MutationObserver === 'undefined') return
  const s = state ?? getOrCreate(el)
  const normalized = normalizeMutate(cfg)
  const initKey = buildMutateInitKey(normalized)

  const existing = s.mutate
  if (existing) {
    existing.cfg = cfg
    existing.normalized = normalized
    if (existing.initKey !== initKey) {
      // Init shape changed — rebuild observers.
      if (existing.observer) existing.observer.disconnect()
      if (existing.parentObserver) existing.parentObserver.disconnect()
      existing.observer = null
      existing.parentObserver = null
      existing.initKey = initKey
      attachMutateObservers(el, s, existing)
    }
    return
  }

  const internal: MutateInternal = {
    cfg,
    normalized,
    observer: null,
    parentObserver: null,
    initKey,
    segment: 'idle',
    lastText: el.textContent,
    pending: new Map(),
    timer: null,
    activeTimer: null,
    resetGateBaseline: () => {
      if (!internal.cfg.gateOnIntersect) return
      if (internal.timer !== null) {
        clearTimeout(internal.timer)
        internal.timer = null
      }
      internal.pending.clear()
      // Mutations that happened while hidden were dropped, so the text the
      // host shows now is the new baseline — not the one from before it went
      // off-screen, which would make the first post-restore `text` event a
      // diff across the whole hidden period.
      internal.lastText = el.textContent
    },
  }
  s.mutate = internal
  attachMutateObservers(el, s, internal)
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
