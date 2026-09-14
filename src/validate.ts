/**
 * Bind-time option validation — the combinations that cannot work, rejected
 * loudly at the point the mistake was made.
 *
 * Everything here is a config error the consumer can fix by editing the
 * binding. The alternative to throwing is a mode that is silently dead (an
 * invalid `match` selector), a gate that silently stops gating (`once` +
 * `gateOnIntersect`), or a browser exception from inside a constructor whose
 * message never mentions this library (a threshold outside `[0, 1]`).
 *
 * Leaf module: imports only types.
 */
import type { ObserveOptions } from './types'

function fail(message: string): never {
  throw new Error(`[v-observe] ${message}`)
}

function validateThresholds(thresholds: number[] | undefined): void {
  if (!thresholds) return
  for (const t of thresholds) {
    if (!Number.isFinite(t) || t < 0 || t > 1) {
      fail(
        `intersect.thresholds must be numbers between 0 and 1 — got ${JSON.stringify(t)}. ` +
          'IntersectionObserver rejects anything else.',
      )
    }
  }
}

function validateSelectors(match: string | string[] | undefined): void {
  if (match === undefined) return
  const selectors = Array.isArray(match) ? match : [match]
  for (const selector of selectors) {
    try {
      document.createDocumentFragment().querySelector(selector)
    } catch {
      fail(
        `mutate.match received the invalid selector ${JSON.stringify(selector)}. ` +
          'A selector that never parses would filter every child out and the mode would look dead.',
      )
    }
  }
}

export function validateOptions(opts: ObserveOptions): void {
  const gated = opts.resize?.gateOnIntersect
    ? 'resize'
    : opts.mutate?.gateOnIntersect
      ? 'mutate'
      : null

  if (gated && !opts.intersect) {
    fail(
      `${gated}.gateOnIntersect requires an intersect config — set \`intersect: { ... }\` ` +
        `alongside \`${gated}: { gateOnIntersect: true }\`.`,
    )
  }
  if (gated && opts.intersect?.once) {
    fail(
      `${gated}.gateOnIntersect cannot be combined with intersect.once — \`once\` disconnects the ` +
        'observer after the first visible tick, and a gate with no live observer stops gating.',
    )
  }

  validateThresholds(opts.intersect?.thresholds)
  validateSelectors(opts.mutate?.match)
}
