/**
 * Resize mode — ResizeObserver wiring, breakpoint-bracket normalization and
 * crossing math, orientation inference, box-model reads (border / content /
 * device-pixel), debounce coalescing, and the resize segment.
 *
 * `box` is passed to `observe()`, not only used when reading the entry: the
 * observed box decides *when a callback fires*. Watching the content box while
 * reporting the border box means a border- or padding-only change — and a
 * devicePixelRatio change, which is the entire point of `'device-pixel'` —
 * never produces a callback at all.
 */
import { isGated } from './gate'
import { getOrCreate, stateMap, type NormalizedBreakpoints, type ObserveState, type ResizeInternal } from './state'
import { writeStateAttribute } from './state-attribute'
import type {
  ResizeBox,
  ResizeConfig,
  ResizeDimensions,
  ResizeEvent,
  ResizeMode,
  ResizeOrientation,
} from './types'

const BOX_OPTION: Record<ResizeBox, ResizeObserverBoxOptions> = {
  border: 'border-box',
  content: 'content-box',
  'device-pixel': 'device-pixel-content-box',
}

/**
 * `'device-pixel-content-box'` is unimplemented in some engines (Safari at the
 * time of writing) and `observe()` rejects the value rather than ignoring it.
 * The size read already degrades to `contentBox × devicePixelRatio` there, so
 * the observation degrades to the content box to match.
 */
function observeBox(observer: ResizeObserver, el: HTMLElement, box: ResizeBox): void {
  if (box !== 'device-pixel') {
    observer.observe(el, { box: BOX_OPTION[box] })
    return
  }
  try {
    observer.observe(el, { box: BOX_OPTION['device-pixel'] })
  } catch {
    observer.observe(el, { box: 'content-box' })
  }
}

export function normalizeBreakpoints(bp: ResizeConfig['breakpoints']): NormalizedBreakpoints | null {
  if (bp === undefined) return null
  if (Array.isArray(bp)) {
    if (bp.length === 0) return null
    const sorted = [...bp].sort((a, b) => a - b)
    const labels: string[] = [`<${sorted[0]}`]
    for (let i = 0; i < sorted.length - 1; i++) {
      labels.push(`${sorted[i]}-${sorted[i + 1]}`)
    }
    labels.push(`>=${sorted[sorted.length - 1]}`)
    return { thresholds: sorted, labels }
  }
  const entries = Object.entries(bp).sort((a, b) => a[1] - b[1])
  if (entries.length === 0) return null
  const thresholds: number[] = []
  const labels: string[] = []
  const hasZero = entries[0][1] === 0
  if (hasZero) {
    // The smallest key (value === 0) labels the [-Infinity, 0] bracket.
    // First crossing threshold is entries[1] if present.
    labels.push(entries[0][0])
    for (let i = 1; i < entries.length; i++) {
      thresholds.push(entries[i][1])
      labels.push(entries[i][0])
    }
  } else {
    labels.push('(base)')
    for (const [k, v] of entries) {
      thresholds.push(v)
      labels.push(k)
    }
  }
  return { thresholds, labels }
}

function bracketIndex(d: number, thresholds: ReadonlyArray<number>): number {
  for (let i = 0; i < thresholds.length; i++) {
    if (d < thresholds[i]) return i
  }
  return thresholds.length
}

/** The dimension brackets are measured on. `'both'` emits crossings for each
 *  axis but has to label with one of them, and width is the responsive default. */
function bracketAxis(cfg: ResizeConfig): 'width' | 'height' {
  return cfg.axis === 'height' ? 'height' : 'width'
}

function bracketLabel(d: number, n: NormalizedBreakpoints | null): string | null {
  if (!n) return null
  return n.labels[bracketIndex(d, n.thresholds)]
}

/**
 * `null` for a degenerate box. A `display: none` element reports 0×0, and 0×0
 * is not square — it is unmeasured. Calling it square made hiding a panel emit
 * a landscape→square→landscape flip and write `resize:square` into the CSS
 * hook, from an aspect ratio that did not exist at that moment.
 */
