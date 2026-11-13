import { describe, expect, it } from 'vitest';
import { SourceSet } from '../core/source.js';
import { assemble, flatten, formatMap } from './index.js';
import type { AssembleOptions, AssembleResult, IncludeResolver } from './types.js';

interface Run {
  readonly result: AssembleResult;
  readonly sources: SourceSet;
  readonly bytes: number[];
  readonly org: number;
}

function run(text: string, options?: AssembleOptions, files: Record<string, string> = {}, extra: Record<string, string> = {}): Run {
  const sources = new SourceSet();
  for (const [path, t] of Object.entries(extra)) sources.add(path, t, 'user');
  const entry = sources.add('main.asm', text, 'user');
  const resolveInclude: IncludeResolver = (name) => {
    const t = files[name];
    return t === undefined ? undefined : { path: name, text: t };
  };
  const result = assemble({ sources, entry, resolveInclude, ...(options ? { options } : {}) });
  const image = flatten(result.segments);
  return { result, sources, bytes: [...image.bytes], org: image.org };
}

const errors = (r: Run): string[] => r.result.diagnostics.filter((d) => d.severity === 'error').map((d) => d.code);
const hex = (bytes: number[]): string => bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');
const sym = (r: Run, name: string): number | undefined => r.result.symbols.get(name)?.value;

describe('assemble: instructions and data', () => {
  it('encodes instructions, DEFB/DEFW/DEFS/DEFM and the aliases', () => {
    const r = run(`org 100
      ld a,5
      ld hl,1234h
      db 1,2, "ab", 'c'
      dw 0abcdh, 2
      ds 3, 7
      defm "x"
      defs 2
      ld (ix-2),b
      ld a,(ix+3)
      ret`);
    expect(errors(r)).toEqual([]);
    expect(r.org).toBe(100);
    expect(hex(r.bytes)).toBe('3e 05 21 34 12 01 02 61 62 63 cd ab 02 00 07 07 07 78 00 00 dd 70 fe dd 7e 03 c9');
  });

  it('evaluates expressions with the reference precedence', () => {
    const r = run(`org 0
      db 2+3*4, (2+3)*4, 10-4-3, 7/2, -7/2, 7%4, -7%4, 2^3^2 & 255, 1<<4|1, 0f0h>>4, 6~3, -2^2`);
    expect(errors(r)).toEqual([]);
    // 14, 20, 3, 3, -4, 3, 1, 512&255=0, 17, 15, 5, (-2)^2=4
    expect(r.bytes).toEqual([14, 20, 3, 3, 252, 3, 1, 0, 17, 15, 5, 4]);
  });

  it('accepts the register and flag forms the runtime uses', () => {
    const r = run(`org 0
      ex af,af'
      ex de,hl
      ex (sp),hl
      jp (hl)
      jp nz,0
      jr c,$
      in a,(c)
      out (c),a
      in a,(254)
      out (254),a
      bit 3,(ix+1)
      rst 8
      im 1
      ld sp,hl
      push af
      sbc hl,de
      add ix,bc
      adc a,(iy-1)
      ld a,[hl]`);
    expect(errors(r)).toEqual([]);
    expect(hex(r.bytes)).toBe(
      '08 eb e3 e9 c2 00 00 38 fe ed 78 ed 79 db fe d3 fe dd cb 01 5e cf ed 56 f9 f5 ed 52 dd 09 fd 8e ff 7e',
    );
  });

  it('treats a parenthesised expression followed by an operator as a value, not a memory access', () => {
    const r = run('org 0\nld a,(2+3)*4\nld a,(2+3)');
    expect(errors(r)).toEqual([]);
    expect(hex(r.bytes)).toBe('3e 14 3a 05 00');
  });

  it('warns when DEFB truncates a value', () => {
    const r = run('org 0\ndb 256');
    expect(r.result.diagnostics.map((d) => d.code)).toEqual(['W504']);
    expect(r.bytes).toEqual([0]);
  });

  it('joins lines that end in a backslash', () => {
    const r = run('org 0\ndb 1, \\\n 2\nnop');
    expect(errors(r)).toEqual([]);
    expect(r.bytes).toEqual([1, 2, 0]);
  });
});

