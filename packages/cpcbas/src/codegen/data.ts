/**
 * Data emission for the code generator: global variables, string constants and the DATA
 * table (docs/ir.md, "Program layout", "Strings and constants", "DATA"). Output lines
 * follow the reference compiler's spelling (`tests/asm-golden/programs/*.asm`).
 */

import { InternalError, type DiagnosticBag } from '../core/diagnostics.js';
import type { Span } from '../core/source.js';
import { realConstant } from '../core/locoreal.js';
import { arrayLabels, arrayLayout } from '../ir/arrays.js';
import type { IrDataItem, IrGlobal, IrString } from '../ir/ir.js';

/**
 * Hex as the reference spells it: `width` digits, upper case, `h` suffix, and a leading 0
 * when the first digit is a letter (`0AAh`, `0FFh`): `AAh` would read as a label.
 */
export const hex = (n: number, width: number): string => {
  const digits = n.toString(16).toUpperCase().padStart(width, '0');
  return `${/^[A-F]/.test(digits) ? '0' : ''}${digits}h`;
};

/** The label of the DATA table's start, which read_restore.asm names. */
export const DATA_TABLE_LABEL = '.DATA.__DATA__0';

/** DATA type bytes (docs/ir.md, "DATA"). */
const DATA_TYPE_BYTE: Readonly<Record<string, number>> = {
  str: 1,
  i8: 2,
  u8: 3,
  i16: 4,
  u16: 5,
  i32: 6,
  u32: 7,
  f16: 8,
  f: 9,
};

/**
 * A real number in Locomotive's 5-byte layout (docs/ir.md, measured on the interpreter): bytes 0..3 are the 32-bit mantissa, least
 * significant byte first, whose top bit holds the sign (the leading 1 is implied), and byte 4
 * is the exponent biased by 128 (the value is 0.1xxx * 2^(e-128)). Zero is five zero bytes. Values
 * too large saturate, too small are zero. A decimal literal gets the tokeniser's rule (REAL of its digits,
 * then the firmware's x 10^E, which `src/core/locoreal.ts` models: 270 of the 299 recorded literals against
 * 265 for the correctly rounded conversion used before FWM-CORE); a double that is exactly a REAL is encoded as it is.
 */
export function encodeReal5(value: number): number[] {
  return realConstant(value);
}

/** `value` as `size` little-endian bytes (two's complement for negatives). */
function intBytes(value: number, size: number): number[] {
  const out: number[] = [];
  let v = BigInt(Math.trunc(value));
  for (let i = 0; i < size; i++) {
    out.push(Number(v & 0xffn));
    v >>= 8n;
  }
  return out;
}

/** `DEFB` lines for bytes, up to 16 per line (zeros as one `DEFB 00, ...` run per line). */
function defb(bytes: Uint8Array): string[] {
  const out: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) out.push(`\tDEFB ${[...bytes.subarray(i, i + 16)].map((b) => hex(b, 2)).join(', ')}`);
  return out;
}

/**
 * A global array (docs/ir.md, "Arrays"; `ir/arrays.ts` has the layout): the 8-byte descriptor,
 * the elements (the initial bytes, else zeros; nothing for `DIM ... AT`, whose element label is
 * an EQU; with `IrGlobal.hidata` the elements are assembled at that address in an `org` block that
 * returns to the data area afterwards), then the dimension and UBOUND tables.
 */
function emitArray(g: IrGlobal): string[] {
  const L = arrayLabels(g.label);
  const layout = arrayLayout(g.dims.map((c) => c - 1), g.type);
  const out = [`${L.descriptor}:`, `\tDEFW ${L.dims}`, `${L.dataPtr}:`, `\tDEFW ${L.data}`, '\tDEFW 0', `\tDEFW ${L.ubound}`];
  if (g.at !== null) {
    out.push(`${L.data} EQU ${g.at}`);
  } else {
    const bytes = new Uint8Array(layout.dataBytes);
    if (g.init !== null) {
      if (g.init.length > bytes.length) throw new InternalError(`array ${g.label}: ${g.init.length} initial bytes for ${bytes.length}`);
      bytes.set(g.init);
    }
    if (g.hidata !== undefined) {
      // #pragma hidata: the elements are assembled at their own address, then the origin goes back
      // (the reference's __HIDATA_BACK_n), so the data area and ZXBASIC_USER_DATA_LEN are unaffected.
      const back = `${L.data}.__BACK__`;
      out.push(`${back}:`, `\torg ${g.hidata}`, `${L.data}:`, ...defb(bytes), `\torg ${back}`);
    } else {
      out.push(`${L.data}:`, ...defb(bytes));
    }
  }
  out.push(`${L.dims}:`, ...defb(layout.dimsTable), `${L.ubound}:`, ...defb(layout.uboundTable));
  return out;
}

