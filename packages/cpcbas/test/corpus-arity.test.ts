/**
 * Follow-up 5: every built-in statement and function that the corpus exercises is seen at
 * its minimum and (when finite) maximum argument count in the valid programs. Counts come
 * from the parsed `Builtin` and `BuiltinCall` nodes and the TAB and SPC items of `Print`, so a word in a comment does not count.
 */
import { describe, expect, it } from 'vitest';
import type { Node } from '../src/ast/ast.js';
import { walk } from '../src/ast/walk.js';
import { DiagnosticBag } from '../src/core/diagnostics.js';
import { SourceSet } from '../src/core/source.js';
import { KEYWORDS } from '../src/lang/keywords.js';
import { runFrontEnd } from '../src/pipeline.js';
import { basFiles, corpusTree, INCLUDE_PATHS } from './corpus-files.js';

const tree = corpusTree();

/** `KEYWORD/count` for every Builtin and BuiltinCall in the valid programs. */
function seenArities(): Set<string> {
  const seen = new Set<string>();
  for (const path of basFiles('valid')) {
    const sources = new SourceSet();
    const { program } = runFrontEnd({ files: tree, main: path, includePaths: INCLUDE_PATHS }, sources, new DiagnosticBag());
    walk(program, (node: Node) => {
      if (node.kind === 'Builtin' || node.kind === 'BuiltinCall') seen.add(`${node.keyword}/${node.args.length}`);
      // TAB and SPC exist only inside PRINT, where they have their own nodes (one argument).
      else if (node.kind === 'Print') {
        for (const item of node.items) {
          if (item.kind === 'PrintTab') seen.add('TAB/1');
          else if (item.kind === 'PrintSpc') seen.add('SPC/1');
        }
      }
    });
  }
  return seen;
}

function required(): string[] {
  const out: string[] = [];
  for (const k of KEYWORDS) {
    if (k.args === undefined) continue;
    if (k.status === 'dropped' || k.status === 'later') continue;
    if (k.kind === 'statement' ? k.form !== 'builtin' : k.kind !== 'function') continue;
    out.push(`${k.name}/${k.args.min}`);
    if (Number.isFinite(k.args.max) && k.args.max !== k.args.min) out.push(`${k.name}/${k.args.max}`);
  }
  return out;
}

describe('corpus built-in argument counts', () => {
  it('every built-in is seen at its minimum and maximum argument count', () => {
    const seen = seenArities();
    const missing = required().filter((r) => !seen.has(r));
    expect(missing).toEqual([]);
  });
});
