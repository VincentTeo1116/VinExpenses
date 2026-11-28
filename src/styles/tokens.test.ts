// The forced Dark palette (Account > Appearance) is a copy of the automatic dark palette, because CSS cannot share one block between a media query
// and an attribute. This keeps the two copies identical, so changing one without the other fails here.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/styles/tokens.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of every block with exactly this selector, each as a sorted, comparable string. */
function rules(selector: string): string[] {
  const out: string[] = [];
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const m of css.matchAll(new RegExp(`(?:^|\\s|\\})${escaped}\\s*\\{([^}]*)\\}`, 'g'))) {
    out.push(
      (m[1] ?? '')
        .split(';')
        .map((line) => line.trim())
        .filter(Boolean)
        .sort()
        .join(';'),
    );
  }
  return out;
}

describe('the dark palette exists twice, and the copies match', () => {
  const pairs: [string, string][] = [
    [":root:not([data-mode='light'])", ":root[data-mode='dark']"],
    ...(['pink', 'orange', 'green'] as const).map((name): [string, string] => [`:root:not([data-mode='light'])[data-theme='${name}']`, `:root[data-mode='dark'][data-theme='${name}']`]),
  ];
  for (const [auto, forced] of pairs) {
    it(`${forced} matches the automatic block`, () => {
      const a = rules(auto);
      const f = rules(forced);
      expect(a).toHaveLength(1);
      expect(f).toHaveLength(1);
      expect(f[0]).toBe(a[0]);
    });
  }
  it('forcing Light asks for light form controls', () => {
    expect(rules(":root[data-mode='light']")[0]).toBe('color-scheme: light');
  });
});
