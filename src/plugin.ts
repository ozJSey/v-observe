/**
 * Plugin install path — `app.use(ObservePlugin)` registers the directive
 * under the kebab-case name `observe`.
 */
import type { App, Plugin } from 'vue'
import { vObserve } from './directive'

/** Public constant for the conventional Vue directive name. */
export const DIRECTIVE_NAME = 'observe' as const

export const ObservePlugin: Plugin = {
  install(app: App) {
    app.directive(DIRECTIVE_NAME, vObserve)
  },
}
