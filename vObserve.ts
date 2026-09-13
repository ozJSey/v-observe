/**
 * Build entry point — re-exports the public surface from `src/`.
 *
 * The split keeps each concern in a single-purpose module (types / state /
 * state-attribute / gate / intersect / resize / mutate + mutate-records /
 * directive / plugin) without changing the bundle: tsup follows this entry
 * and emits the same minified files. See ARCHITECTURE.md for the module map.
 */
export { vObserve, default, DIRECTIVE_NAME, ObservePlugin } from './src'
export type {
  IntersectConfig,
  IntersectCrossEvent,
  IntersectDirection,
  IntersectEvent,
  MutateConfig,
  MutateEvent,
  MutateEventType,
  ObserveOptions,
  ObserveStateAttribute,
  ResizeBox,
  ResizeBracketEvent,
  ResizeConfig,
  ResizeDimensions,
  ResizeEvent,
  ResizeMode,
  ResizeOrientation,
  ResizeOrientationEvent,
  ResizeTickEvent,
} from './src'