describe('assemble: labels', () => {
  it('namespace and PROC/LOCAL scoping', () => {
    const r = run(`org 0
      namespace core
      outer: nop
      push namespace inner
      deep: nop
      pop namespace
      jp outer
      jp .inner.deep
      push namespace
      pop namespace
      namespace .
      top: nop
      jp top
      proc
        local loop
      loop: nop
        jr loop
      shared: nop
      endp
      proc
        local loop
      loop: nop
        jr loop
      endp
      call shared`);
    expect(errors(r)).toEqual([]);
    expect(sym(r, '.core.outer')).toBe(0);
    expect(sym(r, '.inner.deep')).toBe(1);
    expect(sym(r, '.top')).toBe(8);
    // PROC labels that are not LOCAL become global; LOCAL ones are local symbols and not in the map
    expect(r.result.symbols.get('.shared')?.scope).toBe('global');
    const locals = r.result.symbolsByAddress.filter((s) => s.name === '.loop');
    expect(locals.map((s) => s.scope)).toEqual(['local', 'local']);
    expect(locals.map((s) => s.inMap)).toEqual([false, false]);
    expect(r.result.symbols.get('.core.outer')?.inMap).toBe(true);
    expect(formatMap(r.result)).not.toContain('.loop');
    expect(formatMap(r.result)).toContain('0000: .core.outer');
    // jp outer(2..4) jp deep(5..7): top at 8 ... check the jumps resolved
    expect(r.bytes.slice(2, 8)).toEqual([0xc3, 0x00, 0x00, 0xc3, 0x01, 0x00]);
  });

  it('temporary labels forward and back', () => {
    const r = run(`org 100
      1: nop
      jr 1b
      jr 1f
      nop
      1: nop
      jp 1b
      jp 2f
      2: nop`);
    expect(errors(r)).toEqual([]);
    // 100 nop; 101 jr 1b (-3); 103 jr 1f (+1); 105 nop; 106 nop (1:); 107 jp 106; 110 jp 2f = 113; 113 nop
    expect(hex(r.bytes)).toBe('00 18 fd 18 01 00 00 c3 6a 00 c3 71 00 00');
  });

  it('forgets temporary labels at an ORG', () => {
    const r = run('org 0\n1: nop\norg 10\njr 1b');
    expect(errors(r)).toEqual(['E520']);
  });

  it('EQU forward references', () => {
    const r = run(`org 0
      ld hl, later + 1
      ld a, double
      double equ half * 2
      half equ 21
      later equ $ + 5
      ret`);
    expect(errors(r)).toEqual([]);
    expect(hex(r.bytes)).toBe('21 0b 00 3e 2a c9');
    expect(r.result.symbols.get('.half')?.kind).toBe('equ');
    expect(r.result.symbols.get('.half')?.inMap).toBe(false);
    expect(r.result.symbols.get('.later')?.inMap).toBe(false);
    expect(formatMap(r.result)).toBe('');
  });

  it('$ in expressions is the address of the statement', () => {
    const r = run(`org 50
      jr $
      db $, $+1
      dw $
      ld hl,$
      here: jp here`);
    expect(errors(r)).toEqual([]);
    expect(hex(r.bytes)).toBe('18 fe 34 35 36 00 21 38 00 c3 3b 00');
  });

  it('ORG gaps flatten with zeros like the reference', () => {
    const r = run('org 10\ndb 1\norg 14\ndb 2');
    expect(r.org).toBe(10);
    expect(r.bytes).toEqual([1, 0, 0, 0, 2]);
    expect(r.result.segments.map((s) => [s.org, s.bytes.length])).toEqual([
      [10, 1],
      [14, 1],
    ]);
  });

  it('a label at the start of the image counts, trailing labels do not', () => {
    const r = run('org 5\nstart equ 1\nnop\nend_label:');
    expect(r.org).toBe(5);
    expect(r.bytes).toEqual([0]);
    expect(sym(r, '.end_label')).toBe(6);
  });

  it('ALIGN', () => {
    const r = run('org 3\ndb 1\nalign 8\nhere: db 2\nalign 8\nalso: db 3');
    expect(errors(r)).toEqual([]);
    expect(sym(r, '.here')).toBe(8);
    expect(sym(r, '.also')).toBe(16);
    expect(r.org).toBe(3);
    expect(r.bytes.length).toBe(14);
    expect(r.bytes[0]).toBe(1);
    expect(r.bytes[5]).toBe(2);
    expect(r.bytes[13]).toBe(3);
    expect(errors(run('align 1'))).toEqual(['E526']);
  });

  it('END label sets the entry', () => {
    const r = run('org 100\nnop\nstart: nop\nend start');
    expect(errors(r)).toEqual([]);
    expect(r.result.entry).toBe(101);
    expect(run('org 100\nnop\nend').result.entry).toBeNull();
  });

  it('#init: collect returns the labels, zxbasm appends the calls and a jump to the END label', () => {
    const text = 'org 100\n#init init_a\n#init "init_b"\nnop\nmain: nop\ninit_a: ret\ninit_b: ret\nend main';
    const c = run(text);
    expect(errors(c)).toEqual([]);
    expect(c.result.inits).toEqual(['init_a', 'init_b']);
    expect(c.result.entry).toBe(101);
    const z = run(text, { initMode: 'zxbasm' });
    expect(errors(z)).toEqual([]);
    expect(hex(z.bytes)).toBe('00 00 c9 c9 cd 66 00 cd 67 00 c3 65 00'.replace('66', '66'));
    // entry is the address of the first appended CALL (104)
    expect(z.result.entry).toBe(104);
  });

  it('#init without END jumps to the lowest address', () => {
    const z = run('org 100\n#init f\nnop\nf: ret', { initMode: 'zxbasm' });
    expect(hex(z.bytes)).toBe('00 c9 cd 65 00 c3 64 00');
  });

  it('defines come from the options', () => {
    const r = run('org 0\n#ifdef BARE\ndb 1\n#else\ndb 2\n#endif', { defines: new Map([['BARE', '']]) });
    expect(r.bytes).toEqual([1]);
  });

  it('includes are resolved through the resolver', () => {
    const r = run('org 0\n#include once <a.asm>\n#include once <a.asm>\nnop', undefined, { 'a.asm': 'db 9' });
    expect(r.bytes).toEqual([9, 0]);
  });

  it('produces a listing on request', () => {
    const r = run('org 4\nld a,1\nnop', { listing: true });
    expect(r.result.listing?.map((l) => [l.address, l.bytes])).toEqual([
      [4, [0x3e, 1]],
      [6, [0]],
    ]);
  });
});

