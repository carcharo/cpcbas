/** Loads tests/parse-corpus into a virtual tree (paths relative to the corpus root). */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CORPUS_ROOT = fileURLToPath(new URL('../../../tests/parse-corpus/', import.meta.url));
export const INCLUDE_PATHS = ['valid/inc'];

function walk(dir: string, rel: string, out: Map<string, string>): void {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const r = rel === '' ? name : `${rel}/${name}`;
    if (statSync(path).isDirectory()) walk(path, r, out);
    else out.set(r, readFileSync(path, 'utf8'));
  }
}

/** Every corpus file by virtual path (`valid/01-lexical.bas`). */
export function corpusTree(): Map<string, string> {
  const out = new Map<string, string>();
  walk(CORPUS_ROOT, '', out);
  return out;
}

/** Virtual paths of the `.bas` files in `dir` (`valid`, `valid/inc`, `errors`), sorted. */
export function basFiles(dir: string): string[] {
  return readdirSync(join(CORPUS_ROOT, dir))
    .filter((n) => n.endsWith('.bas'))
    .sort()
    .map((n) => `${dir}/${n}`);
}

/** The `LINE:COL CODE` of each line of the `.expect` next to `basPath` (empty when there is none). */
export function expectations(basPath: string): string[] {
  const path = join(CORPUS_ROOT, basPath.replace(/\.bas$/, '.expect'));
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => l.split(' ').slice(0, 2).join(' '));
}
