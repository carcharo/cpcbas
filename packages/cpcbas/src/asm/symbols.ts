/**
 * Labels, namespaces, PROC scopes and temporary labels, following the reference
 * (zxbasm memory.py, label.py, global_.py) closely: a label seen before it is defined is a
 * placeholder in the innermost scope; ENDP moves the scope's non-LOCAL labels to the global
 * scope; names are prefixed with the current namespace unless they start with a dot.
 */
import type { DiagnosticCode, RelatedInfo } from '../core/diagnostics.js';
import type { Span } from '../core/source.js';
import type { Expr, Lbl, TmpRef } from './expr.js';

export const DOT = '.';
export const GLOBAL_NAMESPACE = DOT;

/** `'.'`, `'mynamespace'`, `'..a...b'` -> always dot-prefixed, no empty parts (`.a.b`); only dots give `.`. */
export function normalizeNamespace(ns: string): string {
  return DOT + ns.split(DOT).filter((x) => x !== '').join(DOT);
}

const TEMP_RE = /^[0-9]+$/;
const TEMP_REF_RE = /^([0-9]+)([BF])$/;

export interface SymbolSink {
  report(code: DiagnosticCode, span: Span, message: string, hint?: string, related?: readonly RelatedInfo[]): void;
}

interface TmpDef {
  readonly seq: number;
  readonly namespace: string;
  readonly value: number;
}

export class SymbolTable {
  namespace = GLOBAL_NAMESPACE;
  readonly namespaceStack: string[] = [];
  /** Scope stack; element 0 is the global scope. */
  readonly scopes: Array<Map<string, Lbl>> = [new Map()];
  readonly scopeSpans: Span[] = [];
  readonly all: Lbl[] = [];
  private tmpDefs = new Map<string, TmpDef[]>();
  private tmpPending: TmpRef[] = [];

  constructor(private readonly sink: SymbolSink) {}

  get globals(): Map<string, Lbl> {
    return this.scopes[0] as Map<string, Lbl>;
  }

  private get top(): Map<string, Lbl> {
    return this.scopes[this.scopes.length - 1] as Map<string, Lbl>;
  }

  /** Qualifies a name with the current namespace. Temporary labels are returned unchanged. */
  idName(label: string): string {
    if (TEMP_RE.test(label) || TEMP_REF_RE.test(label)) return label;
    if (!label.startsWith(DOT)) return normalizeNamespace(`${this.namespace}${DOT}${label}`);
    return label;
  }

  private makeLabel(name: string, span: Span, value: number | Expr | null, local: boolean, isAddress: boolean): Lbl {
    const lbl: Lbl = {
      name,
      span,
      value,
      local,
      namespace: this.namespace,
      isAddress,
      cached: null,
      evaluating: false,
      reported: false,
    };
    this.all.push(lbl);
    return lbl;
  }

  private define(lbl: Lbl, value: number | Expr | null, span: Span): void {
    if (lbl.value !== null) {
      this.sink.report('E521', span, `Label '${lbl.name}' is already defined`, undefined, [
        { span: lbl.span, message: 'first defined here' },
      ]);
    }
    lbl.value = value;
    lbl.cached = null;
    lbl.span = span;
    lbl.namespace = this.namespace;
  }

  /**
   * Declares a label at `span`. `value` is the address (when `isAddress`) or the EQU expression.
   * Temporary labels (`1:`) are recorded for later `1f`/`1b` references.
   */
  declare(label: string, span: Span, seq: number, value: number | Expr, isAddress: boolean): void {
    if (TEMP_RE.test(label)) {
      let list = this.tmpDefs.get(label);
      if (list === undefined) {
        list = [];
        this.tmpDefs.set(label, list);
      }
      list.push({ seq, namespace: this.namespace, value: value as number });
      return;
    }
    const name = this.idName(label);
    const existing = this.top.get(name);
    if (existing !== undefined) {
      this.define(existing, value, span);
      existing.isAddress = isAddress;
    } else {
      this.top.set(name, this.makeLabel(name, span, value, false, isAddress));
    }
  }

  /** A reference to a label: the existing label, or a new undefined one in the innermost scope. */
  reference(label: string, span: Span, seq: number): { lbl: Lbl } | { tmp: TmpRef } {
    const name = this.idName(label);
    const m = TEMP_REF_RE.exec(name);
    if (m !== null) {
      const ref: TmpRef = {
        name: m[1] as string,
        dir: m[2] === 'F' ? 1 : -1,
        namespace: this.namespace,
        seq,
        span,
        value: null,
      };
      this.tmpPending.push(ref);
      return { tmp: ref };
    }
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const found = (this.scopes[i] as Map<string, Lbl>).get(name);
      if (found !== undefined) return { lbl: found };
    }
    const lbl = this.makeLabel(name, span, null, false, false);
    this.top.set(name, lbl);
    return { lbl };
  }

  /** LOCAL: marks (creating if needed) a label of the innermost scope as local to it. */
  setLocal(label: string, span: Span): void {
    const name = this.idName(label);
    let lbl = this.top.get(name);
    if (lbl === undefined) {
      lbl = this.makeLabel(name, span, null, false, false);
      this.top.set(name, lbl);
    } else {
      lbl.span = span;
    }
    if (lbl.local) {
      this.sink.report('W540', span, `Label '${label}' is already declared LOCAL`);
    }
    lbl.local = true;
  }

  enterProc(span: Span): void {
    this.scopes.push(new Map());
    this.scopeSpans.push(span);
  }

  exitProc(span: Span): void {
    if (this.scopes.length <= 1) {
      this.sink.report('E529', span, 'ENDP in global scope (with no PROC)');
      return;
    }
    for (const lbl of this.top.values()) {
      if (lbl.local) {
        if (lbl.value === null) {
          // The reference stops here and leaves the scope open (and then also reports "Missing ENDP").
          this.sink.report('E531', span, `Undefined LOCAL label '${lbl.name}'`);
          this.scopes.pop();
          this.scopeSpans.pop();
          return;
        }
        continue;
      }
      const existing = this.globals.get(lbl.name);
      if (existing === undefined) {
        this.globals.set(lbl.name, lbl);
      } else {
        this.define(existing, lbl.value, lbl.span);
      }
    }
    this.scopes.pop();
    this.scopeSpans.pop();
  }

  /** Resolves every pending temporary-label reference and forgets the temporary labels (at ORG and at the end). */
  endTemporaryEpoch(): void {
    for (const ref of this.tmpPending) {
      const defs = this.tmpDefs.get(ref.name);
      if (defs === undefined) continue;
      if (ref.dir === -1) {
        for (let i = defs.length - 1; i >= 0; i--) {
          const d = defs[i] as TmpDef;
          if (d.seq <= ref.seq && d.namespace === ref.namespace) {
            ref.value = d.value;
            break;
          }
        }
      } else {
        for (const d of defs) {
          if (d.seq >= ref.seq && d.namespace === ref.namespace) {
            ref.value = d.value;
            break;
          }
        }
      }
    }
    this.tmpDefs = new Map();
    this.tmpPending = [];
  }
}