describe('assemble: map', () => {
  it('lists global address labels sorted as strings', () => {
    const r = run('org 255\nbb: nop\naa: nop\n.z.x: nop\ncc equ 3');
    expect(formatMap(r.result)).toBe('00FF: .bb\n0100: .aa\n0101: .z.x');
  });
});

describe('assemble: errors', () => {
  it('reports an ORG back over earlier output once per overlapping run (E537, follow-up 44)', () => {
    const r = run('org 100\nnop\nnop\nnop\nnop\norg 102\nhalt\nhalt\norg 300\nnop\norg 100\nnop');
    expect(errors(r)).toEqual(['E537', 'E537']);
    expect(r.result.diagnostics[0]?.message).toContain('address 102');
    expect(r.result.diagnostics[1]?.message).toContain('address 100');
    expect(r.result.ok).toBe(false);
  });

  it('separate blocks that do not touch, and an ORG that continues where the code stopped, are fine', () => {
    const r = run('org 100\nnop\nnop\norg 200\nnop\norg 102\nnop');
    expect(errors(r)).toEqual([]);
  });

  it('reports an undefined label in the file, line and column where it is used', () => {
    const files = { 'lib.asm': 'nop\n  ld hl, missing\n' };
    const r = run('org 0\n#include "lib.asm"', undefined, files);
    const d = r.result.diagnostics.find((x) => x.code === 'E520');
    expect(d).toBeDefined();
    const pos = r.sources.position((d as { span: { file: number } }).span.file as never, (d as { span: { start: number } }).span.start);
    expect(r.sources.get(pos.file).path).toBe('lib.asm');
    expect([pos.line, pos.col]).toEqual([2, 10]);
    expect(r.result.ok).toBe(false);
    expect(r.result.segments).toEqual([]);
  });

  it('reports a duplicate label with the first definition as related information', () => {
    const r = run('org 0\nfoo: nop\nfoo: nop');
    const d = r.result.diagnostics.find((x) => x.code === 'E521');
    expect(d).toBeDefined();
    expect(d?.related?.length).toBe(1);
    expect(r.sources.position(d?.span.file as never, d?.span.start as number).line).toBe(3);
    expect(r.sources.position(d?.related?.[0]?.span.file as never, d?.related?.[0]?.span.start as number).line).toBe(2);
  });

  it('surfaces a relative jump out of range from the encoder at the instruction', () => {
    const r = run('org 0\nstart: nop\n  defs 200\n  jr start');
    const d = r.result.diagnostics.find((x) => x.code === 'E502');
    expect(d).toBeDefined();
    expect(r.sources.position(d?.span.file as never, d?.span.start as number)).toMatchObject({ line: 4, col: 3 });
  });

  it('reports syntax errors, unknown characters and bad operands', () => {
    expect(errors(run('ld a,'))).toEqual(['E522']);
    expect(errors(run('ld a,@'))).toContain('E524');
    expect(errors(run('ld a,hl'))).toEqual(['E501']);
    expect(errors(run('foo bar'))).toEqual(['E522']);
    expect(errors(run('endp'))).toEqual(['E529']);
    expect(errors(run('proc'))).toEqual(['E530']);
    expect(errors(run('pop namespace'))).toEqual(['E532']);
    expect(errors(run('org 70000'))).toEqual(['E525']);
    expect(errors(run('db 1/0'))).toEqual(['E527']);
    expect(errors(run('aa equ bb\nbb equ aa\nld hl,aa'))).toContain('E528');
    expect(errors(run('incbin "x"'))).toEqual(['E534']);
    expect(errors(run('ld a,(ix)+1'))).toEqual(['E522']);
    expect(errors(run('defs 1,2,3'))).toEqual(['E533']);
  });

  it('reports a LOCAL label that is never defined', () => {
    expect(errors(run('proc\nlocal x\nendp'))).toEqual(['E531']);
  });

  it('attributes diagnostics through #line to the BASIC file when it is in the SourceSet', () => {
    const basic = 'PRINT 1\nPRINT 2\nPRINT 3\n';
    const r = run('org 0\n#line 3 "game.bas"\nld a,nothere\n', undefined, {}, { 'game.bas': basic });
    const d = r.result.diagnostics.find((x) => x.code === 'E520');
    expect(d).toBeDefined();
    expect(r.sources.get(d?.span.file as never).path).toBe('game.bas');
    expect(r.sources.position(d?.span.file as never, d?.span.start as number).line).toBe(3);
  });

  it('a bare #line ends the attribution: an error after an ASM block points at the generated text', () => {
    const basic = 'PRINT 1\nPRINT 2\nPRINT 3\n';
    const r = run('org 0\n#line 3 "game.bas"\nnop\n#line\nld a,nothere\n', undefined, {}, { 'game.bas': basic });
    const d = r.result.diagnostics.find((x) => x.code === 'E520');
    expect(d).toBeDefined();
    expect(d?.span.file).toBe(r.sources.byPath('main.asm')?.id);
    expect(r.sources.position(d?.span.file as never, d?.span.start as number).line).toBe(5);
    expect(d?.message).not.toContain('game.bas');
  });

  it('names the #line location in the message when the file is not in the SourceSet', () => {
    const r = run('org 0\n#line 7 "other.bas"\nld a,nothere\n');
    const d = r.result.diagnostics.find((x) => x.code === 'E520');
    expect(d?.span.file).toBe(r.sources.byPath('main.asm')?.id);
    expect(d?.message).toContain('other.bas:7');
  });

  it('ignores #line when lineAttribution is off', () => {
    const r = run('org 0\n#line 7 "other.bas"\nld a,nothere\n', { lineAttribution: false });
    const d = r.result.diagnostics.find((x) => x.code === 'E520');
    expect(d?.message).not.toContain('other.bas');
  });
});

describe('assemble: determinism', () => {
  it('gives identical results on two runs', () => {
    const text = 'org 100\nnamespace n\na: ld hl,b\nb: db 1,2\nc equ a+1\n1: jr 1b\n#init a\n';
    const a = run(text, { initMode: 'zxbasm' });
    const b = run(text, { initMode: 'zxbasm' });
    expect(a.bytes).toEqual(b.bytes);
    expect(JSON.stringify(a.result.diagnostics)).toBe(JSON.stringify(b.result.diagnostics));
    expect(formatMap(a.result)).toBe(formatMap(b.result));
  });
});
