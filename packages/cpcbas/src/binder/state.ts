/** Positional binder state (DEF* ranges, OPTION REAL, #pragma explicit) and small helpers. */
import type { TypeName } from '../sem/types.js';

export type DefTypeName = 'INTEGER' | 'REAL' | 'STRING';

/** What applies at a point in the source. A new object is made at each DEF*, OPTION or explicit pragma. */
export interface BindState {
  readonly explicit: boolean;
  readonly optionReal: boolean;
  /** Lower-case letter to type, for the letters a DEF* statement covered. */
  readonly defs: ReadonlyMap<string, DefTypeName>;
}

export const INITIAL_STATE: BindState = { explicit: false, optionReal: false, defs: new Map() };

/** The type an unsuffixed name has by default: its first letter's DEF* range, else REAL under OPTION REAL, else INTEGER. */
export function defaultType(state: BindState, base: string): TypeName {
  const ch = base.charAt(0);
  const d = state.defs.get(ch);
  if (d !== undefined) return d;
  return state.optionReal ? 'REAL' : 'INTEGER';
}

/** An integer setting in the forms `#if` accepts (decimal, `&H`/`&` hex, `0x`, `&X`/`0b` binary), 0..65535; null when bad. */
export function parseSettingInt(text: string): number | null {
  const s = text.trim();
  let v: number;
  if (/^\d+$/.test(s)) v = parseInt(s, 10);
  else if (/^0[xX][0-9a-fA-F]+$/.test(s)) v = parseInt(s.slice(2), 16);
  else if (/^&[hH][0-9a-fA-F]+$/.test(s)) v = parseInt(s.slice(2), 16);
  else if (/^&[0-9a-fA-F]+$/.test(s)) v = parseInt(s.slice(1), 16);
  else if (/^&[xX][01]+$/.test(s)) v = parseInt(s.slice(2), 2);
  else if (/^0[bB][01]+$/.test(s)) v = parseInt(s.slice(2), 2);
  else return null;
  return v >= 0 && v <= 0xffff ? v : null;
}

export function parseSettingBool(text: string): boolean | null {
  const s = text.trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'on' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'off' || s === 'no') return false;
  return null;
}

/** Edit distance, for "did you mean" hints. */
export function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0] as number;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j] as number;
      prev[j] = Math.min(up + 1, (prev[j - 1] as number) + 1, diag + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length] as number;
}
