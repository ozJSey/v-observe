import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref, withDirectives, type App, type DirectiveBinding, type Ref } from 'vue'
import {
  DIRECTIVE_NAME,
  type IntersectConfig,
  type IntersectCrossEvent,
  type IntersectDirection,
  type IntersectEvent,
  type ObserveOptions,
  type ObserveStateAttribute,
  type MutateConfig,
  type MutateEvent,
  type ResizeBracketEvent,
  type ResizeConfig,
  type ResizeOrientation,
  type ResizeOrientationEvent,
  type ResizeTickEvent,
  type ResizeEvent,
  ObservePlugin,
  vObserve,
} from './vObserve'

/* ------------------------------------------------------------------ */
/*  IntersectionObserver mock — drives entries synchronously           */
/* ------------------------------------------------------------------ */

interface MockedIO {
  readonly callback: IntersectionObserverCallback
  readonly options: IntersectionObserverInit
  readonly observed: Set<Element>
  readonly disconnected: boolean
}

const ioInstances: MockedIO[] = []
const ioByElement = new Map<Element, MockedIO[]>()

class MockIntersectionObserver {
  callback: IntersectionObserverCallback
  options: IntersectionObserverInit
  observed = new Set<Element>()
  disconnected = false
  root: Element | Document | null
  rootMargin: string
  thresholds: ReadonlyArray<number>

  constructor(cb: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
    this.callback = cb
    this.options = options
    this.root = (options.root as Element | Document | null) ?? null
    this.rootMargin = options.rootMargin ?? '0px'
    const t = options.threshold
    this.thresholds = Array.isArray(t) ? t.slice() : t !== undefined ? [t] : [0]
    ioInstances.push(this)
  }

  observe(el: Element): void {
    this.observed.add(el)
    const list = ioByElement.get(el) ?? []
    list.push(this)
    ioByElement.set(el, list)
  }

  unobserve(el: Element): void {
    this.observed.delete(el)
    const list = ioByElement.get(el)
    if (!list) return
    const i = list.indexOf(this)
    if (i !== -1) list.splice(i, 1)
    if (list.length === 0) ioByElement.delete(el)
  }

  disconnect(): void {
    this.disconnected = true
    for (const el of this.observed) {
      const list = ioByElement.get(el)
      if (!list) continue
      const i = list.indexOf(this)
      if (i !== -1) list.splice(i, 1)
      if (list.length === 0) ioByElement.delete(el)
    }
    this.observed.clear()
  }

  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}

function installIOMock(): void {
  ioInstances.length = 0
  ioByElement.clear()
  ;(globalThis as unknown as { IntersectionObserver: typeof IntersectionObserver }).IntersectionObserver =
    MockIntersectionObserver as unknown as typeof IntersectionObserver
}

function uninstallIOMock(): void {
  delete (globalThis as Record<string, unknown>).IntersectionObserver
}

/* ------------------------------------------------------------------ */
/*  ResizeObserver mock — drives entries synchronously                  */
/* ------------------------------------------------------------------ */

interface MockedRO {
  readonly callback: ResizeObserverCallback
  readonly observed: Set<Element>
  readonly disconnected: boolean
}

const roInstances: MockedRO[] = []
const roByElement = new Map<Element, MockedRO[]>()

/**
 * `observe(el, options)` — the second argument is the whole point of `box`,
 * and the previous mock's `observe(el)` signature is why the suite could not
 * see that the real call never passed one. `observeCalls` is the log; a mock
 * that accepts an argument it never records is the same blind spot again.
 */
class MockResizeObserver {
  callback: ResizeObserverCallback
  observed = new Set<Element>()
  observeCalls: { el: Element; options: ResizeObserverOptions | undefined }[] = []
  disconnected = false
  /** Engines without `device-pixel-content-box` reject it rather than ignore it. */
  static rejectBoxes = new Set<string>()

  constructor(cb: ResizeObserverCallback) {
    this.callback = cb
    roInstances.push(this)
  }

  observe(el: Element, options?: ResizeObserverOptions): void {
    if (options?.box && MockResizeObserver.rejectBoxes.has(options.box)) {
      throw new TypeError(`Failed to execute 'observe' on 'ResizeObserver': unsupported box ${options.box}`)
    }
    this.observeCalls.push({ el, options })
    this.observed.add(el)
    const list = roByElement.get(el) ?? []
    list.push(this)
    roByElement.set(el, list)
  }

  unobserve(el: Element): void {
    this.observed.delete(el)
    const list = roByElement.get(el)
    if (!list) return
    const i = list.indexOf(this)
    if (i !== -1) list.splice(i, 1)
    if (list.length === 0) roByElement.delete(el)
  }

  disconnect(): void {
    this.disconnected = true
    for (const el of this.observed) {
      const list = roByElement.get(el)
      if (!list) continue
      const i = list.indexOf(this)
      if (i !== -1) list.splice(i, 1)
      if (list.length === 0) roByElement.delete(el)
    }
    this.observed.clear()
  }
}

function installROMock(): void {
  roInstances.length = 0
  roByElement.clear()
  MockResizeObserver.rejectBoxes.clear()
  ;(globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    MockResizeObserver as unknown as typeof ResizeObserver
}

function uninstallROMock(): void {
  delete (globalThis as Record<string, unknown>).ResizeObserver
}

interface FireResizeOpts {
  width: number
  height: number
  /** Provide separate dimensions per box. Default mirrors `width`/`height` on border + content. */
  borderBox?: { width: number; height: number }
  contentBox?: { width: number; height: number }
  devicePixelContentBox?: { width: number; height: number }
}

function makeBoxSize(w: number, h: number): readonly ResizeObserverSize[] {
  return [{ inlineSize: w, blockSize: h } as ResizeObserverSize]
}

/** Every `observe()` the directive made for this element, newest last. */
function observeCallsFor(el: Element): { el: Element; options: ResizeObserverOptions | undefined }[] {
  const list = roByElement.get(el)
  if (!list || list.length === 0) throw new Error('No ResizeObserver attached to element')
  return (list[0] as unknown as MockResizeObserver).observeCalls
}

function fireResize(el: Element, opts: FireResizeOpts, observerIndex = 0): void {
  const list = roByElement.get(el)
  if (!list || list.length === 0) throw new Error('No ResizeObserver attached to element')
  const ro = list[observerIndex] as unknown as MockResizeObserver
  const border = opts.borderBox ?? { width: opts.width, height: opts.height }
  const content = opts.contentBox ?? { width: opts.width, height: opts.height }
  const dpr = opts.devicePixelContentBox
  const entry = {
    target: el,
    contentRect: mkRect({ width: content.width, height: content.height }),
    borderBoxSize: makeBoxSize(border.width, border.height),
    contentBoxSize: makeBoxSize(content.width, content.height),
    devicePixelContentBoxSize: dpr ? makeBoxSize(dpr.width, dpr.height) : undefined,
  } as unknown as ResizeObserverEntry
  ro.callback([entry], ro as unknown as ResizeObserver)
}

/* ------------------------------------------------------------------ */
/*  MutationObserver mock — drives entries synchronously                */
/*                                                                      */
/*  Captured BEFORE the mock replaces it: every MutationObserver in the  */
/*  suite is fired by hand and never observes a real DOM write, which is  */
/*  how the suite certified the exact configuration that froze a real     */
/*  browser. The "against a real MutationObserver" block at the end of    */
/*  this file puts jsdom's own implementation back and writes to the DOM. */
/* ------------------------------------------------------------------ */

const RealMutationObserver = globalThis.MutationObserver

interface MockedMO {
  readonly callback: MutationCallback
  readonly observed: Map<Node, MutationObserverInit>
  readonly disconnected: boolean
}

const moInstances: MockedMO[] = []
const moByElement = new Map<Node, MockedMO[]>()

class MockMutationObserver {
  callback: MutationCallback
  observed = new Map<Node, MutationObserverInit>()
  disconnected = false

  constructor(cb: MutationCallback) {
    this.callback = cb
    moInstances.push(this)
  }

  observe(target: Node, init: MutationObserverInit = {}): void {
    this.observed.set(target, init)
    const list = moByElement.get(target) ?? []
    list.push(this)
    moByElement.set(target, list)
  }

  disconnect(): void {
    this.disconnected = true
    for (const target of this.observed.keys()) {
      const list = moByElement.get(target)
      if (!list) continue
      const i = list.indexOf(this)
      if (i !== -1) list.splice(i, 1)
      if (list.length === 0) moByElement.delete(target)
    }
    this.observed.clear()
  }

  takeRecords(): MutationRecord[] {
    return []
  }
}

function installMOMock(): void {
  moInstances.length = 0
  moByElement.clear()
  ;(globalThis as unknown as { MutationObserver: typeof MutationObserver }).MutationObserver =
    MockMutationObserver as unknown as typeof MutationObserver
}

function uninstallMOMock(): void {
  delete (globalThis as Record<string, unknown>).MutationObserver
}

interface PartialMutationRecord {
  type: MutationRecordType
  target?: Node
  attributeName?: string | null
  attributeNamespace?: string | null
  oldValue?: string | null
  addedNodes?: Node[]
  removedNodes?: Node[]
}

function makeMutationRecord(target: Node, partial: PartialMutationRecord): MutationRecord {
  const added = partial.addedNodes ?? []
  const removed = partial.removedNodes ?? []
  return {
    type: partial.type,
    target: partial.target ?? target,
    attributeName: partial.attributeName ?? null,
    attributeNamespace: partial.attributeNamespace ?? null,
    oldValue: partial.oldValue ?? null,
    addedNodes: makeNodeList(added),
    removedNodes: makeNodeList(removed),
    previousSibling: null,
    nextSibling: null,
  } as unknown as MutationRecord
}

function makeNodeList(nodes: ReadonlyArray<Node>): NodeList {
  const arr = nodes.slice()
  const out = {
    length: arr.length,
    item(i: number): Node | null {
      return arr[i] ?? null
    },
    forEach(cb: (node: Node, i: number, list: NodeList) => void) {
      arr.forEach((n, i) => cb(n, i, out as unknown as NodeList))
    },
    [Symbol.iterator]() {
      return arr[Symbol.iterator]()
    },
    entries() {
      return arr.entries()
    },
    keys() {
      return arr.keys()
    },
    values() {
      return arr.values()
    },
  } as unknown as NodeList
  for (let i = 0; i < arr.length; i++) {
    Object.defineProperty(out, i, { value: arr[i], enumerable: true })
  }
  return out
}

/**
 * Fire a synthetic MutationObserver callback to the observer attached to `target`.
 * Use `observerIndex` to address sibling observers attached to the same node.
 */
function fireMutation(
  target: Node,
  records: PartialMutationRecord | PartialMutationRecord[],
  observerIndex = 0,
): void {
  const list = moByElement.get(target)
  if (!list || list.length === 0) throw new Error('No MutationObserver attached to element')
  const mo = list[observerIndex] as unknown as MockMutationObserver
  const arr = Array.isArray(records) ? records : [records]
  const built = arr.map((r) => makeMutationRecord(target, r))
  mo.callback(built, mo as unknown as MutationObserver)
}

function mkRect(opts: { top?: number; left?: number; width?: number; height?: number } = {}): DOMRectReadOnly {
  const top = opts.top ?? 0
  const left = opts.left ?? 0
  const width = opts.width ?? 100
  const height = opts.height ?? 100
  return {
    top,
    left,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRectReadOnly
}

function fire(el: Element, partial: Partial<IntersectionObserverEntry> = {}, observerIndex = 0): void {
  const list = ioByElement.get(el)
  if (!list || list.length === 0) throw new Error('No IntersectionObserver attached to element')
  const io = list[observerIndex] as unknown as MockIntersectionObserver
  const entry: IntersectionObserverEntry = {
    target: el,
    isIntersecting: partial.isIntersecting ?? false,
    intersectionRatio: partial.intersectionRatio ?? 0,
    intersectionRect: (partial.intersectionRect as DOMRectReadOnly | undefined) ?? mkRect({ width: 0, height: 0 }),
    boundingClientRect: (partial.boundingClientRect as DOMRectReadOnly | undefined) ?? mkRect(),
    rootBounds: (partial.rootBounds as DOMRectReadOnly | undefined) ?? mkRect({ top: 0, left: 0, width: 1000, height: 800 }),
    time: partial.time ?? performance.now(),
  } as IntersectionObserverEntry
  io.callback([entry], io as unknown as IntersectionObserver)
}

/* ------------------------------------------------------------------ */
/*  Mounting helpers                                                    */
/* ------------------------------------------------------------------ */

interface Mounted {
  host: HTMLElement
  unmount: () => void
  setOpts: (next: ObserveOptions | undefined) => Promise<void>
}

function mount(opts: ObserveOptions | undefined = undefined, attr = 'data-test'): Mounted {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const optsRef: Ref<ObserveOptions | undefined> = ref(opts)

  const Comp = defineComponent({
    setup() {
      return () =>
        withDirectives(h('div', { [attr]: '1' }), [[vObserve, optsRef.value]])
    },
  })

  const app: App = createApp(Comp)
  // Vue 3 dedupes directive-hook error rethrows globally per error signature.
  // Capture and rethrow after `app.mount` so test assertions on synchronous
  // throws (validation guards) are deterministic across test order.
  let captured: unknown = null
  app.config.errorHandler = (err) => {
    captured = err
  }
  app.mount(container)
  if (captured) throw captured
  const host = container.querySelector(`[${attr}]`) as HTMLElement

  async function setOpts(next: ObserveOptions | undefined): Promise<void> {
    optsRef.value = next
    await nextTick()
  }

  function unmount(): void {
    app.unmount()
    container.remove()
  }

  return { host, unmount, setOpts }
}

/* ------------------------------------------------------------------ */
/*  Lifecycle                                                            */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  installIOMock()
  installROMock()
  installMOMock()
})

afterEach(() => {
  uninstallIOMock()
  uninstallROMock()
  uninstallMOMock()
  document.body.innerHTML = ''
})

/* ------------------------------------------------------------------ */
/*  Tests — Public API surface                                          */
/* ------------------------------------------------------------------ */

