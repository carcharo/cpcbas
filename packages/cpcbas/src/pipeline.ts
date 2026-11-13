/**
 * The compile pipeline: lex, preprocess and parse (phase L1), bind, check, lower, generate,
 * link, assemble, layout check and pack (phase L2), with the `tokens`, `ast`, `ir` and `asm`
 * dumps and `parseOnly`.
 */
import { assemble, flatten, formatMap } from './asm/index.js';
import type { Program } from './ast/ast.js';
import { printAst } from './ast/print.js';
import { bind } from './binder/index.js';
import { check } from './checker/index.js';
import { generate, link, makeTarget } from './codegen/index.js';
import { fileBufferBytes } from './codegen/memory-map.js';
import { DiagnosticBag, type Diagnostic } from './core/diagnostics.js';
import { SourceSet, type Span } from './core/source.js';
import type { PreprocessResult } from './core/tokens.js';
import { printTokens } from './core/tokens-print.js';
import { irOptTrace } from './ir/opt/index.js';
import type { CompileInput, CompileResult, Stage } from './index.js';
import { lower, printIr, verifyIr } from './ir/index.js';
import { makeOptimizer } from './opt/index.js';
import { firstUserCall, reachableProcedures } from './ir/lower/reach.js';
import { checkLayout } from './layout/index.js';
import { buildAmsdosHeader, buildCpr, buildDsk, type DskFile, type PackError } from './pack/index.js';
import { parse } from './parser/index.js';
import { predefinedMacros, preprocess } from './preprocessor/index.js';
import { VERSION } from './version.js';

const EMPTY_STATS = { codeBytes: 0, dataBytes: 0, heapBytes: 0, timeMs: 0 } as const;

/** Lex, preprocess and parse: the L1 front end. Reports into `bag`; `sources` gets every file read. */
export function runFrontEnd(
  input: CompileInput,
  sources: SourceSet,
  bag: DiagnosticBag,
): { readonly pp: PreprocessResult; readonly program: Program } {
  const options = input.options ?? {};
  const defines = predefinedMacros({ buildDate: options.buildDate ?? '1970-01-01', version: VERSION });
  const user = input.defines ?? {};
  for (const name of Object.keys(user).sort()) defines.set(name, user[name] as string);
  const pp = preprocess({
    sources,
    tree: input.files,
    main: input.main,
    includePaths: input.includePaths ?? [],
    ...(input.runtime !== undefined ? { library: input.runtime } : {}),
    defines,
    diagnostics: bag,
  });
  const program = parse({ pp, sources, diagnostics: bag });
  return { pp, program };
}

/** The AMSDOS name of the program: `dskName`, else the main file's base name + `.BIN`. */
function programName(input: CompileInput): string {
  if (input.options?.dskName !== undefined) return input.options.dskName;
  const base = input.main.split('/').pop() ?? input.main;
  return `${base.replace(/\.[^.]*$/, '')}.BIN`;
}

const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** What the build stages hand back to `runPipeline`. */
interface BuildOutcome {
  binary?: Uint8Array;
  org?: number;
  entry?: number;
  output?: Uint8Array;
  map?: string;
  asm?: string;
  stats?: { codeBytes: number; dataBytes: number; heapBytes: number };
  layoutFailed?: boolean;
}

/**
 * Bind, check, lower, generate, link, assemble, layout check and pack. Called with a clean
 * front end. Diagnostics go into `bag`; dumps into `stages`.
 */
