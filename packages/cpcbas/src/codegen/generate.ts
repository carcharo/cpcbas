/**
 * The generate() driver: walks an IrProgram, dispatches each quad to the template
 * tables, and emits globals, string constants and DATA (codegen/data.ts). The link step
 * (codegen/link.ts) wraps the result in the prologue and epilogue.
 */

import { InternalError } from '../core/diagnostics.js';
import { asFileId, type Span } from '../core/source.js';
import type { IrProcedure, IrProgram, Operand, Quad } from '../ir/ir.js';
import { planConditions, type BoolStep, type CondPlan } from './cond.js';
import { emitData, emitGlobals, emitStrings } from './data.js';
import { RequireSet } from './requires.js';
import {
  templateKey,
  type AsmProgram,
  type CodeLine,
  type CodeUnit,
  type CompareJumpTable,
  type CompareQuad,
  type EmitContext,
  type GenerateInput,
  type RegisterFormTable,
  type Template,
  type TemplateTable,
  type TempForm,
} from './types.js';

const T_LABEL = /^\.T\.(\d+)$/;

function labelsOf(q: Quad): string[] {
  const out: string[] = [];
  if ('label' in q && typeof q.label === 'string') out.push(q.label);
  if (q.op === 'jtable') out.push(...q.labels);
  if (q.op === 'gosub' || q.op === 'call' || q.op === 'rtcall') out.push(q.label);
  for (const key of ['dst', 'a', 'b', 'array'] as const) {
    const o = (q as unknown as Partial<Record<string, Operand | null>>)[key];
    if (o && typeof o === 'object' && o.k === 'addr') out.push(o.label);
  }
  return out;
}

/** The next number after the highest `.T.<n>` label the IR uses, so generated labels never collide with lowering's. */
function firstFreeLabel(ir: IrProgram): number {
  let next = 0;
  const scan = (q: Quad): void => {
    for (const l of labelsOf(q)) {
      const m = T_LABEL.exec(l);
      if (m) next = Math.max(next, Number(m[1]) + 1);
    }
  };
  ir.main.forEach(scan);
  for (const p of ir.procedures) {
    const m = T_LABEL.exec(p.label);
    if (m) next = Math.max(next, Number(m[1]) + 1);
    p.body.forEach(scan);
  }
  for (const item of ir.data) {
    const m = item.label === null ? null : T_LABEL.exec(item.label);
    if (m) next = Math.max(next, Number(m[1]) + 1);
  }
  return next;
}

function firstSpan(ir: IrProgram): Span {
  for (const q of ir.main) if (q.span !== null) return q.span;
  for (const p of ir.procedures) for (const q of p.body) if (q.span !== null) return q.span;
  return { file: asFileId(0), start: 0, end: 0 };
}

const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

type Slot = 'a' | 'b';
type Maybe = { readonly k: string; readonly id?: number } | undefined;
const operandOf = (q: Quad, key: Slot): Maybe => (q as unknown as Partial<Record<Slot, Maybe>>)[key];

/** The temp operand a quad pops first: `b` when it is a temp, else `a` (docs/ir.md, "The template-operand protocol"). */
function firstPopped(q: Quad): { readonly slot: Slot; readonly id: number } | null {
  for (const slot of ['b', 'a'] as const) {
    const o = operandOf(q, slot);
    if (o?.k === 'temp') return { slot, id: o.id as number };
  }
  return null;
}

/** The temp a quad defines (`dst`), or null. */
function definedTemp(q: Quad): number | null {
  const d = (q as unknown as { dst?: Maybe | null }).dst;
  return d?.k === 'temp' ? (d.id as number) : null;
}

/** What the register-temp decision gives each quad of a body (L5-TEMPS). */
interface BodyForms {
  /** The temp operand quad i takes from the result registers. */
  readonly inRegs: readonly (Slot | null)[];
  /** Quad i leaves its result in the result registers. */
  readonly resultInRegs: readonly boolean[];
}

/**
 * Decides every quad's form with one quad of look-ahead (codegen/types.ts `TempForm`): a temp that the next quad pops first stays
 * in the result registers when the tables say both templates can. A comparison that branches (`plan.leaf`, codegen/cond.ts) makes
 * no temp, and the quads the plan skips take none.
 */
