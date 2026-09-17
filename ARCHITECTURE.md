# Architecture

`vObserve.ts` is the build entry; it re-exports `src/index.ts`. Each module has one purpose;
dependencies point strictly downward — no cycles.

```
vObserve.ts                entry — re-exports src/index
└── src/
    ├── index.ts           public surface: vObserve, ObservePlugin, DIRECTIVE_NAME, types
    ├── plugin.ts          ObservePlugin + DIRECTIVE_NAME
    ├── directive.ts       lifecycle wiring: validate → set `configured` → per-mode setup/teardown
    ├── intersect.ts       IO wiring, observer rebuilds, direction inference, crossed math, once collapse
    ├── resize.ts          RO wiring, observed box, breakpoint brackets, orientation, debounce
    ├── mutate.ts          MO wiring (host + parent), debounce merge, dispatch, cooldown
    ├── mutate-records.ts  pure half of mutate: normalization + record→event translation
    ├── gate.ts            gateOnIntersect: suppression + baseline restore
    ├── validate.ts        bind-time option validation (leaf: imports only types)
    ├── state.ts           internal per-mode state shapes + the WeakMap store
    ├── state-attribute.ts derives `data-observe-state` from the state (leaf: imports only types)
    └── types.ts           all public types
```

## The invariants, and what enforces each

Every line below names a mechanism. A rule that only lives in this file is a rule the next edit
breaks, which is what happened to the three that used to be here.

**Each mode owns exactly one segment of `data-observe-state`.** *Enforced by the shape of the
code.* Each mode's segment lives inside that mode's own internal state (`ResizeInternal.segment`,
`MutateInternal.segment`; intersect's is derived from `ObserveState.visibility`), and no mode holds
a reference to another mode's internal — so `resize.ts` physically cannot write the mutate segment.
The attribute is never assembled by its writers: `state-attribute.ts` reads the three places and
formats them, and it is the only `setAttribute` call in the package.

**The attribute's grammar and the string that reaches the DOM cannot drift.** *Enforced by the
type system.* `observeStateAttribute()` is declared to return the exported `ObserveStateAttribute`
template-literal type, so a change to the format is a compile error unless the type changes with
it. The test suite additionally parses every string the directive writes during a full run.

**A gated mode's baseline is fully cleared on restore.** *Enforced by locality.* `gate.ts` no
longer knows which fields those are: it calls each mode's own `resetGateBaseline`, defined in the
module that declares the fields. A new baseline field is reset in the same file that adds it, in
the same edit.

**Observer construction options are never stale.** *Enforced by comparison, not by discipline.*
`root` / `rootMargin` / `thresholds` cannot be changed on a live `IntersectionObserver`, and Vue
evaluates a binding object during render — before template refs are assigned — so the first value
of `root` is always `null`. `intersect.ts` keeps the construction options in `internal.key` and
rebuilds when they change. `resize.ts` does the same for `box`, which is passed to `observe()`.

**Mode isolation: `intersect.ts`, `resize.ts` and `mutate.ts` never import each other.** *Enforced
by nothing but the import list* — there is no lint rule here. The two places modes genuinely
interact are separate modules by design: `gate.ts` (suppression + restore) and `state-attribute.ts`
(the shared attribute). If you find yourself importing one mode from another, that interaction
belongs in one of those two.

**A children subscription is filtered at delivery, and the `added` / `removed` arrays have exactly
one writer.** *Enforced by locality.* `childList: true` is a single init flag covering both
directions, so the init cannot separate `children:added` from `children:removed` — only
`recordsToEvents` can, and the filter lives at the one place the two arrays are appended to. The
event builders below it read the arrays and know nothing about the subscription, so a new children
event cannot reintroduce a second copy of the check. This is what collapsing both types into one
`childList` flag cost until 0.2.1: every one-sided subscriber received the other half too.

**Bad options fail where they were written.** `validate.ts` runs first in `mounted` and `updated`.
It rejects the combinations whose alternative is a silent death: `once` + `gateOnIntersect` (a gate
with no live observer stops gating), a threshold outside `[0, 1]` (the constructor throws with a
message that never mentions this library), an unparseable `match` selector (the mode filters
everything out and looks dead).

## Copy-paste consumers

Every file under `src/` plus the entry is self-contained TypeScript with no dependencies beyond the
`vue` peer — take the folder as-is. Since 0.2.0 the published tarball contains `src/` as well as
`dist/`, so `node_modules/@ozjsey/v-observe/src/` is the readable copy; you do not have to find the
repository.

If you only need one mode, take `types + state + state-attribute + validate + <mode>` and wire it
in a 20-line directive. `gate.ts` is needed only if you want `gateOnIntersect`; drop
`resetGateBaseline` from the internal and the mode compiles without it.
