#!/usr/bin/env node
// The package as a user gets it: build a staging copy of packages/cpcbas (tsc, dist/lib, the bundle), `npm pack` it,
// install the tarball in an empty directory and compile a program with the installed bin and the installed bundle.
// The staging copy keeps the repo's own dist/ untouched.
//
//   node tools/pack-smoke.mjs [PROGRAM.bas]        (default tests/loco/hello.bas) -> prints a summary
//
// `packSmoke` returns what a test needs: the tarball's file list and the .dsk each entry point wrote.
/* global Buffer, console, process */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundleCli } from './bundle.mjs';
import { copyLib } from './copy-lib.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = join(repo, 'packages', 'cpcbas');
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** Builds, packs and installs; `program` is a .bas path (absolute or relative to the repo). */
export async function packSmoke(program = join(repo, 'tests', 'loco', 'hello.bas'), scratchRoot = tmpdir()) {
  const work = mkdtempSync(join(scratchRoot, 'cpcbas-pack-'));
  try {
    const stage = join(work, 'stage');
    mkdirSync(stage);
    cpSync(join(pkg, 'package.json'), join(stage, 'package.json'));
    run(join(repo, 'node_modules', '.bin', 'tsc'), ['-p', join(pkg, 'tsconfig.build.json'), '--outDir', join(stage, 'dist')], pkg);
    copyLib(join(stage, 'dist', 'lib'));
    await bundleCli(join(stage, 'dist', 'cpcbas.mjs'));
    const packed = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', work], stage));
    const tarball = join(work, packed[0].filename);
    const files = packed[0].files.map((f) => f.path);

    // an empty project, away from every checkout
    const app = join(work, 'app');
    mkdirSync(app);
    writeFileSync(join(app, 'package.json'), '{ "private": true }\n');
    run('npm', ['install', '--offline', '--no-audit', '--no-fund', '--no-package-lock', tarball], app);
    const installed = join(app, 'node_modules', '@cpcbuild', 'cpcbas');
    const name = basename(program);
    cpSync(resolve(repo, program), join(app, name));
    const out = {};
    run(join(app, 'node_modules', '.bin', 'cpcbas'), [name, '-o', 'bin.dsk'], app);
    out.bin = readFileSync(join(app, 'bin.dsk'));
    run('node', [join(installed, 'dist', 'cpcbas.mjs'), name, '-o', 'bundle.dsk'], app);
    out.bundle = readFileSync(join(app, 'bundle.dsk'));
    // the `./node` entry of the installed package finds its own runtime
    const probe = `import('@cpcbuild/cpcbas/node').then((m) => console.log(JSON.stringify([m.loadRuntime().has('runtime/print.asm'), existsSync(${JSON.stringify(join(installed, 'dist', 'lib', 'runtime'))})])));`;
    writeFileSync(join(app, 'probe.mjs'), `import { existsSync } from 'node:fs';\n${probe}\n`);
    out.nodeEntry = JSON.parse(run('node', ['probe.mjs'], app));
    return { files, ...out, tarballBytes: readFileSync(tarball).length, installedHasLib: existsSync(join(installed, 'dist', 'lib')) };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const r = await packSmoke(process.argv[2]);
  const same = Buffer.compare(r.bin, r.bundle) === 0;
  console.log(`pack-smoke: ${r.files.length} files, tarball ${r.tarballBytes} bytes, bin.dsk ${r.bin.length} bytes, bundle ${same ? 'equal' : 'DIFFERENT'}`);
  process.exit(same && r.nodeEntry[0] ? 0 : 1);
}
