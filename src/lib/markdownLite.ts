import { createElement, Fragment, type ReactNode } from 'react'

/**
 * Tiny markdown-ish renderer for ProjectPulse.
 *
 * - `renderInline(text)` handles **bold**, `code` and [n] citation tokens.
 * - `splitBlocks(body)` breaks a body into paragraphs and "- " list items.
 * - `renderBlocks(body)` renders those blocks as React nodes.
 *
 * Everything is built as React elements — no dangerouslySetInnerHTML,
 * no dependencies, so untrusted evidence text can never inject markup.
 */

const INLINE_RE = /(\*\*[^*]+\*\*|`[^`]+`|\[\d+\])/g

const CITATION_RE = /^\[\d+\]$/

export function renderInline(text: string): ReactNode {
  if (!text) return null
  const parts = text.split(INLINE_RE)
  if (parts.length === 1) return text

  return parts.map((part, i) => {
    if (!part) return null
    if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
      return createElement('strong', { key: i, className: 'ph-i-strong' }, part.slice(2, -2))
    }
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
      return createElement('code', { key: i, className: 'ph-i-code' }, part.slice(1, -1))
    }
    if (CITATION_RE.test(part)) {
      return createElement(
        'span',
        { key: i, className: 'ph-i-cite', 'aria-label': `citation ${part.slice(1, -1)}` },
        part,
      )
    }
    return createElement(Fragment, { key: i }, part)
  })
}

export type MdBlock =
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: string[] }

const LIST_RE = /^(?:[-*•]|\d+[.)])\s+(.*)$/
const HEADING_RE = /^#{1,4}\s+(.*)$/

/** Split a body into paragraphs and list runs. Blank lines separate blocks. */
export function splitBlocks(body: string): MdBlock[] {
  const out: MdBlock[] = []
  if (!body) return out

  const lines = body.replace(/\r\n?/g, '\n').split('\n')
  let para: string[] = []
  let list: string[] = []

  const flushPara = () => {
    if (para.length) {
      out.push({ kind: 'p', text: para.join(' ') })
      para = []
    }
  }
  const flushList = () => {
    if (list.length) {
      out.push({ kind: 'ul', items: list })
      list = []
    }
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      flushPara()
      flushList()
      continue
    }
    const listMatch = LIST_RE.exec(line)
    if (listMatch) {
      flushPara()
      list.push(listMatch[1])
      continue
    }
    flushList()
    const heading = HEADING_RE.exec(line)
    para.push(heading ? heading[1] : line)
  }
  flushPara()
  flushList()
  return out
}

/** Render a full body: paragraphs, dash lists, inline tokens. */
export function renderBlocks(body: string): ReactNode {
  const blocks = splitBlocks(body)
  if (!blocks.length) return null
  return createElement(
    'div',
    { className: 'ph-prose' },
    blocks.map((block, i) =>
      block.kind === 'p'
        ? createElement('p', { key: `b${i}` }, renderInline(block.text))
        : createElement(
            'ul',
            { key: `b${i}` },
            block.items.map((item, j) => createElement('li', { key: `i${j}` }, renderInline(item))),
          ),
    ),
  )
}
