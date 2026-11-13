/**
 * The real rule of the printer-diff harness (tools/loco-diff.py `transcripts_match`; Python unit
 * tests in tools/test_loco_diff.py), as ported to compile-helper.ts for the in-process conformance:
 * numeric tokens agree to 8 significant digits, the text between them is identical.
 */
import { describe, expect, it } from 'vitest';
import { numbersAgree, transcriptsMatch } from './compile-helper.js';

describe('the real rule', () => {
  it('numbers agree within one unit of the 8th significant digit', () => {
    expect(numbersAgree('0.333333333', '0.333333334')).toBe(true);
    expect(numbersAgree('1E+10', '1.00000E+10')).toBe(true);
    expect(numbersAgree('0', '0')).toBe(true);
    expect(numbersAgree('3.1415926', '3.1415928')).toBe(false);
    expect(numbersAgree('1.23457E+12', '1.23458E+12')).toBe(false);
    expect(numbersAgree('2', '-2')).toBe(false);
  });
  it('the text between numbers is compared exactly, and lines one by one', () => {
    expect(transcriptsMatch(' 0.333333333  1.5 \nx\n', ' 0.333333334  1.5 \nx\n', 'real')).toBe(true);
    expect(transcriptsMatch(' 0.333333333  1.5 \n', ' 0.333333334 1.5 \n', 'real')).toBe(false);
    expect(transcriptsMatch(' 1 \n', '-1 \n', 'real')).toBe(false);
    expect(transcriptsMatch(' 1 \n', ' 1 \n 2 \n', 'real')).toBe(false);
    expect(transcriptsMatch(' 0.333333333 \n', ' 0.333333334 \n', 'exact')).toBe(false);
  });
});
