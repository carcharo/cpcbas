/**
 * L5-STRIP, the link pass `strip` (slot 100): runtime and library chunks that nothing reachable names are left out of the image.
 *
 * The linked text holds `#include once` lines, so the pass runs the asm preprocessor in its own `SourceSet` to see the lines the
 * assembler will see, asks `asm/reach.ts` which chunks of the runtime region (everything after the `end of user code` marker)
 * are unreachable, and hands the line ranges to the assembler through `LinkedAsm.dropLines`. No imported file is edited, and
 * the `--asm` text is unchanged (it still names every linked file). Anything unexpected leaves the program as it was.
 */

import { preprocessAsm } from '../asm/preprocess.js';
import { unreachable } from '../asm/reach.js';
import { DiagnosticBag } from '../core/diagnostics.js';
import { SourceSet } from '../core/source.js';
import type { LinkPass } from './index.js';

const MARKER = ';; --- end of user code ---';

export const stripPass: LinkPass = {
  name: 'strip',
  order: 100,
  when: (spec) => spec.strip,
  run(linked, env) {
    const sources = new SourceSet();
    const diagnostics = new DiagnosticBag();
    const entry = sources.add('strip-probe.asm', linked.text, 'generated');
    const pre = preprocessAsm({ sources, entry, resolveInclude: linked.resolveInclude, defines: env.target.asmDefines, diagnostics });
    if (diagnostics.hasErrors) return linked;
    const texts = pre.lines.map((l) => l.text);
    const marker = texts.findIndex((t) => t.includes(MARKER));
    if (marker < 0) return linked;
    const result = unreachable(texts, marker + 1);
    if (result.drop.length === 0) return linked;
    return { ...linked, dropLines: { total: texts.length, ranges: result.drop } };
  },
};
