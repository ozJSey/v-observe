/**
 * The directive — lifecycle wiring only.
 *
 * `mounted` and `updated` run the SAME function. There is no separate
 * "swap the cfg" path here: each mode's `setup*` already decides whether the
 * call is a first wiring, a cheap cfg swap, or a rebuild, because only that
 * module knows which of its options can be changed on a live observer. This
 * file used to re-implement two of the three swaps and skip the third, so a
 * fix added to a setup function applied on mount and silently did nothing on
 * a binding update.
 *
 * The only thing this file owns is `state.configured` — which modes THIS
 * binding asks for, which is what makes a `data-observe-state` segment `'-'`.
 */
import type { DirectiveBinding, ObjectDirective } from 'vue'
import { setupIntersect, teardownIntersect } from './intersect'
import { setupMutate, teardownMutate } from './mutate'
import { setupResize, teardownResize } from './resize'
import { getOrCreate, stateMap } from './state'
import { STATE_ATTRIBUTE, writeStateAttribute } from './state-attribute'
import type { ObserveOptions } from './types'
import { validateOptions } from './validate'

function apply(el: HTMLElement, opts: ObserveOptions): void {
  validateOptions(opts)
  const state = getOrCreate(el)

  // Set before any setup runs: a mode that cannot wire up (missing global)
  // is still configured, and the segment must say so.
  state.configured.intersect = opts.intersect !== undefined
  state.configured.resize = opts.resize !== undefined
  state.configured.mutate = opts.mutate !== undefined

  if (opts.intersect) setupIntersect(el, opts.intersect, state)
  else teardownIntersect(el)

  if (opts.resize) setupResize(el, opts.resize, state)
  else teardownResize(el)

  if (opts.mutate) setupMutate(el, opts.mutate, state)
  else teardownMutate(el)

  writeStateAttribute(el, state)
}

/**
 * Declared as `ObjectDirective`, not `Directive`. `Directive` is a union with
 * the function-shorthand form, so `vObserve.mounted` does not typecheck for a
 * consumer (or a test) holding the exported object — which is how this
 * package's own suite ended up excluded from `tsc` entirely.
 */
export const vObserve: ObjectDirective<HTMLElement, ObserveOptions | undefined> = {
  mounted(el: HTMLElement, binding: DirectiveBinding<ObserveOptions | undefined>) {
    apply(el, binding.value ?? {})
  },

  updated(el: HTMLElement, binding: DirectiveBinding<ObserveOptions | undefined>) {
    apply(el, binding.value ?? {})
  },

  unmounted(el: HTMLElement) {
    teardownIntersect(el)
    teardownResize(el)
    teardownMutate(el)
    stateMap.delete(el)
    el.removeAttribute(STATE_ATTRIBUTE)
  },
}

export default vObserve
