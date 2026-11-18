import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import './smaltdb.css'
import { withSmaltworks } from './stage'
import { enablePlaygrounds } from './playground'
import { smaltlpRunner } from './smaltlp'

export default {
  extends: DefaultTheme,
  Layout: withSmaltworks({ Layout: DefaultTheme.Layout }),
  enhanceApp() {
    // Every ts example runs where it stands (BRAND.md, Documentation, rule 7), in one scope per page (theme/smaltlp.ts).
    if (typeof document !== 'undefined') enablePlaygrounds({ runners: { ts: smaltlpRunner() } })
  },
} satisfies Theme
