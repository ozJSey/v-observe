/**
 * Public types for all three modes.
 *
 * Leaf module: imports nothing.
 */
/* ------------------------------------------------------------------ */

/**
 * Direction of a visibility transition.
 *
 * - `'enter-from-above'` — element entered the root from the top edge
 *   (the user scrolled UP, exposing it from above).
 * - `'enter-from-below'` — element entered the root from the bottom edge
 *   (the user scrolled DOWN, exposing it from below).
 * - `'leave-to-above'`  — element left the root via the top edge
 *   (the user kept scrolling DOWN past it).
 * - `'leave-to-below'`  — element left the root via the bottom edge
 *   (the user scrolled UP past it).
 */
export type IntersectDirection =
  | 'enter-from-above'
  | 'enter-from-below'
  | 'leave-to-above'
  | 'leave-to-below'

/** Payload of the per-threshold `crossed` event. */
export type IntersectCrossEvent = {
  threshold: number
  direction: 'up' | 'down'
  ratio: number
}

/** Payload of the `on` callback. */
export type IntersectEvent = {
  isIntersecting: boolean
  ratio: number
  /** Set only on visibility transitions; `null` on intermediate ticks. */
  direction: IntersectDirection | null
  entry: IntersectionObserverEntry
}

/** Configuration for the `intersect` mode. */
export type IntersectConfig = {
  /** Fires on every observer callback. */
  on?: (event: IntersectEvent) => void
  /**
   * Collapse to a single visible tick: after the first callback with
   * `isIntersecting === true` the observer is disconnected, so neither `on`
   * nor `crossed` fires again — and it stays collapsed across re-renders.
   * Incompatible with `gateOnIntersect`, which needs a live observer; that
   * combination throws at bind time.
   */
  once?: boolean
  /**
   * Threshold values forwarded to the underlying `IntersectionObserver`.
   * The directive also fires the per-threshold `crossed` event on each
   * crossing in the appropriate direction. Values outside `[0, 1]` throw at
   * bind time. Changing this rebuilds the observer.
   */
  thresholds?: number[]
  /**
   * Fires once per threshold per crossing. No crossings are emitted for the
   * first callback: a crossing needs a previous ratio to have crossed *from*.
   */
  crossed?: (event: IntersectCrossEvent) => void
  /**
   * Forwarded to `IntersectionObserverInit.root`. Reactive: assigning a
   * different element (for instance a template ref that only resolves after
   * the first render) rebuilds the observer against the new root.
   */
  root?: Element | Document | null
  /** Forwarded to `IntersectionObserverInit.rootMargin`. Reactive — see `root`. */
  rootMargin?: string
}

/* ------------------------------------------------------------------ */
/*  Public types — Resize                                              */
/* ------------------------------------------------------------------ */

export type ResizeOrientation = 'portrait' | 'landscape' | 'square'

export type ResizeBox = 'border' | 'content' | 'device-pixel'

export type ResizeMode = 'tick' | 'crossed' | 'orientation'

export type ResizeDimensions = { width: number; height: number }

/** Fires once per axis per bracket-crossing when `on: 'crossed'`. */
export type ResizeBracketEvent = {
  mode: 'crossed'
  axis: 'width' | 'height'
  threshold: number
  direction: 'up' | 'down'
  /** Label of the bracket entered by crossing THIS threshold. On a jump over
   *  several thresholds each event carries the bracket it entered, not the
   *  final one. */
  bracket: string
  /** The previous dimensions. Never null: a crossing needs two measurements. */
  from: ResizeDimensions
  to: ResizeDimensions
}

/** Fires on every ResizeObserver callback when `on: 'tick'` (default). */
export type ResizeTickEvent = {
  mode: 'tick'
  from: ResizeDimensions | null
  to: ResizeDimensions
  /** to - from componentwise. `{0,0}` on the first tick (from === null). */
  delta: ResizeDimensions
  /** `null` for a degenerate (0-width or 0-height) box — a hidden element has
   *  no orientation, and reporting one would be an invented measurement. */
  orientation: ResizeOrientation | null
  /** Active bracket label on the `axis` in use, or null with no `breakpoints`. */
  bracket: string | null
}

/** Fires when `on: 'orientation'`: once with `from: null` for the first
 *  measurable orientation, then on every portrait ↔ landscape ↔ square flip. */
export type ResizeOrientationEvent = {
  mode: 'orientation'
  /** `null` on the initial event — there was no previous orientation. */
  from: ResizeOrientation | null
  to: ResizeOrientation
  /** Aspect ratio width / height. */
  ratio: number
  dimensions: ResizeDimensions
}

