/**
 * Resize mode — ResizeObserver wiring, breakpoint-bracket normalization and
 * crossing math, orientation inference, box-model reads (border / content /
 * device-pixel), debounce coalescing, and the resize segment.
 */
import { isGated } from './gate'
import { getOrCreate, stateMap, type NormalizedBreakpoints, type ObserveState, type ResizeInternal } from './state'
import { writeStateAttribute } from './state-attribute'
import type {
  ObserveOptions,
  ResizeBox,
  ResizeConfig,
  ResizeDimensions,
  ResizeEvent,
  ResizeMode,
  ResizeOrientation,
} from './types'

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

function bracketLabel(d: number, n: NormalizedBreakpoints | null): string | null {
  if (!n) return null
  return n.labels[bracketIndex(d, n.thresholds)]
}

function computeOrientation(d: ResizeDimensions, tolerance: number): ResizeOrientation {
  const { width: w, height: h } = d
  if (w <= 0 || h <= 0) return 'square'
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
        bracket: n.labels[bracketIndex(next, n.thresholds)],
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
        bracket: n.labels[bracketIndex(next, n.thresholds)],
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
  const bracket = bracketLabel(dims.width, normalized)

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
        bracket,
      })
    }
  } else if (mode === 'crossed') {
    if (prev && normalized) {
      const handler = cfg.handler
      if (handler) {
        const axis = cfg.axis ?? 'width'
        if (axis === 'width' || axis === 'both') {
          emitCrossingsForAxis('width', prev.width, dims.width, normalized, prev, dims, handler)
        }
        if (axis === 'height' || axis === 'both') {
          emitCrossingsForAxis('height', prev.height, dims.height, normalized, prev, dims, handler)
        }
      }
    }
  } else {
    // orientation
    const lastOrient = internal.lastOrientation
    if (lastOrient !== null && lastOrient !== orientation) {
      const handler = cfg.handler
      if (handler) {
        handler({
          mode: 'orientation',
          from: lastOrient,
          to: orientation,
          ratio: dims.height === 0 ? 0 : dims.width / dims.height,
          dimensions: dims,
        })
      }
    }
  }

  // Update segment.
  let segment: string
  if (mode === 'orientation') {
    segment = orientation
  } else if (normalized) {
    segment = normalized.labels[bracketIndex(dims.width, normalized.thresholds)]
  } else {
    segment = 'active'
  }
  state.segments.resize = segment
  writeStateAttribute(el, state.segments)

  internal.lastDispatched = dims
  internal.lastOrientation = orientation
}

export function setupResize(el: HTMLElement, cfg: ResizeConfig, opts: ObserveOptions): void {
  if (typeof ResizeObserver === 'undefined') return

  const state = getOrCreate(el, opts)
  if (state.resize) {
    state.resize.cfg = cfg
    state.resize.normalized = normalizeBreakpoints(cfg.breakpoints)
    return
  }

  const internal: ResizeInternal = {
    cfg,
    observer: null as unknown as ResizeObserver,
    lastDispatched: null,
    lastOrientation: null,
    normalized: normalizeBreakpoints(cfg.breakpoints),
    pending: null,
    timer: null,
  }
  state.resize = internal

  state.segments.resize = 'idle'
  writeStateAttribute(el, state.segments)

  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      if (entry.target !== el) continue
      const live = internal.cfg
      // Cross-observer gate: skip the entire callback (no debounce timer, no
      // segment write, no internal state mutation) while intersect is hidden.
      if (isGated(state, live)) continue
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
          dispatchResize(el, state, internal, pending)
        }, debounce) as unknown as number
      } else {
        dispatchResize(el, state, internal, dims)
      }
    }
  })

  internal.observer = observer
  observer.observe(el)
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