function computeOrientation(d: ResizeDimensions, tolerance: number): ResizeOrientation | null {
  const { width: w, height: h } = d
  if (w <= 0 || h <= 0) return null
  if (tolerance > 0) {
    const larger = Math.max(w, h)
    if (Math.abs(w - h) <= larger * tolerance) return 'square'
  } else if (w === h) {
    return 'square'
  }
  return w > h ? 'landscape' : 'portrait'
}

function readDimensions(entry: ResizeObserverEntry, box: ResizeBox): ResizeDimensions {
  if (box === 'device-pixel') {
    const dpcb = (entry.devicePixelContentBoxSize ?? null) as ReadonlyArray<ResizeObserverSize> | null
    if (dpcb && dpcb.length > 0) {
      return { width: dpcb[0].inlineSize, height: dpcb[0].blockSize }
    }
    // Fallback: contentBoxSize × devicePixelRatio
    const cb = entry.contentBoxSize
    if (cb && cb.length > 0) {
      const dpr = (typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio))
        ? window.devicePixelRatio
        : 1
      return { width: cb[0].inlineSize * dpr, height: cb[0].blockSize * dpr }
    }
    return { width: entry.contentRect.width, height: entry.contentRect.height }
  }
  if (box === 'content') {
    const cb = entry.contentBoxSize
    if (cb && cb.length > 0) {
      return { width: cb[0].inlineSize, height: cb[0].blockSize }
    }
    return { width: entry.contentRect.width, height: entry.contentRect.height }
  }
  // 'border' (default)
  const bb = entry.borderBoxSize
  if (bb && bb.length > 0) {
    return { width: bb[0].inlineSize, height: bb[0].blockSize }
  }
  return { width: entry.contentRect.width, height: entry.contentRect.height }
}

/* ------------------------------------------------------------------ */
/*  Resize — dispatch + segment write                                  */
/* ------------------------------------------------------------------ */

/**
 * One event per threshold crossed, each labelled with the bracket THAT
 * crossing entered. Crossing `thresholds[i]` upward lands in `labels[i + 1]`;
 * crossing it downward lands in `labels[i]`. Stamping every event of a
 * multi-bracket jump with the final label made the intermediate events claim a
 * bracket the element was never in at that threshold.
 */
function emitCrossingsForAxis(
  axis: 'width' | 'height',
  prev: number,
  next: number,
  n: NormalizedBreakpoints,
  prevDims: ResizeDimensions,
  nextDims: ResizeDimensions,
  handler: (event: ResizeEvent) => void,
): void {
  if (next === prev) return
  const prevIdx = bracketIndex(prev, n.thresholds)
  const nextIdx = bracketIndex(next, n.thresholds)
  if (prevIdx === nextIdx) return
  if (nextIdx > prevIdx) {
    for (let i = prevIdx; i < nextIdx; i++) {
      handler({
        mode: 'crossed',
        axis,
        threshold: n.thresholds[i],
        direction: 'up',
        bracket: n.labels[i + 1],
        from: prevDims,
        to: nextDims,
      })
    }
  } else {
    for (let i = prevIdx - 1; i >= nextIdx; i--) {
      handler({
        mode: 'crossed',
        axis,
        threshold: n.thresholds[i],
        direction: 'down',
        bracket: n.labels[i],
        from: prevDims,
        to: nextDims,
      })
    }
  }
}