function decideForms(quads: readonly Quad[], forms: RegisterFormTable, plan: CondPlan): BodyForms {
  const n = quads.length;
  const inRegs = new Array<Slot | null>(n).fill(null);
  const resultInRegs = new Array<boolean>(n).fill(false);
  for (let i = 0; i + 1 < n; i++) {
    if (plan.leaf.has(i) || plan.skip.has(i) || plan.skip.has(i + 1) || plan.bool.has(i)) continue;
    const step = plan.bool.get(i + 1);
    if (step !== undefined && step.kind !== 'leaf') continue; // the 8-bit boolean steps take their operands from the stack
    const q = quads[i] as Quad;
    const next = quads[i + 1] as Quad;
    const t = definedTemp(q);
    if (t === null) continue;
    const popped = firstPopped(next);
    if (popped === null || popped.id !== t) continue;
    const producer = forms[templateKey(q)];
    const consumer = forms[templateKey(next)];
    if (producer === undefined || !producer.result || consumer === undefined || !consumer.operands.includes(popped.slot)) continue;
    resultInRegs[i] = true;
    inRegs[i + 1] = popped.slot;
  }
  return { inRegs, resultInRegs };
}

/**
 * `generate` with the default template tables supplied by the caller (codegen/index.ts passes TEMPLATES, REGISTER_FORMS and
 * COMPARE_JUMPS). Without `registerForms` (tests that pass their own templates) every quad has its stack form.
 */
