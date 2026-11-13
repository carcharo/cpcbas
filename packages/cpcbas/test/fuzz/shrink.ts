/**
 * L5-DIFF layer 2: the shrinker. Given a program that fails, it deletes statements and declarations and unwraps blocks (IF, FOR, WHILE
 * become their bodies) while the program still fails, until no single step keeps the failure. Declarations go too when nothing
 * uses them. The predicate is the failure itself, so a deletion that makes the program unbuildable at -O0 is refused (such a
 * program is "skipped", not "fail").
 */
import type { Block, FuzzProgram, Node } from './gen.js';

type Pred = (p: FuzzProgram) => boolean;

/** Every program one step smaller than `p`: a node deleted, or a block replaced by its body (and by its ELSE part). */
function* smaller(p: FuzzProgram): Generator<FuzzProgram> {
  // a declaration the program no longer needs (one still in use makes the build fail, and the step is refused)
  for (let i = p.decls.length - 1; i >= 0; i--) yield { ...p, decls: p.decls.filter((_, j) => j !== i) };
  for (const main of listVariants(p.main)) yield { ...p, main };
  for (let i = 0; i < p.procs.length; i++) {
    for (const body of listVariants(p.procs[i]!.body)) yield { ...p, procs: p.procs.map((q, j) => (j === i ? { ...q, body } : q)) };
    // a whole procedure, when nothing calls it any more
    const name = /(?:SUB|FUNCTION) (\w+)\(/.exec(p.procs[i]!.head)?.[1];
    if (name !== undefined && !p.main.some((n) => JSON.stringify(n).includes(`${name}(`)) && !p.procs.some((q, j) => j !== i && JSON.stringify(q.body).includes(`${name}(`)) && !p.subs.some((s) => JSON.stringify(s.body).includes(`${name}(`))) {
      yield { ...p, procs: p.procs.filter((_, j) => j !== i) };
    }
  }
  for (let i = 0; i < p.subs.length; i++) {
    for (const body of listVariants(p.subs[i]!.body)) yield { ...p, subs: p.subs.map((s, j) => (j === i ? { ...s, body } : s)) };
  }
}

function* listVariants(nodes: readonly Node[]): Generator<Node[]> {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i]!;
    yield [...nodes.slice(0, i), ...nodes.slice(i + 1)];
    if (typeof n !== 'string') {
      yield [...nodes.slice(0, i), ...n.body, ...nodes.slice(i + 1)];
      if (n.other !== undefined) yield [...nodes.slice(0, i), ...n.other, ...nodes.slice(i + 1)];
      for (const body of listVariants(n.body)) yield [...nodes.slice(0, i), { ...n, body } as Block, ...nodes.slice(i + 1)];
      if (n.other !== undefined) for (const other of listVariants(n.other)) yield [...nodes.slice(0, i), { ...n, other } as Block, ...nodes.slice(i + 1)];
    }
  }
}

/** The smallest failing program reachable by single steps. `limit` bounds the predicate calls. */
export function shrink(p: FuzzProgram, fails: Pred, limit = 2000): FuzzProgram {
  let cur = p;
  let calls = 0;
  for (let progress = true; progress && calls < limit; ) {
    progress = false;
    for (const cand of smaller(cur)) {
      if (calls++ >= limit) break;
      if (fails(cand)) {
        cur = cand;
        progress = true;
        break;
      }
    }
  }
  return cur;
}
