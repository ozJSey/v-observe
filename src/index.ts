/**
 * Public surface. Internal modules (state, state-attribute, gate, intersect,
 * resize, mutate, mutate-records) stay un-exported.
 */
export { vObserve, default } from './directive'
export { DIRECTIVE_NAME, ObservePlugin } from './plugin'
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
} from './types'
