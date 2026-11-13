/**
 * `ir-dead` (L5-IR, slot 400): dead code. Between a quad that never falls through (`jump`, `end`, `retsub`,
 * `ret`, `leave`) and the next `label` nothing can run, so the quads there go, with three exceptions that the
 * rules every pass keeps demand: every `stmt` quad stays (the statement boundaries do not move), every `asm`
 * quad stays (it may define a label that something else names, and it is opaque), and a `label` is never
 * removed. A `jump` to the label that follows it (only other labels between) is a no-op and goes too.
 *
 * There is no separate "unused temps" step: the verifier forbids a temp that nothing pops, and the other
 * passes delete a temp's defining quad together with its use.
 */
import type { IrProgram, Quad } from '../ir.js';
import { printQuad } from '../print.js';
import { attachTrace, isTerminator, mapBodies } from './util.js';
import type { IrPass, IrPassEnv } from '../../opt/index.js';

function deadBody(body: readonly Quad[], log: string[] | null): readonly Quad[] {
  const out: Quad[] = [];
  let dead = false;
  let changed = false;
  body.forEach((q, i) => {
    if (q.op === 'label') dead = false;
    // the body's closing `end` or `leave` stays: the verifier wants it, and the code after it is a no-op
    const closing = i === body.length - 1 && (q.op === 'end' || q.op === 'leave');
    if (dead && q.op !== 'stmt' && q.op !== 'asm' && !closing) {
      changed = true;
      if (log !== null && q.op !== 'comment') log.push(`dead: ${printQuad(q)}`);
      return;
    }
    out.push(q);
    if (!dead && isTerminator(q)) dead = true;
  });
  // a jump to the next label
  const res: Quad[] = [];
  for (let i = 0; i < out.length; i++) {
    const q = out[i] as Quad;
    if (q.op === 'jump') {
      let j = i + 1;
      let falls = false;
      while (j < out.length && (out[j] as Quad).op === 'label') {
        if ((out[j] as Quad & { label: string }).label === q.label) falls = true;
        j++;
      }
      if (falls) {
        changed = true;
        if (log !== null) log.push(`dead: ${printQuad(q)} (to the next label)`);
        continue;
      }
    }
    res.push(q);
  }
  return changed ? res : body;
}

export const IR_DEAD: IrPass = {
  name: 'ir-dead',
  order: 400,
  when: (spec) => spec.irPasses,
  run(ir: IrProgram, env: IrPassEnv): IrProgram {
    const log: string[] | null = env.trace ? [] : null;
    const out = mapBodies(ir, (body) => deadBody(body, log));
    return attachTrace(ir, out, 'ir-dead', log ?? []);
  },
};