describe('public API', () => {
  it('exports DIRECTIVE_NAME = "observe"', () => {
    expect(DIRECTIVE_NAME).toBe('observe')
  })

  it('exports the directive as a Directive object (mounted/updated/unmounted hooks)', () => {
    expect(vObserve).toBeDefined()
    expect(typeof (vObserve as Record<string, unknown>).mounted).toBe('function')
    expect(typeof (vObserve as Record<string, unknown>).updated).toBe('function')
    expect(typeof (vObserve as Record<string, unknown>).unmounted).toBe('function')
  })

  it('ObservePlugin.install registers vObserve under DIRECTIVE_NAME', () => {
    const directives: Record<string, unknown> = {}
    const stubApp = {
      directive(name: string, dir: unknown) {
        directives[name] = dir
        return stubApp
      },
    } as unknown as App
    const install = (ObservePlugin as { install?: (app: App) => void }).install
    expect(typeof install).toBe('function')
    install!(stubApp)
    expect(directives.observe).toBe(vObserve)
  })

  it('app.use(ObservePlugin) wires the directive into _context.directives', () => {
    const app = createApp({ render: () => null })
    app.use(ObservePlugin)
    const ctx = (app as unknown as { _context: { directives: Record<string, unknown> } })._context
    expect(ctx.directives.observe).toBe(vObserve)
  })

  it('public type exports are importable (compile-time presence check)', () => {
    const _intersect: IntersectConfig = { on: () => {} }
    const _cross: IntersectCrossEvent = { threshold: 0.5, direction: 'up', ratio: 0.5 }
    const _direction: IntersectDirection = 'enter-from-below'
    const _event: IntersectEvent = { isIntersecting: true, ratio: 1, direction: null, entry: {} as IntersectionObserverEntry }
    const _options: ObserveOptions = { intersect: { on: () => {} } }
    const _stateAttr: ObserveStateAttribute = 'intersect:visible;resize:-;mutate:idle'
    const _resize: ResizeConfig = {}
    const _resizeOrient: ResizeOrientation = 'portrait'
    const _resizeBracket: ResizeBracketEvent = {
      mode: 'crossed',
      axis: 'width',
      threshold: 320,
      direction: 'up',
      bracket: '320-640',
      from: { width: 300, height: 480 },
      to: { width: 320, height: 480 },
    }
    const _resizeTick: ResizeTickEvent = {
      mode: 'tick',
      from: null,
      to: { width: 320, height: 480 },
      delta: { width: 0, height: 0 },
      orientation: 'portrait',
      bracket: null,
    }
    const _resizeOrientationEvent: ResizeOrientationEvent = {
      mode: 'orientation',
      from: 'portrait',
      to: 'landscape',
      ratio: 16 / 9,
      dimensions: { width: 1280, height: 720 },
    }
    const _resizeEvent: ResizeEvent = _resizeTick
    const _mutate: MutateConfig = {}
    const _mutateEvent: MutateEvent = { type: 'attr:class', target: document.createElement('div') }
    void [_intersect, _cross, _direction, _event, _options, _stateAttr, _resize, _resizeOrient, _resizeBracket, _resizeTick, _resizeOrientationEvent, _resizeEvent, _mutate, _mutateEvent]
    expect(true).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — Mount, attribute, no-config                                 */
/* ------------------------------------------------------------------ */

describe('mounting', () => {
  it('with no binding value mounts without throwing and creates no observer', () => {
    const { host, unmount } = mount(undefined)
    expect(host).toBeTruthy()
    expect(ioByElement.has(host)).toBe(false)
    unmount()
  })

  it('sets data-observe-state on mount with intersect config', () => {
    const { host, unmount } = mount({ intersect: { on: () => {} } })
    expect(host.getAttribute('data-observe-state')).toContain('intersect:hidden')
    unmount()
  })

  it('clears data-observe-state on unmount', () => {
    const { host, unmount } = mount({ intersect: { on: () => {} } })
    expect(host.getAttribute('data-observe-state')).not.toBeNull()
    unmount()
    expect(host.getAttribute('data-observe-state')).toBeNull()
  })

  it('creates an IntersectionObserver only when intersect config is provided', () => {
    const a = mount(undefined, 'data-a')
    expect(ioByElement.has(a.host)).toBe(false)
    a.unmount()

    const b = mount({ intersect: { on: () => {} } }, 'data-b')
    expect(ioByElement.has(b.host)).toBe(true)
    b.unmount()
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — `once: true` auto-disconnect                                */
/* ------------------------------------------------------------------ */

describe('intersect: once: true', () => {
  it('fires `on` exactly once on first isIntersecting=true and disconnects', () => {
    const onIntersect = vi.fn<(e: IntersectEvent) => void>()
    const { host, unmount } = mount({ intersect: { once: true, on: onIntersect } })

    // First tick: not intersecting → no fire
    fire(host, { isIntersecting: false, intersectionRatio: 0 })
    expect(onIntersect).toHaveBeenCalledTimes(0)

    // Second tick: intersecting → fires once
    fire(host, { isIntersecting: true, intersectionRatio: 1 })
    expect(onIntersect).toHaveBeenCalledTimes(1)

    // After fire: observer disconnected, further fire() throws because not registered
    expect(ioByElement.has(host)).toBe(false)

    unmount()
  })

  it('does not fire `on` after unmount', () => {
    const onIntersect = vi.fn()
    const { host, unmount } = mount({ intersect: { once: true, on: onIntersect } })
    unmount()
    expect(() => fire(host, { isIntersecting: true, intersectionRatio: 1 })).toThrow()
    expect(onIntersect).toHaveBeenCalledTimes(0)
  })

  it('without `once`, fires `on` on every callback', () => {
    const onIntersect = vi.fn()
    const { host, unmount } = mount({ intersect: { on: onIntersect } })

    fire(host, { isIntersecting: false, intersectionRatio: 0 })
    fire(host, { isIntersecting: true, intersectionRatio: 0.3 })
    fire(host, { isIntersecting: true, intersectionRatio: 0.7 })
    fire(host, { isIntersecting: false, intersectionRatio: 0 })

    expect(onIntersect).toHaveBeenCalledTimes(4)
    unmount()
  })

  it('`once: true` survives across multiple scrolls — only one call across many ticks', () => {
    const onIntersect = vi.fn()
    const { host, unmount } = mount({ intersect: { once: true, on: onIntersect } })

    fire(host, { isIntersecting: true, intersectionRatio: 0.5 })
    expect(onIntersect).toHaveBeenCalledTimes(1)
    expect(ioByElement.has(host)).toBe(false)

    // Re-mounting would be a fresh observer, but this `once` instance is done.
    unmount()
    expect(onIntersect).toHaveBeenCalledTimes(1)
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — `thresholds` + `crossed` event                              */
/* ------------------------------------------------------------------ */

describe('intersect: thresholds + crossed', () => {
  it('forwards thresholds to IntersectionObserver options', () => {
    const { host, unmount } = mount({ intersect: { thresholds: [0.25, 0.5, 0.75], on: () => {} } })
    const list = ioByElement.get(host)!
    expect(list).toBeDefined()
    expect((list[0] as unknown as MockIntersectionObserver).thresholds).toEqual([0.25, 0.5, 0.75])
    unmount()
  })

  it('fires crossed for [0.25, 0.5] in ascending order when ratio goes 0 → 0.25 → 0.6', () => {
    const events: IntersectCrossEvent[] = []
    const { host, unmount } = mount({
      intersect: {
        thresholds: [0.25, 0.5, 0.75],
        crossed: (e) => events.push(e),
      },
    })

    // The first callback is the baseline — nothing has been crossed yet.
    fire(host, { isIntersecting: false, intersectionRatio: 0 })

    fire(host, { isIntersecting: true, intersectionRatio: 0.25 })
    fire(host, { isIntersecting: true, intersectionRatio: 0.6 })

    expect(events.map((e) => e.threshold)).toEqual([0.25, 0.5])
    expect(events.every((e) => e.direction === 'up')).toBe(true)
    unmount()
  })

  it('fires crossed for [0.75, 0.5] in descending order when ratio goes 1 → 0.8 → 0.3', () => {
    const events: IntersectCrossEvent[] = []
    const { host, unmount } = mount({
      intersect: {
        thresholds: [0.25, 0.5, 0.75],
        crossed: (e) => events.push(e),
      },
    })

    // Establish baseline at 1.0 first
    fire(host, { isIntersecting: true, intersectionRatio: 1 })
    events.length = 0 // clear ascending events from baseline

    fire(host, { isIntersecting: true, intersectionRatio: 0.8 })
    fire(host, { isIntersecting: true, intersectionRatio: 0.3 })

    expect(events.map((e) => e.threshold)).toEqual([0.75, 0.5])
    expect(events.every((e) => e.direction === 'down')).toBe(true)
    unmount()
  })

  it('equal ratio = hit (going up): ratio exactly at threshold fires that threshold', () => {
    const events: IntersectCrossEvent[] = []
    const { host, unmount } = mount({
      intersect: {
        thresholds: [0.5],
        crossed: (e) => events.push(e),
      },
    })

    // The first callback is the baseline — nothing has been crossed yet.
    fire(host, { isIntersecting: false, intersectionRatio: 0 })

    fire(host, { isIntersecting: true, intersectionRatio: 0.5 })
    expect(events.map((e) => e.threshold)).toEqual([0.5])
    expect(events[0].direction).toBe('up')
    unmount()
  })

  it('equal ratio = hit (going down): ratio landing exactly on threshold fires that threshold', () => {
    const events: IntersectCrossEvent[] = []
    const { host, unmount } = mount({
      intersect: {
        thresholds: [0.5],
        crossed: (e) => events.push(e),
      },
    })

    // Go to 1, then to 0.5 exactly
    fire(host, { isIntersecting: true, intersectionRatio: 1 })
    events.length = 0

    fire(host, { isIntersecting: true, intersectionRatio: 0.5 })
    expect(events.map((e) => e.threshold)).toEqual([0.5])
    expect(events[0].direction).toBe('down')
    unmount()
  })

  it('does not refire crossed at the same threshold when ratio is stable', () => {
    const events: IntersectCrossEvent[] = []
    const { host, unmount } = mount({
      intersect: {
        thresholds: [0.25, 0.5],
        crossed: (e) => events.push(e),
      },
    })

    // The first callback is the baseline — nothing has been crossed yet.
    fire(host, { isIntersecting: false, intersectionRatio: 0 })

    fire(host, { isIntersecting: true, intersectionRatio: 0.6 })
    expect(events.map((e) => e.threshold)).toEqual([0.25, 0.5])

    events.length = 0
    fire(host, { isIntersecting: true, intersectionRatio: 0.6 })
    expect(events).toEqual([])
    unmount()
  })

  it('crossed payload carries the current ratio (not the threshold)', () => {
    const events: IntersectCrossEvent[] = []
    const { host, unmount } = mount({
      intersect: {
        thresholds: [0.5],
        crossed: (e) => events.push(e),
      },
    })

    // The first callback is the baseline — nothing has been crossed yet.
    fire(host, { isIntersecting: false, intersectionRatio: 0 })

    fire(host, { isIntersecting: true, intersectionRatio: 0.7 })
    expect(events[0].ratio).toBe(0.7)
    unmount()
  })

  it('crossed without thresholds is a no-op', () => {
    const events: IntersectCrossEvent[] = []
    const { host, unmount } = mount({
      intersect: {
        crossed: (e) => events.push(e),
      },
    })

    fire(host, { isIntersecting: true, intersectionRatio: 0.7 })
    expect(events).toEqual([])
    unmount()
  })

  it('crossed deduplicates threshold values', () => {
    const events: IntersectCrossEvent[] = []
    const { host, unmount } = mount({
      intersect: {
        thresholds: [0.5, 0.5, 0.5],
        crossed: (e) => events.push(e),
      },
    })

    // The first callback is the baseline — nothing has been crossed yet.
    fire(host, { isIntersecting: false, intersectionRatio: 0 })

    fire(host, { isIntersecting: true, intersectionRatio: 0.6 })
    expect(events.map((e) => e.threshold)).toEqual([0.5])
    unmount()
  })

  // A crossing needs a ratio to have crossed *from*. `lastRatio` used to be
  // initialised to a fabricated 0, so an element that merely mounted 60%
  // visible emitted an `up` crossing for every threshold below 0.6 — the
  // README's infinite-scroll sentinel called loadNextPage() during mount.
  it('emits no crossings on the first callback, however visible the element already is', () => {
    const events: IntersectCrossEvent[] = []
    const { host, unmount } = mount({
      intersect: { thresholds: [0.1, 0.25, 0.5], crossed: (e) => events.push(e) },
    })

    fire(host, { isIntersecting: true, intersectionRatio: 0.6 })
    expect(events).toEqual([])

    // …and the baseline it established is real: the next move crosses from 0.6.
    fire(host, { isIntersecting: true, intersectionRatio: 0.2 })
    expect(events.map((e) => e.threshold)).toEqual([0.5, 0.25])
    expect(events.every((e) => e.direction === 'down')).toBe(true)
    unmount()
  })

  // `[0]` is the natural way to ask "tell me when it enters at all". The
  // ascending rule `prev < t <= next` can never fire for t === 0, while the
  // descending rule fires on every full exit, so enter/leave bookkeeping
  // drifted by one every cycle.
  it('thresholds: [0] pairs every `down` crossing with an `up`', () => {
    const events: IntersectCrossEvent[] = []
    const { host, unmount } = mount({
      intersect: { thresholds: [0], crossed: (e) => events.push(e) },
    })

    fire(host, { isIntersecting: false, intersectionRatio: 0 })
    fire(host, { isIntersecting: true, intersectionRatio: 0.4 })
    fire(host, { isIntersecting: false, intersectionRatio: 0 })
    fire(host, { isIntersecting: true, intersectionRatio: 0.9 })

    expect(events.map((e) => `${e.threshold}:${e.direction}`)).toEqual([
      '0:up',
      '0:down',
      '0:up',
    ])
    unmount()
  })

  // The observer samples at the threshold set it was CONSTRUCTED with, so a
  // swap that changed only the crossing math would feed ratios of one
  // granularity into the thresholds of another.
  it('a thresholds swap rebuilds the observer so sampling and crossing math agree', async () => {
    const { host, setOpts, unmount } = mount({
      intersect: { thresholds: [0.5], crossed: () => {} },
    })
    const first = (ioByElement.get(host)![0] as unknown as MockIntersectionObserver)
    expect(first.thresholds).toEqual([0.5])

    await setOpts({ intersect: { thresholds: [0.1, 0.9], crossed: () => {} } })

    expect(first.disconnected).toBe(true)
    const second = (ioByElement.get(host)![0] as unknown as MockIntersectionObserver)
    expect(second).not.toBe(first)
    expect(second.thresholds).toEqual([0.1, 0.9])
    unmount()
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — Scroll-direction inference                                  */
/* ------------------------------------------------------------------ */

describe('intersect: scroll direction', () => {
  it('first tick with top above root center yields `enter-from-above`', () => {
    let captured: IntersectDirection | null = null
    const { host, unmount } = mount({
      intersect: {
        on: (e) => {
          captured = e.direction
        },
      },
    })

    // Root center = 0 + 800 / 2 = 400. Top = 100 → above center.
    fire(host, {
      isIntersecting: true,
      intersectionRatio: 1,
      boundingClientRect: mkRect({ top: 100, height: 100 }),
      rootBounds: mkRect({ top: 0, height: 800 }),
    })

    expect(captured).toBe('enter-from-above')
    unmount()
  })

  it('first tick with top below root center yields `enter-from-below`', () => {
    let captured: IntersectDirection | null = null
    const { host, unmount } = mount({
      intersect: {
        on: (e) => {
          captured = e.direction
        },
      },
    })

    fire(host, {
      isIntersecting: true,
      intersectionRatio: 1,
      boundingClientRect: mkRect({ top: 600, height: 100 }),
      rootBounds: mkRect({ top: 0, height: 800 }),
    })

    expect(captured).toBe('enter-from-below')
    unmount()
  })

  it('subsequent tick where element moved up + transitioned to intersecting → enter-from-below', () => {
    const directions: (IntersectDirection | null)[] = []
    const { host, unmount } = mount({
      intersect: {
        on: (e) => directions.push(e.direction),
      },
    })

    // Tick 1: not intersecting, top below viewport
    fire(host, {
      isIntersecting: false,
      intersectionRatio: 0,
      boundingClientRect: mkRect({ top: 900, height: 100 }),
      rootBounds: mkRect({ top: 0, height: 800 }),
    })

    // Tick 2: intersecting, top moved UP into viewport (delta < 0)
    fire(host, {
      isIntersecting: true,
      intersectionRatio: 1,
      boundingClientRect: mkRect({ top: 600, height: 100 }),
      rootBounds: mkRect({ top: 0, height: 800 }),
    })

    expect(directions[1]).toBe('enter-from-below')
    unmount()
  })

  it('subsequent tick where element moved down + transitioned to intersecting → enter-from-above', () => {
    const directions: (IntersectDirection | null)[] = []
    const { host, unmount } = mount({
      intersect: {
        on: (e) => directions.push(e.direction),
      },
    })

    // Tick 1: not intersecting, top above viewport
    fire(host, {
      isIntersecting: false,
      intersectionRatio: 0,
      boundingClientRect: mkRect({ top: -200, height: 100 }),
      rootBounds: mkRect({ top: 0, height: 800 }),
    })

    // Tick 2: intersecting, top moved DOWN into viewport (delta > 0)
    fire(host, {
      isIntersecting: true,
      intersectionRatio: 1,
      boundingClientRect: mkRect({ top: 100, height: 100 }),
      rootBounds: mkRect({ top: 0, height: 800 }),
    })

    expect(directions[1]).toBe('enter-from-above')
    unmount()
  })

  it('transition from intersecting → not, top moved up → leave-to-above', () => {
    const directions: (IntersectDirection | null)[] = []
    const { host, unmount } = mount({
      intersect: {
        on: (e) => directions.push(e.direction),
      },
    })

    fire(host, {
      isIntersecting: true,
      intersectionRatio: 1,
      boundingClientRect: mkRect({ top: 300, height: 100 }),
      rootBounds: mkRect({ top: 0, height: 800 }),
    })

    fire(host, {
      isIntersecting: false,
      intersectionRatio: 0,
      boundingClientRect: mkRect({ top: -200, height: 100 }),
      rootBounds: mkRect({ top: 0, height: 800 }),
    })

    expect(directions[1]).toBe('leave-to-above')
    unmount()
  })

  it('transition from intersecting → not, top moved down → leave-to-below', () => {
    const directions: (IntersectDirection | null)[] = []
    const { host, unmount } = mount({
      intersect: {
        on: (e) => directions.push(e.direction),
      },
    })

    fire(host, {
      isIntersecting: true,
      intersectionRatio: 1,
      boundingClientRect: mkRect({ top: 300, height: 100 }),
      rootBounds: mkRect({ top: 0, height: 800 }),
    })

    fire(host, {
      isIntersecting: false,
      intersectionRatio: 0,
      boundingClientRect: mkRect({ top: 900, height: 100 }),
      rootBounds: mkRect({ top: 0, height: 800 }),
    })

    expect(directions[1]).toBe('leave-to-below')
    unmount()
  })

  it('direction is null on non-transition ticks (still visible, ratio changing)', () => {
    const directions: (IntersectDirection | null)[] = []
    const { host, unmount } = mount({
      intersect: {
        on: (e) => directions.push(e.direction),
      },
    })

    fire(host, {
      isIntersecting: true,
      intersectionRatio: 0.3,
      boundingClientRect: mkRect({ top: 100, height: 100 }),
      rootBounds: mkRect({ top: 0, height: 800 }),
    })

    fire(host, {
      isIntersecting: true,
      intersectionRatio: 0.8,
      boundingClientRect: mkRect({ top: 50, height: 100 }),
      rootBounds: mkRect({ top: 0, height: 800 }),
    })

    expect(directions[1]).toBeNull()
    unmount()
  })

  it('direction is null when topDelta is exactly 0 on a transition', () => {
    const directions: (IntersectDirection | null)[] = []
    const { host, unmount } = mount({
      intersect: {
        on: (e) => directions.push(e.direction),
      },
    })

    fire(host, {
      isIntersecting: false,
      intersectionRatio: 0,
      boundingClientRect: mkRect({ top: 100, height: 100 }),
      rootBounds: mkRect({ top: 0, height: 800 }),
    })

    fire(host, {
      isIntersecting: true,
      intersectionRatio: 0.5,
      boundingClientRect: mkRect({ top: 100, height: 100 }),
      rootBounds: mkRect({ top: 0, height: 800 }),
    })

    expect(directions[1]).toBeNull()
    unmount()
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — Lifecycle / reactive opts                                   */
/* ------------------------------------------------------------------ */

describe('reactive options', () => {
  it('swapping `on` mid-life uses the new callback', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const { host, unmount, setOpts } = mount({ intersect: { on: first } })

    fire(host, { isIntersecting: true, intersectionRatio: 0.5 })
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(0)

    await setOpts({ intersect: { on: second } })

    fire(host, { isIntersecting: false, intersectionRatio: 0 })
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)

    unmount()
  })

  it('removing `intersect` mid-life tears down the observer', async () => {
    const onIntersect = vi.fn()
    const { host, unmount, setOpts } = mount({ intersect: { on: onIntersect } })

    expect(ioByElement.has(host)).toBe(true)

    await setOpts({})
    expect(ioByElement.has(host)).toBe(false)

    unmount()
  })

  it('adding `intersect` mid-life wires up an observer', async () => {
    const onIntersect = vi.fn()
    const { host, unmount, setOpts } = mount(undefined)
    expect(ioByElement.has(host)).toBe(false)

    await setOpts({ intersect: { on: onIntersect } })
    expect(ioByElement.has(host)).toBe(true)

    fire(host, { isIntersecting: true, intersectionRatio: 1 })
    expect(onIntersect).toHaveBeenCalledTimes(1)

    unmount()
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — Multi-instance non-interference                             */
/* ------------------------------------------------------------------ */

describe('multi-instance', () => {
  it('two hosts with independent observers fire independently', () => {
    const onA = vi.fn()
    const onB = vi.fn()
    const a = mount({ intersect: { on: onA } }, 'data-a')
    const b = mount({ intersect: { on: onB } }, 'data-b')

    fire(a.host, { isIntersecting: true, intersectionRatio: 1 })
    expect(onA).toHaveBeenCalledTimes(1)
    expect(onB).toHaveBeenCalledTimes(0)

    fire(b.host, { isIntersecting: true, intersectionRatio: 1 })
    expect(onA).toHaveBeenCalledTimes(1)
    expect(onB).toHaveBeenCalledTimes(1)

    a.unmount()
    b.unmount()
  })

  it('unmounting one host does not affect the other', () => {
    const onA = vi.fn()
    const onB = vi.fn()
    const a = mount({ intersect: { on: onA } }, 'data-a')
    const b = mount({ intersect: { on: onB } }, 'data-b')

    a.unmount()
    expect(ioByElement.has(a.host)).toBe(false)
    expect(ioByElement.has(b.host)).toBe(true)

    fire(b.host, { isIntersecting: true, intersectionRatio: 1 })
    expect(onB).toHaveBeenCalledTimes(1)

    b.unmount()
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — Validation                                                  */
/* ------------------------------------------------------------------ */

describe('validation', () => {
  it('throws when resize.gateOnIntersect is set without intersect config', () => {
    expect(() =>
      mount({ resize: { gateOnIntersect: true } }),
    ).toThrowError(/gateOnIntersect requires an intersect/)
  })

  it('throws when mutate.gateOnIntersect is set without intersect config', () => {
    expect(() =>
      mount({ mutate: { gateOnIntersect: true } }),
    ).toThrowError(/gateOnIntersect requires an intersect/)
  })

  it('does NOT throw when gateOnIntersect is set with intersect config', () => {
    expect(() =>
      mount({
        intersect: { on: () => {} },
        resize: { gateOnIntersect: true },
      }),
    ).not.toThrow()
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — `data-observe-state` dynamic mirror                         */
/* ------------------------------------------------------------------ */

describe('data-observe-state attribute', () => {
  it('initial value on mount with intersect is `intersect:hidden;resize:-;mutate:-`', () => {
    const { host, unmount } = mount({ intersect: { on: () => {} } })
    expect(host.getAttribute('data-observe-state')).toBe('intersect:hidden;resize:-;mutate:-')
    unmount()
  })

  it('flips intersect segment to "visible" after first isIntersecting=true callback', () => {
    const { host, unmount } = mount({ intersect: { on: () => {} } })
    fire(host, { isIntersecting: true, intersectionRatio: 1 })
    expect(host.getAttribute('data-observe-state')).toBe('intersect:visible;resize:-;mutate:-')
    unmount()
  })

  it('flips intersect segment back to "hidden" when element leaves', () => {
    const { host, unmount } = mount({ intersect: { on: () => {} } })
    fire(host, { isIntersecting: true, intersectionRatio: 1 })
    expect(host.getAttribute('data-observe-state')).toBe('intersect:visible;resize:-;mutate:-')
    fire(host, { isIntersecting: false, intersectionRatio: 0 })
    expect(host.getAttribute('data-observe-state')).toBe('intersect:hidden;resize:-;mutate:-')
    unmount()
  })

  it('attribute updates correlate with the `on` callback receiving isIntersecting=true', () => {
    let lastSeen: boolean | null = null
    const { host, unmount } = mount({
      intersect: {
        on: (e) => {
          lastSeen = e.isIntersecting
        },
      },
    })
    fire(host, { isIntersecting: true, intersectionRatio: 0.7 })
    expect(lastSeen).toBe(true)
    expect(host.getAttribute('data-observe-state')).toContain('intersect:visible')
    unmount()
  })

  it('with intersect missing, intersect segment is `-` (sentinel, not the false-positive "hidden")', () => {
    const { host, unmount } = mount({})
    expect(host.getAttribute('data-observe-state')).toBe('intersect:-;resize:-;mutate:-')
    unmount()
  })

  it('reactive swap: removing intersect drops the segment to `-`', async () => {
    const { host, setOpts, unmount } = mount({ intersect: { on: () => {} } })
    expect(host.getAttribute('data-observe-state')).toBe('intersect:hidden;resize:-;mutate:-')
    fire(host, { isIntersecting: true, intersectionRatio: 1 })
    expect(host.getAttribute('data-observe-state')).toBe('intersect:visible;resize:-;mutate:-')
    await setOpts({})
    expect(host.getAttribute('data-observe-state')).toBe('intersect:-;resize:-;mutate:-')
    unmount()
  })

  it('after `once: true` disconnect, the attribute reflects the last seen state and does not update again', () => {
    const { host, unmount } = mount({ intersect: { once: true, on: () => {} } })
    fire(host, { isIntersecting: true, intersectionRatio: 1 })
    expect(host.getAttribute('data-observe-state')).toBe('intersect:visible;resize:-;mutate:-')
    expect(ioByElement.has(host)).toBe(false)
    unmount()
  })

  it('attribute is removed on unmount', () => {
    const { host, unmount } = mount({ intersect: { on: () => {} } })
    fire(host, { isIntersecting: true, intersectionRatio: 1 })
    unmount()
    expect(host.getAttribute('data-observe-state')).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — SSR / no-DOM defensive                                      */
/* ------------------------------------------------------------------ */

describe('environment defenses', () => {
  it('does not throw when IntersectionObserver is undefined on the global', () => {
    uninstallIOMock()
    expect(() =>
      mount({ intersect: { on: () => {} } }),
    ).not.toThrow()
  })

  // The CSS hook used to report `intersect:hidden` forever on an engine with
  // no IntersectionObserver, because `hidden` was the initial value and
  // nothing else ever wrote the segment. README recipe 5 teaches
  // `.card { opacity: 0 }` + `[data-observe-state*='intersect:visible'] { opacity: 1 }`,
  // so the content was permanently invisible — a blank page, no error. The gate
  // already failed OPEN in exactly this situation; the two now agree.
  it('with no IntersectionObserver the intersect segment is `visible`, not `hidden`', () => {
    uninstallIOMock()
    const { host, unmount } = mount({ intersect: { on: () => {} } })
    expect(host.getAttribute('data-observe-state')).toBe('intersect:visible;resize:-;mutate:-')
    unmount()
  })

  it('with no IntersectionObserver a gated mode still fires — the gate and the CSS hook agree', () => {
    uninstallIOMock()
    const events: ResizeEvent[] = []
    const { host, unmount } = mount({
      intersect: { on: () => {} },
      resize: { gateOnIntersect: true, handler: (e) => events.push(e) },
    })
    fireResize(host, { width: 500, height: 400 })
    expect(events).toHaveLength(1)
    expect(host.getAttribute('data-observe-state')).toBe('intersect:visible;resize:active;mutate:-')
    unmount()
  })

  it('`-` is reserved for "this binding did not ask for the mode"', () => {
    uninstallIOMock()
    uninstallROMock()
    uninstallMOMock()
    const { host, unmount } = mount({})
    expect(host.getAttribute('data-observe-state')).toBe('intersect:-;resize:-;mutate:-')
    unmount()
  })

  it('directive mounted hook is callable with no DOM globals (smoke check)', () => {
    // Calling the hook directly with a stub element + bindable shape ensures
    // the directive does not assume `window` / `document` exist at call time
    // when intersect is omitted.
    const el = document.createElement('div')
    expect(() => {
      const mounted = vObserve.mounted as unknown as (
        el: HTMLElement,
        b: DirectiveBindingStub,
      ) => void
      mounted(el, { value: undefined } as unknown as DirectiveBindingStub)
    }).not.toThrow()
  })
})

type DirectiveBindingStub = { value: ObserveOptions | undefined }

/* ------------------------------------------------------------------ */
/*  Tests — Resize: ResizeObserver setup                                */
/* ------------------------------------------------------------------ */

describe('resize: setup', () => {
  it('creates a ResizeObserver only when resize config is provided', () => {
    const a = mount(undefined, 'data-a')
    expect(roByElement.has(a.host)).toBe(false)
    a.unmount()

    const b = mount({ resize: { handler: () => {} } }, 'data-b')
    expect(roByElement.has(b.host)).toBe(true)
    b.unmount()
  })

  it('does not create a ResizeObserver when only intersect is configured', () => {
    const { host, unmount } = mount({ intersect: { on: () => {} } })
    expect(roByElement.has(host)).toBe(false)
    unmount()
  })

  it('unobserves on unmount (clears roByElement entry)', () => {
    const { host, unmount } = mount({ resize: { handler: () => {} } })
    expect(roByElement.has(host)).toBe(true)
    unmount()
    expect(roByElement.has(host)).toBe(false)
  })

  it('does not throw when ResizeObserver is undefined on the global', () => {
    uninstallROMock()
    expect(() => mount({ resize: { handler: () => {} } })).not.toThrow()
    installROMock()
  })

  it('two hosts with independent observers fire independently', () => {
    const a = vi.fn<(e: ResizeEvent) => void>()
    const b = vi.fn<(e: ResizeEvent) => void>()
    const aMount = mount({ resize: { handler: a } }, 'data-a')
    const bMount = mount({ resize: { handler: b } }, 'data-b')
    fireResize(aMount.host, { width: 100, height: 100 })
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(0)
    aMount.unmount()
    bMount.unmount()
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — Resize: tick mode (default) diff payload                    */
/* ------------------------------------------------------------------ */

describe('resize: tick mode (default)', () => {
  it('fires handler with mode:"tick" and from:null on the first callback', () => {
    const events: ResizeEvent[] = []
    const { host, unmount } = mount({ resize: { handler: (e) => events.push(e) } })
    fireResize(host, { width: 320, height: 480 })
    expect(events).toHaveLength(1)
    expect(events[0].mode).toBe('tick')
    if (events[0].mode === 'tick') {
      expect(events[0].from).toBeNull()
      expect(events[0].to).toEqual({ width: 320, height: 480 })
      expect(events[0].delta).toEqual({ width: 0, height: 0 })
    }
    unmount()
  })

  it('on second callback, from is prior to + delta is correct sign', () => {
    const events: ResizeEvent[] = []
    const { host, unmount } = mount({ resize: { handler: (e) => events.push(e) } })
    fireResize(host, { width: 320, height: 480 })
    fireResize(host, { width: 400, height: 500 })
    expect(events).toHaveLength(2)
    if (events[1].mode === 'tick') {
      expect(events[1].from).toEqual({ width: 320, height: 480 })
      expect(events[1].to).toEqual({ width: 400, height: 500 })
      expect(events[1].delta).toEqual({ width: 80, height: 20 })
    }
    unmount()
  })

  it('delta carries negative values when shrinking', () => {
    const events: ResizeEvent[] = []
    const { host, unmount } = mount({ resize: { handler: (e) => events.push(e) } })
    fireResize(host, { width: 500, height: 500 })
    fireResize(host, { width: 100, height: 200 })
    if (events[1].mode === 'tick') {
      expect(events[1].delta).toEqual({ width: -400, height: -300 })
    }
    unmount()
  })

  it('orientation field on tick payload reflects current dimensions', () => {
    const events: ResizeEvent[] = []
    const { host, unmount } = mount({ resize: { handler: (e) => events.push(e) } })
    fireResize(host, { width: 1280, height: 720 })
    fireResize(host, { width: 400, height: 800 })
    fireResize(host, { width: 500, height: 500 })
    if (events[0].mode === 'tick') expect(events[0].orientation).toBe('landscape')
    if (events[1].mode === 'tick') expect(events[1].orientation).toBe('portrait')
    if (events[2].mode === 'tick') expect(events[2].orientation).toBe('square')
    unmount()
  })

  it('bracket field on tick payload is null when no breakpoints configured', () => {
    const events: ResizeEvent[] = []
    const { host, unmount } = mount({ resize: { handler: (e) => events.push(e) } })
    fireResize(host, { width: 400, height: 800 })
    if (events[0].mode === 'tick') expect(events[0].bracket).toBeNull()
    unmount()
  })

  it('bracket field on tick payload is the current label when breakpoints are configured', () => {
    const events: ResizeEvent[] = []
    const { host, unmount } = mount({
      resize: { breakpoints: [320, 640, 960], handler: (e) => events.push(e) },
    })
    fireResize(host, { width: 500, height: 500 })
    if (events[0].mode === 'tick') expect(events[0].bracket).toBe('320-640')
    unmount()
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — Resize: crossed mode + array breakpoints                    */
/* ------------------------------------------------------------------ */

describe('resize: crossed mode + array breakpoints', () => {
  it('fires only on threshold crossings (no fire within bracket)', () => {
    const events: ResizeEvent[] = []
    const { host, unmount } = mount({
      resize: {
        on: 'crossed',
        breakpoints: [320, 640, 960],
        handler: (e) => events.push(e),
      },
    })
    // baseline tick at 500 (in [320, 640))
    fireResize(host, { width: 500, height: 500 })
    // micro-ticks within bracket — no fire
    fireResize(host, { width: 501, height: 500 })
    fireResize(host, { width: 510, height: 500 })
    fireResize(host, { width: 530, height: 500 })
    expect(events).toHaveLength(0)
    unmount()
  })

  it('jump from 200 (below 320) to 500 (320-640) fires one event for threshold 320 up', () => {
    const events: ResizeEvent[] = []
    const { host, unmount } = mount({
      resize: {
        on: 'crossed',
        breakpoints: [320, 640, 960],
        handler: (e) => events.push(e),
      },
    })
    fireResize(host, { width: 200, height: 200 })
    fireResize(host, { width: 500, height: 500 })
    expect(events).toHaveLength(1)
    if (events[0].mode === 'crossed') {
      expect(events[0].axis).toBe('width')
      expect(events[0].threshold).toBe(320)
      expect(events[0].direction).toBe('up')
      expect(events[0].bracket).toBe('320-640')
      expect(events[0].from).toEqual({ width: 200, height: 200 })
      expect(events[0].to).toEqual({ width: 500, height: 500 })
    }
    unmount()
  })

  it('jump from 200 across two thresholds to 800 fires 320 and 640 in order', () => {
    const events: ResizeEvent[] = []
    const { host, unmount } = mount({
      resize: {
        on: 'crossed',
        breakpoints: [320, 640, 960],
        handler: (e) => events.push(e),
      },
    })
    fireResize(host, { width: 200, height: 200 })
    fireResize(host, { width: 800, height: 200 })
    expect(events).toHaveLength(2)
    if (events[0].mode === 'crossed' && events[1].mode === 'crossed') {
      expect(events[0].threshold).toBe(320)
      expect(events[0].direction).toBe('up')
      expect(events[1].threshold).toBe(640)
      expect(events[1].direction).toBe('up')
    }
    unmount()
  })

  it('downward jump fires thresholds in descending order with direction "down"', () => {
    const events: ResizeEvent[] = []
    const { host, unmount } = mount({
      resize: {
        on: 'crossed',
        breakpoints: [320, 640, 960],
        handler: (e) => events.push(e),
      },
    })
    fireResize(host, { width: 1000, height: 200 })
    fireResize(host, { width: 200, height: 200 })
    expect(events).toHaveLength(3)
    if (
      events[0].mode === 'crossed' &&
      events[1].mode === 'crossed' &&
      events[2].mode === 'crossed'
    ) {
      expect(events.map((e) => e.mode === 'crossed' ? e.threshold : -1)).toEqual([960, 640, 320])
      expect(events.every((e) => e.mode === 'crossed' && e.direction === 'down')).toBe(true)
    }
    unmount()
  })

  it('equal-value crossing counts as a hit going up', () => {
    const events: ResizeEvent[] = []
    const { host, unmount } = mount({
      resize: {
        on: 'crossed',
        breakpoints: [320],
        handler: (e) => events.push(e),
      },
    })
    fireResize(host, { width: 300, height: 200 })
    fireResize(host, { width: 320, height: 200 })
    expect(events).toHaveLength(1)
    if (events[0].mode === 'crossed') expect(events[0].direction).toBe('up')
    unmount()
  })

  it('default labels for array form are "<min", "a-b", ">=max"', () => {
    const events: ResizeEvent[] = []
    const { host, unmount } = mount({
      resize: {
        on: 'tick',
        breakpoints: [320, 640, 960],
        handler: (e) => events.push(e),
      },
    })
    fireResize(host, { width: 100, height: 200 })
    if (events[0].mode === 'tick') expect(events[0].bracket).toBe('<320')
    fireResize(host, { width: 500, height: 200 })
    if (events[1].mode === 'tick') expect(events[1].bracket).toBe('320-640')
    fireResize(host, { width: 700, height: 200 })
    if (events[2].mode === 'tick') expect(events[2].bracket).toBe('640-960')
    fireResize(host, { width: 1100, height: 200 })
    if (events[3].mode === 'tick') expect(events[3].bracket).toBe('>=960')
    unmount()
  })

  it('first tick from null does not fire any crossed events (no baseline yet)', () => {
    const events: ResizeEvent[] = []
    const { host, unmount } = mount({
      resize: {
        on: 'crossed',
        breakpoints: [320],
        handler: (e) => events.push(e),
      },
    })
    fireResize(host, { width: 500, height: 200 })
    expect(events).toHaveLength(0)
    unmount()
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — Resize: crossed mode + object breakpoints                   */
/* ------------------------------------------------------------------ */

describe('resize: crossed mode + object breakpoints', () => {
  it('object form exposes the user-defined key as the bracket label', () => {
    const events: ResizeEvent[] = []
    const { host, unmount } = mount({
      resize: {
        on: 'crossed',
        breakpoints: { sm: 320, md: 640, lg: 960 },
        handler: (e) => events.push(e),
      },
    })
    fireResize(host, { width: 200, height: 200 })
    fireResize(host, { width: 500, height: 200 })
    expect(events).toHaveLength(1)
    if (events[0].mode === 'crossed') {
      expect(events[0].threshold).toBe(320)
      expect(events[0].bracket).toBe('sm')
    }
    unmount()
  })

  it('object form: largest matching key is the active bracket', () => {
    const events: ResizeEvent[] = []
    const { host, unmount } = mount({
      resize: {
        on: 'tick',
        breakpoints: { sm: 320, md: 640, lg: 960 },
        handler: (e) => events.push(e),
      },
    })
    fireResize(host, { width: 200, height: 200 })
    if (events[0].mode === 'tick') expect(events[0].bracket).toBe('(base)')
    fireResize(host, { width: 500, height: 200 })
    if (events[1].mode === 'tick') expect(events[1].bracket).toBe('sm')
    fireResize(host, { width: 800, height: 200 })
    if (events[2].mode === 'tick') expect(events[2].bracket).toBe('md')
    fireResize(host, { width: 1100, height: 200 })
    if (events[3].mode === 'tick') expect(events[3].bracket).toBe('lg')
    unmount()
  })

  it('object form: a 0-entry overrides the default (base) sentinel below the smallest custom key', () => {
    const events: ResizeEvent[] = []
    const { host, unmount } = mount({
      resize: {
        on: 'tick',
        breakpoints: { base: 0, sm: 320, md: 640 },
        handler: (e) => events.push(e),
      },
    })
    fireResize(host, { width: 100, height: 200 })
    if (events[0].mode === 'tick') expect(events[0].bracket).toBe('base')
    unmount()
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — Resize: axis option                                         */
/* ------------------------------------------------------------------ */

describe('resize: axis option', () => {
  it('axis: "width" (default) — only width crossings fire', () => {
    const events: ResizeEvent[] = []
    const { host, unmount } = mount({
      resize: {
        on: 'crossed',
        breakpoints: [320],
        handler: (e) => events.push(e),
      },
    })
    fireResize(host, { width: 200, height: 200 })
    fireResize(host, { width: 200, height: 500 }) // height crossed but axis=width
    expect(events).toHaveLength(0)
    fireResize(host, { width: 500, height: 500 }) // width crossed → fire
    expect(events).toHaveLength(1)
    if (events[0].mode === 'crossed') expect(events[0].axis).toBe('width')
    unmount()
  })

  it('axis: "height" — only height crossings fire', () => {
    const events: ResizeEvent[] = []
    const { host, unmount } = mount({
      resize: {
        on: 'crossed',
        axis: 'height',
        breakpoints: [320],
        handler: (e) => events.push(e),
      },
    })
    fireResize(host, { width: 200, height: 200 })
    fireResize(host, { width: 500, height: 200 }) // width crossed but axis=height
    expect(events).toHaveLength(0)
    fireResize(host, { width: 500, height: 500 })
    expect(events).toHaveLength(1)
    if (events[0].mode === 'crossed') expect(events[0].axis).toBe('height')
    unmount()
  })

  it('axis: "both" — width AND height crossings fire as separate events', () => {
    const events: ResizeEvent[] = []
    const { host, unmount } = mount({
      resize: {
        on: 'crossed',
        axis: 'both',
        breakpoints: [320],
        handler: (e) => events.push(e),
      },
    })
    fireResize(host, { width: 200, height: 200 })
    fireResize(host, { width: 500, height: 500 })
    expect(events).toHaveLength(2)
    if (events[0].mode === 'crossed' && events[1].mode === 'crossed') {
      expect(events.map((e) => e.mode === 'crossed' ? e.axis : '').sort()).toEqual(['height', 'width'])
    }
    unmount()
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — Resize: orientation mode                                    */
/* ------------------------------------------------------------------ */

describe('resize: orientation mode', () => {
  // An orientation-mode consumer used to get NOTHING until the user resized:
  // the first measurable orientation was swallowed as "the baseline", so a
  // layout keyed on the event never initialised and the `resize:` segment
  // stayed at `idle` through first paint.
  it('fires once for the first measurable orientation, with from: null', () => {
    const events: ResizeEvent[] = []
    const { host, unmount } = mount({
      resize: { on: 'orientation', handler: (e) => events.push(e) },
    })
    fireResize(host, { width: 400, height: 800 })
    expect(events).toHaveLength(1)
    if (events[0].mode === 'orientation') {
      expect(events[0].from).toBeNull()
      expect(events[0].to).toBe('portrait')
    }
    expect(host.getAttribute('data-observe-state')).toBe('intersect:-;resize:portrait;mutate:-')
    unmount()
  })

  it('then fires only on portrait↔landscape flips', () => {
    const events: ResizeEvent[] = []
    const { host, unmount } = mount({
      resize: { on: 'orientation', handler: (e) => events.push(e) },
    })
    fireResize(host, { width: 400, height: 800 }) // portrait — initial event
    events.length = 0
    fireResize(host, { width: 410, height: 800 }) // still portrait
    fireResize(host, { width: 420, height: 800 }) // still portrait
    expect(events).toHaveLength(0)
    fireResize(host, { width: 1280, height: 720 }) // → landscape
    expect(events).toHaveLength(1)
    if (events[0].mode === 'orientation') {
      expect(events[0].from).toBe('portrait')
      expect(events[0].to).toBe('landscape')
      expect(events[0].dimensions).toEqual({ width: 1280, height: 720 })
      expect(events[0].ratio).toBeCloseTo(1280 / 720, 5)
    }
    unmount()
  })

  it('flip from landscape → portrait fires with correct from/to', () => {
    const events: ResizeEvent[] = []
    const { host, unmount } = mount({
      resize: { on: 'orientation', handler: (e) => events.push(e) },
    })
    fireResize(host, { width: 1280, height: 720 })
    events.length = 0
    fireResize(host, { width: 400, height: 800 })
    expect(events).toHaveLength(1)
    if (events[0].mode === 'orientation') {
      expect(events[0].from).toBe('landscape')
      expect(events[0].to).toBe('portrait')
    }
    unmount()
  })

  it('default squareTolerance: 0 — only exact w === h is square', () => {
    const events: ResizeEvent[] = []
    const { host, unmount } = mount({
      resize: { on: 'orientation', handler: (e) => events.push(e) },
    })
    fireResize(host, { width: 500, height: 480 }) // landscape baseline
    events.length = 0
    fireResize(host, { width: 500, height: 500 }) // → square flip
    expect(events).toHaveLength(1)
    if (events[0].mode === 'orientation') {
      expect(events[0].to).toBe('square')
    }
    unmount()
  })

  it('squareTolerance widens the square band proportionally', () => {
    const events: ResizeEvent[] = []
    const { host, unmount } = mount({
      resize: { on: 'orientation', squareTolerance: 0.05, handler: (e) => events.push(e) },
    })
    fireResize(host, { width: 600, height: 400 }) // landscape baseline (ratio 1.5)
    events.length = 0
    // ratio = 1.03 → within 5% of 1.0 → square
    fireResize(host, { width: 1030, height: 1000 })
    expect(events).toHaveLength(1)
    if (events[0].mode === 'orientation') expect(events[0].to).toBe('square')
    unmount()
  })

  // A `display: none` panel reports 0x0. That is not square, it is unmeasured
  // — calling it square made a v-if toggle emit landscape → square → landscape
  // and write `resize:square` into the CSS hook from an aspect ratio that did
  // not exist at that moment.
  it('a 0x0 box emits no orientation event and leaves the segment alone', () => {
    const events: ResizeEvent[] = []
    const { host, unmount } = mount({
      resize: { on: 'orientation', handler: (e) => events.push(e) },
    })
    fireResize(host, { width: 800, height: 400 }) // landscape
    events.length = 0

    fireResize(host, { width: 0, height: 0 }) // hidden
    expect(events).toHaveLength(0)
    expect(host.getAttribute('data-observe-state')).toBe('intersect:-;resize:landscape;mutate:-')

    fireResize(host, { width: 800, height: 400 }) // shown again, same shape
    expect(events).toHaveLength(0)
    unmount()
  })

  it('tick mode reports orientation null for a degenerate box rather than square', () => {
    const events: ResizeTickEvent[] = []
    const { host, unmount } = mount({
      resize: { handler: (e) => { if (e.mode === 'tick') events.push(e) } },
    })
    fireResize(host, { width: 0, height: 0 })
    expect(events[0].orientation).toBeNull()
    unmount()
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — Resize: box modes                                           */
/* ------------------------------------------------------------------ */

describe('resize: box modes', () => {
  it('default box="border" reads borderBoxSize', () => {
    const events: ResizeEvent[] = []
    const { host, unmount } = mount({
      resize: { handler: (e) => events.push(e) },
    })
    fireResize(host, {
      width: 0, height: 0, // unused (border below)
      borderBox: { width: 320, height: 480 },
      contentBox: { width: 100, height: 100 },
    })
    if (events[0].mode === 'tick') expect(events[0].to).toEqual({ width: 320, height: 480 })
    unmount()
  })

  it('box="content" reads contentBoxSize', () => {
    const events: ResizeEvent[] = []
    const { host, unmount } = mount({
      resize: { box: 'content', handler: (e) => events.push(e) },
    })
    fireResize(host, {
      width: 0, height: 0,
      borderBox: { width: 320, height: 480 },
      contentBox: { width: 200, height: 300 },
    })
    if (events[0].mode === 'tick') expect(events[0].to).toEqual({ width: 200, height: 300 })
    unmount()
  })

  it('box="device-pixel" reads devicePixelContentBoxSize when present', () => {
    const events: ResizeEvent[] = []
    const { host, unmount } = mount({
      resize: { box: 'device-pixel', handler: (e) => events.push(e) },
    })
    fireResize(host, {
      width: 0, height: 0,
      borderBox: { width: 320, height: 480 },
      contentBox: { width: 320, height: 480 },
      devicePixelContentBox: { width: 640, height: 960 },
    })
    if (events[0].mode === 'tick') expect(events[0].to).toEqual({ width: 640, height: 960 })
    unmount()
  })

  it('box="device-pixel" falls back to contentBoxSize × DPR when devicePixelContentBox is undefined', () => {
    const events: ResizeEvent[] = []
    // Set a known DPR
    const original = window.devicePixelRatio
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true })
    const { host, unmount } = mount({
      resize: { box: 'device-pixel', handler: (e) => events.push(e) },
    })
    fireResize(host, {
      width: 0, height: 0,
      borderBox: { width: 320, height: 480 },
      contentBox: { width: 320, height: 480 },
      // devicePixelContentBox omitted on purpose
    })
    if (events[0].mode === 'tick') expect(events[0].to).toEqual({ width: 640, height: 960 })
    unmount()
    Object.defineProperty(window, 'devicePixelRatio', { value: original, configurable: true })
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — Resize: debounce                                            */
/* ------------------------------------------------------------------ */

describe('resize: debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounce collapses tick storms into one call per window', () => {
    const events: ResizeEvent[] = []
    const { host, unmount } = mount({
      resize: { debounce: 100, handler: (e) => events.push(e) },
    })
    fireResize(host, { width: 100, height: 100 })
    fireResize(host, { width: 200, height: 200 })
    fireResize(host, { width: 300, height: 300 })
    fireResize(host, { width: 400, height: 400 })
    expect(events).toHaveLength(0)
    vi.advanceTimersByTime(100)
    expect(events).toHaveLength(1)
    if (events[0].mode === 'tick') expect(events[0].to).toEqual({ width: 400, height: 400 })
    unmount()
  })

  it('settled state at 250ms after last tick = 1 call with final dimensions', () => {
    const events: ResizeEvent[] = []
    const { host, unmount } = mount({
      resize: { debounce: 100, handler: (e) => events.push(e) },
    })
    fireResize(host, { width: 200, height: 200 })
    vi.advanceTimersByTime(50)
    fireResize(host, { width: 300, height: 300 })
    vi.advanceTimersByTime(50)
    fireResize(host, { width: 400, height: 400 })
    vi.advanceTimersByTime(250)
    expect(events).toHaveLength(1)
    if (events[0].mode === 'tick') expect(events[0].to).toEqual({ width: 400, height: 400 })
    unmount()
  })

  it('unmount cancels pending debounce timer', () => {
    const events: ResizeEvent[] = []
    const { host, unmount } = mount({
      resize: { debounce: 100, handler: (e) => events.push(e) },
    })
    fireResize(host, { width: 100, height: 100 })
    unmount()
    vi.advanceTimersByTime(500)
    expect(events).toHaveLength(0)
  })

  it('debounce coexists with breakpoints: bracket crossing is debounced too', () => {
    const events: ResizeEvent[] = []
    const { host, unmount } = mount({
      resize: {
        on: 'crossed',
        breakpoints: [320],
        debounce: 100,
        handler: (e) => events.push(e),
      },
    })
    // baseline below 320
    fireResize(host, { width: 200, height: 200 })
    vi.advanceTimersByTime(100)
    // storm of crossings — collapsed to one
    fireResize(host, { width: 400, height: 200 })
    fireResize(host, { width: 200, height: 200 })
    fireResize(host, { width: 400, height: 200 })
    expect(events).toHaveLength(0)
    vi.advanceTimersByTime(100)
    // last settled = 400, prior baseline = 200 → one crossing up
    expect(events).toHaveLength(1)
    if (events[0].mode === 'crossed') {
      expect(events[0].direction).toBe('up')
    }
    unmount()
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — Resize: data-observe-state segment                          */
/* ------------------------------------------------------------------ */

describe('resize: data-observe-state segment', () => {
  it('initial value on mount with resize-only config is `intersect:-;resize:idle;mutate:-`', () => {
    const { host, unmount } = mount({ resize: { handler: () => {} } })
    expect(host.getAttribute('data-observe-state')).toBe('intersect:-;resize:idle;mutate:-')
    unmount()
  })

  it('after first tick callback, resize segment is the bracket label or "active"', () => {
    const { host, unmount } = mount({
      resize: {
        breakpoints: [320, 640, 960],
        handler: () => {},
      },
    })
    fireResize(host, { width: 500, height: 500 })
    expect(host.getAttribute('data-observe-state')).toBe('intersect:-;resize:320-640;mutate:-')
    unmount()
  })

  it('without breakpoints, resize segment after tick is "active"', () => {
    const { host, unmount } = mount({ resize: { handler: () => {} } })
    fireResize(host, { width: 500, height: 500 })
    expect(host.getAttribute('data-observe-state')).toBe('intersect:-;resize:active;mutate:-')
    unmount()
  })

  it('orientation mode writes the orientation as the resize segment', () => {
    const { host, unmount } = mount({ resize: { on: 'orientation', handler: () => {} } })
    fireResize(host, { width: 1280, height: 720 })
    expect(host.getAttribute('data-observe-state')).toBe('intersect:-;resize:landscape;mutate:-')
    fireResize(host, { width: 400, height: 800 })
    expect(host.getAttribute('data-observe-state')).toBe('intersect:-;resize:portrait;mutate:-')
    unmount()
  })

  it('attribute is removed on unmount', () => {
    const { host, unmount } = mount({ resize: { handler: () => {} } })
    fireResize(host, { width: 320, height: 480 })
    unmount()
    expect(host.getAttribute('data-observe-state')).toBeNull()
  })

  it('intersect + resize together: both segments update independently', () => {
    const { host, unmount } = mount({
      intersect: { on: () => {} },
      resize: { breakpoints: [320, 640], handler: () => {} },
    })
    expect(host.getAttribute('data-observe-state')).toBe('intersect:hidden;resize:idle;mutate:-')
    fire(host, { isIntersecting: true, intersectionRatio: 1 })
    fireResize(host, { width: 400, height: 400 })
    expect(host.getAttribute('data-observe-state')).toBe('intersect:visible;resize:320-640;mutate:-')
    unmount()
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — Resize: reactive options                                    */
/* ------------------------------------------------------------------ */

describe('resize: reactive options', () => {
  it('adding resize mid-life wires up an observer', async () => {
    const { host, setOpts, unmount } = mount({ intersect: { on: () => {} } })
    expect(roByElement.has(host)).toBe(false)
    await setOpts({ intersect: { on: () => {} }, resize: { handler: () => {} } })
    expect(roByElement.has(host)).toBe(true)
    unmount()
  })

  it('removing resize mid-life tears down the observer', async () => {
    const { host, setOpts, unmount } = mount({ resize: { handler: () => {} } })
    expect(roByElement.has(host)).toBe(true)
    await setOpts({})
    expect(roByElement.has(host)).toBe(false)
    expect(host.getAttribute('data-observe-state')).toBe('intersect:-;resize:-;mutate:-')
    unmount()
  })

  it('swapping handler mid-life uses the new callback', async () => {
    const first = vi.fn<(e: ResizeEvent) => void>()
    const second = vi.fn<(e: ResizeEvent) => void>()
    const { host, setOpts, unmount } = mount({ resize: { handler: first } })
    fireResize(host, { width: 100, height: 100 })
    expect(first).toHaveBeenCalledTimes(1)
    await setOpts({ resize: { handler: second } })
    fireResize(host, { width: 200, height: 200 })
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('swapping breakpoints mid-life uses the new buckets', async () => {
    const events: ResizeEvent[] = []
    const { host, setOpts, unmount } = mount({
      resize: { on: 'tick', breakpoints: [320], handler: (e) => events.push(e) },
    })
    fireResize(host, { width: 500, height: 200 })
    if (events[0].mode === 'tick') expect(events[0].bracket).toBe('>=320')
    await setOpts({ resize: { on: 'tick', breakpoints: [640], handler: (e) => events.push(e) } })
    fireResize(host, { width: 500, height: 200 })
    // 500 < 640 → bracket should now be "<640"
    if (events[1].mode === 'tick') expect(events[1].bracket).toBe('<640')
    unmount()
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — Mutate: setup                                               */
/* ------------------------------------------------------------------ */

describe('mutate: setup', () => {
  it('creates a MutationObserver only when mutate config is provided', () => {
    const a = mount(undefined, 'data-a')
    expect(moByElement.has(a.host)).toBe(false)
    a.unmount()

    const b = mount({ mutate: { on: 'attr:class', handler: () => {} } }, 'data-b')
    expect(moByElement.has(b.host)).toBe(true)
    b.unmount()
  })

  it('does not create a MutationObserver when only intersect/resize is configured', () => {
    const { host, unmount } = mount({
      intersect: { on: () => {} },
      resize: { handler: () => {} },
    })
    expect(moByElement.has(host)).toBe(false)
    unmount()
  })

  it('disconnects on unmount (clears moByElement entry)', () => {
    const { host, unmount } = mount({ mutate: { on: 'attr:class', handler: () => {} } })
    expect(moByElement.has(host)).toBe(true)
    unmount()
    expect(moByElement.has(host)).toBe(false)
  })

  it('does not throw when MutationObserver is undefined on the global', () => {
    uninstallMOMock()
    expect(() => {
      const { unmount } = mount({ mutate: { on: 'attr:class', handler: () => {} } })
      unmount()
    }).not.toThrow()
    installMOMock()
  })

  it('two hosts with independent observers fire independently', () => {
    const aSpy = vi.fn<(e: MutateEvent) => void>()
    const bSpy = vi.fn<(e: MutateEvent) => void>()
    const a = mount({ mutate: { on: 'attr:class', handler: aSpy } }, 'data-a')
    const b = mount({ mutate: { on: 'attr:class', handler: bSpy } }, 'data-b')
    fireMutation(a.host, { type: 'attributes', attributeName: 'class', oldValue: 'old', target: a.host })
    expect(aSpy).toHaveBeenCalledTimes(1)
    expect(bSpy).toHaveBeenCalledTimes(0)
    fireMutation(b.host, { type: 'attributes', attributeName: 'class', oldValue: 'old2', target: b.host })
    expect(aSpy).toHaveBeenCalledTimes(1)
    expect(bSpy).toHaveBeenCalledTimes(1)
    a.unmount()
    b.unmount()
  })

  it('a mutate config with no handler is a no-op, not an error — the segment still moves', () => {
    // The handler is optional: the directive still wires the observer, so the
    // CSS hook works for a consumer who only wants `mutate:active`.
    const { host, unmount } = mount({ mutate: { on: 'attr:class' } })
    expect(host.getAttribute('data-observe-state')).toBe('intersect:-;resize:-;mutate:idle')
    expect(() =>
      fireMutation(host, { type: 'attributes', attributeName: 'class', oldValue: 'a', target: host }),
    ).not.toThrow()
    expect(host.getAttribute('data-observe-state')).toBe('intersect:-;resize:-;mutate:active')
    unmount()
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — Mutate: semantic event types                                */
/* ------------------------------------------------------------------ */

describe('mutate: semantic event types', () => {
  it('"attr:class" sets attributes:true + attributeFilter:["class"] + attributeOldValue:true', () => {
    const { host, unmount } = mount({ mutate: { on: 'attr:class', handler: () => {} } })
    const observerList = moByElement.get(host)
    expect(observerList).toBeDefined()
    const init = (observerList![0] as unknown as MockMutationObserver).observed.get(host)
    expect(init?.attributes).toBe(true)
    expect(init?.attributeFilter).toEqual(['class'])
    expect(init?.attributeOldValue).toBe(true)
    unmount()
  })

  it('"attr:style" filters to style only', () => {
    const { host, unmount } = mount({ mutate: { on: 'attr:style', handler: () => {} } })
    const init = (moByElement.get(host)![0] as unknown as MockMutationObserver).observed.get(host)
    expect(init?.attributeFilter).toEqual(['style'])
    unmount()
  })

  it('"attr:data-foo" filters to the named attribute only', () => {
    const { host, unmount } = mount({ mutate: { on: 'attr:data-foo', handler: () => {} } })
    const init = (moByElement.get(host)![0] as unknown as MockMutationObserver).observed.get(host)
    expect(init?.attributeFilter).toEqual(['data-foo'])
    unmount()
  })

  it('"attr:*" subscribes to all attributes (no attributeFilter)', () => {
    const { host, unmount } = mount({ mutate: { on: 'attr:*', handler: () => {} } })
    const init = (moByElement.get(host)![0] as unknown as MockMutationObserver).observed.get(host)
    expect(init?.attributes).toBe(true)
    expect(init?.attributeFilter).toBeUndefined()
    expect(init?.attributeOldValue).toBe(true)
    unmount()
  })

  it('"children:added" sets childList:true', () => {
    const { host, unmount } = mount({ mutate: { on: 'children:added', handler: () => {} } })
    const init = (moByElement.get(host)![0] as unknown as MockMutationObserver).observed.get(host)
    expect(init?.childList).toBe(true)
    unmount()
  })

  it('"children:removed" sets childList:true', () => {
    const { host, unmount } = mount({ mutate: { on: 'children:removed', handler: () => {} } })
    const init = (moByElement.get(host)![0] as unknown as MockMutationObserver).observed.get(host)
    expect(init?.childList).toBe(true)
    unmount()
  })

  it('"text" sets characterData:true + characterDataOldValue:true + subtree:true', () => {
    const { host, unmount } = mount({ mutate: { on: 'text', handler: () => {} } })
    const init = (moByElement.get(host)![0] as unknown as MockMutationObserver).observed.get(host)
    expect(init?.characterData).toBe(true)
    expect(init?.characterDataOldValue).toBe(true)
    expect(init?.subtree).toBe(true)
    unmount()
  })

  it('"removed" attaches a second observer to the parent (for self-removal detection)', () => {
    const a = document.createElement('div')
    const b = document.createElement('div')
    a.appendChild(b)
    document.body.appendChild(a)
    // We can't mount via Vue easily for this — use the directive directly.
    if (typeof vObserve === 'function') throw new Error('expected directive object')
    vObserve.mounted!(b, {
      value: { mutate: { on: 'removed', handler: () => {} } },
    } as unknown as DirectiveBinding<ObserveOptions | undefined>, null as never, null as never)

    // The parent now has an observer attached.
    expect(moByElement.has(a)).toBe(true)
    const init = (moByElement.get(a)![0] as unknown as MockMutationObserver).observed.get(a)
    expect(init?.childList).toBe(true)

    vObserve.unmounted!(b, null as never, null as never, null as never)
    a.remove()
  })

  it('array form `on: [\'attr:class\', \'children:added\']` subscribes to both', () => {
    const { host, unmount } = mount({ mutate: { on: ['attr:class', 'children:added'], handler: () => {} } })
    const init = (moByElement.get(host)![0] as unknown as MockMutationObserver).observed.get(host)
    expect(init?.attributes).toBe(true)
    expect(init?.attributeFilter).toEqual(['class'])
    expect(init?.childList).toBe(true)
    unmount()
  })

  it('array form with `attr:*` plus another attr: drops the filter (any attribute wins)', () => {
    const { host, unmount } = mount({
      mutate: { on: ['attr:*', 'attr:class'], handler: () => {} },
    })
    const init = (moByElement.get(host)![0] as unknown as MockMutationObserver).observed.get(host)
    expect(init?.attributes).toBe(true)
    // `attr:*` widens — no filter.
    expect(init?.attributeFilter).toBeUndefined()
    unmount()
  })

  it('array form with two distinct `attr:foo` types unions the filter', () => {
    const { host, unmount } = mount({
      mutate: { on: ['attr:class', 'attr:data-foo'], handler: () => {} },
    })
    const init = (moByElement.get(host)![0] as unknown as MockMutationObserver).observed.get(host)
    expect(init?.attributes).toBe(true)
    expect(init?.attributeFilter).toEqual(expect.arrayContaining(['class', 'data-foo']))
    unmount()
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — Mutate: diff payload                                        */
/* ------------------------------------------------------------------ */

describe('mutate: diff payload', () => {
  it('attr:class fires with { type, name, from, to, target }', () => {
    const events: MutateEvent[] = []
    const { host, unmount } = mount({ mutate: { on: 'attr:class', handler: (e) => events.push(e) } })
    host.setAttribute('class', 'after')
    fireMutation(host, {
      type: 'attributes',
      attributeName: 'class',
      oldValue: 'before',
      target: host,
    })
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('attr:class')
    expect(events[0].name).toBe('class')
    expect(events[0].from).toBe('before')
    expect(events[0].to).toBe('after')
    expect(events[0].target).toBe(host)
    unmount()
  })

  it('attr:* preserves the actual attribute name in the event type', () => {
    const events: MutateEvent[] = []
    const { host, unmount } = mount({ mutate: { on: 'attr:*', handler: (e) => events.push(e) } })
    host.setAttribute('data-foo', 'bar')
    fireMutation(host, {
      type: 'attributes',
      attributeName: 'data-foo',
      oldValue: null,
      target: host,
    })
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('attr:data-foo')
    expect(events[0].name).toBe('data-foo')
    expect(events[0].from).toBeNull()
    expect(events[0].to).toBe('bar')
    unmount()
  })

  it('children:added fires with { type, added: [...], target }', () => {
    const events: MutateEvent[] = []
    const { host, unmount } = mount({ mutate: { on: 'children:added', handler: (e) => events.push(e) } })
    const child1 = document.createElement('span')
    const child2 = document.createElement('p')
    fireMutation(host, {
      type: 'childList',
      target: host,
      addedNodes: [child1, child2],
    })
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('children:added')
    expect(events[0].added).toEqual([child1, child2])
    expect(events[0].target).toBe(host)
    expect(events[0].removed).toBeUndefined()
    unmount()
  })

  it('children:removed fires with { type, removed: [...], target }', () => {
    const events: MutateEvent[] = []
    const { host, unmount } = mount({ mutate: { on: 'children:removed', handler: (e) => events.push(e) } })
    const gone = document.createElement('li')
    fireMutation(host, {
      type: 'childList',
      target: host,
      removedNodes: [gone],
    })
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('children:removed')
    expect(events[0].removed).toEqual([gone])
    expect(events[0].added).toBeUndefined()
    unmount()
  })

  it('text fires with { type:"text", from, to, target } — both sides read the HOST', () => {
    const events: MutateEvent[] = []
    const { host, unmount } = mount({ mutate: { on: 'text', handler: (e) => events.push(e) } })
    host.textContent = 'before'
    // The baseline is captured at setup, so the first edit diffs from ''.
    fireMutation(host, { type: 'childList', target: host, addedNodes: [host.firstChild!] })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'text', from: '', to: 'before', target: host })

    const textNode = host.firstChild as Text
    textNode.data = 'after'
    fireMutation(host, { type: 'characterData', target: textNode, oldValue: 'before' })
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({ type: 'text', from: 'before', to: 'after' })
    unmount()
  })

  // `to` used to be the changed NODE's textContent while `from` came from the
  // first record's oldValue — in a batch touching two nodes, a diff between two
  // unrelated strings. The contenteditable validator in README recipe 15 starts
  // judging one line the moment the user presses Enter.
  it('a multi-node host reports the whole text, not the fragment that changed', () => {
    const events: MutateEvent[] = []
    const { host, unmount } = mount({ mutate: { on: 'text', handler: (e) => events.push(e) } })
    const first = document.createTextNode('line one')
    const second = document.createTextNode(' line two')
    host.append(first, second)
    fireMutation(host, [
      { type: 'childList', target: host, addedNodes: [first, second] },
    ])
    events.length = 0

    // The user edits only the second node.
    second.data = ' LINE TWO'
    fireMutation(host, { type: 'characterData', target: second, oldValue: ' line two' })

    expect(events).toHaveLength(1)
    expect(events[0].from).toBe('line one line two')
    expect(events[0].to).toBe('line one LINE TWO')
  unmount()
  })

  // `<div>{{ msg }}</div>` compiles to `el.textContent = …`, which replaces the
  // text node: a childList mutation. Subscribing to characterData alone meant
  // the single most common Vue text update produced no `text` event at all.
  it('a textContent replacement (childList) is a text event', () => {
    const events: MutateEvent[] = []
    const { host, unmount } = mount({ mutate: { on: 'text', handler: (e) => events.push(e) } })
    const before = document.createTextNode('old')
    host.appendChild(before)
    fireMutation(host, { type: 'childList', target: host, addedNodes: [before] })
    events.length = 0

    host.textContent = 'new'
    fireMutation(host, {
      type: 'childList',
      target: host,
      addedNodes: [host.firstChild!],
      removedNodes: [before],
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'text', from: 'old', to: 'new' })
    unmount()
  })

  it('a childList record that leaves the text unchanged emits no text event', () => {
    const events: MutateEvent[] = []
    const { host, unmount } = mount({ mutate: { on: 'text', handler: (e) => events.push(e) } })
    const el = document.createElement('span')
    host.appendChild(el)
    fireMutation(host, { type: 'childList', target: host, addedNodes: [el] })
    expect(events).toHaveLength(0)
    unmount()
  })

  it('multiple class records in one MO callback collapse to one diff (first.from → last.to)', () => {
    const events: MutateEvent[] = []
    const { host, unmount } = mount({ mutate: { on: 'attr:class', handler: (e) => events.push(e) } })
    fireMutation(host, [
      { type: 'attributes', attributeName: 'class', oldValue: 'a', target: host },
      { type: 'attributes', attributeName: 'class', oldValue: 'b', target: host },
    ])
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('attr:class')
    expect(events[0].from).toBe('a')
    // The actual element's current class attribute is the "to" baseline.
    unmount()
  })

  it('multiple distinct attribute records in one batch emit one diff per (type, name)', () => {
    const events: MutateEvent[] = []
    const { host, unmount } = mount({ mutate: { on: 'attr:*', handler: (e) => events.push(e) } })
    fireMutation(host, [
      { type: 'attributes', attributeName: 'class', oldValue: 'c-old', target: host },
      { type: 'attributes', attributeName: 'style', oldValue: 's-old', target: host },
      { type: 'attributes', attributeName: 'data-foo', oldValue: null, target: host },
    ])
    expect(events).toHaveLength(3)
    const byName = new Map(events.map((e) => [e.name, e]))
    expect(byName.get('class')?.from).toBe('c-old')
    expect(byName.get('style')?.from).toBe('s-old')
    expect(byName.get('data-foo')?.from).toBeNull()
    unmount()
  })

  it('multiple children:added in one batch collapse to one event with all nodes in `added`', () => {
    const events: MutateEvent[] = []
    const { host, unmount } = mount({ mutate: { on: 'children:added', handler: (e) => events.push(e) } })
    const a = document.createElement('div')
    const b = document.createElement('div')
    const c = document.createElement('div')
    fireMutation(host, [
      { type: 'childList', target: host, addedNodes: [a] },
      { type: 'childList', target: host, addedNodes: [b, c] },
    ])
    expect(events).toHaveLength(1)
    expect(events[0].added).toEqual([a, b, c])
    unmount()
  })

  it('non-element nodes (text/comment) in children:added/removed are dropped', () => {
    const events: MutateEvent[] = []
    const { host, unmount } = mount({ mutate: { on: 'children:added', handler: (e) => events.push(e) } })
    const elNode = document.createElement('span')
    const textNode = document.createTextNode('hello')
    const commentNode = document.createComment('comment')
    fireMutation(host, {
      type: 'childList',
      target: host,
      addedNodes: [elNode, textNode, commentNode],
    })
    expect(events).toHaveLength(1)
    expect(events[0].added).toEqual([elNode])
    unmount()
  })

  it('handler is not invoked when `on` does not include the record type', () => {
    const events: MutateEvent[] = []
    const { host, unmount } = mount({ mutate: { on: 'attr:class', handler: (e) => events.push(e) } })
    // Fire a childList record — but we subscribed to attr:class only.
    fireMutation(host, {
      type: 'childList',
      target: host,
      addedNodes: [document.createElement('span')],
    })
    expect(events).toHaveLength(0)
    unmount()
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — Mutate: children:added vs children:removed                  */
/*                                                                      */
/*  `childList: true` in the observer init is what EITHER subscription   */
/*  needs, so the browser hands the directive both directions no matter  */
/*  which one the consumer asked for. Separating them is therefore a     */
/*  DELIVERY-time filter, and these are the tests that watch it: each    */
/*  fires the direction that was not subscribed and asserts silence.     */
/*  Until 0.2.1 both types collapsed into one `childList` flag and every  */
/*  one-sided subscriber got the other half too.                        */
/* ------------------------------------------------------------------ */

describe('mutate: children:added vs children:removed', () => {
  it('children:added only — a removal is NOT delivered', () => {
    const events: MutateEvent[] = []
    const { host, unmount } = mount({
      mutate: { on: 'children:added', handler: (e) => events.push(e) },
    })
    // The init stays correct: one flag covers both directions, by design.
    const init = (moByElement.get(host)![0] as unknown as MockMutationObserver).observed.get(host)
    expect(init?.childList).toBe(true)

    const gone = document.createElement('li')
    fireMutation(host, { type: 'childList', target: host, removedNodes: [gone] })

    expect(events).toEqual([])
    unmount()
  })

  it('children:removed only — an addition is NOT delivered', () => {
    const events: MutateEvent[] = []
    const { host, unmount } = mount({
      mutate: { on: 'children:removed', handler: (e) => events.push(e) },
    })
    const init = (moByElement.get(host)![0] as unknown as MockMutationObserver).observed.get(host)
    expect(init?.childList).toBe(true)

    const fresh = document.createElement('li')
    fireMutation(host, { type: 'childList', target: host, addedNodes: [fresh] })

    expect(events).toEqual([])
    unmount()
  })

  it('children:added only — one record carrying both directions delivers the addition alone', () => {
    // `el.replaceChildren(next)` is a single record with addedNodes AND
    // removedNodes, so the two halves cannot be told apart by record.
    const events: MutateEvent[] = []
    const { host, unmount } = mount({
      mutate: { on: 'children:added', handler: (e) => events.push(e) },
    })
    const gone = document.createElement('li')
    const fresh = document.createElement('li')
    fireMutation(host, {
      type: 'childList',
      target: host,
      addedNodes: [fresh],
      removedNodes: [gone],
    })

    expect(events.map((e) => e.type)).toEqual(['children:added'])
    expect(events[0].added).toEqual([fresh])
    expect(events[0].removed).toBeUndefined()
    unmount()
  })

  it('children:removed only — one record carrying both directions delivers the removal alone', () => {
    const events: MutateEvent[] = []
    const { host, unmount } = mount({
      mutate: { on: 'children:removed', handler: (e) => events.push(e) },
    })
    const gone = document.createElement('li')
    const fresh = document.createElement('li')
    fireMutation(host, {
      type: 'childList',
      target: host,
      addedNodes: [fresh],
      removedNodes: [gone],
    })

    expect(events.map((e) => e.type)).toEqual(['children:removed'])
    expect(events[0].removed).toEqual([gone])
    expect(events[0].added).toBeUndefined()
    unmount()
  })

  it('both subscribed — payloads and data-observe-state are unchanged', () => {
    const events: MutateEvent[] = []
    const { host, unmount } = mount({
      mutate: { on: ['children:added', 'children:removed'], handler: (e) => events.push(e) },
    })
    expect(host.getAttribute('data-observe-state')).toBe('intersect:-;resize:-;mutate:idle')

    const gone = document.createElement('li')
    const fresh = document.createElement('li')
    fireMutation(host, {
      type: 'childList',
      target: host,
      addedNodes: [fresh],
      removedNodes: [gone],
    })

    expect(events.map((e) => e.type)).toEqual(['children:added', 'children:removed'])
    expect(Object.keys(events[0]).sort()).toEqual(['added', 'target', 'type'])
    expect(Object.keys(events[1]).sort()).toEqual(['removed', 'target', 'type'])
    expect(events[0].added).toEqual([fresh])
    expect(events[0].target).toBe(host)
    expect(events[1].removed).toEqual([gone])
    expect(events[1].target).toBe(host)
    expect(host.getAttribute('data-observe-state')).toBe('intersect:-;resize:-;mutate:active')
    unmount()
  })

  it('children:added only, debounced — the removal never reaches the flush', () => {
    vi.useFakeTimers()
    const events: MutateEvent[] = []
    const { host, unmount } = mount({
      mutate: { on: 'children:added', debounce: 100, handler: (e) => events.push(e) },
    })
    const fresh = document.createElement('li')
    const gone = document.createElement('li')
    fireMutation(host, { type: 'childList', target: host, addedNodes: [fresh] })
    fireMutation(host, { type: 'childList', target: host, removedNodes: [gone] })
    vi.advanceTimersByTime(100)

    expect(events.map((e) => e.type)).toEqual(['children:added'])
    expect(events[0].added).toEqual([fresh])
    unmount()
    vi.useRealTimers()
  })

  it('match filters the subscribed direction only — an unsubscribed match is still silent', () => {
    const events: MutateEvent[] = []
    const { host, unmount } = mount({
      mutate: { on: 'children:added', match: '.item', handler: (e) => events.push(e) },
    })
    const goneItem = document.createElement('li')
    goneItem.className = 'item'
    fireMutation(host, { type: 'childList', target: host, removedNodes: [goneItem] })

    expect(events).toEqual([])
    unmount()
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — Mutate: self-removal detection                              */
/* ------------------------------------------------------------------ */

describe('mutate: self-removal detection', () => {
  it('fires "removed" once when the host is removed from its parent', () => {
    const parent = document.createElement('div')
    const host = document.createElement('div')
    parent.appendChild(host)
    document.body.appendChild(parent)
    const events: MutateEvent[] = []

    vObserve.mounted!(
      host,
      { value: { mutate: { on: 'removed', handler: (e: MutateEvent) => events.push(e) } } } as unknown as DirectiveBinding<ObserveOptions | undefined>,
      null as never,
      null as never,
    )

    // Simulate `parent.removeChild(host)`.
    fireMutation(parent, {
      type: 'childList',
      target: parent,
      removedNodes: [host],
    })

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('removed')
    expect(events[0].target).toBe(host)

    vObserve.unmounted!(host, null as never, null as never, null as never)
    parent.remove()
  })

  it('parent.innerHTML = "" fires "removed" once', () => {
    const parent = document.createElement('div')
    const host = document.createElement('div')
    parent.appendChild(host)
    document.body.appendChild(parent)
    const events: MutateEvent[] = []

    vObserve.mounted!(
      host,
      { value: { mutate: { on: 'removed', handler: (e: MutateEvent) => events.push(e) } } } as unknown as DirectiveBinding<ObserveOptions | undefined>,
      null as never,
      null as never,
    )

    fireMutation(parent, {
      type: 'childList',
      target: parent,
      removedNodes: [host],
    })

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('removed')

    vObserve.unmounted!(host, null as never, null as never, null as never)
    parent.remove()
  })

  it('removed others (siblings) do not fire on this host', () => {
    const parent = document.createElement('div')
    const host = document.createElement('div')
    const sibling = document.createElement('div')
    parent.appendChild(host)
    parent.appendChild(sibling)
    document.body.appendChild(parent)
    const events: MutateEvent[] = []

    vObserve.mounted!(
      host,
      { value: { mutate: { on: 'removed', handler: (e: MutateEvent) => events.push(e) } } } as unknown as DirectiveBinding<ObserveOptions | undefined>,
      null as never,
      null as never,
    )

    fireMutation(parent, {
      type: 'childList',
      target: parent,
      removedNodes: [sibling],
    })

    expect(events).toHaveLength(0)

    vObserve.unmounted!(host, null as never, null as never, null as never)
    parent.remove()
  })

  it('"removed" not subscribed → no parent observer + no "removed" event when host is detached', () => {
    const parent = document.createElement('div')
    const host = document.createElement('div')
    parent.appendChild(host)
    document.body.appendChild(parent)
    const events: MutateEvent[] = []

    vObserve.mounted!(
      host,
      { value: { mutate: { on: 'attr:class', handler: (e: MutateEvent) => events.push(e) } } } as unknown as DirectiveBinding<ObserveOptions | undefined>,
      null as never,
      null as never,
    )

    expect(moByElement.has(parent)).toBe(false)
    vObserve.unmounted!(host, null as never, null as never, null as never)
    parent.remove()
  })

  it('parent observer disconnects after firing "removed" once (no double-fire)', () => {
    const parent = document.createElement('div')
    const host = document.createElement('div')
    parent.appendChild(host)
    document.body.appendChild(parent)
    const events: MutateEvent[] = []

    vObserve.mounted!(
      host,
      { value: { mutate: { on: 'removed', handler: (e: MutateEvent) => events.push(e) } } } as unknown as DirectiveBinding<ObserveOptions | undefined>,
      null as never,
      null as never,
    )

    fireMutation(parent, {
      type: 'childList',
      target: parent,
      removedNodes: [host],
    })
    // Second fire of the same record should not double-emit.
    expect(() =>
      fireMutation(parent, {
        type: 'childList',
        target: parent,
        removedNodes: [host],
      }),
    ).toThrow('No MutationObserver attached to element')
    expect(events).toHaveLength(1)

    vObserve.unmounted!(host, null as never, null as never, null as never)
    parent.remove()
  })

  it('detached host (no parent at mount) does not throw and does not attach a parent observer', () => {
    const orphan = document.createElement('div')
    expect(() => {
      vObserve.mounted!(
        orphan,
        { value: { mutate: { on: 'removed', handler: () => {} } } } as unknown as DirectiveBinding<ObserveOptions | undefined>,
        null as never,
        null as never,
      )
    }).not.toThrow()
    expect(moByElement.has(orphan)).toBe(false)
    vObserve.unmounted!(orphan, null as never, null as never, null as never)
  })

  it('"removed" combined with other subscriptions emits both event types correctly', () => {
    const parent = document.createElement('div')
    const host = document.createElement('div')
    parent.appendChild(host)
    document.body.appendChild(parent)
    const events: MutateEvent[] = []

    vObserve.mounted!(
      host,
      { value: { mutate: { on: ['attr:class', 'removed'], handler: (e: MutateEvent) => events.push(e) } } } as unknown as DirectiveBinding<ObserveOptions | undefined>,
      null as never,
      null as never,
    )

    // Attr change → fires via host observer.
    fireMutation(host, {
      type: 'attributes',
      attributeName: 'class',
      oldValue: 'a',
      target: host,
    })
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('attr:class')

    // Self-removal → fires via parent observer.
    fireMutation(parent, {
      type: 'childList',
      target: parent,
      removedNodes: [host],
    })
    expect(events).toHaveLength(2)
    expect(events[1].type).toBe('removed')

    vObserve.unmounted!(host, null as never, null as never, null as never)
    parent.remove()
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — Mutate: selector filter (match)                             */
/* ------------------------------------------------------------------ */

describe('mutate: selector filter (match)', () => {
  it('match: ".item" filters children:added to elements matching the selector', () => {
    const events: MutateEvent[] = []
    const { host, unmount } = mount({
      mutate: { on: 'children:added', match: '.item', handler: (e) => events.push(e) },
    })
    const matching = document.createElement('div')
    matching.className = 'item'
    const nonMatching = document.createElement('div')
    nonMatching.className = 'other'
    fireMutation(host, {
      type: 'childList',
      target: host,
      addedNodes: [matching, nonMatching],
    })
    expect(events).toHaveLength(1)
    expect(events[0].added).toEqual([matching])
    unmount()
  })

  it('match: [".foo", ".bar"] supports multi-match (any selector matches)', () => {
    const events: MutateEvent[] = []
    const { host, unmount } = mount({
      mutate: { on: 'children:added', match: ['.foo', '.bar'], handler: (e) => events.push(e) },
    })
    const foo = document.createElement('div')
    foo.className = 'foo'
    const bar = document.createElement('div')
    bar.className = 'bar'
    const baz = document.createElement('div')
    baz.className = 'baz'
    fireMutation(host, {
      type: 'childList',
      target: host,
      addedNodes: [foo, bar, baz],
    })
    expect(events).toHaveLength(1)
    expect(events[0].added).toEqual([foo, bar])
    unmount()
  })

  it('match applies to children:removed too', () => {
    const events: MutateEvent[] = []
    const { host, unmount } = mount({
      mutate: { on: 'children:removed', match: '.item', handler: (e) => events.push(e) },
    })
    const matching = document.createElement('div')
    matching.className = 'item'
    const nonMatching = document.createElement('div')
    fireMutation(host, {
      type: 'childList',
      target: host,
      removedNodes: [matching, nonMatching],
    })
    expect(events).toHaveLength(1)
    expect(events[0].removed).toEqual([matching])
    unmount()
  })

  it('children:added with no matching nodes drops the event entirely', () => {
    const events: MutateEvent[] = []
    const { host, unmount } = mount({
      mutate: { on: 'children:added', match: '.item', handler: (e) => events.push(e) },
    })
    fireMutation(host, {
      type: 'childList',
      target: host,
      addedNodes: [document.createElement('div')],
    })
    expect(events).toHaveLength(0)
    unmount()
  })

  it('match does not affect attribute events', () => {
    const events: MutateEvent[] = []
    const { host, unmount } = mount({
      mutate: { on: ['attr:class', 'children:added'], match: '.item', handler: (e) => events.push(e) },
    })
    fireMutation(host, {
      type: 'attributes',
      attributeName: 'class',
      oldValue: 'a',
      target: host,
    })
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('attr:class')
    unmount()
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — Mutate: debounce                                            */
/* ------------------------------------------------------------------ */

describe('mutate: debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounce collapses chatty subtree events into one call per window', () => {
    const events: MutateEvent[] = []
    const { host, unmount } = mount({
      mutate: { on: 'children:added', debounce: 100, handler: (e) => events.push(e) },
    })
    const a = document.createElement('div')
    const b = document.createElement('div')
    const c = document.createElement('div')
    fireMutation(host, { type: 'childList', target: host, addedNodes: [a] })
    fireMutation(host, { type: 'childList', target: host, addedNodes: [b] })
    fireMutation(host, { type: 'childList', target: host, addedNodes: [c] })
    expect(events).toHaveLength(0)
    vi.advanceTimersByTime(100)
    expect(events).toHaveLength(1)
    // All three accumulated additions are in the single emitted event.
    expect(events[0].added).toEqual([a, b, c])
    unmount()
  })

  it('settled state at 250ms after last tick = 1 call', () => {
    const events: MutateEvent[] = []
    const { host, unmount } = mount({
      mutate: { on: 'attr:class', debounce: 100, handler: (e) => events.push(e) },
    })
    fireMutation(host, { type: 'attributes', attributeName: 'class', oldValue: 'a', target: host })
    vi.advanceTimersByTime(50)
    fireMutation(host, { type: 'attributes', attributeName: 'class', oldValue: 'b', target: host })
    vi.advanceTimersByTime(50)
    fireMutation(host, { type: 'attributes', attributeName: 'class', oldValue: 'c', target: host })
    vi.advanceTimersByTime(250)
    expect(events).toHaveLength(1)
    // First record's oldValue is preserved as `from`.
    expect(events[0].from).toBe('a')
    unmount()
  })

  it('unmount cancels pending debounce timer', () => {
    const events: MutateEvent[] = []
    const { host, unmount } = mount({
      mutate: { on: 'children:added', debounce: 100, handler: (e) => events.push(e) },
    })
    fireMutation(host, {
      type: 'childList',
      target: host,
      addedNodes: [document.createElement('div')],
    })
    unmount()
    vi.advanceTimersByTime(500)
    expect(events).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — Mutate: data-observe-state segment                          */
/* ------------------------------------------------------------------ */

describe('mutate: data-observe-state segment', () => {
  it('initial value on mount with mutate-only config is `intersect:-;resize:-;mutate:idle`', () => {
    const { host, unmount } = mount({ mutate: { on: 'attr:class', handler: () => {} } })
    expect(host.getAttribute('data-observe-state')).toBe('intersect:-;resize:-;mutate:idle')
    unmount()
  })

  it('after first event dispatch, mutate segment becomes "active"', () => {
    vi.useFakeTimers()
    try {
      const { host, unmount } = mount({ mutate: { on: 'attr:class', handler: () => {} } })
      fireMutation(host, { type: 'attributes', attributeName: 'class', oldValue: 'a', target: host })
      expect(host.getAttribute('data-observe-state')).toBe('intersect:-;resize:-;mutate:active')
      unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('mutate segment falls back to "idle" after the active-cooldown window', () => {
    vi.useFakeTimers()
    try {
      const { host, unmount } = mount({ mutate: { on: 'attr:class', handler: () => {} } })
      fireMutation(host, { type: 'attributes', attributeName: 'class', oldValue: 'a', target: host })
      expect(host.getAttribute('data-observe-state')).toBe('intersect:-;resize:-;mutate:active')
      // The cooldown window is 150ms per the directive convention.
      vi.advanceTimersByTime(150)
      expect(host.getAttribute('data-observe-state')).toBe('intersect:-;resize:-;mutate:idle')
      unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('subsequent events within the cooldown window extend the active state', () => {
    vi.useFakeTimers()
    try {
      const { host, unmount } = mount({ mutate: { on: 'attr:class', handler: () => {} } })
      fireMutation(host, { type: 'attributes', attributeName: 'class', oldValue: 'a', target: host })
      vi.advanceTimersByTime(100)
      fireMutation(host, { type: 'attributes', attributeName: 'class', oldValue: 'b', target: host })
      vi.advanceTimersByTime(100)
      // 200ms after the first event but only 100ms after the second — still active.
      expect(host.getAttribute('data-observe-state')).toBe('intersect:-;resize:-;mutate:active')
      vi.advanceTimersByTime(100)
      // 200ms after the second event — now idle.
      expect(host.getAttribute('data-observe-state')).toBe('intersect:-;resize:-;mutate:idle')
      unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('intersect + mutate together: both segments update independently', () => {
    vi.useFakeTimers()
    try {
      const { host, unmount } = mount({
        intersect: { on: () => {} },
        mutate: { on: 'attr:class', handler: () => {} },
      })
      expect(host.getAttribute('data-observe-state')).toBe('intersect:hidden;resize:-;mutate:idle')
      fire(host, { isIntersecting: true, intersectionRatio: 1 })
      expect(host.getAttribute('data-observe-state')).toBe('intersect:visible;resize:-;mutate:idle')
      fireMutation(host, { type: 'attributes', attributeName: 'class', oldValue: 'a', target: host })
      expect(host.getAttribute('data-observe-state')).toBe('intersect:visible;resize:-;mutate:active')
      unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('attribute is removed on unmount', () => {
    const { host, unmount } = mount({ mutate: { on: 'attr:class', handler: () => {} } })
    expect(host.getAttribute('data-observe-state')).not.toBeNull()
    unmount()
    expect(host.getAttribute('data-observe-state')).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — Mutate: reactive options                                    */
/* ------------------------------------------------------------------ */

describe('mutate: reactive options', () => {
  it('adding mutate mid-life wires up an observer', async () => {
    const { host, setOpts, unmount } = mount({ intersect: { on: () => {} } })
    expect(moByElement.has(host)).toBe(false)
    await setOpts({ intersect: { on: () => {} }, mutate: { on: 'attr:class', handler: () => {} } })
    expect(moByElement.has(host)).toBe(true)
    unmount()
  })

  it('removing mutate mid-life tears down the observer', async () => {
    const { host, setOpts, unmount } = mount({ mutate: { on: 'attr:class', handler: () => {} } })
    expect(moByElement.has(host)).toBe(true)
    await setOpts({})
    expect(moByElement.has(host)).toBe(false)
    expect(host.getAttribute('data-observe-state')).toBe('intersect:-;resize:-;mutate:-')
    unmount()
  })

  it('swapping handler mid-life uses the new callback', async () => {
    const first = vi.fn<(e: MutateEvent) => void>()
    const second = vi.fn<(e: MutateEvent) => void>()
    const { host, setOpts, unmount } = mount({ mutate: { on: 'attr:class', handler: first } })
    fireMutation(host, { type: 'attributes', attributeName: 'class', oldValue: 'a', target: host })
    expect(first).toHaveBeenCalledTimes(1)
    await setOpts({ mutate: { on: 'attr:class', handler: second } })
    fireMutation(host, { type: 'attributes', attributeName: 'class', oldValue: 'b', target: host })
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('swapping `on` mid-life rebuilds the observer with new init config', async () => {
    const { host, setOpts, unmount } = mount({ mutate: { on: 'attr:class', handler: () => {} } })
    const init1 = (moByElement.get(host)![0] as unknown as MockMutationObserver).observed.get(host)
    expect(init1?.attributeFilter).toEqual(['class'])
    await setOpts({ mutate: { on: 'attr:style', handler: () => {} } })
    const init2 = (moByElement.get(host)![0] as unknown as MockMutationObserver).observed.get(host)
    expect(init2?.attributeFilter).toEqual(['style'])
    unmount()
  })

  it('swapping `match` mid-life applies the new selector', async () => {
    const events: MutateEvent[] = []
    const { host, setOpts, unmount } = mount({
      mutate: { on: 'children:added', match: '.foo', handler: (e) => events.push(e) },
    })
    const foo = document.createElement('div')
    foo.className = 'foo'
    const bar = document.createElement('div')
    bar.className = 'bar'

    fireMutation(host, { type: 'childList', target: host, addedNodes: [foo, bar] })
    expect(events).toHaveLength(1)
    expect(events[0].added).toEqual([foo])

    await setOpts({
      mutate: { on: 'children:added', match: '.bar', handler: (e) => events.push(e) },
    })

    fireMutation(host, { type: 'childList', target: host, addedNodes: [foo, bar] })
    expect(events).toHaveLength(2)
    expect(events[1].added).toEqual([bar])

    unmount()
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — Resize: breakpoint edge cases                              */
/* ------------------------------------------------------------------ */

describe('resize: breakpoint edge cases', () => {
  it('empty array breakpoints behaves like no breakpoints (bracket = null, segment = active)', () => {
    const events: ResizeEvent[] = []
    const { host, unmount } = mount({
      resize: {
        on: 'tick',
        breakpoints: [],
        handler: (e) => events.push(e),
      },
    })
    fireResize(host, { width: 500, height: 500 })
    expect(events).toHaveLength(1)
    if (events[0].mode === 'tick') {
      expect(events[0].bracket).toBeNull()
    }
    // segment writes 'active' (sentinel for no-breakpoints + non-orientation mode)
    expect(host.getAttribute('data-observe-state')).toContain('resize:active')
    expect(host.getAttribute('data-observe-state')).not.toContain('<undefined')
    expect(host.getAttribute('data-observe-state')).not.toContain('>=undefined')
    unmount()
  })

  it('empty object breakpoints behaves like no breakpoints', () => {
    const events: ResizeEvent[] = []
    const { host, unmount } = mount({
      resize: {
        on: 'tick',
        breakpoints: {},
        handler: (e) => events.push(e),
      },
    })
    fireResize(host, { width: 500, height: 500 })
    if (events[0]?.mode === 'tick') {
      expect(events[0].bracket).toBeNull()
    }
    expect(host.getAttribute('data-observe-state')).toContain('resize:active')
    unmount()
  })

  it('crossed mode with empty array breakpoints fires zero events (no thresholds to cross)', () => {
    const events: ResizeEvent[] = []
    const { host, unmount } = mount({
      resize: {
        on: 'crossed',
        breakpoints: [],
        handler: (e) => events.push(e),
      },
    })
    fireResize(host, { width: 200, height: 200 })
    fireResize(host, { width: 800, height: 800 })
    expect(events).toHaveLength(0)
    unmount()
  })

  it('single-threshold array yields two labels: "<n" and ">=n"', () => {
    const events: ResizeEvent[] = []
    const { host, unmount } = mount({
      resize: {
        on: 'tick',
        breakpoints: [500],
        handler: (e) => events.push(e),
      },
    })
    fireResize(host, { width: 200, height: 200 })
    if (events[0]?.mode === 'tick') expect(events[0].bracket).toBe('<500')
    fireResize(host, { width: 800, height: 200 })
    if (events[1]?.mode === 'tick') expect(events[1].bracket).toBe('>=500')
    unmount()
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — Resize: orientation edge cases                              */
/* ------------------------------------------------------------------ */

describe('resize: orientation edge cases', () => {
  it('a degenerate box reports orientation null — an absent measurement, not a square one', () => {
    const events: ResizeTickEvent[] = []
    const { host, unmount } = mount({
      resize: { on: 'tick', handler: (e) => { if (e.mode === 'tick') events.push(e) } },
    })
    fireResize(host, { width: 0, height: 100 })
    expect(events[0].orientation).toBeNull()
    fireResize(host, { width: 100, height: 0 })
    expect(events[1].orientation).toBeNull()
    unmount()
  })

  it('squareTolerance > 0 with exact equality still reports square', () => {
    const events: ResizeEvent[] = []
    const { host, unmount } = mount({
      resize: {
        on: 'tick',
        squareTolerance: 0.05,
        handler: (e) => events.push(e),
      },
    })
    fireResize(host, { width: 400, height: 400 })
    if (events[0]?.mode === 'tick') expect(events[0].orientation).toBe('square')
    unmount()
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — Resize: box modes — final fallback                         */
/* ------------------------------------------------------------------ */

describe('resize: box modes — contentRect fallback', () => {
  it('box:"device-pixel" with no devicePixelContentBoxSize and no contentBoxSize falls back to contentRect', () => {
    const events: ResizeEvent[] = []
    const { host, unmount } = mount({
      resize: { box: 'device-pixel', handler: (e) => events.push(e) },
    })
    // Manually fire an entry without contentBoxSize at all
    const list = roByElement.get(host)
    expect(list).toBeDefined()
    const ro = list![0] as unknown as MockResizeObserver
    const entry = {
      target: host,
      contentRect: mkRect({ width: 123, height: 456 }),
      borderBoxSize: undefined as unknown as ReadonlyArray<ResizeObserverSize>,
      contentBoxSize: undefined as unknown as ReadonlyArray<ResizeObserverSize>,
      devicePixelContentBoxSize: undefined as unknown as ReadonlyArray<ResizeObserverSize>,
    } as unknown as ResizeObserverEntry
    ro.callback([entry], ro as unknown as ResizeObserver)
    expect(events).toHaveLength(1)
    if (events[0].mode === 'tick') {
      expect(events[0].to).toEqual({ width: 123, height: 456 })
    }
    unmount()
  })

  it('reactive `box` swap takes effect on the next tick (box read at callback time)', async () => {
    const events: ResizeEvent[] = []
    const { host, setOpts, unmount } = mount({
      resize: { box: 'border', handler: (e) => events.push(e) },
    })
    fireResize(host, {
      width: 100,
      height: 100,
      borderBox: { width: 100, height: 100 },
      contentBox: { width: 80, height: 80 },
    })
    if (events[0]?.mode === 'tick') {
      expect(events[0].to).toEqual({ width: 100, height: 100 })
    }
    await setOpts({ resize: { box: 'content', handler: (e) => events.push(e) } })
    fireResize(host, {
      width: 100,
      height: 100,
      borderBox: { width: 100, height: 100 },
      contentBox: { width: 80, height: 80 },
    })
    if (events[1]?.mode === 'tick') {
      expect(events[1].to).toEqual({ width: 80, height: 80 })
    }
    // …and the observed box moved with it, or the swap only changed what is
    // reported and not what is watched.
    expect(observeCallsFor(host).map((c) => c.options?.box)).toEqual(['border-box', 'content-box'])
    unmount()
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — Resize: `box` decides what is OBSERVED, not only what is read */
/*                                                                      */
/*  `observe(el)` was called with no second argument, so the observed    */
/*  box was always content-box. That is what decides WHEN a callback     */
/*  fires: `device-pixel` exists to catch a devicePixelRatio change,     */
/*  which produces no content-box change at all, so the one job the      */
/*  option has was the one it could not do.                              */
/* ------------------------------------------------------------------ */

describe('resize: the `box` option reaches observe()', () => {
  it('default border → observe(el, { box: "border-box" })', () => {
    const { host, unmount } = mount({ resize: { handler: () => {} } })
    expect(observeCallsFor(host)).toEqual([{ el: host, options: { box: 'border-box' } }])
    unmount()
  })

  it('content → observe(el, { box: "content-box" })', () => {
    const { host, unmount } = mount({ resize: { box: 'content', handler: () => {} } })
    expect(observeCallsFor(host)[0].options).toEqual({ box: 'content-box' })
    unmount()
  })

  it('device-pixel → observe(el, { box: "device-pixel-content-box" })', () => {
    const { host, unmount } = mount({ resize: { box: 'device-pixel', handler: () => {} } })
    expect(observeCallsFor(host)[0].options).toEqual({ box: 'device-pixel-content-box' })
    unmount()
  })

  it('an engine that rejects device-pixel-content-box degrades to content-box rather than throwing', () => {
    MockResizeObserver.rejectBoxes.add('device-pixel-content-box')
    const { host, unmount } = mount({ resize: { box: 'device-pixel', handler: () => {} } })
    expect(observeCallsFor(host).map((c) => c.options?.box)).toEqual(['content-box'])
    unmount()
  })

  it('re-observes exactly once per box change, and not at all when the box is unchanged', async () => {
    const { host, setOpts, unmount } = mount({ resize: { box: 'border', handler: () => {} } })
    await setOpts({ resize: { box: 'border', debounce: 10, handler: () => {} } })
    expect(observeCallsFor(host)).toHaveLength(1)
    await setOpts({ resize: { box: 'device-pixel', debounce: 10, handler: () => {} } })
    expect(observeCallsFor(host).map((c) => c.options?.box)).toEqual([
      'border-box',
      'device-pixel-content-box',
    ])
    unmount()
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — Mutate: shape rebuild on reactive `on` swap                */
/* ------------------------------------------------------------------ */

describe('mutate: shape rebuilds on reactive `on` swap', () => {
  it('swap from "attr:class" to "removed" drops the host observer and attaches a parent observer', async () => {
    const { host, setOpts, unmount } = mount({
      mutate: { on: 'attr:class', handler: () => {} },
    })
    expect(moByElement.has(host)).toBe(true)
    const parent = host.parentNode as Node
    expect(moByElement.has(parent)).toBe(false)

    await setOpts({ mutate: { on: 'removed', handler: () => {} } })

    // After swap: host observer dropped, parent observer attached
    expect(moByElement.has(host)).toBe(false)
    expect(moByElement.has(parent)).toBe(true)
    unmount()
  })

  it('swap from "removed" to "attr:class" drops parent observer and reattaches host observer', async () => {
    const { host, setOpts, unmount } = mount({
      mutate: { on: 'removed', handler: () => {} },
    })
    const parent = host.parentNode as Node
    expect(moByElement.has(host)).toBe(false)
    expect(moByElement.has(parent)).toBe(true)

    await setOpts({ mutate: { on: 'attr:class', handler: () => {} } })

    expect(moByElement.has(host)).toBe(true)
    expect(moByElement.has(parent)).toBe(false)
    unmount()
  })

  it('swap from [`attr:class`] to [`children:added`] disconnects the prior host observer', async () => {
    const { host, setOpts, unmount } = mount({
      mutate: { on: 'attr:class', handler: () => {} },
    })
    const observersBefore = moByElement.get(host)!.length
    expect(observersBefore).toBe(1)

    await setOpts({ mutate: { on: 'children:added', handler: () => {} } })

    // Same host should still hold exactly one observer (the new one), not two.
    expect(moByElement.get(host)!.length).toBe(1)
    const init = (moByElement.get(host)![0] as unknown as MockMutationObserver).observed.get(host)
    expect(init?.childList).toBe(true)
    expect(init?.attributeFilter).toBeUndefined()
    unmount()
  })

  it('adding mutate mid-life sets segment from `-` to `idle`', async () => {
    const { host, setOpts, unmount } = mount({
      intersect: { on: () => {} },
    })
    expect(host.getAttribute('data-observe-state')).toContain('mutate:-')

    await setOpts({
      intersect: { on: () => {} },
      mutate: { on: 'attr:class', handler: () => {} },
    })
    expect(host.getAttribute('data-observe-state')).toContain('mutate:idle')
    unmount()
  })

  it('removing mutate mid-life resets segment to `-`', async () => {
    const { host, setOpts, unmount } = mount({
      mutate: { on: 'attr:class', handler: () => {} },
    })
    fireMutation(host, { type: 'attributes', attributeName: 'class', oldValue: 'a', target: host })
    expect(host.getAttribute('data-observe-state')).toContain('mutate:active')

    await setOpts({})
    expect(host.getAttribute('data-observe-state')).toContain('mutate:-')
    expect(moByElement.has(host)).toBe(false)
    unmount()
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — Mutate: invalid selector resilience                        */
/* ------------------------------------------------------------------ */

// An unparseable selector used to be swallowed per-selector, so a one-character
// typo left the mode permanently and silently dead: events were built, filtered
// to empty, and dropped. There is no console warn anywhere in this package, so
// absence was the consumer's only signal. It is now a bind-time throw, at the
// line where the mistake was made.
describe('mutate: an unparseable `match` selector', () => {
  it('throws at bind time, naming the selector', () => {
    expect(() =>
      mount({ mutate: { on: 'children:added', match: '>>>invalid<<<', handler: () => {} } }),
    ).toThrow(/v-observe.*match.*>>>invalid<<</s)
  })

  it('throws even when a valid selector sits beside it in the array', () => {
    expect(() =>
      mount({
        mutate: { on: 'children:added', match: ['.valid', '>>>invalid<<<'], handler: () => {} },
      }),
    ).toThrow(/v-observe/)
  })

  it('a valid selector list still filters', () => {
    const events: MutateEvent[] = []
    const { host, unmount } = mount({
      mutate: {
        on: 'children:added',
        match: ['.valid', 'li[data-x]'],
        handler: (e) => events.push(e),
      },
    })
    const hit = document.createElement('div')
    hit.className = 'valid'
    const miss = document.createElement('div')
    fireMutation(host, { type: 'childList', target: host, addedNodes: [hit, miss] })
    expect(events).toHaveLength(1)
    expect(events[0].added).toEqual([hit])
    unmount()
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — Tri-mode interaction: intersect + resize + mutate          */
/* ------------------------------------------------------------------ */

describe('tri-mode interaction (intersect + resize + mutate)', () => {
  it('all three segments update independently and the attribute reflects every flip', () => {
    const { host, unmount } = mount({
      intersect: { on: () => {} },
      resize: { handler: () => {}, breakpoints: [320, 640] },
      mutate: { on: 'attr:class', handler: () => {} },
    })
    // initial: intersect:hidden;resize:idle;mutate:idle
    expect(host.getAttribute('data-observe-state')).toBe(
      'intersect:hidden;resize:idle;mutate:idle',
    )
    // resize tick → resize segment flips to bracket label
    fireResize(host, { width: 500, height: 500 })
    expect(host.getAttribute('data-observe-state')).toBe(
      'intersect:hidden;resize:320-640;mutate:idle',
    )
    // intersect transition → intersect flips to visible
    fire(host, { isIntersecting: true, intersectionRatio: 1, boundingClientRect: mkRect({ top: 0 }) })
    expect(host.getAttribute('data-observe-state')).toBe(
      'intersect:visible;resize:320-640;mutate:idle',
    )
    // mutate → mutate flips to active
    fireMutation(host, { type: 'attributes', attributeName: 'class', oldValue: 'a', target: host })
    expect(host.getAttribute('data-observe-state')).toBe(
      'intersect:visible;resize:320-640;mutate:active',
    )
    unmount()
  })

  it('teardown of one mode does not clobber sibling segments', async () => {
    const { host, setOpts, unmount } = mount({
      intersect: { on: () => {} },
      resize: { handler: () => {}, breakpoints: [320, 640] },
      mutate: { on: 'attr:class', handler: () => {} },
    })
    fireResize(host, { width: 500, height: 500 })
    fire(host, { isIntersecting: true, intersectionRatio: 1, boundingClientRect: mkRect({ top: 0 }) })
    fireMutation(host, { type: 'attributes', attributeName: 'class', oldValue: 'a', target: host })

    // drop resize only — intersect:visible and mutate:active must remain
    await setOpts({
      intersect: { on: () => {} },
      mutate: { on: 'attr:class', handler: () => {} },
    })
    const attr = host.getAttribute('data-observe-state')!
    expect(attr).toContain('intersect:visible')
    expect(attr).toContain('resize:-')
    expect(attr).toContain('mutate:active')
    unmount()
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — Cross-observer `gateOnIntersect` runtime gating            */
/* ------------------------------------------------------------------ */

describe('cross-observer gateOnIntersect runtime gating — resize', () => {
  it('does not fire resize handler before intersect ever reports visible (default hidden)', () => {
    const tickEvents: ResizeEvent[] = []
    const { host, unmount } = mount({
      intersect: { on: () => {} },
      resize: { gateOnIntersect: true, handler: (e) => tickEvents.push(e) },
    })
    // No IO fire yet → state is hidden.
    fireResize(host, { width: 500, height: 400 })
    expect(tickEvents).toHaveLength(0)
    // segment stays at 'idle' (no dispatch happened)
    expect(host.getAttribute('data-observe-state')).toBe('intersect:hidden;resize:idle;mutate:-')
    unmount()
  })

  it('fires resize handler after intersect reports visible', () => {
    const tickEvents: ResizeEvent[] = []
    const { host, unmount } = mount({
      intersect: { on: () => {} },
      resize: { gateOnIntersect: true, handler: (e) => tickEvents.push(e) },
    })
    fire(host, { isIntersecting: true, intersectionRatio: 1, boundingClientRect: mkRect({ top: 0 }) })
    fireResize(host, { width: 500, height: 400 })
    expect(tickEvents).toHaveLength(1)
    expect(tickEvents[0]).toMatchObject({ mode: 'tick', from: null, to: { width: 500, height: 400 } })
    unmount()
  })

  it('stops dispatching resize once intersect flips back to hidden', () => {
    const tickEvents: ResizeEvent[] = []
    const { host, unmount } = mount({
      intersect: { on: () => {} },
      resize: { gateOnIntersect: true, handler: (e) => tickEvents.push(e) },
    })
    fire(host, { isIntersecting: true, intersectionRatio: 1, boundingClientRect: mkRect({ top: 0 }) })
    fireResize(host, { width: 500, height: 400 })
    expect(tickEvents).toHaveLength(1)
    fire(host, { isIntersecting: false, intersectionRatio: 0, boundingClientRect: mkRect({ top: 0 }) })
    fireResize(host, { width: 600, height: 400 })
    fireResize(host, { width: 700, height: 400 })
    expect(tickEvents).toHaveLength(1) // gated; no new dispatches
    unmount()
  })

  it('resets resize baseline on hidden→visible transition (first post-restore tick has from:null)', () => {
    const tickEvents: ResizeTickEvent[] = []
    const { host, unmount } = mount({
      intersect: { on: () => {} },
      resize: { gateOnIntersect: true, handler: (e) => tickEvents.push(e as ResizeTickEvent) },
    })
    // visible: first tick + second tick
    fire(host, { isIntersecting: true, intersectionRatio: 1, boundingClientRect: mkRect({ top: 0 }) })
    fireResize(host, { width: 500, height: 400 })
    fireResize(host, { width: 600, height: 400 })
    expect(tickEvents).toHaveLength(2)
    expect(tickEvents[1].from).toEqual({ width: 500, height: 400 })

    // hidden: dispatches gated
    fire(host, { isIntersecting: false, intersectionRatio: 0, boundingClientRect: mkRect({ top: 0 }) })
    fireResize(host, { width: 1200, height: 800 }) // gated; dropped
    expect(tickEvents).toHaveLength(2)

    // visible again: baseline reset → first post-restore tick has from:null
    fire(host, { isIntersecting: true, intersectionRatio: 1, boundingClientRect: mkRect({ top: 0 }) })
    fireResize(host, { width: 1300, height: 800 })
    expect(tickEvents).toHaveLength(3)
    expect(tickEvents[2].from).toBeNull()
    expect(tickEvents[2].to).toEqual({ width: 1300, height: 800 })
    unmount()
  })

  it('resize crossed mode: no missed crossings emitted on hidden→visible', () => {
    const crossings: ResizeBracketEvent[] = []
    const { host, unmount } = mount({
      intersect: { on: () => {} },
      resize: {
        gateOnIntersect: true,
        on: 'crossed',
        breakpoints: [320, 640, 960],
        handler: (e) => crossings.push(e as ResizeBracketEvent),
      },
    })
    // visible: baseline at <320
    fire(host, { isIntersecting: true, intersectionRatio: 1, boundingClientRect: mkRect({ top: 0 }) })
    fireResize(host, { width: 200, height: 200 })
    expect(crossings).toHaveLength(0) // first tick from null → no baseline

    // hidden: cross 320 silently → 700 → 1000 → 500
    fire(host, { isIntersecting: false, intersectionRatio: 0, boundingClientRect: mkRect({ top: 0 }) })
    fireResize(host, { width: 700, height: 200 })
    fireResize(host, { width: 1000, height: 200 })
    fireResize(host, { width: 500, height: 200 })
    expect(crossings).toHaveLength(0) // gated

    // visible again: baseline reset → 500 is the new from:null
    fire(host, { isIntersecting: true, intersectionRatio: 1, boundingClientRect: mkRect({ top: 0 }) })
    fireResize(host, { width: 500, height: 200 })
    expect(crossings).toHaveLength(0) // first tick post-restore = no baseline

    // From 500 (320-640) to 700 (640-960) crosses the 640 threshold once.
    fireResize(host, { width: 700, height: 200 })
    expect(crossings).toEqual([
      { mode: 'crossed', axis: 'width', threshold: 640, direction: 'up', bracket: '640-960', from: { width: 500, height: 200 }, to: { width: 700, height: 200 } },
    ])
    unmount()
  })

  it('resize segment does NOT update while gated (stays at initial idle)', () => {
    const { host, unmount } = mount({
      intersect: { on: () => {} },
      resize: { gateOnIntersect: true, breakpoints: [320, 640], handler: () => {} },
    })
    // hidden by default
    expect(host.getAttribute('data-observe-state')).toBe('intersect:hidden;resize:idle;mutate:-')
    fireResize(host, { width: 500, height: 200 })
    // segment unchanged
    expect(host.getAttribute('data-observe-state')).toBe('intersect:hidden;resize:idle;mutate:-')
    unmount()
  })

  it('resize segment updates again after restore', () => {
    const { host, unmount } = mount({
      intersect: { on: () => {} },
      resize: { gateOnIntersect: true, breakpoints: [320, 640], handler: () => {} },
    })
    fire(host, { isIntersecting: true, intersectionRatio: 1, boundingClientRect: mkRect({ top: 0 }) })
    fireResize(host, { width: 500, height: 200 })
    expect(host.getAttribute('data-observe-state')).toBe('intersect:visible;resize:320-640;mutate:-')
    unmount()
  })

  it('resize debounce: timer does not spin while gated (no dispatch when timer fires)', () => {
    vi.useFakeTimers()
    const tickEvents: ResizeEvent[] = []
    const { host, unmount } = mount({
      intersect: { on: () => {} },
      resize: { gateOnIntersect: true, debounce: 100, handler: (e) => tickEvents.push(e) },
    })
    // hidden → RO callback gated entirely → no timer scheduled
    fireResize(host, { width: 500, height: 200 })
    fireResize(host, { width: 600, height: 200 })
    vi.advanceTimersByTime(200)
    expect(tickEvents).toHaveLength(0)
    vi.useRealTimers()
    unmount()
  })

  it('reactive toggle: setting gateOnIntersect=false mid-life resumes dispatch immediately', async () => {
    const tickEvents: ResizeEvent[] = []
    const { host, setOpts, unmount } = mount({
      intersect: { on: () => {} },
      resize: { gateOnIntersect: true, handler: (e) => tickEvents.push(e) },
    })
    fireResize(host, { width: 500, height: 200 })
    expect(tickEvents).toHaveLength(0) // gated
    await setOpts({
      intersect: { on: () => {} },
      resize: { gateOnIntersect: false, handler: (e) => tickEvents.push(e) },
    })
    fireResize(host, { width: 600, height: 200 })
    expect(tickEvents).toHaveLength(1)
    unmount()
  })

  it('reactive toggle: setting gateOnIntersect=true on a visible host keeps dispatching, then gates on hide', async () => {
    const tickEvents: ResizeEvent[] = []
    const { host, setOpts, unmount } = mount({
      intersect: { on: () => {} },
      resize: { handler: (e) => tickEvents.push(e) },
    })
    fire(host, { isIntersecting: true, intersectionRatio: 1, boundingClientRect: mkRect({ top: 0 }) })
    fireResize(host, { width: 500, height: 200 })
    expect(tickEvents).toHaveLength(1)
    await setOpts({
      intersect: { on: () => {} },
      resize: { gateOnIntersect: true, handler: (e) => tickEvents.push(e) },
    })
    fireResize(host, { width: 600, height: 200 })
    expect(tickEvents).toHaveLength(2) // still visible → dispatch
    fire(host, { isIntersecting: false, intersectionRatio: 0, boundingClientRect: mkRect({ top: 0 }) })
    fireResize(host, { width: 700, height: 200 })
    expect(tickEvents).toHaveLength(2) // gated
    unmount()
  })

  it('graceful degradation: IntersectionObserver undefined → gateOnIntersect becomes a no-op (handler fires)', () => {
    uninstallIOMock()
    try {
      const tickEvents: ResizeEvent[] = []
      const { host, unmount } = mount({
        intersect: { on: () => {} }, // does not wire up since IO is undefined
        resize: { gateOnIntersect: true, handler: (e) => tickEvents.push(e) },
      })
      fireResize(host, { width: 500, height: 200 })
      expect(tickEvents).toHaveLength(1)
      unmount()
    } finally {
      installIOMock() // restore for next test
    }
  })

  it('resize orientation mode: gated flips are not delivered; the baseline resets on restore', () => {
    const events: ResizeOrientationEvent[] = []
    const { host, unmount } = mount({
      intersect: { on: () => {} },
      resize: {
        gateOnIntersect: true,
        on: 'orientation',
        handler: (e) => { if (e.mode === 'orientation') events.push(e) },
      },
    })
    // visible: the first measurable orientation is itself an event.
    fire(host, { isIntersecting: true, intersectionRatio: 1, boundingClientRect: mkRect({ top: 0 }) })
    fireResize(host, { width: 300, height: 600 }) // portrait
    expect(events.map((e) => `${e.from}→${e.to}`)).toEqual(['null→portrait'])
    fireResize(host, { width: 800, height: 300 }) // landscape → flip
    expect(events.map((e) => `${e.from}→${e.to}`)).toEqual(['null→portrait', 'portrait→landscape'])

    // hidden: silently flip back to portrait
    fire(host, { isIntersecting: false, intersectionRatio: 0, boundingClientRect: mkRect({ top: 0 }) })
    fireResize(host, { width: 300, height: 600 })
    expect(events).toHaveLength(2) // gated

    // visible again: the baseline was forgotten, so the consumer is told what
    // the orientation IS rather than being handed a flip from a stale value
    // it never saw ('landscape → portrait' would be a lie about the interim).
    fire(host, { isIntersecting: true, intersectionRatio: 1, boundingClientRect: mkRect({ top: 0 }) })
    fireResize(host, { width: 300, height: 600 })
    expect(events.at(-1)).toMatchObject({ from: null, to: 'portrait' })
    fireResize(host, { width: 800, height: 300 })
    expect(events.at(-1)).toMatchObject({ from: 'portrait', to: 'landscape' })
    expect(events).toHaveLength(4)
    unmount()
  })
})

describe('cross-observer gateOnIntersect runtime gating — mutate', () => {
  it('does not fire mutate handler before intersect reports visible', () => {
    const events: MutateEvent[] = []
    const { host, unmount } = mount({
      intersect: { on: () => {} },
      mutate: { gateOnIntersect: true, on: 'attr:class', handler: (e) => events.push(e) },
    })
    fireMutation(host, { type: 'attributes', attributeName: 'class', oldValue: 'a', target: host })
    expect(events).toHaveLength(0)
    expect(host.getAttribute('data-observe-state')).toBe('intersect:hidden;resize:-;mutate:idle')
    unmount()
  })

  it('fires mutate handler after intersect reports visible', () => {
    const events: MutateEvent[] = []
    const { host, unmount } = mount({
      intersect: { on: () => {} },
      mutate: { gateOnIntersect: true, on: 'attr:class', handler: (e) => events.push(e) },
    })
    fire(host, { isIntersecting: true, intersectionRatio: 1, boundingClientRect: mkRect({ top: 0 }) })
    host.setAttribute('class', 'b')
    fireMutation(host, { type: 'attributes', attributeName: 'class', oldValue: 'a', target: host })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'attr:class', from: 'a', to: 'b' })
    unmount()
  })

  it('gates childList events while hidden', () => {
    const events: MutateEvent[] = []
    const { host, unmount } = mount({
      intersect: { on: () => {} },
      mutate: { gateOnIntersect: true, on: 'children:added', handler: (e) => events.push(e) },
    })
    const child = document.createElement('div')
    fireMutation(host, { type: 'childList', target: host, addedNodes: [child] })
    expect(events).toHaveLength(0)
    unmount()
  })

  it('removed events BYPASS the gate (terminal event)', () => {
    const events: MutateEvent[] = []
    const { host, unmount } = mount({
      intersect: { on: () => {} },
      mutate: { gateOnIntersect: true, on: 'removed', handler: (e) => events.push(e) },
    })
    // hidden by default
    const parent = host.parentNode! as HTMLElement
    fireMutation(parent, { type: 'childList', target: parent, removedNodes: [host] })
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('removed')
    unmount()
  })

  it('mutate segment does NOT flip to active while gated', () => {
    const { host, unmount } = mount({
      intersect: { on: () => {} },
      mutate: { gateOnIntersect: true, on: 'attr:class', handler: () => {} },
    })
    fireMutation(host, { type: 'attributes', attributeName: 'class', oldValue: 'a', target: host })
    expect(host.getAttribute('data-observe-state')).toBe('intersect:hidden;resize:-;mutate:idle')
    unmount()
  })

  it('mutate segment flips to active after visible restore', () => {
    const { host, unmount } = mount({
      intersect: { on: () => {} },
      mutate: { gateOnIntersect: true, on: 'attr:class', handler: () => {} },
    })
    fire(host, { isIntersecting: true, intersectionRatio: 1, boundingClientRect: mkRect({ top: 0 }) })
    fireMutation(host, { type: 'attributes', attributeName: 'class', oldValue: 'a', target: host })
    expect(host.getAttribute('data-observe-state')).toBe('intersect:visible;resize:-;mutate:active')
    unmount()
  })

  it('mutate debounce: pending events accumulated while gated are dropped on visible restore', async () => {
    vi.useFakeTimers()
    const events: MutateEvent[] = []
    const { host, unmount } = mount({
      intersect: { on: () => {} },
      mutate: { gateOnIntersect: true, debounce: 100, on: 'attr:class', handler: (e) => events.push(e) },
    })
    fireMutation(host, { type: 'attributes', attributeName: 'class', oldValue: 'a', target: host })
    vi.advanceTimersByTime(50)
    fire(host, { isIntersecting: true, intersectionRatio: 1, boundingClientRect: mkRect({ top: 0 }) })
    vi.advanceTimersByTime(200)
    expect(events).toHaveLength(0) // all events dropped on restore
    // post-restore mutation should fire normally
    host.setAttribute('class', 'c')
    fireMutation(host, { type: 'attributes', attributeName: 'class', oldValue: 'b', target: host })
    vi.advanceTimersByTime(150)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'attr:class', from: 'b', to: 'c' })
    vi.useRealTimers()
    unmount()
  })

  it('graceful degradation: MutationObserver works without intersect IO present (IO undefined)', () => {
    uninstallIOMock()
    try {
      const events: MutateEvent[] = []
      const { host, unmount } = mount({
        intersect: { on: () => {} },
        mutate: { gateOnIntersect: true, on: 'attr:class', handler: (e) => events.push(e) },
      })
      host.setAttribute('class', 'b')
      fireMutation(host, { type: 'attributes', attributeName: 'class', oldValue: 'a', target: host })
      expect(events).toHaveLength(1)
      unmount()
    } finally {
      installIOMock()
    }
  })

  it('reactive toggle: gateOnIntersect=true → false resumes mutate dispatch', async () => {
    const events: MutateEvent[] = []
    const { host, setOpts, unmount } = mount({
      intersect: { on: () => {} },
      mutate: { gateOnIntersect: true, on: 'attr:class', handler: (e) => events.push(e) },
    })
    fireMutation(host, { type: 'attributes', attributeName: 'class', oldValue: 'a', target: host })
    expect(events).toHaveLength(0)
    await setOpts({
      intersect: { on: () => {} },
      mutate: { gateOnIntersect: false, on: 'attr:class', handler: (e) => events.push(e) },
    })
    host.setAttribute('class', 'c')
    fireMutation(host, { type: 'attributes', attributeName: 'class', oldValue: 'b', target: host })
    expect(events).toHaveLength(1)
    unmount()
  })
})

describe('cross-observer gateOnIntersect — interactions with intersect `once: true`', () => {
  // `once` disconnects the observer after the first visible tick, and a gate
  // with no live observer stops gating: the combination used to suppress work
  // until the element was first seen and then never again, including after it
  // scrolled far off-screen. Two options whose documented meanings cancel each
  // other out are a config error, so they are refused where they were written.
  it('once + gateOnIntersect is refused at bind time', () => {
    expect(() =>
      mount({
        intersect: { once: true, on: () => {} },
        resize: { gateOnIntersect: true, handler: () => {} },
      }),
    ).toThrow(/v-observe.*gateOnIntersect.*once/s)

    expect(() =>
      mount({
        intersect: { once: true },
        mutate: { gateOnIntersect: true, on: 'attr:class', handler: () => {} },
      }),
    ).toThrow(/v-observe.*gateOnIntersect.*once/s)
  })

  it('intersect-only consumer (no `on`) can still drive gating for resize', () => {
    const tickEvents: ResizeEvent[] = []
    const { host, unmount } = mount({
      intersect: {}, // no `on`, no `crossed` — pure gating signal
      resize: { gateOnIntersect: true, handler: (e) => tickEvents.push(e) },
    })
    // hidden by default
    fireResize(host, { width: 500, height: 400 })
    expect(tickEvents).toHaveLength(0)
    // intersect→visible un-gates without any user-facing intersect handler
    fire(host, { isIntersecting: true, intersectionRatio: 1, boundingClientRect: mkRect({ top: 0 }) })
    fireResize(host, { width: 600, height: 400 })
    expect(tickEvents).toHaveLength(1)
    unmount()
  })

  it('two gated modes share the same intersect: both gate together and restore together', () => {
    const tickEvents: ResizeEvent[] = []
    const mutateEvents: MutateEvent[] = []
    const { host, unmount } = mount({
      intersect: { on: () => {} },
      resize: { gateOnIntersect: true, handler: (e) => tickEvents.push(e) },
      mutate: { gateOnIntersect: true, on: 'attr:class', handler: (e) => mutateEvents.push(e) },
    })
    // hidden
    fireResize(host, { width: 500, height: 400 })
    fireMutation(host, { type: 'attributes', attributeName: 'class', oldValue: 'a', target: host })
    expect(tickEvents).toHaveLength(0)
    expect(mutateEvents).toHaveLength(0)

    // restore — both un-gate
    fire(host, { isIntersecting: true, intersectionRatio: 1, boundingClientRect: mkRect({ top: 0 }) })
    fireResize(host, { width: 600, height: 400 })
    fireMutation(host, { type: 'attributes', attributeName: 'class', oldValue: 'a', target: host })
    expect(tickEvents).toHaveLength(1)
    expect(mutateEvents).toHaveLength(1)
    unmount()
  })

  it('mixed: only resize gated, mutate ungated — mutate fires while intersect is hidden', () => {
    const tickEvents: ResizeEvent[] = []
    const mutateEvents: MutateEvent[] = []
    const { host, unmount } = mount({
      intersect: { on: () => {} },
      resize: { gateOnIntersect: true, handler: (e) => tickEvents.push(e) },
      mutate: { on: 'attr:class', handler: (e) => mutateEvents.push(e) }, // not gated
    })
    fireResize(host, { width: 500, height: 400 })
    fireMutation(host, { type: 'attributes', attributeName: 'class', oldValue: 'a', target: host })
    expect(tickEvents).toHaveLength(0) // gated
    expect(mutateEvents).toHaveLength(1) // ungated — fires regardless
    unmount()
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — Observer CONSTRUCTION options are reactive                  */
/*                                                                      */
/*  `root`, `rootMargin` and `thresholds` cannot be changed on a live    */
/*  observer, and they were read exactly once — at the one moment they   */
/*  are guaranteed to be wrong. Vue evaluates the binding object during  */
/*  render, before template refs are assigned, so `root: scroller` is     */
/*  `null` at `mounted` and the element only ever arrives via `updated`. */
/*  Every `root:` recipe in the README and every playground demo that     */
/*  passed one observed the viewport.                                    */
/* ------------------------------------------------------------------ */

describe('intersect: observer construction options are reactive', () => {
  it('reproduces the template-ref timing: mounted sees root null, updated sees the element', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const scroller: Ref<HTMLElement | null> = ref(null)
    const seen: (Element | Document | null | undefined)[] = []

    const Comp = defineComponent({
      setup() {
        return () =>
          h('div', { ref: scroller, 'data-scroller': '1' }, [
            withDirectives(h('div', { 'data-host': '1' }), [
              [vObserve, { intersect: { root: scroller.value, on: () => {} } }],
            ]),
          ])
      },
    })
    const app = createApp(Comp)
    app.mount(container)

    const host = container.querySelector('[data-host]') as HTMLElement
    seen.push((ioByElement.get(host)![0] as unknown as MockIntersectionObserver).root)
    // The binding object was built during render — before `ref` was assigned.
    expect(seen[0]).toBeNull()

    // A re-render now carries the resolved element.
    await nextTick()
    ;(app._instance!.proxy as unknown as { $forceUpdate: () => void }).$forceUpdate()
    await nextTick()

    const live = ioByElement.get(host)![0] as unknown as MockIntersectionObserver
    expect(live.root).toBe(container.querySelector('[data-scroller]'))

    app.unmount()
    container.remove()
  })

  it('a root swap disconnects the old observer and observes against the new one', async () => {
    const a = document.createElement('div')
    const b = document.createElement('div')
    document.body.append(a, b)
    const { host, setOpts, unmount } = mount({ intersect: { root: a, on: () => {} } })

    const first = ioByElement.get(host)![0] as unknown as MockIntersectionObserver
    expect(first.root).toBe(a)

    await setOpts({ intersect: { root: b, on: () => {} } })
    expect(first.disconnected).toBe(true)
    const second = ioByElement.get(host)![0] as unknown as MockIntersectionObserver
    expect(second.root).toBe(b)
    expect(second.observed.has(host)).toBe(true)
    unmount()
    a.remove()
    b.remove()
  })

  it('a rootMargin swap rebuilds — the preload distance is not frozen at mount', async () => {
    const { host, setOpts, unmount } = mount({ intersect: { rootMargin: '0px', on: () => {} } })
    expect((ioByElement.get(host)![0] as unknown as MockIntersectionObserver).rootMargin).toBe('0px')
    await setOpts({ intersect: { rootMargin: '240px 0px', on: () => {} } })
    expect((ioByElement.get(host)![0] as unknown as MockIntersectionObserver).rootMargin).toBe('240px 0px')
    expect(ioInstances).toHaveLength(2)
    unmount()
  })

  it('a callback-only swap does NOT rebuild — the ratio baseline survives', async () => {
    const seen: number[] = []
    const { host, setOpts, unmount } = mount({
      intersect: { thresholds: [0.5], crossed: (e) => seen.push(e.threshold) },
    })
    fire(host, { isIntersecting: false, intersectionRatio: 0 })
    await setOpts({ intersect: { thresholds: [0.5], crossed: (e) => seen.push(e.threshold) } })
    expect(ioInstances).toHaveLength(1)
    // The baseline established before the swap is still there, so this is a
    // crossing rather than a new first callback.
    fire(host, { isIntersecting: true, intersectionRatio: 0.9 })
    expect(seen).toEqual([0.5])
    unmount()
  })

  it('an identical root object across renders does not churn the observer', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const { setOpts, unmount } = mount({ intersect: { root, rootMargin: '10px', on: () => {} } })
    await setOpts({ intersect: { root, rootMargin: '10px', on: () => {} } })
    await setOpts({ intersect: { root, rootMargin: '10px', on: () => {} } })
    expect(ioInstances).toHaveLength(1)
    unmount()
    root.remove()
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — `once` is the collapse signal, with or without `on`         */
/* ------------------------------------------------------------------ */

describe('intersect: `once` collapse does not depend on `on`', () => {
  // `hasFired` was set inside `if (live.on)`, and the teardown check read it.
  // With `{ once: true, thresholds, crossed }` and no `on`, the flag stayed
  // false forever: the observer was never released and `crossed` kept firing
  // on every scroll past the sentinel.
  it('crossed-only + once disconnects after the first visible tick', () => {
    const events: IntersectCrossEvent[] = []
    const { host, unmount } = mount({
      intersect: { once: true, thresholds: [0.5], crossed: (e) => events.push(e) },
    })
    fire(host, { isIntersecting: false, intersectionRatio: 0 })
    expect(ioByElement.has(host)).toBe(true)

    fire(host, { isIntersecting: true, intersectionRatio: 0.8 })
    expect(events.map((e) => `${e.threshold}:${e.direction}`)).toEqual(['0.5:up'])
    expect(ioByElement.has(host)).toBe(false)
    expect(ioInstances[0].disconnected).toBe(true)
    unmount()
  })

  it('a bare `{ once: true }` with no callbacks at all still disconnects', () => {
    const { host, unmount } = mount({ intersect: { once: true } })
    fire(host, { isIntersecting: true, intersectionRatio: 1 })
    expect(ioByElement.has(host)).toBe(false)
    unmount()
  })

  it('the collapse survives a re-render — `once` is not "once per parent render"', async () => {
    const onIntersect = vi.fn()
    const { host, setOpts, unmount } = mount({ intersect: { once: true, on: onIntersect } })
    fire(host, { isIntersecting: true, intersectionRatio: 1 })
    expect(onIntersect).toHaveBeenCalledTimes(1)

    await setOpts({ intersect: { once: true, on: onIntersect } })
    expect(ioByElement.has(host)).toBe(false)
    expect(ioInstances).toHaveLength(1)
    expect(onIntersect).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('dropping intersect entirely and re-adding it starts a fresh observer', async () => {
    const onIntersect = vi.fn()
    const { host, setOpts, unmount } = mount({ intersect: { once: true, on: onIntersect } })
    fire(host, { isIntersecting: true, intersectionRatio: 1 })
    await setOpts({})
    await setOpts({ intersect: { once: true, on: onIntersect } })
    expect(ioByElement.has(host)).toBe(true)
    fire(host, { isIntersecting: true, intersectionRatio: 1 })
    expect(onIntersect).toHaveBeenCalledTimes(2)
    unmount()
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — A throwing observer constructor produces ONE error          */
/* ------------------------------------------------------------------ */

describe('a rejected observer option reports one error, not two', () => {
  // `state.intersect = internal` used to run before `new IntersectionObserver`,
  // with `observer: null as unknown as IntersectionObserver`. A real
  // IntersectionObserver throws RangeError for a threshold outside [0, 1] —
  // a consumer-supplied number — and unmount then dereferenced the null,
  // pointing the reader at a lifecycle bug that does not exist.
  it('validates thresholds at bind time, before the constructor is reached', () => {
    expect(() => mount({ intersect: { thresholds: [0, 1.5], on: () => {} } })).toThrow(
      /v-observe.*thresholds.*between 0 and 1/s,
    )
    expect(ioInstances).toHaveLength(0)
  })

  it('rejects NaN and negative thresholds too', () => {
    expect(() => mount({ intersect: { thresholds: [Number.NaN] } })).toThrow(/v-observe/)
    expect(() => mount({ intersect: { thresholds: [-0.1] } })).toThrow(/v-observe/)
  })

  it('a constructor that throws anyway leaves nothing half-built for teardown to trip over', () => {
    class ThrowingIO {
      constructor() {
        throw new SyntaxError("Failed to construct 'IntersectionObserver': rootMargin is not valid")
      }
    }
    ;(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = ThrowingIO

    const el = document.createElement('div')
    document.body.appendChild(el)
    const mounted = vObserve.mounted as unknown as (el: HTMLElement, b: { value: ObserveOptions }) => void
    const unmounted = vObserve.unmounted as unknown as (el: HTMLElement) => void

    expect(() => mounted(el, { value: { intersect: { rootMargin: 'nonsense', on: () => {} } } })).toThrow(
      /rootMargin is not valid/,
    )
    // The second error is the one that used to send people hunting.
    expect(() => unmounted(el)).not.toThrow()
    el.remove()
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — A gated resize gets a measurement when the gate re-opens    */
/*                                                                      */
/*  Resize observations are gathered BEFORE intersection observations    */
/*  are delivered, so with `gateOnIntersect: true` the mandatory first    */
/*  RO callback is always dropped — even for an element visible at        */
/*  mount. A real ResizeObserver does not re-send it for an element       */
/*  whose box has not changed, so the consumer got no dimensions at all.  */
/* ------------------------------------------------------------------ */

describe('gateOnIntersect: restoring the gate asks for a fresh measurement', () => {
  it('re-observes the element on hidden→visible', () => {
    const { host, unmount } = mount({
      intersect: { on: () => {} },
      resize: { gateOnIntersect: true, handler: () => {} },
    })
    expect(observeCallsFor(host)).toHaveLength(1)

    // The first RO callback arrives while intersect still says hidden and is
    // dropped — exactly the browser's ordering.
    fireResize(host, { width: 500, height: 400 })
    fire(host, { isIntersecting: true, intersectionRatio: 1, boundingClientRect: mkRect({ top: 0 }) })

    expect(observeCallsFor(host)).toHaveLength(2)
    expect(observeCallsFor(host)[1].options).toEqual({ box: 'border-box' })
    unmount()
  })

  it('re-observes with the configured box, not the default', () => {
    const { host, unmount } = mount({
      intersect: { on: () => {} },
      resize: { gateOnIntersect: true, box: 'content', handler: () => {} },
    })
    fire(host, { isIntersecting: true, intersectionRatio: 1, boundingClientRect: mkRect({ top: 0 }) })
    expect(observeCallsFor(host).map((c) => c.options?.box)).toEqual(['content-box', 'content-box'])
    unmount()
  })

  it('does not re-observe a mode that is not gated', () => {
    const { host, unmount } = mount({
      intersect: { on: () => {} },
      resize: { handler: () => {} },
    })
    fire(host, { isIntersecting: true, intersectionRatio: 1, boundingClientRect: mkRect({ top: 0 }) })
    expect(observeCallsFor(host)).toHaveLength(1)
    unmount()
  })

  it('does not re-observe on visible→visible ticks', () => {
    const { host, unmount } = mount({
      intersect: { on: () => {} },
      resize: { gateOnIntersect: true, handler: () => {} },
    })
    fire(host, { isIntersecting: true, intersectionRatio: 0.4, boundingClientRect: mkRect({ top: 0 }) })
    fire(host, { isIntersecting: true, intersectionRatio: 0.9, boundingClientRect: mkRect({ top: 0 }) })
    expect(observeCallsFor(host)).toHaveLength(2)
    unmount()
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — The bracket label a consumer reads is the one CSS shows     */
/* ------------------------------------------------------------------ */

describe('resize: bracket labels follow `axis`', () => {
  // `bracketLabel(dims.width, …)` ignored `cfg.axis`, so with `axis: 'height'`
  // a handler logging `e.bracket` and a stylesheet keyed on
  // `[data-observe-state*='resize:…']` disagreed about the same element at the
  // same instant.
  it("axis: 'height' labels the tick event and the CSS segment from the height", () => {
    const events: ResizeTickEvent[] = []
    const { host, unmount } = mount({
      resize: {
        axis: 'height',
        breakpoints: { narrow: 0, wide: 500 },
        handler: (e) => { if (e.mode === 'tick') events.push(e) },
      },
    })
    fireResize(host, { width: 300, height: 700 })
    expect(events[0].bracket).toBe('wide')
    expect(host.getAttribute('data-observe-state')).toBe('intersect:-;resize:wide;mutate:-')
    unmount()
  })

  it("axis: 'width' (default) is unchanged", () => {
    const events: ResizeTickEvent[] = []
    const { host, unmount } = mount({
      resize: {
        breakpoints: { narrow: 0, wide: 500 },
        handler: (e) => { if (e.mode === 'tick') events.push(e) },
      },
    })
    fireResize(host, { width: 300, height: 700 })
    expect(events[0].bracket).toBe('narrow')
    expect(host.getAttribute('data-observe-state')).toBe('intersect:-;resize:narrow;mutate:-')
    unmount()
  })

  // A jump over several thresholds stamped every event with the FINAL label,
  // so the threshold-320 event claimed a bracket the element was never in at
  // that crossing. README:477 calls the field "bracket label entered".
  it('each crossing of a multi-bracket jump carries the bracket THAT crossing entered', () => {
    const events: ResizeBracketEvent[] = []
    const { host, unmount } = mount({
      resize: {
        on: 'crossed',
        breakpoints: [320, 640],
        handler: (e) => { if (e.mode === 'crossed') events.push(e) },
      },
    })
    fireResize(host, { width: 200, height: 100 })
    fireResize(host, { width: 800, height: 100 })
    expect(events.map((e) => [e.threshold, e.bracket])).toEqual([
      [320, '320-640'],
      [640, '>=640'],
    ])
    unmount()
  })

  it('and the same on the way down', () => {
    const events: ResizeBracketEvent[] = []
    const { host, unmount } = mount({
      resize: {
        on: 'crossed',
        breakpoints: [320, 640],
        handler: (e) => { if (e.mode === 'crossed') events.push(e) },
      },
    })
    fireResize(host, { width: 800, height: 100 })
    fireResize(host, { width: 200, height: 100 })
    expect(events.map((e) => [e.threshold, e.bracket])).toEqual([
      [640, '320-640'],
      [320, '<320'],
    ])
    unmount()
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — The state attribute is written by exactly one builder        */
/* ------------------------------------------------------------------ */

describe('data-observe-state: the grammar and the string cannot drift', () => {
  // The old check was `const _x: ObserveStateAttribute = 'intersect:visible;…'`
  // — a hand-written literal against a hand-written type, which cannot fail if
  // the writer drifts from either. The type is now the writer's return type,
  // so this reads the real attribute back and parses it against the grammar.
  it('every string the directive writes parses as ObserveStateAttribute', () => {
    const seen = new Set<string>()
    const { host, unmount } = mount({
      intersect: { on: () => {} },
      resize: { breakpoints: { sm: 0, lg: 600 }, handler: () => {} },
      mutate: { on: 'attr:class', handler: () => {} },
    })
    const snap = () => seen.add(host.getAttribute('data-observe-state')!)

    snap()
    fire(host, { isIntersecting: true, intersectionRatio: 1 })
    snap()
    fireResize(host, { width: 800, height: 100 })
    snap()
    fireResize(host, { width: 100, height: 100 })
    snap()
    fireMutation(host, { type: 'attributes', attributeName: 'class', oldValue: 'a', target: host })
    snap()
    fire(host, { isIntersecting: false, intersectionRatio: 0 })
    snap()

    expect(seen.size).toBeGreaterThan(3)
    for (const value of seen) {
      const m = /^intersect:(visible|hidden|-);resize:([^;]+);mutate:(active|idle|-)$/.exec(value)
      expect(m, `not a valid data-observe-state: ${value}`).not.toBeNull()
      // The compiler agrees, on the same string the DOM holds.
      const typed: ObserveStateAttribute = value as ObserveStateAttribute
      expect(typed).toBe(value)
    }
    unmount()
  })

  it('an unchanged state does not rewrite the attribute', () => {
    const { host, unmount } = mount({ intersect: { on: () => {} } })
    const writes: string[] = []
    const original = host.setAttribute.bind(host)
    host.setAttribute = ((name: string, value: string) => {
      if (name === 'data-observe-state') writes.push(value)
      original(name, value)
    }) as typeof host.setAttribute

    fire(host, { isIntersecting: true, intersectionRatio: 0.4 })
    fire(host, { isIntersecting: true, intersectionRatio: 0.6 })
    fire(host, { isIntersecting: true, intersectionRatio: 0.9 })
    expect(writes).toEqual(['intersect:visible;resize:-;mutate:-'])
    unmount()
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — Against a real MutationObserver                             */
/*                                                                      */
/*  The directive writes `data-observe-state` on the host it observes.   */
/*  `setAttribute` queues a MutationRecord even when the value is         */
/*  unchanged, so `mutate: { on: 'attr:*' }` used to observe its own      */
/*  write, flush, write again — a microtask loop with no stack and no     */
/*  error, i.e. a frozen tab. Nothing in the mock-driven suite could see  */
/*  it, because no MutationObserver in it ever watched a real DOM write.  */
/* ------------------------------------------------------------------ */

describe('mutate: against a real MutationObserver', () => {
  beforeEach(() => {
    ;(globalThis as unknown as { MutationObserver: typeof MutationObserver }).MutationObserver =
      RealMutationObserver
  })

  /** Watchdog-wrapped mount: a regression must fail the test, not hang the run. */
  function mountWatched(opts: ObserveOptions, cap = 200) {
    const events: MutateEvent[] = []
    let stop: (() => void) | null = null
    const cfg = opts.mutate!
    const mounted = mount({
      ...opts,
      mutate: {
        ...cfg,
        handler: (e) => {
          events.push(e)
          if (events.length >= cap) stop?.()
        },
      },
    })
    stop = mounted.unmount
    return { ...mounted, events }
  }

  it("'attr:*' reports one external attribute change and nothing else", async () => {
    const { host, events, unmount } = mountWatched({ mutate: { on: 'attr:*' } })

    host.setAttribute('data-kick', '1')
    await new Promise((r) => setTimeout(r, 400))

    expect(events.map((e) => e.type)).toEqual(['attr:data-kick'])
    expect(events[0]).toMatchObject({ name: 'data-kick', from: null, to: '1' })
    unmount()
  })

  it("'attr:*' still settles after the mutate:active → idle cooldown re-writes the attribute", async () => {
    const { host, events, unmount } = mountWatched({ mutate: { on: 'attr:*' } })

    host.setAttribute('data-kick', '1')
    await new Promise((r) => setTimeout(r, 60))
    expect(host.getAttribute('data-observe-state')).toBe('intersect:-;resize:-;mutate:active')

    await new Promise((r) => setTimeout(r, 400))
    expect(host.getAttribute('data-observe-state')).toBe('intersect:-;resize:-;mutate:idle')
    expect(events).toHaveLength(1)
    unmount()
  })

  it('subscribing to the state attribute by name is dropped rather than honoured', async () => {
    const { host, events, unmount } = mountWatched({
      mutate: { on: ['attr:data-observe-state', 'attr:data-kick'] },
    })

    host.setAttribute('data-kick', '1')
    await new Promise((r) => setTimeout(r, 400))

    expect(events.map((e) => e.type)).toEqual(['attr:data-kick'])
    unmount()
  })

  it('an intersect tick rewriting the attribute does not wake the mutate handler', async () => {
    const { host, events, unmount } = mountWatched({
      intersect: { on: () => {} },
      mutate: { on: 'attr:*' },
    })
    fire(host, { isIntersecting: true, intersectionRatio: 1 })
    expect(host.getAttribute('data-observe-state')).toBe('intersect:visible;resize:-;mutate:idle')

    await new Promise((r) => setTimeout(r, 400))
    expect(events).toHaveLength(0)
    // Still idle: the handler never ran, so the segment was never flipped.
    expect(host.getAttribute('data-observe-state')).toBe('intersect:visible;resize:-;mutate:idle')
    unmount()
  })

  it('real children:added / children:removed', async () => {
    const { host, events, unmount } = mountWatched({
      mutate: { on: ['children:added', 'children:removed'] },
    })
    const child = document.createElement('span')
    host.appendChild(child)
    await new Promise((r) => setTimeout(r, 50))
    child.remove()
    await new Promise((r) => setTimeout(r, 50))

    expect(events.map((e) => e.type)).toEqual(['children:added', 'children:removed'])
    expect(events[0].added).toEqual([child])
    expect(events[1].removed).toEqual([child])
    unmount()
  })

  it('real children:added only — a real removal is not delivered', async () => {
    const { host, events, unmount } = mountWatched({ mutate: { on: 'children:added' } })
    const child = document.createElement('span')
    host.appendChild(child)
    await new Promise((r) => setTimeout(r, 50))
    child.remove()
    await new Promise((r) => setTimeout(r, 50))

    expect(events.map((e) => e.type)).toEqual(['children:added'])
    expect(events[0].added).toEqual([child])
    unmount()
  })

  it('real children:removed only — a real addition is not delivered', async () => {
    const { host, events, unmount } = mountWatched({ mutate: { on: 'children:removed' } })
    const child = document.createElement('span')
    host.appendChild(child)
    await new Promise((r) => setTimeout(r, 50))
    child.remove()
    await new Promise((r) => setTimeout(r, 50))

    expect(events.map((e) => e.type)).toEqual(['children:removed'])
    expect(events[0].removed).toEqual([child])
    unmount()
  })

  it('a real `el.textContent = …` — the way Vue patches an interpolation — is a text event', async () => {
    const { host, events, unmount } = mountWatched({ mutate: { on: 'text' } })
    host.textContent = 'hello'
    await new Promise((r) => setTimeout(r, 50))

    expect(events.map((e) => e.type)).toEqual(['text'])
    expect(events[0]).toMatchObject({ from: '', to: 'hello' })
    unmount()
  })

  it('a real contenteditable split into two text nodes still diffs the whole host', async () => {
    const { host, events, unmount } = mountWatched({ mutate: { on: 'text' } })
    const first = document.createTextNode('line one')
    host.appendChild(first)
    await new Promise((r) => setTimeout(r, 50))
    events.length = 0

    // Enter: the editor splits the content into two nodes, then the user types
    // into the second one only.
    const second = document.createTextNode(' and two')
    host.appendChild(second)
    await new Promise((r) => setTimeout(r, 50))
    second.data = ' and TWO'
    await new Promise((r) => setTimeout(r, 50))

    expect(events.at(-1)?.to).toBe('line one and TWO')
    expect(events.at(-1)?.from).toBe('line one and two')
    unmount()
  })

  it('a real self-removal fires `removed` exactly once', async () => {
    const { host, events, unmount } = mountWatched({ mutate: { on: 'removed' } })
    // A third party yanks the host out without unmounting Vue.
    host.remove()
    await new Promise((r) => setTimeout(r, 100))

    expect(events.map((e) => e.type)).toEqual(['removed'])
    unmount()
  })
})

/* ------------------------------------------------------------------ */
/*  Tests — Gaps found by mutating the source                           */
/*                                                                      */
/*  Each of these was a mutation the suite let through: the library was  */
/*  right and nothing was watching. Reverting the line named in the      */
/*  comment turns the test red.                                          */
/* ------------------------------------------------------------------ */

describe('mutation-testing gaps', () => {
  // `uniqSorted` — the crossing loops walk the list in order, and the observer
  // is constructed from it, so an unsorted list mis-orders both.
  it('thresholds given out of order are sorted before use', () => {
    const events: IntersectCrossEvent[] = []
    const { host, unmount } = mount({
      intersect: { thresholds: [0.75, 0.25, 0.5], crossed: (e) => events.push(e) },
    })
    expect((ioByElement.get(host)![0] as unknown as MockIntersectionObserver).thresholds).toEqual([
      0.25, 0.5, 0.75,
    ])

    fire(host, { isIntersecting: false, intersectionRatio: 0 })
    fire(host, { isIntersecting: true, intersectionRatio: 0.9 })
    expect(events.map((e) => e.threshold)).toEqual([0.25, 0.5, 0.75])

    events.length = 0
    fire(host, { isIntersecting: true, intersectionRatio: 0.1 })
    expect(events.map((e) => e.threshold)).toEqual([0.75, 0.5, 0.25])
    unmount()
  })

  // `squareTolerance` is documented as a fraction of the LARGER dimension.
  // 200x180 with 0.105 is square against the larger (21 >= 20) and landscape
  // against the smaller (18.9 < 20), so it tells the two apart.
  it('squareTolerance is a fraction of the larger dimension', () => {
    const events: ResizeTickEvent[] = []
    const { host, unmount } = mount({
      resize: { squareTolerance: 0.105, handler: (e) => { if (e.mode === 'tick') events.push(e) } },
    })
    fireResize(host, { width: 200, height: 180 })
    expect(events[0].orientation).toBe('square')
    unmount()
  })

  // `text` turns on `subtree`, so childList records arrive for descendants too.
  // Those are not the host's children.
  it('a childList record from a descendant is not reported as a host child', () => {
    const events: MutateEvent[] = []
    const { host, unmount } = mount({
      mutate: { on: ['children:added', 'text'], handler: (e) => events.push(e) },
    })
    const inner = document.createElement('ul')
    host.appendChild(inner)
    const grandchild = document.createElement('li')
    inner.appendChild(grandchild)

    fireMutation(host, { type: 'childList', target: inner, addedNodes: [grandchild] })
    expect(events.map((e) => e.type)).toEqual([])
    unmount()
  })

  // `stateMap.delete(el)` on unmount. Without it the cached "last written"
  // string outlives the element's teardown, so a directive re-bound to the
  // same element skips its initial write and the CSS hook is simply absent.
  it('re-binding the directive to the same element rewrites the attribute', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const mounted = vObserve.mounted as unknown as (el: HTMLElement, b: { value: ObserveOptions }) => void
    const unmounted = vObserve.unmounted as unknown as (el: HTMLElement) => void

    mounted(el, { value: { intersect: { on: () => {} } } })
    expect(el.getAttribute('data-observe-state')).toBe('intersect:hidden;resize:-;mutate:-')
    unmounted(el)
    expect(el.getAttribute('data-observe-state')).toBeNull()

    mounted(el, { value: { intersect: { on: () => {} } } })
    expect(el.getAttribute('data-observe-state')).toBe('intersect:hidden;resize:-;mutate:-')
    unmounted(el)
    el.remove()
  })
})
