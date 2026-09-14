/**
 * The unified `data-observe-state` CSS hook.
 *
 * The attribute is DERIVED here, never assembled by its writers: each mode
 * keeps its own segment inside its own internal state, and this module reads
 * those three places and formats them. A mode holds no reference to another
 * mode's internal, so "each mode owns exactly one segment" is enforced by the
 * shape of the code rather than by everyone remembering it.
 *
 * Leaf module: imports only types.
 */
import type { ObserveStateAttribute } from './types'

export type IntersectSegment = 'visible' | 'hidden' | '-'
export type ResizeSegment = string
export type MutateSegment = 'active' | 'idle' | '-'

/** See `ObserveState.visibility` — declared here because the intersect segment
 *  is derived from it, which keeps this module a leaf. */
export type IntersectVisibility = 'unwired' | 'hidden' | 'visible'

/**
 * The segment a mode shows when the binding configures it but no observer is
 * live — an engine without the global, or intersect after a `once` collapse.
 * Every one of these fails OPEN, matching `isGated`: content that reveals
 * itself on `intersect:visible` must not stay invisible forever because the
 * browser is old.
 */
const UNOBSERVED: { intersect: IntersectSegment; resize: ResizeSegment; mutate: MutateSegment } = {
  intersect: 'visible',
  resize: 'idle',
  mutate: 'idle',
}

/**
 * The minimum `ObserveState` shape this module needs. Declared structurally so
 * the dependency points downward: `state.ts` → `state-attribute.ts` → `types`.
 */
export interface SegmentSource {
  configured: { intersect: boolean; resize: boolean; mutate: boolean }
  visibility: IntersectVisibility
  resize?: { segment: ResizeSegment }
  mutate?: { segment: MutateSegment }
  written: string | null
}

function intersectSegment(state: SegmentSource): IntersectSegment {
  if (!state.configured.intersect) return '-'
  if (state.visibility === 'unwired') return UNOBSERVED.intersect
  return state.visibility
}

function resizeSegment(state: SegmentSource): ResizeSegment {
  if (!state.configured.resize) return '-'
  return state.resize?.segment ?? UNOBSERVED.resize
}

function mutateSegment(state: SegmentSource): MutateSegment {
  if (!state.configured.mutate) return '-'
  return state.mutate?.segment ?? UNOBSERVED.mutate
}

/** The grammar and the string are the same thing: this is the only builder,
 *  and its declared return type is the exported `ObserveStateAttribute`. */
export function observeStateAttribute(state: SegmentSource): ObserveStateAttribute {
  return `intersect:${intersectSegment(state)};resize:${resizeSegment(state)};mutate:${mutateSegment(state)}`
}

/**
 * Write the attribute, but only when it actually changed. `setAttribute`
 * queues a MutationRecord even for an identical value, which is how
 * `mutate: { on: 'attr:*' }` used to observe the directive's own writes and
 * loop forever; it is also a wasted style invalidation on every tick.
 */
export function writeStateAttribute(el: HTMLElement, state: SegmentSource): void {
  const next = observeStateAttribute(state)
  if (next === state.written) return
  state.written = next
  el.setAttribute('data-observe-state', next)
}

/** The attribute the directive writes — never reported as a mutation, since
 *  the directive is the one writing it. */
export const STATE_ATTRIBUTE = 'data-observe-state'