function build(
  input: CompileInput,
  sources: SourceSet,
  bag: DiagnosticBag,
  program: Program,
  mainSpan: Span,
  stages: Partial<Record<Stage, string>>,
): BuildOutcome {
  const options = input.options ?? {};
  const dump = options.dump ?? [];
  const defines = input.defines ?? {};
  const out: BuildOutcome = {};
  const bareMetal = has(defines, 'CPC_BAREMETAL');
  const stopAfterIrOpt = dump.length > 0 && !dump.includes('asm');
  const stopAfterIr = stopAfterIrOpt && !dump.includes('ir-opt');
  const stopAfterAsm = dump.includes('asm');

  const opt = makeOptimizer({ level: options.optimize, disable: options.optDisable ?? [], trace: options.optTrace === true, diagnostics: bag, span: mainSpan });
  const bound = bind({ program, sources, diagnostics: bag, bareMetal, warnImplicit: options.warnImplicit === true });
  const checked = check({ bound, sources, diagnostics: bag });
  // W306: an unused procedure of the program's own files (the library's are dropped silently).
  const reached = reachableProcedures(checked);
  for (const id of bound.procedures) {
    const sym = bound.symbols[id];
    if (reached.has(id) || sym === undefined || (sym.kind !== 'procedure' && sym.kind !== 'deffn')) continue;
    if (sources.get(sym.span.file).origin !== 'user') continue;
    bag.report('W306', sym.span, `'${sym.decl.name.text}' is never called; it is not compiled`);
  }
  if (bag.hasErrors) return out;
  const ir = lower({ checked, diagnostics: bag, minimalSpills: opt.spec.level !== 0 });
  if (bag.hasErrors) return out;
  const problems = verifyIr(ir);
  if (problems.length > 0) {
    bag.report('E001', mainSpan, `Internal compiler error: the IR failed verification: ${problems[0] as string}`);
    return out;
  }
  if (dump.includes('ir')) stages.ir = printIr(ir);
  if (stopAfterIr) return out;
  const optimized = opt.ir(ir); // the IR stage (src/opt/index.ts)
  if (bag.hasErrors) return out;
  if (dump.includes('ir-opt')) stages['ir-opt'] = printIr(optimized) + (options.optTrace === true ? irOptTrace(optimized).map((l) => `${l}\n`).join('') : '');
  if (stopAfterIrOpt) return out;

  if (input.runtime === undefined) {
    bag.report('E004', mainSpan, 'code generation needs the runtime library tree (CompileInput.runtime)', 'Pass the repo\'s lib/ directory (the CLI\'s --runtime).');
    return out;
  }
  const target = makeTarget({
    ...(options.org !== undefined ? { org: options.org } : {}),
    ...(options.heapSize !== undefined ? { heapSize: options.heapSize } : {}),
    ...(options.heapAddress !== undefined ? { heapAddress: options.heapAddress } : {}),
    defines,
    settings: bound.settings,
    fileBuffers: { input: ir.requires.includes('loco/file.asm'), output: ir.requires.includes('loco/fileout.asm') },
  });
  const codegen = opt.codegen(target);
  const generated = generate({ ir: optimized, target, diagnostics: bag, sources, ...(codegen !== undefined ? { opt: codegen } : {}) });
  if (bag.hasErrors) return out;
  const linked = opt.link(link({ asm: generated, target, runtime: input.runtime, sources, diagnostics: bag }), target); // the link stage
  if (bag.hasErrors) return out;
  if (options.asm === true || dump.includes('asm')) out.asm = linked.text;
  if (dump.includes('asm')) stages.asm = linked.text;
  if (stopAfterAsm) return out;

  const entryFile = sources.add('program.asm', linked.text, 'generated');
  const result = assemble({
    sources,
    entry: entryFile,
    resolveInclude: linked.resolveInclude,
    options: { initMode: 'collect', defines: target.asmDefines, ...(linked.dropLines !== undefined ? { dropLines: linked.dropLines } : {}) },
  });

  // Every #init label of the source must be defined (E422); the prologue's call of a missing one is then not a second error.
  const missingInits = new Set<string>();
  for (const init of bound.inits) {
    if (!result.symbols.has(init.label) && !result.symbols.has(`.${init.label}`)) {
      missingInits.add(init.label);
      bag.report('E422', init.span, `#init routine '${init.label}' is not defined`);
    }
  }
  const namesMissingInit = (d: Diagnostic): boolean => [...missingInits].some((l) => d.message.includes(`'.${l}'`) || d.message.includes(`'${l}'`));
  for (const d of result.diagnostics) {
    if (d.severity === 'note') continue;
    const origin = sources.get(d.span.file).origin;
    if (origin === 'user') {
      bag.add(d);
    } else if (d.severity === 'error') {
      if (origin === 'generated' && namesMissingInit(d)) continue;
      // Two blocks of output on the same addresses (a #pragma hidata block over the program, an ORG back into code).
      if (d.code === 'E537') {
        bag.report('E537', mainSpan, d.message, 'A #pragma hidata block overlaps the program (or another block): move the block, or the program with --org.');
        continue;
      }
      // A library refusal stub (`call .core.Name_needs_...`, lib/stdlib/cpc.bas and others): a call of a routine this build mode cannot give.
      if (d.code === 'E520' && /_needs_/.test(d.message)) {
        const call = firstUserCall(checked, d.span, (f) => sources.get(f).origin === 'user');
        bag.report(
          'E520',
          call ?? d.span,
          d.message,
          'This routine is not available in this build mode; the label names the reason (the firmware, or bare-metal mode).',
          call === null ? undefined : [{ span: d.span, message: 'the library routine that refuses' }],
        );
        continue;
      }
      bag.report('E001', mainSpan, `Internal compiler error: the assembler rejected generated code (${d.code}: ${d.message})`);
    }
  }
  if (bag.hasErrors || !result.ok) {
    if (!bag.hasErrors) bag.report('E001', mainSpan, 'Internal compiler error: the assembler failed without a diagnostic');
    return out;
  }

  const segments = result.segments.map((s) => ({ start: s.org, end: s.org + s.bytes.length }));
  const globalLabels = new Set<string>();
  for (const [name, sym] of result.symbols) if (sym.scope === 'global') globalLabels.add(name);
  const layoutOk = checkLayout({
    map: target.map,
    segments,
    heapInUse: linked.heapInUse,
    heapAddress: target.heapAddress,
    heapSize: target.heapSize,
    fileBufferBytes: target.mode === 'bare' ? 0 : fileBufferBytes(ir.requires.includes('loco/file.asm'), ir.requires.includes('loco/fileout.asm')),
    globalLabels,
    span: mainSpan,
    diagnostics: bag,
  });
  if (!layoutOk) {
    out.layoutFailed = true;
    return out;
  }

  const image = flatten(result.segments);
  const start = result.symbols.get('.core.__START_PROGRAM');
  const entry = result.entry ?? start?.value ?? image.org;
  out.binary = image.bytes;
  out.org = image.org;
  out.entry = entry;
  if (options.map === true) {
    // The reference's `.__HIDATA_BACK_0`: where the low segment ends when a `#pragma hidata` block puts arrays above it
    // (the Studio's memory report and Starfall's build script read it). Nothing is added without hidata.
    const low = result.segments.find((s) => start !== undefined && s.org <= start.value && start.value < s.org + s.bytes.length);
    const hasHidata = optimized.globals.some((g) => g.hidata !== undefined);
    out.map = formatMap(result, hasHidata && low !== undefined ? [{ name: '.__HIDATA_BACK_0', value: low.org + low.bytes.length }] : []);
  }
  out.stats = {
    codeBytes: result.segments[0]?.bytes.length ?? 0,
    dataBytes: result.symbols.get('.core.ZXBASIC_USER_DATA_LEN')?.value ?? 0,
    heapBytes: linked.heapInUse ? target.heapSize : 0,
  };

  const fail = (e: PackError): BuildOutcome => {
    bag.report(e.code, mainSpan, e.message);
    return out;
  };
  const format = options.format ?? 'bin';
  const name = programName(input);
  if (format === 'bin') {
    if (options.amsdosHeader === false) {
      out.output = image.bytes;
    } else {
      const header = buildAmsdosHeader({ name, length: image.bytes.length, loadAddress: image.org, entryAddress: entry });
      if (!header.ok) return fail(header.error);
      const all = new Uint8Array(header.value.length + image.bytes.length);
      all.set(header.value, 0);
      all.set(image.bytes, header.value.length);
      out.output = all;
    }
  } else if (format === 'dsk') {
    const files: DskFile[] = [
      { name, data: image.bytes, loadAddress: image.org, entryAddress: entry, fileType: 2 },
      ...(options.dskFiles ?? []).map((f): DskFile => ({ name: f.name, data: f.data, header: 'none' })),
    ];
    const dsk = buildDsk(files);
    if (!dsk.ok) return fail(dsk.error);
    out.output = dsk.value;
  } else if (format === 'cpr') {
    const cpr = buildCpr({ image: image.bytes, loadAddress: image.org, entryAddress: entry });
    if (!cpr.ok) return fail(cpr.error);
    out.output = cpr.value;
  }
  return out;
}

