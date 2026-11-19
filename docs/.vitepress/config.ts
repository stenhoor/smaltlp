import { defineConfig } from 'vitepress'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { smaltLight, smaltDark } from './theme/shiki'
import { smaltworksMenu, smaltworksFooter } from './theme/smaltworks'
import { playgroundPlugin } from './theme/playground'
import { agentDocs, packageVersion } from './theme/agents'

const here = path.dirname(fileURLToPath(import.meta.url))
const REPO = 'https://github.com/stenhoor/smaltlp'
// GitHub Pages serves the site under the repository's name.
const BASE = process.env.SMALTLP_BASE ?? '/smaltlp/'

export default defineConfig({
  title: 'smaltlp',
  description: 'Linear and integer programming for smaltdb, in the browser.',
  base: BASE,
  cleanUrls: true,
  lastUpdated: false,
  // Markdown for AI agents beside the pages: a twin of each page, /llms.txt and /agents.md (BRAND.md, Documentation).
  buildEnd: (config) => {
    agentDocs(config, {
      product: 'smaltlp',
      version: packageVersion(path.resolve(here, '../../package.json')),
      url: `https://stenhoor.github.io${BASE}`,
      intro: 'guide/agents.md',
      guide: ['reference/'],
    })
  },
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${BASE}favicon-32.svg` }],
    ['meta', { property: 'og:title', content: 'smaltlp' }],
    ['meta', { property: 'og:description', content: 'Small. Alternative. Optimal. Linear and integer programming for smaltdb, in the browser.' }],
    ['meta', { property: 'og:image', content: 'https://raw.githubusercontent.com/stenhoor/smalt-brand/main/social/smaltlp.png' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;700&family=Geist+Mono:wght@400;500&family=Martian+Mono:wght@400;600&display=swap' }],
  ],
  vite: {
    resolve: {
      alias: [
        { find: /^@smaltworks\/smaltlp$/, replacement: path.resolve(here, '../../src/index.ts') },
        { find: /^@smaltworks\/smaltlp\/(.*)$/, replacement: path.resolve(here, '../../src/$1/index.ts') },
      ],
    },
    worker: { format: 'es' },
  },
  markdown: {
    theme: { light: smaltLight, dark: smaltDark },
    config(md) {
      // Every ts example runs where it stands (BRAND.md, Documentation, rule 7; theme/smaltlp.ts).
      md.use(playgroundPlugin, { languages: ['ts'] })
      // Links that leave docs/ point at the file on GitHub.
      const fallback = md.renderer.rules.link_open ?? ((t, i, o, _e, s) => s.renderToken(t, i, o))
      md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
        const href = tokens[idx].attrGet('href')
        if (href && !/^[a-z]+:|^#|^\//i.test(href) && env?.relativePath) {
          const target = path.posix.normalize(path.posix.join(path.posix.dirname(env.relativePath), href))
          if (target.startsWith('../')) {
            tokens[idx].attrSet('href', `${REPO}/blob/HEAD/${target.slice(3)}`)
            tokens[idx].attrSet('target', '_blank')
            tokens[idx].attrSet('rel', 'noreferrer')
          }
        }
        return fallback(tokens, idx, options, env, self)
      }
    },
  },
  themeConfig: {
    logo: { light: '/lockup.svg', dark: '/lockup-on-dark.svg', alt: 'smaltlp' },
    siteTitle: false,
    // The four sections of every smalt site (BRAND.md, Documentation, rule 1).
    nav: [
      { text: 'Quick start', link: '/guide/quick-start' },
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Reference', link: '/reference/' },
      { text: 'Playground', link: '/playground' },
      smaltworksMenu(),
    ],
    sidebar: [
      { text: 'Quick start', items: [{ text: 'Quick start', link: '/guide/quick-start' }] },
      {
        text: 'Getting started',
        items: [
          { text: 'Installation', link: '/guide/getting-started' },
          { text: 'For AI agents', link: '/guide/agents' },
        ],
      },
      {
        text: 'User guide',
        items: [
          { text: 'Solving from matrices', link: '/guide/matrices' },
          { text: 'Building a model', link: '/guide/models' },
          { text: 'Integer programs', link: '/guide/integers' },
          { text: 'Reading duals', link: '/guide/duals' },
          { text: 'MPS and LP files', link: '/guide/mps' },
          { text: 'Models from tables', link: '/guide/tables' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Overview', link: '/reference/' },
          { text: 'linprog', link: '/reference/linprog' },
          { text: 'milp', link: '/reference/milp' },
          {
            text: 'Modelling',
            collapsed: false,
            items: [
              { text: 'LpProblem', link: '/reference/model/lp-problem' },
              { text: 'LpVariable', link: '/reference/model/lp-variable' },
              { text: 'LpAffineExpression', link: '/reference/model/lp-affine-expression' },
              { text: 'LpConstraint', link: '/reference/model/lp-constraint' },
              { text: 'lpSum, lpDot', link: '/reference/model/lp-sum' },
              { text: 'value', link: '/reference/model/value' },
              { text: 'LpSolveStatus', link: '/reference/model/lp-solve-status' },
            ],
          },
          {
            text: 'Model files',
            collapsed: false,
            items: [
              { text: 'readMps', link: '/reference/io/read-mps' },
              { text: 'readLp', link: '/reference/io/read-lp' },
              { text: 'writeMps', link: '/reference/io/write-mps' },
              { text: 'writeLp', link: '/reference/io/write-lp' },
              { text: 'mpsToProblem', link: '/reference/io/mps-to-problem' },
              { text: 'problemToModel', link: '/reference/io/problem-to-model' },
            ],
          },
          {
            text: 'Tables',
            collapsed: false,
            items: [
              { text: 'addVariables', link: '/reference/tables/add-variables' },
              { text: 'dotColumn', link: '/reference/tables/dot-column' },
              { text: 'addConstraints', link: '/reference/tables/add-constraints' },
              { text: 'variableRows, constraintRows, withColumn', link: '/reference/tables/results' },
            ],
          },
          {
            text: 'Worker',
            collapsed: false,
            items: [
              { text: 'startWorker', link: '/reference/worker/start-worker' },
              { text: 'connect, serve', link: '/reference/worker/connect' },
            ],
          },
          { text: 'Errors', link: '/reference/errors' },
          { text: 'Where smaltlp differs', link: '/reference/divergences' },
          {
            text: 'Internals',
            collapsed: true,
            items: [{ text: 'Benchmarks', link: '/research/benchmarks' }],
          },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: REPO }],
    search: { provider: 'local' },
    outline: { level: [2, 3] },
    footer: smaltworksFooter(BASE),
  },
})
