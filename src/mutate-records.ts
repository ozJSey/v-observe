/**
 * Mutate mode, pure half — config normalization, MutationObserverInit
 * builders, and the MutationRecord → semantic-event translation. No state,
 * no observers: everything here is a pure function over its inputs.
 */
import type { NormalizedMutateConfig } from './state'
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
      attrNames.add(t.slice(5))
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
  if (norm.childList) {
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

function matchesAnySelector(el: Element, selectors: ReadonlyArray<string>): boolean {
  if (typeof el.matches !== 'function') return false
  for (const s of selectors) {
    try {
      if (el.matches(s)) return true
    } catch {
      // Invalid selector — treat as non-match.
    }
  }
  return false
}

function filterElementNodes<T extends Node>(nodes: ReadonlyArray<T>): HTMLElement[] {
  const out: HTMLElement[] = []
  for (const n of nodes) {
    if (n.nodeType === 1) out.push(n as unknown as HTMLElement)
  }
  return out
}

function applyMatchFilter(els: HTMLElement[], matches: ReadonlyArray<string> | null): HTMLElement[] {
  if (!matches) return els
  return els.filter((el) => matchesAnySelector(el, matches))
}

export function recordsToEvents(
  el: HTMLElement,
  records: ReadonlyArray<MutationRecord>,
  norm: NormalizedMutateConfig,
): MutateEvent[] {
  const attrDiffs = new Map<string, { from: string | null }>()
  const added: HTMLElement[] = []
  const removed: HTMLElement[] = []
  let textFirstFrom: string | null = null
  let textTarget: Node | null = null
  let hasTextSeen = false

  for (const r of records) {
    if (r.type === 'attributes') {
      const name = r.attributeName
      if (!name) continue
      if (!norm.attrAny && !norm.attrNames.has(name)) continue
      if (!attrDiffs.has(name)) {
        attrDiffs.set(name, { from: r.oldValue ?? null })
      }
    } else if (r.type === 'childList') {
      if (!norm.childList) continue
      if (r.target !== el) continue
      for (const node of filterElementNodes(Array.from(r.addedNodes))) added.push(node)
      for (const node of filterElementNodes(Array.from(r.removedNodes))) removed.push(node)
    } else if (r.type === 'characterData') {
      if (!norm.text) continue
      if (!hasTextSeen) {
        textFirstFrom = r.oldValue ?? null
        hasTextSeen = true
      }
      textTarget = r.target
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
  if (textTarget) {
    events.push({
      type: 'text',
      from: textFirstFrom,
      to: (textTarget as { textContent: string | null }).textContent ?? null,
      target: el,
    })
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
