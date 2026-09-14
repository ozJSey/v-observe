/**
 * Internal per-element state — one shape per mode plus the WeakMap store.
 * Every other module receives these bags as arguments; this is the only file
 * that knows where state lives.
 *
 * Two things live on `ObserveState` rather than inside a mode, because more
 * than one mode reads them:
 *
 * - `visibility` — what `intersect` last reported. Both `gate.ts` and the CSS
 *   segment derive from it, so they can no longer disagree, and it survives
 *   the `once` collapse that deletes `intersect`.
 * - `configured` — which modes THIS binding asks for, which is what makes a
 *   segment `'-'`. A mode whose observer global is missing is still
 *   configured; it is not absent.
 *
 * Each mode's own segment lives inside that mode's internal (`segment`), so a
 * module physically cannot write another mode's segment: it never holds a
 * reference to another mode's state. That is the mechanical form of
 * ARCHITECTURE.md's "each mode owns exactly one segment".
 */
import type { IntersectVisibility, MutateSegment, ResizeSegment } from './state-attribute'
import type {
  IntersectConfig,
  MutateConfig,
  MutateEvent,
  ResizeConfig,
  ResizeDimensions,
  ResizeOrientation,
} from './types'

/** The options `IntersectionObserver` is constructed with — changing any of
 *  them requires a new observer, so they are kept for comparison. */
export interface IntersectObserverKey {
  root: Element | Document | null | undefined
  rootMargin: string | undefined
  /** Sorted, de-duplicated thresholds joined for comparison; `''` when unset. */
  thresholds: string
}

export interface IntersectInternal {
  cfg: IntersectConfig
  observer: IntersectionObserver
  /** The construction options in force, to detect a rebuild-worthy change. */
  key: IntersectObserverKey
  /** Previous reported ratio for the `crossed` calculation. `null` until the
   *  first callback — there is nothing to have crossed from before it. */
  lastRatio: number | null
  /** Previous reported `boundingClientRect.top` for the direction inference. `null` until the first callback. */
  lastTop: number | null
}

/** `setTimeout`'s return type differs between the DOM and Node typings, and
 *  the only thing this package does with it is hand it back to `clearTimeout`.
 *  Naming it here is what keeps `as unknown as number` out of three files. */
export type TimerId = ReturnType<typeof setTimeout>

export interface NormalizedBreakpoints {
  thresholds: number[]
  /** Length = thresholds.length + 1. labels[i] is the label for bracket [thresholds[i-1], thresholds[i]). */
  labels: string[]
}

export interface ResizeInternal {
  cfg: ResizeConfig
  observer: ResizeObserver
  /** The `box` currently passed to `observe()`, to detect a re-observe. */
  observedBox: NonNullable<ResizeConfig['box']>
  /** This mode's segment of `data-observe-state`. Owned here, written only by `resize.ts`. */
  segment: ResizeSegment
  /** Last dispatched `to` — null until first dispatch. */
  lastDispatched: ResizeDimensions | null
  /** Last dispatched orientation. */
  lastOrientation: ResizeOrientation | null
  /** Cached normalized breakpoints — recomputed when cfg changes. */
  normalized: NormalizedBreakpoints | null
  /** Pending dimensions when debouncing. */
  pending: ResizeDimensions | null
  /** Debounce timer id. */
  timer: TimerId | null
  /** Everything this mode must forget when the gate re-opens. Defined by
   *  `resize.ts`, which owns these fields, so a new baseline field is reset in
   *  the same file that adds it. */
  resetGateBaseline: () => void
}

export interface NormalizedMutateConfig {
  /** Specific attribute names to filter on, e.g. ['class', 'data-foo']. */
  attrNames: Set<string>
  /** When true, attributes are observed without a filter (any attribute change fires). */
  attrAny: boolean
  /** Subscribed to children:added or children:removed. */
  childList: boolean
  /** Subscribed to text. */
  text: boolean
  /** Subscribed to self-removal. */
  removed: boolean
  /** Selector(s) to filter children:added / children:removed nodes. */
  matches: string[] | null
}

export interface MutateInternal {
  cfg: MutateConfig
  normalized: NormalizedMutateConfig
  observer: MutationObserver | null
  /** Second observer attached to el.parentNode when `removed` is subscribed. */
  parentObserver: MutationObserver | null
  /** Cached observer init — used to detect when a rebuild is required. */
  initKey: string
  /** This mode's segment of `data-observe-state`. Owned here, written only by `mutate.ts`. */
  segment: MutateSegment
  /** The host's `textContent` as of the last dispatch, so a `text` event is a
   *  diff of the WHOLE host rather than of whichever node happened to change. */
  lastText: string | null
  /** Accumulated diffs during a debounce window, keyed by `event.type`. */
  pending: Map<string, MutateEvent>
  /** Debounce timer id. */
  timer: TimerId | null
  /** Cooldown timer for `mutate:active` → `mutate:idle` transition. */
  activeTimer: TimerId | null
  /** See `ResizeInternal.resetGateBaseline`. */
  resetGateBaseline: () => void
}

/** Which modes the current binding configures. Owned by `directive.ts`. */
export interface ConfiguredModes {
  intersect: boolean
  resize: boolean
  mutate: boolean
}

export interface ObserveState {
  intersect?: IntersectInternal
  resize?: ResizeInternal
  mutate?: MutateInternal
  configured: ConfiguredModes
  /**
   * What `intersect` last reported. `'unwired'` means no observer has ever
   * reported — intersect is not configured, or `IntersectionObserver` does not
   * exist here. The gate and the CSS hook both treat that as "no information"
   * and both fail OPEN: no suppression, and a segment of `visible` so a
   * `[data-observe-state*='intersect:visible']` reveal rule still matches.
   */
  visibility: IntersectVisibility
  /** Set once `once: true` has collapsed intersect, so a later `updated` does
   *  not quietly build a second observer and fire again. */
  intersectCollapsed: boolean
  /** Last string written to `data-observe-state`, so an unchanged write is
   *  skipped — a no-op `setAttribute` still queues a MutationRecord. */
  written: string | null
}

export const stateMap = new WeakMap<HTMLElement, ObserveState>()

export function getOrCreate(el: HTMLElement): ObserveState {
  let s = stateMap.get(el)
  if (!s) {
    s = {
      configured: { intersect: false, resize: false, mutate: false },
      visibility: 'unwired',
      intersectCollapsed: false,
      written: null,
    }
    stateMap.set(el, s)
  }
  return s
}
