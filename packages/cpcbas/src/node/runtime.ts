/** The runtime library (`lib/`) as a FileTree, for hosts that run on Node. */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FileTree } from '../core/source.js';
import { diskTree } from './tree.js';

const hasRuntime = (lib: string): boolean => existsSync(resolve(lib, 'runtime'));

/**
 * The runtime directory that belongs to this copy of the compiler, or undefined when there is none. In a checkout
 * (a `packages/cpcbas` and a `lib/` above this file) it is that `lib/`, so an edit to the library shows at once,
 * without a build. Otherwise it is the nearest `lib/` found walking up: the package's own `dist/lib` when installed
 * (`dist/src/node/`), the folder of `cpcbas.mjs` in the SDK (`lib/` beside it).
 */
export function defaultRuntimeDir(): string | undefined {
  const ancestors: string[] = [];
  for (let dir = dirname(fileURLToPath(import.meta.url)); ancestors.length < 8; ) {
    ancestors.push(dir);
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  const checkout = ancestors.find((d) => existsSync(resolve(d, 'packages', 'cpcbas', 'package.json')) && hasRuntime(resolve(d, 'lib')));
  if (checkout !== undefined) return resolve(checkout, 'lib');
  const near = ancestors.find((d) => hasRuntime(resolve(d, 'lib')));
  return near === undefined ? undefined : resolve(near, 'lib');
}

/** The runtime library as a lazy FileTree: `dir`, or the package's own copy ({@link defaultRuntimeDir}). */
export function loadRuntime(dir?: string): FileTree {
  const where = dir ?? defaultRuntimeDir();
  if (where === undefined) throw new Error('cpcbas: the runtime library (lib/) was not found; pass its directory');
  return diskTree(where);
}
