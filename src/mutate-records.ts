/**
 * Mutate mode, pure half — config normalization, MutationObserverInit
 * builders, and the MutationRecord → semantic-event translation. No state,
 * no observers: everything here is a pure function over its inputs.
 *
 * Two rules this file exists to keep honest:
 *
 * - `text` is a diff of the HOST's `textContent`, never of one text node.
 *   The browser reports characterData per node, and a host with several text
 *   nodes (a contenteditable after the first Enter) would otherwise pair the
 *   `from` of one node with the `to` of another. It also subscribes to
 *   `childList`, because `<div>{{ msg }}</div>` compiles to
 *   `el.textContent = …` — a childList mutation, and the most common way a
 *   Vue app changes text.
 * - `data-observe-state` is never reported. The directive writes it, so
 *   feeding it back as an `attr:` event is the directive observing itself.
 */
import type { NormalizedMutateConfig } from './state'
import { STATE_ATTRIBUTE } from './state-attribute'
import type { MutateConfig, MutateEvent, MutateEventType } from './types'

export function normalizeMutate(cfg: MutateConfig): NormalizedMutateConfig {
  const on = cfg.on
  const types = on === undefined ? [] : Array.isArray(on) ? on : [on]
  const attrNames = new Set<string>()
  let attrAny = false
  let childList = false
  let text = false
  let removed = false
  for (const t of types) {
    if (t === 'attr:*') {
      attrAny = true
    } else if (t.startsWith('attr:')) {
      // Subscribing to the directive's own attribute is a request for a
      // feedback loop; it is dropped rather than honoured.
      const name = t.slice(5)
      if (name !== STATE_ATTRIBUTE) attrNames.add(name)
    } else if (t === 'children:added' || t === 'children:removed') {
      childList = true
    } else if (t === 'text') {
      text = true
    } else if (t === 'removed') {
      removed = true
    }
  }
  const matches = cfg.match
    ? Array.isArray(cfg.match) ? cfg.match.slice() : [cfg.match]
    : null
  return { attrNames, attrAny, childList, text, removed, matches }
}

export function buildMutateInit(norm: NormalizedMutateConfig): MutationObserverInit {
  const init: MutationObserverInit = {}
  if (norm.attrAny) {
    init.attributes = true
    init.attributeOldValue = true
  } else if (norm.attrNames.size > 0) {
    init.attributes = true
    init.attributeOldValue = true
    init.attributeFilter = Array.from(norm.attrNames)
  }
  // `text` needs childList as well: setting `el.textContent` replaces the text
  // node rather than editing it, and that is what a Vue text interpolation
  // compiles to.
  if (norm.childList || norm.text) {
    init.childList = true
  }
  if (norm.text) {
    init.characterData = true
    init.characterDataOldValue = true
    init.subtree = true
  }
  return init
}

export function buildMutateInitKey(norm: NormalizedMutateConfig): string {
  const attrPart = norm.attrAny
    ? '*'
    : Array.from(norm.attrNames).sort().join(',')
  return `a:${attrPart}|c:${norm.childList ? 1 : 0}|t:${norm.text ? 1 : 0}|r:${norm.removed ? 1 : 0}`
}

export function initHasAnyHostSignal(init: MutationObserverInit): boolean {
  return Boolean(init.attributes || init.childList || init.characterData)
}

/** Selectors are parsed once at bind time (`validate.ts`), so an unparseable
 *  one never reaches here — it threw where the consumer wrote it. */
function matchesAnySelector(el: Element, selectors: ReadonlyArray<string>): boolean {
  for (const s of selectors) {
    if (el.matches(s)) return true
  }
  return false
}

/**
 * `nodeType === 1` is the only test available here — `instanceof HTMLElement`
 * is false across realms (an iframe's children) and false for SVG, which the
 * `added` / `removed` arrays are meant to carry. A predicate rather than a
 * cast at the call site, so the assumption has one name and one comment.
 */
function isElementNode(n: Node): n is HTMLElement {
  return n.nodeType === 1
}

function filterElementNodes(nodes: ReadonlyArray<Node>): HTMLElement[] {
  return nodes.filter(isElementNode)
}

function applyMatchFilter(els: HTMLElement[], matches: ReadonlyArray<string> | null): HTMLElement[] {
  if (!matches) return els
  return els.filter((el) => matchesAnySelector(el, matches))
}

/**
 * @param lastText the host's `textContent` as of the previous dispatch — the
 *   `from` side of a `text` diff. `mutate.ts` owns it.
 */
export function recordsToEvents(
  el: HTMLElement,
  records: ReadonlyArray<MutationRecord>,
  norm: NormalizedMutateConfig,
  lastText: string | null,
): MutateEvent[] {
  const attrDiffs = new Map<string, { from: string | null }>()
  const added: HTMLElement[] = []
  const removed: HTMLElement[] = []
  let sawTextSignal = false

  for (const r of records) {
    if (r.type === 'attributes') {
      const name = r.attributeName
      if (!name) continue
      if (name === STATE_ATTRIBUTE) continue
      // `text` turns on `subtree`, which widens the attribute subscription to
      // descendants — those are not the host's attributes.
      if (r.target !== el) continue
      if (!norm.attrAny && !norm.attrNames.has(name)) continue
      if (!attrDiffs.has(name)) {
        attrDiffs.set(name, { from: r.oldValue ?? null })
      }
    } else if (r.type === 'childList') {
      // Any childList record can have changed the host's text, including one
      // on a descendant (`subtree` is on when `text` is subscribed).
      sawTextSignal = true
      if (!norm.childList) continue
      if (r.target !== el) continue
      for (const node of filterElementNodes(Array.from(r.addedNodes))) added.push(node)
      for (const node of filterElementNodes(Array.from(r.removedNodes))) removed.push(node)
    } else if (r.type === 'characterData') {
      sawTextSignal = true
    }
  }

  const events: MutateEvent[] = []
  for (const [name, diff] of attrDiffs) {
    events.push({
      type: `attr:${name}` as MutateEventType,
      name,
      from: diff.from,
      to: el.getAttribute(name),
      target: el,
    })
  }

  const addedFiltered = applyMatchFilter(added, norm.matches)
  const removedFiltered = applyMatchFilter(removed, norm.matches)
  if (addedFiltered.length > 0) {
    events.push({
      type: 'children:added',
      added: addedFiltered,
      target: el,
    })
  }
  if (removedFiltered.length > 0) {
    events.push({
      type: 'children:removed',
      removed: removedFiltered,
      target: el,
    })
  }
  if (norm.text && sawTextSignal) {
    const to = el.textContent
    // A childList record that reordered elements without touching text is not
    // a text edit, and neither is a characterData record that restored the
    // previous string.
    if (to !== lastText) {
      events.push({ type: 'text', from: lastText, to, target: el })
    }
  }
  return events
}

export function mergePendingEvent(existing: MutateEvent, next: MutateEvent): void {
  if (next.type === 'children:added') {
    const a = existing.added ?? []
    existing.added = a.concat(next.added ?? [])
    return
  }
  if (next.type === 'children:removed') {
    const a = existing.removed ?? []
    existing.removed = a.concat(next.removed ?? [])
    return
  }
  // attr:* and text — keep `from` from the first event, update `to` to latest.
  existing.to = next.to
}
