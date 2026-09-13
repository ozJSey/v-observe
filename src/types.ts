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
  /** Auto-disconnect after the first `isIntersecting === true` callback. */
  once?: boolean
  /**
   * Threshold values forwarded to the underlying `IntersectionObserver`.
   * The directive also fires the per-threshold `crossed` event on each
   * crossing in the appropriate direction.
   */
  thresholds?: number[]
  /** Fires once per threshold per crossing. */
  crossed?: (event: IntersectCrossEvent) => void
  /** Forwarded to `IntersectionObserverInit.root`. */
  root?: Element | Document | null
  /** Forwarded to `IntersectionObserverInit.rootMargin`. */
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
  /** Resolved label of the bracket the dimension is now in. */
  bracket: string
  from: ResizeDimensions | null
  to: ResizeDimensions
}

/** Fires on every ResizeObserver callback when `on: 'tick'` (default). */
export type ResizeTickEvent = {
  mode: 'tick'
  from: ResizeDimensions | null
  to: ResizeDimensions
  /** to - from componentwise. `{0,0}` on the first tick (from === null). */
  delta: ResizeDimensions
  orientation: ResizeOrientation
  /** Active bracket label when `breakpoints` configured, else null. */
  bracket: string | null
}

/** Fires only on portrait↔landscape (or ↔square) flips when `on: 'orientation'`. */
export type ResizeOrientationEvent = {
  mode: 'orientation'
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
   * - `'orientation'` — handler fires only on orientation flips with `ResizeOrientationEvent`.
   */
  on?: ResizeMode
  /**
   * Breakpoint thresholds (px). Array form `[320, 640, 960]` produces default labels
   * `'<320'` / `'320-640'` / `'640-960'` / `'>=960'`. Object form `{ sm: 320, md: 640, lg: 960 }`
   * uses keys as labels; below the smallest key the active label is `'(base)'` unless
   * a key with value `0` is explicitly provided.
   */
  breakpoints?: number[] | Record<string, number>
  /** Axis filter for `crossed` events. Default `'width'`. */
  axis?: 'width' | 'height' | 'both'
  /** Half-width of the square band as a fraction of the larger dimension. Default `0`. */
  squareTolerance?: number
  /** Which ResizeObserverEntry box to read. Default `'border'`. */
  box?: ResizeBox
  /** Coalesces tick storms into one call per window (ms). */
  debounce?: number
  /** Gate handler behind `intersect` visibility — wired in a follow-up run. */
  gateOnIntersect?: boolean
  /** Subscriber. Receives a discriminated union — narrow via `event.mode`. */
  handler?: (event: ResizeEvent) => void
}

/* ------------------------------------------------------------------ */
/*  Public types — Mutate (P0 stubs)                                   */
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
  name?: string
  from?: string | null
  to?: string | null
  added?: T[]
  removed?: T[]
  target: HTMLElement
}

export type MutateConfig<T extends HTMLElement = HTMLElement> = {
  on?: MutateEventType | MutateEventType[]
  match?: string | string[]
  debounce?: number
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
 */
export type ObserveStateAttribute =
  `intersect:${'visible' | 'hidden' | '-'};resize:${string};mutate:${'active' | 'idle' | '-'}`

