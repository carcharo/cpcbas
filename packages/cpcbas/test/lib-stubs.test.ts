/**
 * Follow-up 46 (L3-FIX): the library's refusal stubs. A call of a routine the build mode cannot give
 * (the firmware sound manager and BankLoad in bare-metal mode, the raster interrupts in firmware mode)
 * fails at build time with a message that names the reason; a program that does not call one builds,
 * because only reachable procedures are compiled.
 */
import { describe, expect, it } from 'vitest';
import { compile, formatDiagnostic } from '../src/index.js';
import { libTree } from './runtime-tree.js';

function build(main: string, defines: Record<string, string>) {
  const r = compile({ files: new Map([['main.bas', main]]), main: 'main.bas', defines, runtime: libTree(), options: { format: 'bin' } });
  return { r, text: r.diagnostics.filter((d) => d.severity === 'error').map((d) => formatDiagnostic(d, r.sources)).join('\n') };
}

const BARE = { CPC_BAREMETAL: '', CPC6128: '' };
const FW = { CPC6128: '', PLUS: '' };

describe('refusal stubs', () => {
  const cases: [string, string, Record<string, string>, string][] = [
    ['SoundQueue', '#include <stdlib/cpc.bas>\nDIM r AS UBYTE\nr = SoundQueue(1, 239, 10, 7, 0)\n', BARE, 'SoundQueue_needs_the_firmware__not_available_with_CPC_BAREMETAL'],
    ['SoundFree', '#include <stdlib/cpc.bas>\nDIM r AS UBYTE\nr = SoundFree(1)\n', BARE, 'SoundFree_needs_the_firmware__not_available_with_CPC_BAREMETAL'],
    ['SoundBusy', '#include <stdlib/cpc.bas>\nDIM r AS UBYTE\nr = SoundBusy(1)\n', BARE, 'SoundBusy_needs_the_firmware__not_available_with_CPC_BAREMETAL'],
    ['SoundEnvelope', '#include <stdlib/cpc.bas>\nSoundEnvelope(1, 0, 1)\n', BARE, 'SoundEnvelope_needs_the_firmware__not_available_with_CPC_BAREMETAL'],
    ['BankLoad', '#include <cpcbuild/banks.bas>\nDIM r AS UBYTE\nr = BankLoad("A.BIN", 1, 49152)\n', BARE, 'BankLoad_needs_the_firmware__not_available_with_CPC_BAREMETAL'],
    ['RasterIntAt', '#include <cpcplus/cpcplus.bas>\nRasterIntAt(10, 0)\n', FW, 'RasterIntAt_needs_bare_mode__build_with_D_CPC_BAREMETAL'],
    ['RasterIntOff', '#include <cpcplus/cpcplus.bas>\nRasterIntOff(10)\n', FW, 'RasterIntOff_needs_bare_mode__build_with_D_CPC_BAREMETAL'],
    ['RasterIntMove', '#include <cpcplus/cpcplus.bas>\nDIM r AS UBYTE\nr = RasterIntMove(10, 20)\n', FW, 'RasterIntMove_needs_bare_mode__build_with_D_CPC_BAREMETAL'],
    ['RasterIntClear', '#include <cpcplus/cpcplus.bas>\nRasterIntClear()\n', FW, 'RasterIntClear_needs_bare_mode__build_with_D_CPC_BAREMETAL'],
  ];
  for (const [name, src, defines, reason] of cases) {
    it(`a call of ${name} fails and names the reason`, () => {
      const b = build(src, defines);
      expect(b.r.ok).toBe(false);
      expect(b.text).toContain(reason);
      expect(b.text).not.toContain('Internal compiler error');
    });
  }

  it('the error is at the first call in the user file (follow-up 67)', () => {
    const b = build('#include <stdlib/cpc.bas>\nPRINT 1\nDIM r AS UBYTE\nr = SoundFree(1)\nr = SoundFree(2)\n', BARE);
    const lines = b.text.split('\n').filter((l) => l.includes('error E520'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^main\.bas:4:5: error E520: .*SoundFree_needs_the_firmware/);
  });

  it('programs that call none of them build, in bare-metal mode and in firmware mode', () => {
    const bare = build('#include <stdlib/cpc.bas>\n#include <cpcbuild/banks.bas>\nSoundStop()\nPRINT 1\n', BARE);
    expect(bare.text).toBe('');
    expect(bare.r.ok).toBe(true);
    const fw = build('#include <cpcplus/cpcplus.bas>\nPRINT 1\n', FW);
    expect(fw.text).toBe('');
    expect(fw.r.ok).toBe(true);
  });
});
