/**
 * IR structural verifier (rules in ir/ir.ts and docs/ir.md). Every message starts with the
 * quad list and index: `main[3]: ...` or `proc _Name[2]: ...`.
 *
 * Temps: a quad pops the temps it uses (operand `b` before `a`, the later pushed first;
 * `aaddr` pops its `dims` index temps) and then pushes its `dst`. A use must be the top of
 * the temp stack (LIFO, hence defined earlier and not yet used). The stack must be empty
 * after `label`, `jump`, `jz`/`jnz`, `jtable`, `gosub`, `retsub`, `end`, `ret`, `stmt`,
 * `enter` and `leave` have consumed theirs, and at the end of the list. Temps may stay live
 * across `call` and `rtcall` (the callee's frame is above them; STDCALL `leave` removes only
 * the callee's own parameters).
 */
import type { IrProgram, Operand, Quad, VerifyIrFn } from './ir.js';

const EMPTY_AFTER = new Set<Quad['op']>(['label', 'jump', 'jz', 'jnz', 'jtable', 'gosub', 'retsub', 'end', 'ret', 'stmt', 'enter', 'leave']);

/** The operands a quad pops, in pop order (top of stack first). */
function uses(q: Quad): Operand[] {
  switch (q.op) {
    case 'poke':
    case 'out':
    case 'astore':
      return [q.b, q.a];
    case 'add':
    case 'sub':
    case 'mul':
    case 'div':
    case 'mod':
    case 'pow':
    case 'and':
    case 'or':
    case 'xor':
    case 'shl':
    case 'shr':
    case 'concat':
    case 'eq':
    case 'ne':
    case 'lt':
    case 'le':
    case 'gt':
    case 'ge':
      return [q.b, q.a];
    case 'load':
    case 'store':
    case 'neg':
    case 'not':
    case 'abs':
    case 'cast':
    case 'peek':
    case 'in':
    case 'aload':
    case 'jz':
    case 'jnz':
    case 'jtable':
    case 'end':
    case 'param':
    case 'fparam':
    case 'ret':
      return [q.a];
    default:
      return [];
  }
}

/** The operands a quad names besides its uses (for the `strconst` check). */
function allOperands(q: Quad): Operand[] {
  const r: Operand[] = [];
  const rec = q as unknown as Record<string, unknown>;
  for (const f of ['dst', 'a', 'b', 'array']) {
    const v = rec[f];
    if (typeof v === 'object' && v !== null && 'k' in v) r.push(v as Operand);
  }
  return r;
}

function checkList(name: string, quads: readonly Quad[], strings: ReadonlySet<number>, problems: string[]): void {
  const at = (i: number, msg: string): void => {
    problems.push(`${name}[${i}]: ${msg}`);
  };
  const defined = new Set<number>();
  const used = new Set<number>();
  const stack: number[] = [];
  const labels = new Set<string>();
  for (const q of quads) if (q.op === 'label') labels.add(q.label);

  quads.forEach((q, i) => {
    // Temp uses.
    for (const o of uses(q)) {
      if (o.k !== 'temp') continue;
      if (!defined.has(o.id)) at(i, `${q.op} uses t${o.id} before it is defined`);
      else if (used.has(o.id)) at(i, `${q.op} uses t${o.id} a second time`);
      else if (stack[stack.length - 1] !== o.id) at(i, `${q.op} uses t${o.id} out of LIFO order (top of stack is t${stack[stack.length - 1] ?? '?'})`);
      else {
        stack.pop();
        used.add(o.id);
      }
    }
    if (q.op === 'aaddr') {
      if (stack.length < q.dims) at(i, `aaddr needs ${q.dims} index temps on the stack, ${stack.length} there`);
      for (let n = 0; n < q.dims && stack.length > 0; n++) used.add(stack.pop() as number);
    }
    // Temp definitions.
    if ('dst' in q && q.dst !== null && q.dst.k === 'temp') {
      if (defined.has(q.dst.id)) at(i, `${q.op} defines t${q.dst.id} a second time`);
      else {
        defined.add(q.dst.id);
        // Only a temp defined by a quad that pushes can later be used; stores never have temp dsts.
        stack.push(q.dst.id);
      }
    }
    if (EMPTY_AFTER.has(q.op)) {
      const live = stack;
      if (live.length > 0) {
        at(i, `${q.op}: temps live here: ${live.map((t) => `t${t}`).join(', ')}`);
        // Report once: forget them so later quads do not repeat the problem.
        for (const t of live) used.add(t);
        stack.splice(0, live.length);
      }
    }
    // Targets.
    const target = q.op === 'jump' || q.op === 'jz' || q.op === 'jnz' || q.op === 'gosub' || q.op === 'ret' ? q.label : null;
    if (target !== null && !labels.has(target)) at(i, `${q.op} target ${target} is not defined in this list`);
    if (q.op === 'jtable') for (const l of q.labels) if (!labels.has(l)) at(i, `jtable target ${l} is not defined in this list`);
    // fparam placement.
    if (q.op === 'fparam') {
      const next = quads[i + 1];
      if (next === undefined || (next.op !== 'call' && next.op !== 'rtcall')) at(i, 'fparam is not immediately followed by call or rtcall');
    }
    for (const o of allOperands(q)) if (o.k === 'strconst' && !strings.has(o.id)) at(i, `${q.op} uses undefined string constant s${o.id}`);
  });

  if (stack.length > 0) problems.push(`${name}[${quads.length}]: temps live at the end: ${stack.map((t) => `t${t}`).join(', ')}`);
  for (const t of defined) if (!used.has(t) && !stack.includes(t)) problems.push(`${name}: t${t} is never used`);
}

export const verifyIr: VerifyIrFn = (program: IrProgram): readonly string[] => {
  const problems: string[] = [];
  const strings = new Set(program.strings.map((s) => s.id));

  checkList('main', program.main, strings, problems);
  const last = program.main[program.main.length - 1];
  if (last === undefined || last.op !== 'end') problems.push(`main[${Math.max(program.main.length - 1, 0)}]: main does not end with end`);

  for (const p of program.procedures) {
    const name = `proc ${p.label}`;
    checkList(name, p.body, strings, problems);
    const first = p.body[0];
    const second = p.body[1];
    if (first === undefined || first.op !== 'label' || first.label !== p.label) problems.push(`${name}[0]: procedure does not start with its label`);
    if (second === undefined || second.op !== 'enter') problems.push(`${name}[1]: procedure label is not followed by enter`);
    const end = p.body[p.body.length - 1];
    if (end === undefined || end.op !== 'leave') problems.push(`${name}[${Math.max(p.body.length - 1, 0)}]: procedure does not end with leave`);
  }

  // Labels unique program-wide, in list order.
  const seen = new Map<string, string>();
  const lists: [string, readonly Quad[]][] = [['main', program.main], ...program.procedures.map((p): [string, readonly Quad[]] => [`proc ${p.label}`, p.body])];
  for (const [name, quads] of lists) {
    quads.forEach((q, i) => {
      if (q.op !== 'label') return;
      const prev = seen.get(q.label);
      if (prev !== undefined) problems.push(`${name}[${i}]: label ${q.label} is already defined in ${prev}`);
      else seen.set(q.label, `${name}[${i}]`);
    });
  }
  return problems;
};