/** Global variables and arrays between `.core.ZXBASIC_USER_DATA` and `..._END`. */
export function emitGlobals(globals: readonly IrGlobal[], _diagnostics: DiagnosticBag, _span: Span): string[] {
  const out: string[] = [];
  for (const g of globals) {
    if (g.dims.length > 0) {
      out.push(...emitArray(g));
      continue;
    }
    if (g.at !== null) {
      out.push(`${g.label} EQU ${g.at}`);
      continue;
    }
    out.push(`${g.label}:`);
    if (g.init === null) {
      out.push(`\tDEFB ${new Array<string>(g.size).fill('00').join(', ')}`);
    } else {
      for (const b of g.init) out.push(`\tDEFB ${hex(b, 2)}`);
    }
  }
  return out;
}

/** String constants: `label:`, `DEFW <length>`, one `DEFB` per byte. */
export function emitStrings(strings: readonly IrString[]): string[] {
  const out: string[] = [];
  for (const s of strings) {
    out.push(`${s.label}:`, `\tDEFW ${hex(s.bytes.length, 4)}`);
    for (const b of s.bytes) out.push(`\tDEFB ${hex(b, 2)}`);
  }
  return out;
}

/**
 * The DATA table: for each item its type byte then the value (a string item is its type
 * byte and the address of a string constant, emitted after the table), a `label:` before
 * the items that RESTORE can name, and a final zero byte. Empty when there is no DATA and
 * `force` is false; with `force` (read_restore.asm is linked) an empty table is just the
 * label and the terminator.
 */
export function emitData(items: readonly IrDataItem[], diagnostics: DiagnosticBag, span: Span, force: boolean): string[] {
  if (items.length === 0 && !force) return [];
  const out: string[] = [`${DATA_TABLE_LABEL}:`];
  const trailer: string[] = [];
  let strings = 0;
  for (const item of items) {
    if (item.label !== null) out.push(`${item.label}:`);
    const typeByte = DATA_TYPE_BYTE[item.type];
    if (typeByte === undefined) {
      diagnostics.report('E002', span, `DATA of type ${item.type} is not implemented yet`);
      continue;
    }
    if (item.spelling !== undefined) {
      // A spelling entry (type byte 10 and the address of a string constant) precedes the numeric entry.
      const label = `.DATA.__S${strings++}`;
      out.push(`\tDEFB 10`, `\tDEFW ${label}`);
      trailer.push(`${label}:`, `\tDEFW ${hex(item.spelling.length, 4)}`);
      for (const b of item.spelling) trailer.push(`\tDEFB ${hex(b, 2)}`);
    }
    out.push(`\tDEFB ${typeByte}`);
    if (item.type === 'str') {
      const bytes = item.value instanceof Uint8Array ? item.value : new Uint8Array();
      const label = `.DATA.__S${strings++}`;
      out.push(`\tDEFW ${label}`);
      trailer.push(`${label}:`, `\tDEFW ${hex(bytes.length, 4)}`);
      for (const b of bytes) trailer.push(`\tDEFB ${hex(b, 2)}`);
    } else {
      const v = item.value as number;
      const bytes =
        item.type === 'f'
          ? encodeReal5(v)
          : item.type === 'f16'
            ? intBytes(Math.round(v * 65536), 4)
            : intBytes(v, item.type === 'i8' || item.type === 'u8' ? 1 : item.type === 'i16' || item.type === 'u16' ? 2 : 4);
      for (const b of bytes) out.push(`\tDEFB ${b}`);
    }
  }
  out.push('__DATA__END:', '\tDEFB 00h', ...trailer);
  return out;
}
