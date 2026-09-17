# @ozjsey/v-observe

See in action: **[npm portfolio playground →
`#v-observe`](https://ozjsey.github.io/npm-portfolio-playground/#v-observe)** — 17 cards, one per
feature, every one editable in the browser. Recent behaviour changes are in
[`CHANGELOG.md`](./CHANGELOG.md); 0.2.0 fixed four things that made a documented option do nothing
at all, so read it before upgrading from 0.1.0.

Straight to a card: [`intersect`](https://ozjsey.github.io/npm-portfolio-playground/#v-observe/lazy-once) · [`resize`](https://ozjsey.github.io/npm-portfolio-playground/#v-observe/resize-tick) ·
[`mutate`](https://ozjsey.github.io/npm-portfolio-playground/#v-observe/mutate-attr) · [`gateOnIntersect`](https://ozjsey.github.io/npm-portfolio-playground/#v-observe/gate-on-intersect) ·
[all three at once](https://ozjsey.github.io/npm-portfolio-playground/#v-observe/combined). Each recipe below names its own.

Vue 3 directive owning **`IntersectionObserver`** + **`ResizeObserver`** + **`MutationObserver`** in one binding — with scroll-direction inference, per-threshold `crossed` events, breakpoint brackets, orientation crossings, child / attribute / text mutation diffs, self-removal detection, and a unified **`data-observe-state`** CSS hook.

- Zero runtime dependencies (Vue 3 peer only)
- Single directive, three observer modes
- Fully reactive — callback swaps stay in place, and the options an observer must be *constructed*
  with (`root`, `rootMargin`, `thresholds`, `box`) rebuild it, so a template ref that only resolves
  after the first render still works
- SSR-safe (no top-level DOM access), and every degradation fails open
- `data-observe-state="intersect:…;resize:…;mutate:…"` for CSS-only UI
- The published tarball contains `src/` — copy the folder if you would rather vendor than install

## Install

```bash
npm install @ozjsey/v-observe
```

## Quick start — plugin install (recommended)

```ts
import { createApp } from 'vue'
import { ObservePlugin } from '@ozjsey/v-observe'
import App from './App.vue'

createApp(App).use(ObservePlugin).mount('#app')
```

Registers the directive under `observe`, so templates use `v-observe="..."`.

## Quick start — manual

```ts
import { createApp } from 'vue'
import { vObserve } from '@ozjsey/v-observe'

createApp(App).directive('observe', vObserve).mount('#app')
```

## Recipes — intersect

> **Each of these is a card**, running in a real scroller with the events printed as they arrive:
> [1 lazy-load, `once: true`](https://ozjsey.github.io/npm-portfolio-playground/#v-observe/lazy-once) ·
> [2 multi-threshold `crossed`](https://ozjsey.github.io/npm-portfolio-playground/#v-observe/thresholds-crossed) ·
> [4 direction inference](https://ozjsey.github.io/npm-portfolio-playground/#v-observe/direction) ·
> [5 CSS-only visible state](https://ozjsey.github.io/npm-portfolio-playground/#v-observe/css-only) ·
> [6 custom `root` + `rootMargin`](https://ozjsey.github.io/npm-portfolio-playground/#v-observe/root-margin)

### 1. Lazy-load — fire once when visible

```vue
<script setup lang="ts">
import { ref } from 'vue'
const loaded = ref(false)
</script>

<template>
  <img
    v-observe="{
      intersect: {
        once: true,
        on: (e) => { if (e.isIntersecting) loaded = true },
      },
    }"
    :src="loaded ? '/big.jpg' : '/placeholder.svg'"
  />
</template>
```

`once: true` disconnects the observer the first time the element intersects.

### 2. Infinite-scroll sentinel — multi-threshold `crossed`

```vue
<script setup lang="ts">
import type { IntersectCrossEvent } from '@ozjsey/v-observe'

function onCross(e: IntersectCrossEvent) {
  if (e.threshold >= 0.8 && e.direction === 'up') loadNextPage()
}
</script>

<template>
  <article v-for="post in posts" :key="post.id">{{ post.title }}</article>
  <div v-observe="{ intersect: { thresholds: [0.25, 0.5, 0.8], crossed: onCross } }" />
</template>
```

`crossed` fires once per threshold per crossing, with `direction: 'up' | 'down'`.

### 3. Analytics impression — fire when 50% visible

```vue
<script setup lang="ts">
import type { IntersectEvent } from '@ozjsey/v-observe'

function track(e: IntersectEvent) {
  if (e.isIntersecting && e.ratio >= 0.5) analytics.fire('impression', { id: card.id })
}
</script>

<template>
  <Card v-observe="{ intersect: { once: true, thresholds: [0.5], on: track } }" />
</template>
```

### 4. Scroll-direction reveal

```vue
<script setup lang="ts">
import type { IntersectEvent } from '@ozjsey/v-observe'
const cssDir = ref<'from-below' | 'from-above' | null>(null)

function onIntersect(e: IntersectEvent) {
  if (e.direction === 'enter-from-below') cssDir.value = 'from-below'
  else if (e.direction === 'enter-from-above') cssDir.value = 'from-above'
}
</script>

<template>
  <section v-observe="{ intersect: { on: onIntersect } }" :data-reveal="cssDir">
    <h2>Section</h2>
  </section>
</template>

<style scoped>
[data-reveal='from-below'] { animation: slide-up 300ms both; }
[data-reveal='from-above'] { animation: slide-down 300ms both; }
</style>
```

Four directions: `enter-from-above`, `enter-from-below`, `leave-to-above`, `leave-to-below`. `direction` is `null` on intermediate ticks.

### 5. CSS-only visible state

```vue
<template>
  <div v-observe="{ intersect: { on: () => {} } }" class="card">Fade in</div>
</template>

<style scoped>
.card { opacity: 0; transition: opacity 250ms ease-out; }
.card[data-observe-state*='intersect:visible'] { opacity: 1; }
</style>
```

### 6. Nested scroll container — custom `root`

```vue
<script setup lang="ts">
const scroller = ref<HTMLElement | null>(null)
</script>

<template>
  <div ref="scroller" class="scroll-pane">
    <article v-for="i in items" :key="i.id" v-observe="{ intersect: { root: scroller, on: track } }" />
  </div>
</template>
```

`root`, `rootMargin` and `thresholds` are the options the `IntersectionObserver` is *constructed*
with, and a live observer cannot be reconfigured — so the directive compares them on every binding
update and rebuilds when one changes. That is what makes the recipe above work at all: Vue
evaluates the binding object during render, before template refs are assigned, so `root` is `null`
on the first pass and the element only arrives on the next one. Before 0.2.0 the first value was
kept forever and every `root:` in this README observed the viewport.

Changing them costs an observer. Callback-only swaps (`on`, `crossed`) do not rebuild, so the
crossing baseline survives.

## Recipes — resize

> [7 tick mode with from/to/delta](https://ozjsey.github.io/npm-portfolio-playground/#v-observe/resize-tick) ·
> [8 breakpoint brackets](https://ozjsey.github.io/npm-portfolio-playground/#v-observe/resize-breakpoints) ·
> [9 `on: 'crossed'`](https://ozjsey.github.io/npm-portfolio-playground/#v-observe/resize-crossed) ·
> [10 `on: 'orientation'`](https://ozjsey.github.io/npm-portfolio-playground/#v-observe/resize-orientation) ·
> [11-12 box modes and debounce](https://ozjsey.github.io/npm-portfolio-playground/#v-observe/resize-box-debounce) — the box modes matter most here:
> `device-pixel-content-box` is the one a canvas needs and the one you cannot eyeball from a table.

### 7. Live dimension readout (tick mode)

```vue
<script setup lang="ts">
import type { ResizeEvent } from '@ozjsey/v-observe'
const size = ref<{ width: number; height: number }>({ width: 0, height: 0 })

function onResize(e: ResizeEvent) {
  if (e.mode === 'tick') size.value = e.to
}
</script>

<template>
  <div v-observe="{ resize: { handler: onResize } }">{{ size.width }}×{{ size.height }}</div>
</template>
```

Default mode is `'tick'`. The first tick has `from: null` and `delta: { width: 0, height: 0 }`.

### 8. Responsive UI via breakpoint brackets

```vue
<script setup lang="ts">
import type { ResizeEvent } from '@ozjsey/v-observe'
const bracket = ref<string>('xs')

function onResize(e: ResizeEvent) {
  if (e.mode === 'tick' && e.bracket) bracket.value = e.bracket
}
</script>

<template>
  <div
    v-observe="{
      resize: {
        breakpoints: { xs: 0, sm: 320, md: 640, lg: 960 },
        handler: onResize,
      },
    }"
    class="grid"
  >
    Bracket: {{ bracket }}
  </div>
</template>

<style scoped>
.grid[data-observe-state*='resize:sm'] { grid-template-columns: 1fr 1fr; }
.grid[data-observe-state*='resize:md'] { grid-template-columns: repeat(3, 1fr); }
.grid[data-observe-state*='resize:lg'] { grid-template-columns: repeat(4, 1fr); }
</style>
```

Object form: keys label brackets, smallest key with value `0` labels the `[0, n)` range. Array form: default labels `'<320'`, `'320-640'`, `'>=640'`.

### 9. Fire only on bracket cross (crossed mode)

```vue
<script setup lang="ts">
import type { ResizeEvent } from '@ozjsey/v-observe'

function onCross(e: ResizeEvent) {
  if (e.mode === 'crossed') {
    console.log(`${e.axis} crossed ${e.threshold} going ${e.direction} → ${e.bracket}`)
  }
}
</script>

<template>
  <div
    v-observe="{
      resize: {
        on: 'crossed',
        breakpoints: [600, 900],
        axis: 'width',
        handler: onCross,
      },
    }"
  />
</template>
```

`axis` defaults to `'width'`. Use `'both'` to emit per-axis events on simultaneous crossings.

### 10. Orientation flip handler

```vue
<script setup lang="ts">
import type { ResizeEvent } from '@ozjsey/v-observe'

function onFlip(e: ResizeEvent) {
  if (e.mode === 'orientation') {
    console.log(`${e.from} → ${e.to} at ratio ${e.ratio.toFixed(2)}`)
  }
}
</script>

<template>
  <div
    v-observe="{
      resize: { on: 'orientation', squareTolerance: 0.05, handler: onFlip },
    }"
  />
</template>
```

`squareTolerance` (0–1) defines the band around 1:1 that counts as `'square'`.

### 11. Device-pixel-accurate canvas

```vue
<script setup lang="ts">
import type { ResizeEvent } from '@ozjsey/v-observe'
const canvas = ref<HTMLCanvasElement | null>(null)

function onResize(e: ResizeEvent) {
  if (e.mode === 'tick' && canvas.value) {
    canvas.value.width = e.to.width
    canvas.value.height = e.to.height
  }
}
</script>

<template>
  <canvas
    ref="canvas"
    v-observe="{ resize: { box: 'device-pixel', handler: onResize } }"
  />
</template>
```

`box` is passed to `ResizeObserver.observe()`, so it decides **when a callback fires**, not only
what the dimensions mean. That is the whole point of `'device-pixel'`: a `devicePixelRatio` change
— a zoom, or the window moving to a different monitor — produces no content-box change at all, so
watching the content box means the callback never arrives and the canvas stays blurry. Likewise
`'border'` sees a border- or padding-only change that leaves the content box where it was.

The read falls back to `contentBox × devicePixelRatio` when the browser lacks
`devicePixelContentBoxSize`, and the *observation* degrades to the content box on engines that
reject `device-pixel-content-box` outright (Safari, at the time of writing) — so the option never
throws, it just cannot beat the engine.

### 12. Debounced expensive layout

```vue
<template>
  <div v-observe="{ resize: { debounce: 150, handler: relayout } }">…</div>
</template>
```

`debounce: 150` is a trailing-edge debounce, not a rate limit: the timer restarts on every
callback, so a continuous drag produces **no** call at all until it stops, and then exactly one
with the final dimensions.

## Recipes — mutate

> [13 attribute diffs](https://ozjsey.github.io/npm-portfolio-playground/#v-observe/mutate-attr) ·
> [14 children added/removed, filtered](https://ozjsey.github.io/npm-portfolio-playground/#v-observe/mutate-children) ·
> [15 text edits](https://ozjsey.github.io/npm-portfolio-playground/#v-observe/mutate-text) ·
> [16 self-removal](https://ozjsey.github.io/npm-portfolio-playground/#v-observe/mutate-removed) ·
> [17 multi-type + debounce](https://ozjsey.github.io/npm-portfolio-playground/#v-observe/mutate-multi)

### 13. Theme-class watcher

```vue
<script setup lang="ts">
import type { MutateEvent } from '@ozjsey/v-observe'

function onTheme(e: MutateEvent) {
  if (e.type === 'attr:class') syncTheme(e.to)
}
</script>

<template>
  <html v-observe="{ mutate: { on: 'attr:class', handler: onTheme } }">…</html>
</template>
```

### 14. Detect added children (with selector filter)

```vue
<script setup lang="ts">
import type { MutateEvent } from '@ozjsey/v-observe'

function onAdd(e: MutateEvent) {
  if (e.type === 'children:added' && e.added) {
    e.added.forEach(animateIn)
  }
}
</script>

<template>
  <ul
    v-observe="{
      mutate: { on: 'children:added', match: '.card', handler: onAdd },
    }"
  >
    <li v-for="card in cards" :key="card.id" class="card">{{ card.title }}</li>
  </ul>
</template>
```

`match` accepts a string or a `string[]`. An unparseable selector **throws at bind time**, naming
the selector. It used to be swallowed per-selector, which meant a one-character typo left the mode
permanently and silently dead — events built, filtered to empty, dropped — with absence as the
consumer's only signal.

### 15. Live-validate `contenteditable` text

```vue
<script setup lang="ts">
import type { MutateEvent } from '@ozjsey/v-observe'

function onEdit(e: MutateEvent) {
  if (e.type === 'text') validate(e.to)
}
</script>

<template>
  <p
    contenteditable
    v-observe="{ mutate: { on: 'text', handler: onEdit } }"
  >
    Edit me.
  </p>
</template>
```

`from` and `to` are the **host's whole `textContent`**, before and after the flush — not the
content of whichever text node the browser happened to report. A `contenteditable` splits into
several text nodes the first time the user presses Enter, and a per-node diff would pair the `from`
of one node with the `to` of another; the validator above would start judging a single line.

Text mode subscribes with `subtree: true` *and* `childList`, because `<div>{{ msg }}</div>` compiles
to `el.textContent = …` — a childList mutation, and the most common way a Vue app changes text.
Several records in one observer batch collapse to a single event with the original `from` and the
latest `to`, and a batch that leaves the text identical emits nothing.

### 16. Self-removal cleanup

```vue
<script setup lang="ts">
import type { MutateEvent } from '@ozjsey/v-observe'

function onRemoved(e: MutateEvent) {
  if (e.type === 'removed') tearDownChartInstance()
}
</script>

<template>
  <div v-observe="{ mutate: { on: 'removed', handler: onRemoved } }">…</div>
</template>
```

Self-removal attaches a second observer to `el.parentNode` (recorded at mount). It auto-disconnects after firing once. Useful when integrating with third-party DOM rippers (e.g. Bootstrap modals) that yank the host without unmounting Vue.

### 17. Multi-type subscription

```vue
<template>
  <div
    v-observe="{
      mutate: {
        on: ['attr:class', 'children:added', 'children:removed', 'text'],
        debounce: 100,
        handler: log,
      },
    }"
  />
</template>
```

Array form unions the subscription. `attr:*` plus a named `attr:foo` drops the filter — any
attribute change fires.

`data-observe-state` is never reported, under `attr:*` or by name. The directive writes it, and
`setAttribute` queues a MutationRecord even for an unchanged value, so reporting it would be the
directive observing itself: flush → write → flush. Before 0.2.0 that was an unbounded microtask
loop, i.e. a frozen tab with no stack and no error.

### 18. CSS-only mutate-active hook

```vue
<template>
  <div v-observe="{ mutate: { on: 'attr:class', handler: () => {} } }" class="card">…</div>
</template>

<style scoped>
.card[data-observe-state*='mutate:active'] { outline: 2px solid #f59e0b; }
</style>
```

`mutate:active` flips for 150 ms after every flush, then drops back to `mutate:idle`.

## API

```ts
import type {
  ObserveOptions,
  IntersectConfig, IntersectEvent, IntersectCrossEvent, IntersectDirection,
  ResizeConfig, ResizeEvent, ResizeTickEvent, ResizeBracketEvent, ResizeOrientationEvent,
  ResizeOrientation, ResizeBox, ResizeMode, ResizeDimensions,
  MutateConfig, MutateEvent, MutateEventType,
  ObserveStateAttribute,
} from '@ozjsey/v-observe'

type ObserveOptions = {
  intersect?: IntersectConfig
  resize?:    ResizeConfig
  mutate?:    MutateConfig
}
```

### `IntersectConfig`

```ts
type IntersectConfig = {
  on?:        (event: IntersectEvent) => void
  once?:      boolean
  thresholds?: number[]
  crossed?:   (event: IntersectCrossEvent) => void
  root?:      Element | Document | null
  rootMargin?: string
}
```

### `ResizeConfig`

```ts
type ResizeConfig = {
  on?:              'tick' | 'crossed' | 'orientation'  // default 'tick'
  breakpoints?:     number[] | Record<string, number>
  axis?:            'width' | 'height' | 'both'         // default 'width'; also labels the segment
  squareTolerance?: number                              // default 0
  box?:             'border' | 'content' | 'device-pixel'  // default 'border'
  debounce?:        number                              // ms; 0 = off
  gateOnIntersect?: boolean                             // see Caveats
  handler?:         (event: ResizeEvent) => void
}

type ResizeEvent = ResizeTickEvent | ResizeBracketEvent | ResizeOrientationEvent

type ResizeTickEvent = {
  mode: 'tick'
  from: ResizeDimensions | null     // null on the first tick
  to:   ResizeDimensions
  delta: ResizeDimensions           // {0,0} on the first tick
  orientation: ResizeOrientation | null   // null for a degenerate (0-width or 0-height) box
  bracket: string | null            // active label on `axis`, or null when no breakpoints
}

type ResizeBracketEvent = {
  mode: 'crossed'
  axis: 'width' | 'height'
  threshold: number
  direction: 'up' | 'down'
  bracket: string                   // the bracket THIS crossing entered
  from: ResizeDimensions            // never null — a crossing needs two measurements
  to:   ResizeDimensions
}

type ResizeOrientationEvent = {
  mode: 'orientation'
  from: ResizeOrientation | null    // null on the first measurable orientation, then the previous one
  to:   ResizeOrientation
  ratio: number                     // width / height (0 when height === 0)
  dimensions: ResizeDimensions
}

type ResizeOrientation = 'portrait' | 'landscape' | 'square'
type ResizeBox = 'border' | 'content' | 'device-pixel'
type ResizeDimensions = { width: number; height: number }
```

### `MutateConfig`

```ts
type MutateConfig = {
  on?:              MutateEventType | MutateEventType[]
  match?:           string | string[]
  debounce?:        number                              // ms; 0 = off
  gateOnIntersect?: boolean                             // see Caveats
  handler?:         (event: MutateEvent) => void
}

type MutateEventType =
  | 'attr:class'                    // shorthand
  | 'attr:style'                    // shorthand
  | `attr:${string}`                // any attribute by name
  | 'attr:*'                        // any attribute (no filter)
  | 'children:added'
  | 'children:removed'
  | 'text'
  | 'removed'                       // self-removal from parent

type MutateEvent = {
  type:    MutateEventType
  name?:   string                   // attribute name, on attr:* events
  from?:   string | null            // attr / text — previous value
  to?:     string | null            // attr / text — current value
  added?:  HTMLElement[]            // children:added — element nodes only
  removed?: HTMLElement[]           // children:removed — element nodes only
  target:  HTMLElement              // the directive host
}
```

### `data-observe-state` grammar

> [All three modes on one element](https://ozjsey.github.io/npm-portfolio-playground/#v-observe/combined) is the card to read this off: one binding, three
> observers, and the attribute's three segments moving independently.

```text
intersect:<visible | hidden | ->;resize:<bracket | active | idle | ->;mutate:<active | idle | ->
```

The `-` sentinel means **mode not configured on this binding** — nothing else. A configured mode
whose observer global is missing is still configured, and reports the value it would report if
nothing had happened yet.

The attribute is only written when the string actually changes: a no-op `setAttribute` still queues
a MutationRecord and still invalidates style.

| Segment | Value | When |
|---|---|---|
| `intersect:visible` | when `isIntersecting === true` | observer callback |
| `intersect:hidden`  | when `isIntersecting === false` | observer callback |
| `intersect:visible` | when there is no `IntersectionObserver` on this engine | mounted — see below |
| `resize:idle`       | initial value when configured | mounted |
| `resize:active`     | tick mode without `breakpoints` | every callback |
| `resize:<label>`    | bracket label | tick / crossed mode with `breakpoints` |
| `resize:portrait` / `landscape` / `square` | orientation | `on: 'orientation'` |
| `mutate:idle`       | initial value when configured | mounted |
| `mutate:active`     | flips after each flush | dispatched event |

### Exports

| Export | Description |
|---|---|
| `vObserve` | The directive object — `app.directive('observe', vObserve)` |
| `ObservePlugin` | Vue plugin — `app.use(ObservePlugin)` |
| `DIRECTIVE_NAME` | The literal `'observe'` |
| `ObserveOptions` / `IntersectConfig` / `IntersectEvent` / `IntersectCrossEvent` / `IntersectDirection` | Intersect types |
| `ResizeConfig` / `ResizeEvent` / `ResizeTickEvent` / `ResizeBracketEvent` / `ResizeOrientationEvent` / `ResizeOrientation` / `ResizeBox` / `ResizeMode` / `ResizeDimensions` | Resize types |
| `MutateConfig` / `MutateEvent` / `MutateEventType` | Mutate types |
| `ObserveStateAttribute` | Template-literal type of the unified state attribute |

## Behavior

- **First-tick semantics.** `ResizeObserver` fires once when an element is first observed. The
  first emitted tick has `from: null` and `delta: { width: 0, height: 0 }`; in `on: 'orientation'`
  it is an event with `from: null` and the orientation the element actually has, which is the only
  signal an orientation consumer gets before the user resizes anything.
- **No crossings on the first callback.** `intersect.crossed` and `resize` `on: 'crossed'` both
  need a previous measurement to have crossed *from*. An element that mounts 60% visible has not
  been scrolled in, and saying so would make an infinite-scroll sentinel load page 2 during mount.
- **Reactive `cfg` swap.** Updating the binding swaps callbacks live without re-creating the observer. Changing the *shape* of `mutate.on` (e.g. `attr:class` → `removed`) triggers a host- and parent-observer rebuild; callback-only swaps stay in place.
- **`children:added` and `children:removed` are separate subscriptions.** One `childList: true` init
  serves both — the browser has no way to watch a single direction — so the directive filters at
  delivery: `on: 'children:added'` never reports a removal, and a single record that does both at
  once (`el.replaceChildren(next)`) delivers only the half you subscribed to. Before 0.2.1 either
  type delivered both, with the other direction's payload. Subscribing to both is unchanged.
- **Mutate self-removal.** `on: 'removed'` attaches a second `MutationObserver` to `el.parentNode` (recorded at mount). It auto-disconnects after firing once. The host's main observer is **only** attached when at least one host-level signal (attr / children / text) is configured.
- **Debounce coalescing.** Resize debounce keeps only the latest dimensions. Mutate debounce keeps the first `from` and the latest `to` for attr / text events; child-list events concatenate `added` / `removed`.
- **`once: true` intersect.** Disconnects after the first `isIntersecting === true` callback,
  whether or not you passed an `on`. `crossed` stops too — `once` is the explicit collapse signal —
  and the collapse survives re-renders, so `once` never degrades into "once per parent render".
  It cannot be combined with `gateOnIntersect`; that throws at bind time (see Caveats).
- **Empty breakpoints.** `breakpoints: []` and `breakpoints: {}` are equivalent to `breakpoints: undefined` — no bracket labels emitted, segment writes `'active'` in tick mode.
- **SSR-safe.** No `window` / `document` / observer global access at module evaluation. If a
  required global is undefined at mount, that mode short-circuits and **every degradation fails
  open**: the gate stops gating rather than swallowing every event, and the CSS hook reports
  `intersect:visible` rather than `intersect:hidden`. Recipe 5 reveals content on
  `[data-observe-state*='intersect:visible']`, so failing closed there meant a permanently invisible
  page on any engine without an `IntersectionObserver`. Before 0.2.0 the two halves disagreed: the
  gate failed open and the CSS hook failed closed.

## Caveats

- **`gateOnIntersect` is "always fire" when `IntersectionObserver` is unavailable.** If the global is missing (older browsers / SSR / disabled), the gate becomes a no-op rather than silently swallowing every event for the directive's lifetime. Pair `gateOnIntersect: true` with a real `intersect` block — the validator throws if you forget.
- **An unparseable `match` selector throws at bind time**, naming the selector, rather than
  quietly filtering every child out.
- **`once` and `gateOnIntersect` cannot be combined**, and the pair throws at bind time. `once`
  disconnects the observer after the first visible tick, and a gate with no live observer stops
  gating — so the combination used to suppress work until the element was first seen and then never
  again, including once it had scrolled far off-screen.
- **A restored gate re-observes.** Resize observations are delivered before intersection ones, so
  with `gateOnIntersect: true` the mandatory first `ResizeObserver` callback is always dropped —
  and a real `ResizeObserver` does not re-send it for a box that has not changed. On the
  hidden → visible flip the element is re-observed, so the first call after restore carries a fresh
  measurement instead of never arriving.
- **A 0x0 box has no orientation.** A `display: none` element reports `0 × 0`, which is not square,
  it is unmeasured. `ResizeTickEvent.orientation` is `null` there, `on: 'orientation'` emits
  nothing, and the `resize:` segment keeps its previous value — so hiding and showing a panel no
  longer flickers through a phantom `square`.
- **`box: 'device-pixel'` fallback chain.** `devicePixelContentBoxSize` →
  `contentBoxSize × devicePixelRatio` → `contentRect`. The first available is read at each callback.
  The *observation* falls back to `content-box` on engines that reject `device-pixel-content-box`.
- **`thresholds` outside `[0, 1]` throw at bind time**, with a message naming this library.
  `IntersectionObserver`'s own `RangeError` does not mention it, and the option's value is usually
  consumer-supplied.
- **`(base)` bracket label.** Object-form breakpoints without a `0` key use `(base)` as the smallest-bracket label. Provide an explicit `0` key (e.g. `{ xs: 0, sm: 320, … }`) to take ownership of that label.
- **Direction inference is null on intermediate ticks.** `IntersectEvent.direction` is only set on visibility transitions; mid-scroll ticks where `isIntersecting` didn't flip return `null`.
- **`mutate.on: 'removed'` bypasses `gateOnIntersect`.** The `removed` event is terminal — if it were gated, you might never see it (the element is detached, so `IntersectionObserver` may report stale state). It always fires through the parent observer regardless of visibility.

## License

MIT