export function generateWith(
  input: GenerateInput,
  defaults: readonly TemplateTable[],
  registerForms: RegisterFormTable = {},
  compareJumps: CompareJumpTable = {},
): AsmProgram {
  const { ir, target, diagnostics } = input;
  const tables = input.templates ?? defaults;
  const requires = new RequireSet();
  for (const r of ir.requires) requires.file(r);
  let counter = firstFreeLabel(ir);
  const fallback = firstSpan(ir);
  const checkBreak = ir.checkBreak === true;

  const lookup = (q: Quad): Template | undefined => {
    const full = templateKey(q);
    for (const t of tables) if (has(t, full)) return t[full];
    if (full !== q.op) for (const t of tables) if (has(t, q.op)) return t[q.op];
    return undefined;
  };

  /**
   * One step of a condition evaluated as 8-bit booleans (codegen/cond.ts `BoolStep`). A comparison is its ordinary template with the
   * result left in the registers, minus the `ld h, a / ld l, a` that widens A to a 16-bit boolean; a `raw` leaf is the `jnz` template
   * of the same operand minus its jump (the value tested stays in A).
   */
  const emitBool = (q: Quad, step: BoolStep, inReg: Slot | null, ctx: EmitContext): string[] => {
    const out: string[] = [];
    switch (step.kind) {
      case 'leaf': {
        const cmp = q as CompareQuad;
        if (step.raw) {
          const jnz: Quad = { op: 'jnz', type: cmp.type, a: cmp.a, label: '.T.raw', span: cmp.span } as Quad;
          const t = lookup(jnz) as Template;
          const lines = [...t(jnz, ctx, inReg === null ? undefined : { inRegs: inReg, resultInRegs: false })];
          if (lines.pop() !== '\tjp nz, .T.raw') throw new InternalError('condition leaf: the jnz template does not end in its jump');
          if ((cmp.type === 'u8' || cmp.type === 'i8') && lines[lines.length - 1] === '\tor a') lines.pop(); // A already holds the value
          out.push(...lines);
        } else {
          const t = lookup(q);
          if (t === undefined) return [];
          const lines = [...t(q, ctx, { inRegs: inReg, resultInRegs: true })];
          if (lines.pop() !== '\tld l, a' || lines.pop() !== '\tld h, a') throw new InternalError('condition leaf: the comparison template does not end in ld h, a / ld l, a');
          out.push(...lines);
        }
        break;
      }
      case 'and':
        out.push('\tpop bc', '\tand b');
        break;
      case 'or':
        out.push('\tpop bc', '\tor b');
        break;
      case 'not':
        out.push('\tcpl');
        break;
      case 'root':
        return ['\tor a', `\tjp ${step.when === 'false' ? 'z' : 'nz'}, ${step.label}`];
    }
    if (step.push) out.push('\tpush af');
    return out;
  };

  const style = input.opt?.style;
  const registerTemps = input.opt?.registerTemps === true;
  const cmpjump = registerTemps && input.opt?.enabled('cmpjump') === true;
  /** One body's lines, tagged for the code stage (codegen/types.ts `CodeLine`). */
  const emitQuads = (quads: readonly Quad[], procedure: IrProcedure | null): CodeUnit => {
    const ctx: EmitContext = { target, requires, newLabel: () => `.T.${counter++}`, procedure, diagnostics, checkBreak, ...(style !== undefined ? { style } : {}) };
    const out: CodeLine[] = [];
    const plan: CondPlan = cmpjump
      ? planConditions(quads, (key) => has(compareJumps, key), ctx.newLabel, { bool8: style === 'fast' || style === 'short' })
      : { leaf: new Map(), skip: new Set(), labelAt: new Map(), bool: new Map() };
    const decided = registerTemps ? decideForms(quads, registerForms, plan) : null;
    for (let quad = 0; quad < quads.length; quad++) {
      const q = quads[quad] as Quad;
      const push = (kind: CodeLine['kind'], text: string): void => void out.push({ text, kind, quad });
      if (q.op === 'stmt') push('boundary', '');
      if (q.op === 'stmt' && !checkBreak) continue;
      if (q.op === 'comment') {
        push('code', `\t; ${q.text}`);
        continue;
      }
      if (q.op === 'asm') {
        // An ASM block's lines are the user's (`#line` to the BASIC source, ended by a bare
        // `#line` after the block); the lowering's internal lines are generated code.
        const attribute = input.sources !== undefined && q.internal !== true && q.lines.length > 0;
        for (const line of q.lines) {
          if (attribute && input.sources !== undefined) {
            const file = input.sources.get(line.span.file);
            const n = input.sources.position(line.span.file, line.span.start).line;
            push('opaque', `#line ${n} "${file.path}"`);
          }
          push('opaque', line.text);
        }
        if (attribute) push('opaque', '#line');
        continue;
      }
      const inReg = decided?.inRegs[quad] ?? null;
      const form: TempForm | undefined = decided !== null && (inReg !== null || decided.resultInRegs[quad] === true) ? { inRegs: inReg, resultInRegs: decided.resultInRegs[quad] === true } : undefined;
      const boolStep = plan.bool.get(quad);
      if (boolStep !== undefined) {
        for (const text of emitBool(q, boolStep, inReg, ctx)) push('code', text);
        continue;
      }
      const leaf = plan.leaf.get(quad);
      if (leaf !== undefined) {
        // a comparison that branches (codegen/cond.ts): one compare-and-branch, no boolean
        const cmp = q as CompareQuad;
        const fusedTemplate = compareJumps[`cmpjump:${cmp.op}:${cmp.type}`] as NonNullable<CompareJumpTable[string]>;
        for (const text of fusedTemplate(cmp, leaf, ctx, { inRegs: inReg, resultInRegs: false })) push('code', text);
        continue;
      }
      if (plan.skip.has(quad)) {
        const end = plan.labelAt.get(quad);
        if (end !== undefined) push('code', `${end}:`);
        continue;
      }
      const template = lookup(q);
      if (template === undefined) {
        const key = templateKey(q);
        const [op, type] = key.split(':');
        const what = type === undefined ? `\`${op}\`` : `\`${op}\` on \`${type}\``;
        diagnostics.report('E002', q.span ?? fallback, `${what} is not implemented yet`);
        continue;
      }
      for (const text of template(q, ctx, form)) push(q.op === 'stmt' ? 'opaque' : 'code', text);
    }
    return { procedure: procedure?.label ?? null, quads, lines: out };
  };
  const text = (u: CodeUnit): string[] => u.lines.filter((l) => l.kind !== 'boundary').map((l) => l.text);

  const raw = [emitQuads(ir.main, null), ...ir.procedures.map((p) => emitQuads(p.body, p))];
  const units = input.opt?.runCodePasses(raw) ?? raw; // the code stage (src/opt/index.ts); -O0: none
  const main = text(units[0] as CodeUnit);
  const procedures = units.slice(1).flatMap(text);

  const data = emitGlobals(ir.globals, diagnostics, fallback);
  const constants = [
    ...emitStrings(ir.strings),
    ...emitData(ir.data, diagnostics, fallback, requires.has('read_restore.asm')),
  ];

  return {
    data,
    main,
    procedures,
    constants,
    requires: requires.sorted(),
    inits: [...ir.inits],
    ...(ir.requireSpans !== undefined ? { requireSpans: ir.requireSpans } : {}),
  };
}
