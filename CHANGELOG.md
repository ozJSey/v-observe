# Changelog

All notable changes to `@ozjsey/v-observe`.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Every entry below is backed by a test in `vObserve.test.ts` that fails when the fix is reverted —
each one was negative-controlled, not just written. The entries that jsdom cannot reach (`root`,
`rootMargin`, `box`, the `attr:*` freeze, the gated first measurement) were additionally driven in
a real Chrome through the playground's `v-observe` tab; see
`playground/scripts/interactions/v-observe.mjs`.

## [0.2.1] — 2026-09-17

Documentation only; no code change. Two release-state claims in the 0.2.0 tarball corrected against
`registry.npmjs.org`, which is the only source either was ever checkable against:

> **"`0.1.0` was never published."** The registry has held `@ozjsey/v-observe@0.1.0` since
> 2026-09-13T13:52:52Z, and it is still installable. Anyone who ran `npm i @ozjsey/v-observe` that
> day and then read the 0.2.0 changelog was told they had imagined it.

> **"[0.2.0] — 2026-09-13."** 0.2.0 went up at 2026-09-14T10:06:06Z. The date was the day the work
> was done, typed before the publish and never revisited — the same habit behind the line above.

`scripts/publish.mjs` now refuses a tarball whose packed docs deny the release state of the version
being published (DOC-1).

## [0.2.0] — 2026-09-14

The package's first audit, and its first browser spec. Published to npm at 2026-09-14T10:06:06Z.

**If you are on `0.1.0`** — published 2026-09-13T13:52:52Z, and still installable — the four items
under "the ones that made the feature useless" are the reason it behaves oddly.

### Fixed — the ones that made the feature useless

- **`root`, `rootMargin` and `thresholds` were read once, at the one moment they are guaranteed to
  be wrong, and never again.** Vue evaluates a binding object during render — before template refs
  are assigned — so `{ intersect: { root: scroller } }` handed `root: null` to the observer's
  constructor and the real element only ever arrived on the next render, where it was accepted into
  the config and ignored. **Every `root:` recipe in the README and all seven playground demos that
  passed one were observing the viewport.** It degraded quietly, because intersection is still
  clipped by overflow ancestors: lazy-load still "worked", so nobody looked again. What did not
  work was preloading — a viewport-relative `rootMargin` says nothing about an element inside a
  scroll pane — and the rootMargin slider on playground demo 05 was inert. A live
  `IntersectionObserver` cannot be reconfigured, so the construction options are now compared on
  every binding update and a change rebuilds the observer. Callback-only swaps still do not, so the
  crossing baseline survives them. A `thresholds` swap used to change the crossing math while the
  observer kept sampling at the old granularity; it now rebuilds too.

- **`resize.box` never reached `observe()`, so it changed what was reported but not what was
  watched.** `observer.observe(el)` was called with no second argument, which means the content box
  — and the observed box is what decides *when a callback fires*. `box: 'device-pixel'` exists for
  exactly one job, re-rastering a canvas when `devicePixelRatio` changes on a zoom or a monitor
  move, and that job produces no content-box change at all, so **no callback ever arrived**: the
  handler was correct, the dimensions were correct when they came, and they never came. README
  recipe 11 was the broken case verbatim. `box: 'border'` likewise missed border- and padding-only
  changes. The box is now passed to `observe()`, a change re-observes, and an engine that rejects
  `device-pixel-content-box` outright degrades to the content box instead of throwing.

- **`mutate: { on: 'attr:*' }` froze the tab.** The directive writes `data-observe-state` on the
  element it observes, and `setAttribute` queues a MutationRecord even when the value has not
  changed — so an unfiltered attribute subscription saw the directive's own write, flushed, wrote
  again, and re-entered forever. A microtask loop with no stack and no error: the tab simply died,
  on the next attribute change anywhere on the host. The 150 ms `mutate:active` → `idle` cooldown
  re-armed it on its own. `attr:*` was advertised in the README and shipped as a dropdown option on
  playground demo 11. The directive's own attribute is now never reported (under `attr:*` or by
  name), and the attribute is only written when the string actually changes.

