#!/usr/bin/env node
/**
 * The `cpcbas` command: the thin entry that gives {@link run} a real file system and
 * the process. The CLI is the only place that touches either; the library stays pure.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defaultRuntimeDir, readFileOrUndefined } from '../src/node/index.js';
import { run, type CliIo } from './cli.js';

const cwd = process.cwd();
const runtime = defaultRuntimeDir();
const io: CliIo = {
  readFile: (path) => readFileOrUndefined(resolve(cwd, path)),
  writeFile(path, bytes) {
    writeFileSync(resolve(cwd, path), bytes);
  },
  stdout: (text) => void process.stdout.write(text),
  stderr: (text) => void process.stderr.write(text),
  cwd,
  ...(runtime !== undefined ? { defaultRuntime: runtime } : {}),
};

process.exitCode = await run(process.argv.slice(2), io);
