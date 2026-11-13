/**
 * The link step: wraps the generated program in the reference CPC backend's prologue
 * and epilogue (docs/ir.md, "Program layout"; contract: codegen/types.ts, LinkFn).
 */

import { preprocessAsm } from '../asm/preprocess.js';
import type { IncludeResolver } from '../asm/types.js';
import { decodeText, dirname, joinPath, normalizePath, type FileTree, type Span } from '../core/source.js';
import { memoryMapEqus } from './memory-map.js';
import { MEMINITS } from './requires.js';
import type { LinkFn } from './types.js';

const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** `runtime/<name>` then `<name>` under the lib root; for `"name"` the including file's directory first. */
function makeResolver(runtime: FileTree): IncludeResolver {
  return (name, fromPath, angle) => {
    const candidates: string[] = [];
    if (!angle) candidates.push(joinPath(dirname(fromPath), name));
    candidates.push(joinPath('runtime', name), normalizePath(name));
    for (const path of candidates) {
      const content = runtime.get(path);
      if (content !== undefined) return { path, text: decodeText(content) };
    }
    return undefined;
  };
}

export const link: LinkFn = (input) => {
  const { asm, target, runtime, sources, diagnostics } = input;
  const resolveInclude = makeResolver(runtime);

  // The files to link, sorted and unique; a missing one is E420 at its line of the include list.
  const wanted = [...new Set(asm.requires)].sort(byCodePoint);
  const allText = wanted.map((f) => `#include once <${f}>`).join('\n') + '\n';
  const listing = sources.add('link-includes.asm', allText, 'generated');
  const found: string[] = [];
  wanted.forEach((file, i) => {
    if (resolveInclude(file, listing.path, true) !== undefined) {
      found.push(file);
      return;
    }
    const at = asm.requireSpans?.get(file);
    if (at !== undefined) {
      diagnostics.report('E421', at, `#require file '${file}' not found in the runtime library`);
      return;
    }
    const start = sources.offsetAt(listing.id, i + 1);
    const span: Span = { file: listing.id, start, end: start + `#include once <${file}>`.length };
    const forced = file === 'bootstrap.asm';
    diagnostics.report('E420', span, `Runtime file '${file}' not found (${forced ? 'every program links it' : 'required by the generated code'})`);
  });
  const includeLines = found.map((f) => `#include once <${f}>`);

  // Every #init in the linked runtime files, found by running the asm preprocessor over the includes.
  const probe = sources.add('link-inits.asm', includeLines.join('\n') + '\n', 'generated');
  const pre = preprocessAsm({ sources, entry: probe, resolveInclude, defines: target.asmDefines, diagnostics });
  const inits = [...new Set([...asm.inits, ...pre.inits.map((i) => i.label)])].sort(byCodePoint);

  const heapInUse = found.some((f) => MEMINITS.includes(f)) || inits.includes('.core.__MEM_INIT');
  const heap: string[] = heapInUse
    ? [
        '\t; Defines HEAP SIZE',
        `.core.ZXBASIC_HEAP_SIZE EQU ${target.heapSize}`,
        '\t; Defines HEAP ADDRESS',
        `.core.ZXBASIC_MEM_HEAP EQU ${target.heapAddress}`,
      ]
    : [];

  const lines: string[] = [
    `\torg ${target.org}`,
    ...memoryMapEqus(target.map),
    '.core.__START_PROGRAM:',
    '\tdi',
    '\tld sp, .core.CPC_STACK_TOP',
    ...inits.map((x) => `\tcall ${x}`),
    '\tjp .core.__MAIN_PROGRAM__',
    '.core.ZXBASIC_USER_DATA:',
    ...heap,
    '\t; Defines USER DATA Length in bytes',
    '.core.ZXBASIC_USER_DATA_LEN EQU .core.ZXBASIC_USER_DATA_END - .core.ZXBASIC_USER_DATA',
    '\t.core.__LABEL__.ZXBASIC_USER_DATA_LEN EQU .core.ZXBASIC_USER_DATA_LEN',
    '\t.core.__LABEL__.ZXBASIC_USER_DATA EQU .core.ZXBASIC_USER_DATA',
    ...asm.data,
    '.core.ZXBASIC_USER_DATA_END:',
    '.core.__MAIN_PROGRAM__:',
    ...asm.main,
    ...asm.procedures,
    ...asm.constants,
    '\t;; --- end of user code ---',
    ...includeLines,
    '\tEND .core.__START_PROGRAM',
  ];

  return { text: lines.join('\n') + '\n', inits, heapInUse, resolveInclude };
};
