/**
 * The binder's first walk: everything that depends only on source order. DEF*, OPTION and
 * pragma state per node, line labels with the DATA position they stand at, the DATA table,
 * `#require`/`#init`, build settings, and the list of procedures and DEF FNs.
 */
import type { DeclareStmt, DefFnStmt, DimDecl, LineLabel, Node, PragmaStmt, ProcedureDecl } from '../ast/ast.js';
import { children } from '../ast/walk.js';
import type { DiagnosticBag } from '../core/diagnostics.js';
import type { Span } from '../core/source.js';
import type { DataItem, HidataAt, InitEntry, SourceSettings } from '../sem/model.js';
import { INITIAL_STATE, parseSettingBool, parseSettingInt, type BindState, type DefTypeName } from './state.js';

export interface CollectedLabel {
  readonly node: LineLabel;
  readonly owner: ProcedureDecl | null;
  /** Index of the first DATA item at or after this line. */
  readonly dataIndex: number;
}

export interface CollectedRequire {
  readonly path: string;
  readonly span: Span;
  readonly owner: ProcedureDecl | null;
}

export interface Collected {
  readonly stateAt: Map<Node, BindState>;
  readonly procLikes: Array<ProcedureDecl | DefFnStmt>;
  readonly declares: DeclareStmt[];
  readonly labels: CollectedLabel[];
  readonly data: DataItem[];
  readonly requires: CollectedRequire[];
  readonly inits: InitEntry[];
  /** The `#pragma hidata` in force at each DIM declarator (absent when none is): sem/model.ts `HidataAt`. */
  readonly hidataAt: Map<DimDecl, HidataAt>;
  settings: SourceSettings;
}

const SETTING_NAMES = ['org', 'heap_size', 'heap_address', 'hidata'] as const;
type SettingName = (typeof SETTING_NAMES)[number];
const TRACKED = new Set<string>(['explicit', ...SETTING_NAMES]);

export function collect(program: Node, diagnostics: DiagnosticBag): Collected {
  const c: Collected = {
    stateAt: new Map(),
    procLikes: [],
    declares: [],
    labels: [],
    data: [],
    requires: [],
    inits: [],
    hidataAt: new Map(),
    settings: { explicit: false, optionReal: false, org: null, heapSize: null, heapAddress: null, hidata: null },
  };
  let state: BindState = INITIAL_STATE;
  let settings: { -readonly [K in keyof SourceSettings]: SourceSettings[K] } = { ...c.settings };
  const stacks = new Map<string, Array<boolean | number | null>>();
  // Each setting of `hidata` (a pragma or a pop) starts a new run: the fork resets its cursor there.
  let hidataRun = 0;

  const getSetting = (name: string): boolean | number | null => {
    switch (name) {
      case 'explicit':
        return state.explicit;
      case 'org':
        return settings.org;
      case 'heap_size':
        return settings.heapSize;
      case 'heap_address':
        return settings.heapAddress;
      default:
        return settings.hidata;
    }
  };
  const putSetting = (name: string, v: boolean | number | null): void => {
    switch (name) {
      case 'explicit':
        state = { ...state, explicit: v === true };
        break;
      case 'org':
        settings.org = v as number | null;
        break;
      case 'heap_size':
        settings.heapSize = v as number | null;
        break;
      case 'heap_address':
        settings.heapAddress = v as number | null;
        break;
      default:
        settings.hidata = v as number | null;
        hidataRun++;
    }
  };

  const pragma = (p: PragmaStmt): void => {
    if (p.op === 'push') {
      if (TRACKED.has(p.name)) {
        const st = stacks.get(p.name) ?? [];
        st.push(getSetting(p.name));
        stacks.set(p.name, st);
      }
      return;
    }
    if (p.op === 'pop') {
      if (!TRACKED.has(p.name)) return;
      const st = stacks.get(p.name);
      if (!st || st.length === 0) {
        diagnostics.report('E212', p.span, `#pragma pop(${p.name}) has no matching push`);
        return;
      }
      putSetting(p.name, st.pop() as boolean | number | null);
      return;
    }
    if (p.name === 'explicit') {
      if (p.value === null) {
        putSetting('explicit', true);
        return;
      }
      const b = parseSettingBool(p.value);
      if (b === null) diagnostics.report('E211', p.span, `'${p.value}' is not a valid value for #pragma explicit`, 'Write #pragma explicit, or = true or = false.');
      else putSetting('explicit', b);
      return;
    }
    if ((SETTING_NAMES as readonly string[]).includes(p.name)) {
      const name = p.name as SettingName;
      if (p.value === null) {
        diagnostics.report('E211', p.span, `#pragma ${name} needs a value`, `Write #pragma ${name} = value.`);
        return;
      }
      const v = parseSettingInt(p.value);
      if (v === null) {
        diagnostics.report('E211', p.span, `'${p.value}' is not a valid value for #pragma ${name}`);
        return;
      }
      putSetting(name, name === 'hidata' && v === 0 ? null : v);
      return;
    }
    if (p.name === 'case_insensitive') return;
    diagnostics.report('W303', p.span, `Unknown pragma '${p.name}' is ignored`);
  };

  const visit = (node: Node, owner: ProcedureDecl | null): void => {
    c.stateAt.set(node, state);
    switch (node.kind) {
      case 'Pragma':
        pragma(node);
        break;
      case 'DefType': {
        const defs = new Map(state.defs);
        for (const r of node.ranges) {
          // A backwards range is the parser's E164; the binder ignores it.
          if (r.from > r.to) continue;
          for (let code = r.from.charCodeAt(0); code <= r.to.charCodeAt(0); code++) defs.set(String.fromCharCode(code), node.type as DefTypeName);
        }
        state = { ...state, defs };
        break;
      }
      case 'Option':
        if (node.name === 'REAL') {
          state = { ...state, optionReal: true };
          settings.optionReal = true;
        }
        break;
      case 'LineLabel':
        c.labels.push({ node, owner, dataIndex: c.data.length });
        break;
      case 'Data':
        for (const value of node.values) c.data.push({ index: c.data.length, value, stmt: node });
        break;
      case 'Require':
        c.requires.push({ path: node.path, span: node.span, owner });
        break;
      case 'DimDecl':
        if (settings.hidata !== null) c.hidataAt.set(node, { address: settings.hidata, run: hidataRun });
        break;
      case 'Init':
        c.inits.push({ label: node.label, span: node.span });
        break;
      case 'Procedure':
        c.procLikes.push(node);
        break;
      case 'DefFn':
        c.procLikes.push(node);
        break;
      case 'Declare':
        c.declares.push(node);
        break;
      default:
        break;
    }
    const next = node.kind === 'Procedure' ? node : owner;
    for (const ch of children(node)) visit(ch, next);
  };

  visit(program, null);
  settings = { ...settings, explicit: state.explicit };
  c.settings = settings;
  return c;
}
