/**
 * File trees over the disk (Node only: this folder is the package's `./node` entry and the
 * browser entry never imports it).
 *
 *   lazyTree(read, prefix)  a FileTree over any reader; a file is read only when the compiler asks for it
 *   diskTree(dir)           the same over the file system, paths relative to `dir` (absolute ones pass through)
 *   readTree(dir, filter?)  every file under `dir` that passes the filter, read now: path -> bytes
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { normalizePath, type FileContent, type FileTree } from '../core/source.js';

export type ReadFile = (path: string) => Uint8Array | undefined;

/**
 * A FileTree over a reader, read lazily: a file is read only when the compiler asks for it,
 * and at most once. Virtual paths are POSIX paths; `prefix` is put in front of each one.
 */
export function lazyTree(read: ReadFile, prefix = ''): FileTree {
  const cache = new Map<string, Uint8Array | undefined>();
  const load = (path: string): Uint8Array | undefined => {
    const key = normalizePath(path);
    if (!cache.has(key)) cache.set(key, read(prefix === '' ? key : normalizePath(`${prefix}/${key}`)));
    return cache.get(key);
  };
  return {
    get: (path: string): FileContent | undefined => load(path),
    has: (path: string): boolean => load(path) !== undefined,
  };
}

/** The bytes of a file, or undefined when it cannot be read (missing, a directory, no permission). */
export function readFileOrUndefined(path: string): Uint8Array | undefined {
  try {
    return readFileSync(path);
  } catch {
    return undefined;
  }
}

/** A lazy FileTree over the directory `dir`: a path is resolved against it (an absolute path is used as it is). */
export function diskTree(dir: string): FileTree {
  const base = resolve(dir);
  return lazyTree((path) => readFileOrUndefined(resolve(base, path)));
}

/** What `readTree` keeps: a predicate on the POSIX path relative to the directory, or a RegExp tested on it. */
export type TreeFilter = RegExp | ((path: string) => boolean);

const SKIP_DIRS = new Set(['node_modules', '.git', '.worktrees']);

/**
 * Every file under `dir` that passes `filter` (default: names ending in `.bas`, any case), read now, as a Map from the
 * POSIX path relative to `dir` to its bytes. `node_modules`, `.git` and `.worktrees` are not entered. Sorted by path,
 * so the same directory always gives the same map.
 */
export function readTree(dir: string, filter: TreeFilter = /\.bas$/i): Map<string, Uint8Array> {
  const keep = typeof filter === 'function' ? filter : (p: string): boolean => filter.test(p);
  const root = resolve(dir);
  const found: string[] = [];
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
      const path = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path);
      } else if (entry.isFile() && keep(path)) {
        found.push(path);
      }
    }
  };
  walk('');
  found.sort();
  return new Map(found.map((p) => [p, readFileSync(join(root, p))]));
}
