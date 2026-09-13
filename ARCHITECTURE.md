# Architecture

`vObserve.ts` is the build entry; it re-exports `src/index.ts`. Each module has one purpose;
dependencies point strictly downward — no cycles.

```
vObserve.ts                entry — re-exports src/index
└── src/
    ├── index.ts           public surface: vObserve, ObservePlugin, DIRECTIVE_NAME, types
    ├── plugin.ts          ObservePlugin + DIRECTIVE_NAME
    ├── directive.ts       lifecycle wiring: validate → per-mode setup/swap/teardown
    ├── intersect.ts       IO wiring, direction inference, crossed math, once collapse
    ├── resize.ts          RO wiring, breakpoint brackets, orientation, box reads, debounce
    ├── mutate.ts          MO wiring (host + parent), debounce merge, dispatch, cooldown
    ├── mutate-records.ts  pure half of mutate: normalization + record→event translation
    ├── gate.ts            gateOnIntersect: suppression, baseline restore, validation
    ├── state.ts           internal per-mode state shapes + the WeakMap store
    ├── state-attribute.ts data-observe-state segments — one owner per mode
    └── types.ts           all public types
```

Mode isolation is the design rule: `intersect.ts`, `resize.ts` and `mutate.ts` never import each
other. The two places modes genuinely interact are explicit modules — `gate.ts` (resize/mutate
suppressed while intersect reports hidden, baselines reset on restore) and `state-attribute.ts`
(each mode writes only its own segment of the shared attribute).

Copy-paste consumers: every file under `src/` plus the entry is self-contained TypeScript with no
dependencies beyond the `vue` peer — take the folder as-is. If you only need one mode, take
`types + state + state-attribute + gate + <mode>` and wire it in a 20-line directive.
