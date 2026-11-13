/** Test helper: all of lib/ (.asm and .bas) keyed by path, as the CLI's --runtime reads it. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './z80sim/run.js';

export { repoRoot };

export function loadLibTree(): Map<string, string> {
  const tree = new Map<string, string>();
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, `${prefix}${name}/`);
      else if (/\.(asm|bas)$/.test(name)) tree.set(`${prefix}${name}`, readFileSync(full, 'latin1'));
    }
  };
  walk(join(repoRoot, 'lib'), '');
  return tree;
}