/** Compiles a program. Never throws; a compiler bug becomes E001. */
export function runPipeline(input: CompileInput): CompileResult {
  const options = input.options ?? {};
  const t0 = options.now?.() ?? 0;
  const sources = new SourceSet();
  const bag = new DiagnosticBag({
    disabled: options.disabledWarnings ?? [],
    warningsAsErrors: options.warningsAsErrors ?? false,
  });
  const stages: Partial<Record<Stage, string>> = {};
  let outcome: BuildOutcome = {};
  try {
    const dump = options.dump ?? [];
    const { pp, program } = runFrontEnd(input, sources, bag);
    if (dump.includes('tokens')) stages.tokens = printTokens(pp.tokens, sources);
    if (dump.includes('ast')) stages.ast = printAst(program, sources);

    const frontEndOnly = options.parseOnly === true || (dump.length > 0 && dump.every((s) => s === 'tokens' || s === 'ast'));
    if (!bag.hasErrors) {
      const mainSpan: Span = { file: pp.mainFile ?? sources.add(input.main, '', 'user').id, start: 0, end: 0 };
      if (!frontEndOnly) outcome = build(input, sources, bag, program, mainSpan, stages);
      // the front-end-only paths check the optimiser's options too (E570, E571; follow-up 165), as `build` does
      else makeOptimizer({ level: options.optimize, disable: options.optDisable ?? [], diagnostics: bag, span: mainSpan });
    }
  } catch (e) {
    const file = sources.all()[0] ?? sources.add(input.main, '', 'user');
    const msg = e instanceof Error ? e.message : String(e);
    bag.report('E001', { file: file.id, start: 0, end: 0 }, `Internal compiler error: ${msg}`);
  }
  const diagnostics = bag.all();
  const ok = !diagnostics.some((d) => d.severity === 'error');
  const good = ok && outcome.binary !== undefined;
  return {
    ok,
    diagnostics,
    sources,
    ...(good && outcome.binary !== undefined ? { binary: outcome.binary } : {}),
    ...(good && outcome.org !== undefined ? { org: outcome.org } : {}),
    ...(good && outcome.entry !== undefined ? { entry: outcome.entry } : {}),
    ...(good && outcome.output !== undefined && options.format !== 'none' ? { output: outcome.output } : {}),
    ...(good && outcome.map !== undefined ? { map: outcome.map } : {}),
    ...(ok && outcome.asm !== undefined ? { asm: outcome.asm } : {}),
    ...(Object.keys(stages).length > 0 ? { stages } : {}),
    stats: { ...EMPTY_STATS, ...(good ? outcome.stats : {}), timeMs: options.now ? options.now() - t0 : 0 },
    exitCode: ok ? 0 : outcome.layoutFailed === true && !bag.all().some((d) => d.severity === 'error' && !/^E40[0-4]$/.test(d.code)) ? 5 : 1,
  };
}
