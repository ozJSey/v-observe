/**
 * The unified `data-observe-state` CSS hook. Each mode owns exactly one
 * segment; writing one never clobbers the others because every write goes
 * through the full `StateSegments` snapshot kept per element.
 */
import type { ObserveOptions } from './types'

export type IntersectSegment = 'visible' | 'hidden' | '-'
export type ResizeSegment = string
export type MutateSegment = 'active' | 'idle' | '-'

export interface StateSegments {
  intersect: IntersectSegment
  resize: ResizeSegment
  mutate: MutateSegment
}

export function initialSegments(opts: ObserveOptions): StateSegments {
  return {
    intersect: opts.intersect ? 'hidden' : '-',
    resize: opts.resize ? 'idle' : '-',
    mutate: opts.mutate ? 'idle' : '-',
  }
}

export function writeStateAttribute(el: HTMLElement, segs: StateSegments): void {
  el.setAttribute(
    'data-observe-state',
    `intersect:${segs.intersect};resize:${segs.resize};mutate:${segs.mutate}`,
  )
}
