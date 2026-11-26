// A small, safe markdown reader for the article files: headings, paragraphs, lists, tables, bold, italic, code and links to this site only.
// The same parsed text is drawn by React in the app and written as plain HTML by the build, so the two cannot differ.
export type Inline = { t: 'text'; v: string } | { t: 'b' | 'i'; c: Inline[] } | { t: 'code'; v: string } | { t: 'a'; href: string; c: Inline[] };
export type Block = { t: 'h2'; c: Inline[] } | { t: 'p'; c: Inline[] } | { t: 'ul'; items: Inline[][] } | { t: 'ol'; items: Inline[][] } | { t: 'table'; head: Inline[][]; rows: Inline[][][] };

export interface Article {
  title: string;
  description: string;
  short: string;
  checked: string;
  heading: Inline[];
  blocks: Block[];
}

const PATTERNS: { re: RegExp; make: (m: RegExpExecArray) => Inline }[] = [
  { re: /\[([^\]]+)\]\((\/[^)\s]*)\)/, make: (m) => ({ t: 'a', href: m[2] as string, c: inline(m[1] as string) }) },
  { re: /\*\*(.+?)\*\*/, make: (m) => ({ t: 'b', c: inline(m[1] as string) }) },
  { re: /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/, make: (m) => ({ t: 'i', c: inline(m[1] as string) }) },
  { re: /`([^`]+)`/, make: (m) => ({ t: 'code', v: m[1] as string }) },
];

export function inline(text: string): Inline[] {
  let best: { index: number; length: number; node: Inline } | null = null;
  for (const { re, make } of PATTERNS) {
    const m = re.exec(text);
    if (m && (best === null || m.index < best.index)) best = { index: m.index, length: m[0].length, node: make(m) };
  }
  if (!best) return text ? [{ t: 'text', v: text }] : [];
  return [...(best.index > 0 ? [{ t: 'text', v: text.slice(0, best.index) } as Inline] : []), best.node, ...inline(text.slice(best.index + best.length))];
}

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

export function parseArticle(source: string): Article {
  const text = source.replace(/\r\n/g, '\n');
  const meta: Record<string, string> = {};
  let body = text;
  if (text.startsWith('---\n')) {
    const end = text.indexOf('\n---\n', 4);
    if (end > 0) {
      for (const line of text.slice(4, end).split('\n')) {
        const at = line.indexOf(':');
        if (at > 0) meta[line.slice(0, at).trim()] = line.slice(at + 1).trim();
      }
      body = text.slice(end + 5);
    }
  }
  const lines = body.split('\n');
  const blocks: Block[] = [];
  let heading: Inline[] = [];
  let i = 0;
  const special = (line: string) => /^(#{1,2} |- |\d+\. |\||---)/.test(line);
  while (i < lines.length) {
    const line = (lines[i] as string).trimEnd();
    if (!line.trim()) {
      i += 1;
    } else if (line.startsWith('# ')) {
      heading = inline(line.slice(2).trim());
      i += 1;
    } else if (line.startsWith('## ')) {
      blocks.push({ t: 'h2', c: inline(line.slice(3).trim()) });
      i += 1;
    } else if (/^---+$/.test(line)) {
      i += 1;
    } else if (line.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] as string).trim().startsWith('|')) {
        rows.push(cells(lines[i] as string));
        i += 1;
      }
      const data = rows.filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c)));
      const [head = [], ...rest] = data;
      blocks.push({ t: 'table', head: head.map(inline), rows: rest.map((r) => r.map(inline)) });
    } else if (/^(- |\d+\. )/.test(line)) {
      const ordered = /^\d+\. /.test(line);
      const items: Inline[][] = [];
      while (i < lines.length && (ordered ? /^\d+\. /.test(lines[i] as string) : /^- /.test(lines[i] as string))) {
        items.push(inline((lines[i] as string).replace(ordered ? /^\d+\. / : /^- /, '').trim()));
        i += 1;
      }
      blocks.push(ordered ? { t: 'ol', items } : { t: 'ul', items });
    } else {
      const parts: string[] = [];
      while (i < lines.length && (lines[i] as string).trim() && !special(lines[i] as string)) {
        parts.push((lines[i] as string).trim());
        i += 1;
      }
      blocks.push({ t: 'p', c: inline(parts.join(' ')) });
    }
  }
  return { title: meta.title ?? '', description: meta.description ?? '', short: meta.short ?? '', checked: meta.checked ?? '', heading, blocks };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function inlineHtml(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      if (n.t === 'text') return esc(n.v);
      if (n.t === 'code') return `<code>${esc(n.v)}</code>`;
      if (n.t === 'a') return `<a href="${esc(n.href)}">${inlineHtml(n.c)}</a>`;
      return `<${n.t === 'b' ? 'strong' : 'em'}>${inlineHtml(n.c)}</${n.t === 'b' ? 'strong' : 'em'}>`;
    })
    .join('');
}

export function blocksHtml(blocks: Block[]): string {
  return blocks
    .map((b) => {
      if (b.t === 'h2') return `<h2>${inlineHtml(b.c)}</h2>`;
      if (b.t === 'p') return `<p>${inlineHtml(b.c)}</p>`;
      if (b.t === 'ul' || b.t === 'ol') return `<${b.t}>${b.items.map((item) => `<li>${inlineHtml(item)}</li>`).join('')}</${b.t}>`;
      return `<table><thead><tr>${b.head.map((h) => `<th scope="col">${inlineHtml(h)}</th>`).join('')}</tr></thead><tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${inlineHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    })
    .join('');
}

/** The plain text of some inline nodes (for titles and image captions). */
export const inlineText = (nodes: Inline[]): string => nodes.map((n) => (n.t === 'text' || n.t === 'code' ? n.v : inlineText(n.c))).join('');