export type ResizeEvent = ResizeTickEvent | ResizeBracketEvent | ResizeOrientationEvent

export type ResizeConfig = {
  /**
   * Dispatch mode:
   * - `'tick'` (default) — handler fires on every observer callback with `ResizeTickEvent`.
   * - `'crossed'` — handler fires only on bracket crossings with `ResizeBracketEvent` (requires `breakpoints`).
   * - `'orientation'` — handler fires on the first measurable orientation and on every flip after it.
   */
  on?: ResizeMode
  /**
   * Breakpoint thresholds (px). Array form `[320, 640, 960]` produces default labels
   * `'<320'` / `'320-640'` / `'640-960'` / `'>=960'`. Object form `{ sm: 320, md: 640, lg: 960 }`
   * uses keys as labels; below the smallest key the active label is `'(base)'` unless
   * a key with value `0` is explicitly provided.
   */
  breakpoints?: number[] | Record<string, number>
  /**
   * Which dimension the brackets are measured on. Default `'width'`. Also
   * decides the axis behind `ResizeTickEvent.bracket` and the `resize:` state
   * segment; `'both'` emits crossings for each axis and labels on width.
   */
  axis?: 'width' | 'height' | 'both'
  /** Half-width of the square band as a fraction of the larger dimension. Default `0`. */
  squareTolerance?: number
  /**
   * Which box to observe and report. Default `'border'`. This is passed to
   * `ResizeObserver.observe`, so it decides *when a callback fires* as well as
   * what the dimensions mean: `'border'` sees a border/padding-only change,
   * `'device-pixel'` sees a devicePixelRatio change that leaves layout alone.
   * Changing it re-observes the element.
   */
  box?: ResizeBox
  /**
   * Trailing-edge debounce (ms). The handler fires once the callbacks stop for
   * this long, with the latest dimensions — a continuous drag produces no call
   * until it ends.
   */
  debounce?: number
  /**
   * Suppress the handler while `intersect` reports the host hidden. On the
   * hidden → visible flip the element is re-observed, so the first call after
   * restore carries a fresh measurement rather than a stale baseline. Requires
   * an `intersect` config without `once` — both are checked at bind time.
   */
  gateOnIntersect?: boolean
  /** Subscriber. Receives a discriminated union — narrow via `event.mode`. */
  handler?: (event: ResizeEvent) => void
}

/* ------------------------------------------------------------------ */
/*  Public types — Mutate                                              */
/* ------------------------------------------------------------------ */

export type MutateEventType =
  | 'attr:class'
  | 'attr:style'
  | `attr:${string}`
  | 'children:added'
  | 'children:removed'
  | 'text'
  | 'removed'

export type MutateEvent<T extends HTMLElement = HTMLElement> = {
  type: MutateEventType
  /** Attribute name, on `attr:` events. */
  name?: string
  /** Previous value — the attribute's, or the host's whole `textContent`. */
  from?: string | null
  /** Current value — the attribute's, or the host's whole `textContent`. */
  to?: string | null
  added?: T[]
  removed?: T[]
  /** The directive host. */
  target: HTMLElement
}

export type MutateConfig<T extends HTMLElement = HTMLElement> = {
  on?: MutateEventType | MutateEventType[]
  /** Selector(s) filtering `children:added` / `children:removed`. An invalid
   *  selector throws at bind time rather than silently matching nothing. */
  match?: string | string[]
  /** Trailing-edge debounce (ms). Events merge per type inside the window. */
  debounce?: number
  /**
   * Suppress the handler while `intersect` reports the host hidden. Mutations
   * that happen while hidden are dropped, not replayed. `on: 'removed'` is
   * never gated. Requires an `intersect` config without `once`.
   */
  gateOnIntersect?: boolean
  handler?: (event: MutateEvent<T>) => void
}

/* ------------------------------------------------------------------ */
/*  Public types — Top-level                                           */
/* ------------------------------------------------------------------ */

export type ObserveOptions = {
  intersect?: IntersectConfig
  resize?: ResizeConfig
  mutate?: MutateConfig
}

/**
 * Template-literal type of the unified state attribute set on the host. The
 * resize segment is open-ended (`string`) because it carries the matched
 * breakpoint label which is consumer-defined. Each segment is `"-"` when the
 * corresponding mode is not configured on this binding.
 *
 * This is the writer's own return type — `observeStateAttribute()` in
 * `state-attribute.ts` is declared to return it, so the grammar and the
 * string that reaches the DOM cannot drift apart.
 */
export type ObserveStateAttribute =
  `intersect:${'visible' | 'hidden' | '-'};resize:${string};mutate:${'active' | 'idle' | '-'}`
