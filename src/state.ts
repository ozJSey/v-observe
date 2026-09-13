/**
 * Internal per-element state — one shape per mode plus the WeakMap store.
 * Every other module receives these bags as arguments; this is the only file
 * that knows where state lives.
 */
import { initialSegments, type StateSegments } from './state-attribute'
import type {
  IntersectConfig,
  MutateConfig,
  MutateEvent,
  ObserveOptions,
  ResizeConfig,
  ResizeDimensions,
  ResizeOrientation,
} from './types'

export interface IntersectInternal {
  cfg: IntersectConfig
  observer: IntersectionObserver
  /** Previous reported ratio for the `crossed` calculation. Initial value `0`. */
  lastRatio: number
  /** Previous reported `boundingClientRect.top` for the direction inference. `null` until the first callback. */
  lastTop: number | null
  /** Previous reported `isIntersecting`. Initial value `false`. */
  lastIsIntersecting: boolean
  /** Set after the single `on` callback when `once: true`. */
  hasFired: boolean
}

export interface NormalizedBreakpoints {
  thresholds: number[]
  /** Length = thresholds.length + 1. labels[i] is the label for bracket [thresholds[i-1], thresholds[i]). */
  labels: string[]
}

export interface ResizeInternal {
  cfg: ResizeConfig
  observer: ResizeObserver
  /** Last dispatched `to` — null until first dispatch. */
  lastDispatched: ResizeDimensions | null
  /** Last dispatched orientation. */
  lastOrientation: ResizeOrientation | null
  /** Cached normalized breakpoints — recomputed when cfg changes. */
  normalized: NormalizedBreakpoints | null
  /** Pending dimensions when debouncing. */
  pending: ResizeDimensions | null
  /** Debounce timer id. */
  timer: number | null
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
  /** Accumulated diffs during a debounce window, keyed by `event.type`. */
  pending: Map<string, MutateEvent>
  /** Debounce timer id. */
  timer: number | null
  /** Cooldown timer for `mutate:active` → `mutate:idle` transition. */
  activeTimer: number | null
}

export interface ObserveState {
  intersect?: IntersectInternal
  resize?: ResizeInternal
  mutate?: MutateInternal
  /** Tracks every segment of `data-observe-state` so updates from one mode
   * don't clobber values written by another. */
  segments: StateSegments
}

export const stateMap = new WeakMap<HTMLElement, ObserveState>()

export function getOrCreate(el: HTMLElement, opts: ObserveOptions): ObserveState {
  let s = stateMap.get(el)
  if (!s) {
    s = { segments: initialSegments(opts) }
    stateMap.set(el, s)
  }
  return s
}
