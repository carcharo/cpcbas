/**
 * RC4: the `--opt-disable` names that the documents give are the names the compiler takes. docs/optimisation.md "The names"
 * (public) lists only names that work; docs/ir.md's table (the contract) may list a planned name, and then says so in its row
 * ("planned"), and that name must still be refused (E571) until its pass is registered.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { optNames } from '../src/opt/index.js';
import { repoRoot } from './readme-helper.js';

/** The rows of the first table after `heading` whose first column is "Name", as their cells. */
function nameRows(markdown: string, heading: string): string[][] {
  const lines = markdown.split(/\r?\n/);
  let i = lines.findIndex((l) => l.trim() === heading);
  expect(i, heading).toBeGreaterThanOrEqual(0);
  while (i < lines.length && !/^\| Name \|/.test(lines[i]!)) i++;
  const rows: string[][] = [];
  for (i += 2; i < lines.length && lines[i]!.startsWith('|'); i++) rows.push(lines[i]!.split('|').slice(1, -1));
  expect(rows.length, heading).toBeGreaterThan(5);
  return rows;
}

const quoted = (cell: string | undefined): string[] => [...(cell ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1]!);

const known = new Set(optNames());

describe('the --opt-disable names in the documents', () => {
  it('docs/optimisation.md "The names": every name in the table works, the rule examples too', () => {
    const md = readFileSync(join(repoRoot, 'docs/optimisation.md'), 'utf8');
    // every backquoted name of the table that has the form of a name (the descriptions also quote options such as `-O0`)
    const names = nameRows(md, '### The names').flatMap((cells) => cells.flatMap(quoted)).filter((n) => /^[a-z0-9][a-z0-9_-]*$/.test(n));
    expect(names).toContain('tailmerge');
    expect(names).toContain('504_add_hl_1');
    expect(names.filter((n) => !known.has(n))).toEqual([]);
  });

  it('docs/ir.md: every name works unless its row says it is planned, and a planned name is refused', () => {
    const md = readFileSync(join(repoRoot, 'docs/ir.md'), 'utf8');
    const unknown: string[] = [];
    const planned: string[] = [];
    for (const [first, second] of nameRows(md, '### Levels')) {
      // a row whose description starts with "planned" plans all its names; "`x` is planned" plans one name
      const rowPlanned = /^\s*planned\b/.test(second ?? '') ? quoted(first) : [];
      rowPlanned.push(...[...(second ?? '').matchAll(/`([a-z0-9-]+)` is planned/g)].map((m) => m[1]!));
      planned.push(...rowPlanned);
      unknown.push(...quoted(first).filter((n) => !rowPlanned.includes(n) && !known.has(n)));
    }
    expect(unknown).toEqual([]);
    expect(planned.sort()).toEqual(['flow', 'ir-cse']);
    expect(planned.filter((n) => known.has(n))).toEqual([]);
  });
});
