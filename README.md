# @ozjsey/v-observe

**`IntersectionObserver` + `ResizeObserver` + `MutationObserver` in one Vue 3 binding**, with the
diffs, thresholds and debounces you would otherwise write by hand.

[![npm](https://img.shields.io/npm/v/@ozjsey/v-observe.svg)](https://www.npmjs.com/package/@ozjsey/v-observe)
![license MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![gzipped 4.58 KiB](https://img.shields.io/badge/gzipped-4.58%20KiB-blue.svg)
![dependencies 0](https://img.shields.io/badge/dependencies-0-blue.svg)

## The problem

VueUse wraps the three observers separately — `vIntersectionObserver`, `vResizeObserver`,
`useMutationObserver` — each one a near-1:1 over the native API. A consumer who needs more than one signal
on the same element wires up more than one of them, and then writes the interesting part themselves: which
threshold was crossed and in which direction, what the box was before it changed, which children arrived,
and how to stop all of it firing while the element is off-screen.

## The solution

One directive, three modes, one binding — and the integrations that are only possible when a single
directive owns all three signals. `gateOnIntersect: true` skips resize and mutate callbacks while the host
is off-screen. `data-observe-state="intersect:…;resize:…;mutate:…"` reflects [all three at
once](https://ozjsey.github.io/npm-portfolio-playground/#v-observe/combined), so a CSS-only reveal or a
responsive grid needs no callback at all. Every mode reports a **diff** rather than a raw record: `from` /
`to` / `delta` for resize, per-threshold `crossed` with `direction` for intersect, semantic event types with
before/after values for mutate.

**Neither `crossed` mode fires on its first callback.** `intersect.crossed` and resize's
`on: 'crossed'` both need a previous measurement to have crossed *from*; an element that mounts 60%
visible has not been scrolled in, and saying so would make an infinite-scroll sentinel load page 2
during mount.

## Install

```bash
npm install @ozjsey/v-observe
```

Requires Vue 3. Zero runtime dependencies. The plugin registers the directive under `observe`, so
templates use `v-observe="…"`; the published tarball also contains `src/`, if you would rather
vendor than install.

```ts
import { createApp } from 'vue'
import { ObservePlugin } from '@ozjsey/v-observe'
import App from './App.vue'

createApp(App).use(ObservePlugin).mount('#app')
```

## Usage

### Lazy-load — fire once when visible

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

### Responsive UI via breakpoint brackets

```vue
<script setup lang="ts">
import { ref } from 'vue'
import type { ResizeEvent } from '@ozjsey/v-observe'

const bracket = ref('xs')

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
.grid[data-observe-state*='resize:md'] { grid-template-columns: repeat(3, 1fr); }
</style>
```

The bracket arrives on the event *and* on the state attribute, so the layout above changes with no
JavaScript in the loop.

### Watch children, but only while on screen

```vue
<script setup lang="ts">
import type { MutateEvent } from '@ozjsey/v-observe'

function onAdd(e: MutateEvent) {
  if (e.added) e.added.forEach((el) => el.classList.add('is-new'))
}
</script>

<template>
  <ul
    v-observe="{
      intersect: { thresholds: [0.5] },
      mutate: { on: 'children:added', match: '.item', handler: onAdd, gateOnIntersect: true },
    }"
  >
    <li class="item">…</li>
  </ul>
</template>
```

No DOM-diff work happens while the list is scrolled away. Where `IntersectionObserver` does not
exist the gate stops gating rather than swallowing every event — every degradation here fails open.

## Everything else

**[The `v-observe` playground tab](https://ozjsey.github.io/npm-portfolio-playground/#v-observe)** is the reference: 17 cards, every option and every
event driven in a real scroller, each one editable in the browser.

- **intersect** — [`once`](https://ozjsey.github.io/npm-portfolio-playground/#v-observe/lazy-once) · [multi-threshold `crossed`](https://ozjsey.github.io/npm-portfolio-playground/#v-observe/thresholds-crossed) · [direction](https://ozjsey.github.io/npm-portfolio-playground/#v-observe/direction) · [CSS-only](https://ozjsey.github.io/npm-portfolio-playground/#v-observe/css-only) · [`root` + `rootMargin`](https://ozjsey.github.io/npm-portfolio-playground/#v-observe/root-margin)
- **resize** — [tick, with from/to/delta](https://ozjsey.github.io/npm-portfolio-playground/#v-observe/resize-tick) · [brackets](https://ozjsey.github.io/npm-portfolio-playground/#v-observe/resize-breakpoints) · [`on: 'crossed'`](https://ozjsey.github.io/npm-portfolio-playground/#v-observe/resize-crossed) · [`on: 'orientation'`](https://ozjsey.github.io/npm-portfolio-playground/#v-observe/resize-orientation) · [box modes and debounce](https://ozjsey.github.io/npm-portfolio-playground/#v-observe/resize-box-debounce), where `device-pixel` is the one a canvas needs and the one you cannot eyeball from a table
- **mutate** — [attribute diffs](https://ozjsey.github.io/npm-portfolio-playground/#v-observe/mutate-attr) · [children, filtered](https://ozjsey.github.io/npm-portfolio-playground/#v-observe/mutate-children) · [text edits](https://ozjsey.github.io/npm-portfolio-playground/#v-observe/mutate-text) · [self-removal](https://ozjsey.github.io/npm-portfolio-playground/#v-observe/mutate-removed) · [multi-type + debounce](https://ozjsey.github.io/npm-portfolio-playground/#v-observe/mutate-multi)
- **together** — [the gate](https://ozjsey.github.io/npm-portfolio-playground/#v-observe/gate-on-intersect) · [all three modes on one element](https://ozjsey.github.io/npm-portfolio-playground/#v-observe/combined), where the state attribute's three segments move independently

[`CHANGELOG.md`](./CHANGELOG.md) · [`ARCHITECTURE.md`](./ARCHITECTURE.md)

## License

MIT