- **`once: true` only collapsed if you also passed an `on` callback.** The "has fired" flag was set
  inside `if (cfg.on)` while the teardown check read it, so `{ once: true, thresholds, crossed }`
  never disconnected and kept firing `crossed` on every scroll past the sentinel — an observer
  leaked for the life of the page, and a `once` sentinel that called `loadNextPage()` every time.
  `once` now collapses on the first visible tick whatever callbacks you passed, and the collapse
  survives re-renders, so it can no longer degrade into "once per parent render".

### Fixed — wrong answers

- **`gateOnIntersect` silently stopped gating forever once `intersect`'s `once` collapse ran.** The
  gate read the intersect observer's internal state, and `once` deleted it; the gate then took its
  "no IntersectionObserver on this engine" branch, which deliberately fails open. So
  `{ intersect: { once: true }, resize: { gateOnIntersect: true } }` gated until the element was
  first seen and never again — the expensive handler ran for an off-screen element with nothing to
  say the gate was gone. Whether it happened at all depended on whether you had passed an `on`.
  The gate now reads a visibility record that outlives the observer, and the combination is
  **refused at bind time**: `once` and `gateOnIntersect` cancel each other out by definition.

- **A gated resize lost the `ResizeObserver`'s first observation and never asked for another.**
  Resize observations are gathered before intersection observations are delivered, so with
  `gateOnIntersect: true` the mandatory first callback was always dropped — even for an element
  visible at mount — and a real `ResizeObserver` does not re-send it for a box that has not changed
  since. The consumer got no dimensions at all until a genuine resize, possibly never. (Playground
  demo 16's "resize ticks" counter could only ever read 0.) The element is now re-observed when the
  gate re-opens.

- **The `resize:` CSS segment and `ResizeTickEvent.bracket` were always computed from the width,
  whatever `axis` said.** With `axis: 'height'`, breakpoints `{ narrow: 0, wide: 500 }` and a
  300×700 element, the handler received `bracket: 'wide'` while the same element's attribute read
  `resize:narrow` at the same instant — a stylesheet and a JS log disagreeing about the active
  breakpoint.

- **A multi-bracket jump stamped every crossing with the final label.** 200px → 800px over
  `[320, 640]` emitted `[320, '>=640']` and `[640, '>=640']`, so the threshold-320 event claimed a
  bracket the element was never in at that crossing — the field the README calls "bracket label
  entered". Each event now carries the bracket that crossing entered.

- **`on: 'text'` reported the changed text node's content under the host's name, and missed Vue's
  most common text update entirely.** `to` was the last character-data record's node while `from`
  came from the first record, so a batch touching two nodes produced a diff between two unrelated
  strings, with no field saying which node changed. README recipe 15 and playground demo 13 are a
  `contenteditable` validator (`e.to.trim().length >= 5`): the first Enter splits the content into
  two text nodes and the validator starts judging one line, reporting "too short" for a full box.
  Separately, the subscription covered only `characterData`, and `<div>{{ msg }}</div>` compiles to
  `el.textContent = …` — a childList mutation — so the commonest Vue text change produced no event
  at all. `from` and `to` are now the host's whole `textContent` across the flush, `childList` is
  subscribed alongside `characterData`, and a batch that leaves the text identical emits nothing.

- **A 0×0 box was called `square`.** `ResizeObserver` fires with 0×0 when an element goes
  `display: none`, so hiding a panel emitted landscape → square → landscape and wrote
  `resize:square` into the CSS hook, from an aspect ratio that did not exist at that moment.
  A degenerate box is unmeasured, not square: `ResizeTickEvent.orientation` is now `null` there,
  `on: 'orientation'` emits nothing, and the segment keeps its previous value.

- **`thresholds: [0]` emitted `down` crossings with no matching `up`.** The ascending rule was
  exclusive (`prev < t`) while the descending one was inclusive, and a ratio is never negative — so
  threshold `0`, the natural way to ask "tell me when it enters at all", could only ever fire
  downward, and paired enter/leave bookkeeping drifted by one every cycle.

- **Crossings were emitted on the very first callback, measured from a fabricated previous ratio of
  0.** An element that merely mounted 60% visible emitted an `up` crossing for every threshold below
  0.6, as if it had just been scrolled in; README recipe 2's infinite-scroll sentinel called
  `loadNextPage()` during mount. There is now no crossing until there is something to have crossed
  from.

- **With no `IntersectionObserver`, the CSS hook reported `intersect:hidden` forever.** README
  recipe 5 and playground demo 04 teach `.card { opacity: 0 }` plus
  `[data-observe-state*='intersect:visible'] { opacity: 1 }` — so on an older or locked-down engine
  that content was **permanently invisible**, with the JS handlers silently never firing either. The
  gate already failed open in exactly this situation; the CSS hook failed closed, and the two could
  not both be right. Every degradation now fails open, and `-` means only "this binding did not
  configure the mode".

### Changed

- **`on: 'orientation'` now fires for the first measurable orientation, with `from: null`.** It
  previously swallowed it as "the baseline", so an orientation-mode consumer received nothing at all
  until the user resized something — the layout that depends on the event never initialised, and
  playground demo 09's `e.from ?? '(initial)'` branch was unreachable. The same applies after a
  `gateOnIntersect` restore: you are told what the orientation *is*, rather than handed a flip from
  a value you never saw.
- **`ResizeBracketEvent.from` is `ResizeDimensions`, no longer `| null`.** A crossing needs two
  measurements, so the null arm was unreachable and only invited dead initial-state branches.
- **`ResizeTickEvent.orientation` is `ResizeOrientation | null`** — see the 0×0 fix above.
- **An unparseable `match` selector throws at bind time**, naming the selector, instead of being
  swallowed per-selector. With the documented single-selector form, one typo used to leave the mode
  permanently and silently dead: events built, filtered to empty, dropped. There is no `DEV` warn
  anywhere in this package, so absence was the consumer's only signal.
- **`thresholds` outside `[0, 1]` throw at bind time**, with a message naming this library.
  `IntersectionObserver`'s own `RangeError` does not, and the value is usually consumer-supplied.
  Previously the half-built state bag was published before the constructor ran, so one mistake
  produced two errors — the second and louder being `Cannot read properties of null (reading
  'disconnect')` from teardown, which sent readers hunting for a lifecycle bug that did not exist.
- **The npm tarball now contains `src/` and the entry**, not only minified `dist/`. `ARCHITECTURE.md`
  has always told consumers to take the source folder — most people copy this code rather than
  install it — and `files: ["dist"]` was the one thing that made that impossible without finding the
  repository by hand.

- **`vObserve` is typed `ObjectDirective`, not `Directive`.** `Directive` is a union with the
  function-shorthand form, so `vObserve.mounted` did not typecheck for anyone holding the exported
  object. It is assignable everywhere `Directive` was, so `app.directive('observe', vObserve)` and
  `app.use(ObservePlugin)` are unaffected.

### Internal

- **The test file was never typechecked.** `tsconfig.json` included only `vObserve.ts`, and vitest
  strips types without checking them, so the suite's "public type exports are importable
  (compile-time presence check)" test could not fail — and had already drifted from the source it
  claims to check. `include` now covers `src/`, the entry and the suite, and `npm run typecheck`
  gates it.
- `directive.ts` no longer re-implements the config swap each `setup*` function already performs.
  `mounted` and `updated` now run the same function, so a fix added to a setup path can no longer
  apply on mount and silently do nothing on a binding update.
- `data-observe-state` is derived in one place from three mode-owned segments, and
  `observeStateAttribute()` is declared to return the exported `ObserveStateAttribute` type — the
  grammar and the string that reaches the DOM are now the same object, rather than two hand-written
  copies of the same idea checked against each other.
- `gate.ts` no longer hand-maintains a list of another mode's private fields; each mode defines its
  own `resetGateBaseline` in the file that declares those fields.
- Removed defensive branches for states the types exclude (`entry.boundingClientRect?.top ?? 0`,
  which would have fed a fabricated `0` into direction inference; `entry.target !== el` on
  single-element observers; `typeof el.matches !== 'function'`), and the last four
  `as unknown as` casts (three `setTimeout` ids, now a named `TimerId`; one node narrowing, now a
  type predicate that says what it assumes and why).
- The unit suite grew from 189 to 241 declarations and gained a block driven by jsdom's **real**
  `MutationObserver` — every mutate test before this was fired by hand and never watched a real DOM
  write, which is why the configuration that froze a real browser passed.
- First browser spec: 19 checks in `playground/scripts/interactions/v-observe.mjs`, covering 13 of
  the 17 demo cards.
