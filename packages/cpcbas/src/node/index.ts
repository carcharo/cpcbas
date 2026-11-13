/**
 * `@cpcbuild/cpcbas/node`: the helpers that read the disk. Node only; the library entry (`@cpcbuild/cpcbas`)
 * never imports this file, so a browser bundle of the compiler stays free of `node:` modules.
 */
export { diskTree, lazyTree, readFileOrUndefined, readTree } from './tree.js';
export type { ReadFile, TreeFilter } from './tree.js';
export { defaultRuntimeDir, loadRuntime } from './runtime.js';