function dispatchResize(el: HTMLElement, state: ObserveState, internal: ResizeInternal, dims: ResizeDimensions): void {
  const cfg = internal.cfg
  const prev = internal.lastDispatched
  const mode: ResizeMode = cfg.on ?? 'tick'
  const orientation = computeOrientation(dims, cfg.squareTolerance ?? 0)
  const normalized = internal.normalized
  const axis = bracketAxis(cfg)
  const label = bracketLabel(dims[axis], normalized)

  if (mode === 'tick') {
    const handler = cfg.handler
    if (handler) {
      handler({
        mode: 'tick',
        from: prev,
        to: dims,
        delta: prev
          ? { width: dims.width - prev.width, height: dims.height - prev.height }
          : { width: 0, height: 0 },
        orientation,
        bracket: label,
      })
    }
  } else if (mode === 'crossed') {
    if (prev && normalized) {
      const handler = cfg.handler
      if (handler) {
        const configured = cfg.axis ?? 'width'
        if (configured === 'width' || configured === 'both') {
          emitCrossingsForAxis('width', prev.width, dims.width, normalized, prev, dims, handler)
        }
        if (configured === 'height' || configured === 'both') {
          emitCrossingsForAxis('height', prev.height, dims.height, normalized, prev, dims, handler)
        }
      }
    }
  } else if (orientation !== null && orientation !== internal.lastOrientation) {
    // orientation — including the first measurable one, which is the only
    // signal an orientation-mode consumer gets before the user resizes.
    const handler = cfg.handler
    if (handler) {
      handler({
        mode: 'orientation',
        from: internal.lastOrientation,
        to: orientation,
        ratio: dims.height === 0 ? 0 : dims.width / dims.height,
        dimensions: dims,
      })
    }
  }

  // Segment. A degenerate box in orientation mode leaves the previous label
  // alone rather than inventing one.
  if (mode === 'orientation') {
    if (orientation !== null) internal.segment = orientation
  } else {
    internal.segment = normalized ? normalized.labels[bracketIndex(dims[axis], normalized.thresholds)] : 'active'
  }
  writeStateAttribute(el, state)

  internal.lastDispatched = dims
  if (orientation !== null) internal.lastOrientation = orientation
}

export function setupResize(el: HTMLElement, cfg: ResizeConfig, state?: ObserveState): void {
  if (typeof ResizeObserver === 'undefined') return
  const s = state ?? getOrCreate(el)

  const existing = s.resize
  if (existing) {
    existing.cfg = cfg
    existing.normalized = normalizeBreakpoints(cfg.breakpoints)
    const box = cfg.box ?? 'border'
    if (box !== existing.observedBox) {
      existing.observedBox = box
      existing.observer.unobserve(el)
      observeBox(existing.observer, el, box)
    }
    return
  }

  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const internal = s.resize
      if (!internal) return
      const live = internal.cfg
      // Cross-observer gate: skip the entire callback (no debounce timer, no
      // segment write, no internal state mutation) while intersect is hidden.
      // `resetGateBaseline` re-observes on restore, so the measurement dropped
      // here is asked for again rather than lost.
      if (isGated(s, live)) continue
      const dims = readDimensions(entry, live.box ?? 'border')

      const debounce = live.debounce ?? 0
      if (debounce > 0) {
        internal.pending = dims
        if (internal.timer !== null) {
          clearTimeout(internal.timer)
        }
        internal.timer = setTimeout(() => {
          internal.timer = null
          const pending = internal.pending
          if (pending === null) return
          internal.pending = null
          dispatchResize(el, s, internal, pending)
        }, debounce)
      } else {
        dispatchResize(el, s, internal, dims)
      }
    }
  })

  const internal: ResizeInternal = {
    cfg,
    observer,
    observedBox: cfg.box ?? 'border',
    segment: 'idle',
    lastDispatched: null,
    lastOrientation: null,
    normalized: normalizeBreakpoints(cfg.breakpoints),
    pending: null,
    timer: null,
    resetGateBaseline: () => {
      if (!internal.cfg.gateOnIntersect) return
      internal.lastDispatched = null
      internal.lastOrientation = null
      if (internal.timer !== null) {
        clearTimeout(internal.timer)
        internal.timer = null
      }
      internal.pending = null
      // The observation that arrived while the host was hidden was dropped,
      // and ResizeObserver does not re-send it for an element whose box has
      // not changed since. Re-observing is how you ask for it again.
      internal.observer.unobserve(el)
      observeBox(internal.observer, el, internal.observedBox)
    },
  }
  s.resize = internal
  observeBox(observer, el, internal.observedBox)
}

export function teardownResize(el: HTMLElement): void {
  const state = stateMap.get(el)
  if (!state?.resize) return
  if (state.resize.timer !== null) {
    clearTimeout(state.resize.timer)
  }
  state.resize.observer.disconnect()
  state.resize = undefined
}
