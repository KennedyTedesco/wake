// The languages the diff highlights, loaded only when a file needs one. A curated list keeps
// the plugin small; any other file is shown without colors.
import type { LanguageRegistration } from 'shiki/core'

type Loader = () => Promise<{ default: LanguageRegistration[] }>

export const LANGUAGE_LOADERS: Record<string, Loader> = {
  astro: () => import('shiki/langs/astro.mjs'),
  // No extension maps to it: HTML, Vue, Svelte and PHP embed it.
  javascript: () => import('shiki/langs/javascript.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  dart: () => import('shiki/langs/dart.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  docker: () => import('shiki/langs/docker.mjs'),
  elixir: () => import('shiki/langs/elixir.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  graphql: () => import('shiki/langs/graphql.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  ini: () => import('shiki/langs/ini.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsonc: () => import('shiki/langs/jsonc.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  lua: () => import('shiki/langs/lua.mjs'),
  make: () => import('shiki/langs/make.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  prisma: () => import('shiki/langs/prisma.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  r: () => import('shiki/langs/r.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  scala: () => import('shiki/langs/scala.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  svelte: () => import('shiki/langs/svelte.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  vue: () => import('shiki/langs/vue.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  zig: () => import('shiki/langs/zig.mjs')
}

const BY_EXTENSION: Record<string, string> = {
  astro: 'astro',
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  fish: 'shellscript',
  c: 'c',
  h: 'c',
  // The C++ grammar alone is 780 KB, a quarter of the plugin; C colors C++ well enough in a diff.
  cc: 'c',
  cpp: 'c',
  cxx: 'c',
  hpp: 'c',
  hh: 'c',
  cs: 'csharp',
  css: 'css',
  dart: 'dart',
  diff: 'diff',
  patch: 'diff',
  ex: 'elixir',
  exs: 'elixir',
  go: 'go',
  graphql: 'graphql',
  gql: 'graphql',
  html: 'html',
  htm: 'html',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  properties: 'ini',
  java: 'java',
  // TypeScript's grammar is a superset of JavaScript's, so one grammar serves both.
  js: 'typescript',
  mjs: 'typescript',
  cjs: 'typescript',
  json: 'json',
  jsonc: 'jsonc',
  json5: 'jsonc',
  jsx: 'tsx',
  kt: 'kotlin',
  kts: 'kotlin',
  less: 'scss',
  lua: 'lua',
  mk: 'make',
  md: 'markdown',
  mdx: 'markdown',
  markdown: 'markdown',
  m: 'c',
  mm: 'c',
  php: 'php',
  prisma: 'prisma',
  py: 'python',
  pyi: 'python',
  r: 'r',
  rb: 'ruby',
  rake: 'ruby',
  gemspec: 'ruby',
  rs: 'rust',
  scala: 'scala',
  scss: 'scss',
  sass: 'scss',
  sql: 'sql',
  svelte: 'svelte',
  swift: 'swift',
  toml: 'toml',
  tsx: 'tsx',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  vue: 'vue',
  xml: 'xml',
  svg: 'xml',
  plist: 'xml',
  csproj: 'xml',
  yml: 'yaml',
  yaml: 'yaml',
  zig: 'zig'
}

const BY_NAME: Record<string, string> = {
  dockerfile: 'docker',
  makefile: 'make',
  gemfile: 'ruby',
  rakefile: 'ruby',
  '.bashrc': 'shellscript',
  '.zshrc': 'shellscript',
  '.gitconfig': 'ini',
  '.editorconfig': 'ini',
  'tsconfig.json': 'jsonc',
  'jsconfig.json': 'jsonc'
}

export function languageOf(path: string): string | null {
  const name = (path.split('/').pop() ?? path).toLowerCase()
  const byName = BY_NAME[name]
  if (byName) return byName
  if (name.startsWith('dockerfile')) return 'docker'
  const dot = name.lastIndexOf('.')
  if (dot < 0) return null
  return BY_EXTENSION[name.slice(dot + 1)] ?? null
}
