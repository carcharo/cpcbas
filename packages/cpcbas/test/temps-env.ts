/**
 * L5-TEMPS: the template tests (src/codegen/int|real|array|str.test.ts) normally emit the stack forms. With register temps on they
 * emit the register forms and compare-and-branch (the `-O1` code generation options), so every operand-kind and value table of those
 * suites becomes a test of the register forms against the same model. `src/codegen/temps-suites.test.ts` imports the suites that way
 * under `npm test`; `CPCBAS_TEMPS=1 npx vitest run src/codegen` does it for a whole run.
 */
import { COMPARE_JUMPS, REGISTER_FORMS, type CodegenOptions, type CompareJumpTable, type RegisterFormTable, type TemplateStyle } from '../src/codegen/index.js';

let on = process.env.CPCBAS_TEMPS === '1';

/** Turns register temps on for the suites imported afterwards in this test file. */
export const setTempsOn = (value: boolean): void => {
  on = value;
};

let style: TemplateStyle = (process.env.CPCBAS_STYLE as TemplateStyle | undefined) ?? 'base';

/** L5-CG: the template style the suites imported afterwards generate with (register temps are switched on too: `fast` and `short` are -O2 and -Os). */
export const setStyle = (value: TemplateStyle): void => {
  style = value;
  on = true;
};

/** The code generation options of a level with register temps (the style is `base` unless `setStyle` or `CPCBAS_STYLE` says otherwise). */
export const TEMPS_OPTIONS: CodegenOptions = {
  registerTemps: true,
  get style() {
    return style;
  },
  enabled: () => true,
  runCodePasses: (units) => units,
};

/** The `GenerateInput.opt` of a test's generate call (absent: stack forms). */
export const tempsOpt = (): { opt?: CodegenOptions } => (on ? { opt: TEMPS_OPTIONS } : {});

/** The register forms a test passes to `generateWith` (empty: stack forms). */
export const tempsForms = (): [RegisterFormTable, CompareJumpTable] => (on ? [REGISTER_FORMS, COMPARE_JUMPS] : [{}, {}]);
