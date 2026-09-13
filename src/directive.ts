/**
 * The directive — lifecycle wiring only. Validates the option shape, then
 * delegates each configured mode to its own module; `updated` diffs mode
 * presence (setup / cfg-swap / teardown) and keeps the state attribute's
 * segments truthful.
 */
import type { Directive, DirectiveBinding } from 'vue'
import { validateOptions } from './gate'
import { setupIntersect, teardownIntersect } from './intersect'
import { setupMutate, teardownMutate } from './mutate'
import { normalizeBreakpoints, setupResize, teardownResize } from './resize'
import { getOrCreate, stateMap } from './state'
import { writeStateAttribute } from './state-attribute'
import type { ObserveOptions } from './types'

function resolveBinding(value: ObserveOptions | undefined): ObserveOptions {
  return value ?? {}
}

export const vObserve: Directive<HTMLElement, ObserveOptions | undefined> = {
  mounted(el: HTMLElement, binding: DirectiveBinding<ObserveOptions | undefined>) {
    const opts = resolveBinding(binding.value)
    validateOptions(opts)
    const state = getOrCreate(el, opts)
    writeStateAttribute(el, state.segments)
    if (opts.intersect) {
      setupIntersect(el, opts.intersect, opts)
    }
    if (opts.resize) {
      setupResize(el, opts.resize, opts)
    }
    if (opts.mutate) {
      setupMutate(el, opts.mutate, opts)
    }
  },

  updated(el: HTMLElement, binding: DirectiveBinding<ObserveOptions | undefined>) {
    const next = resolveBinding(binding.value)
    validateOptions(next)
    const state = stateMap.get(el)

    if (next.intersect) {
      if (state?.intersect) {
        state.intersect.cfg = next.intersect
      } else {
        setupIntersect(el, next.intersect, next)
      }
    } else if (state?.intersect) {
      teardownIntersect(el)
      if (state) state.segments.intersect = '-'
    }

    if (next.resize) {
      if (state?.resize) {
        state.resize.cfg = next.resize
        state.resize.normalized = normalizeBreakpoints(next.resize.breakpoints)
      } else {
        setupResize(el, next.resize, next)
      }
    } else if (state?.resize) {
      teardownResize(el)
      if (state) state.segments.resize = '-'
    }

    if (next.mutate) {
      setupMutate(el, next.mutate, next)
    } else if (state?.mutate) {
      teardownMutate(el)
      if (state) state.segments.mutate = '-'
    }

    if (state) writeStateAttribute(el, state.segments)
  },

  unmounted(el: HTMLElement) {
    teardownIntersect(el)
    teardownResize(el)
    teardownMutate(el)
    stateMap.delete(el)
    el.removeAttribute('data-observe-state')
  },
}

export default vObserve
