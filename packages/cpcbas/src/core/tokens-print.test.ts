import { describe, expect, it } from 'vitest';
import { SourceSet } from './source.js';
import type { Span } from './source.js';
import type { PunctKind, Token, TokenKind } from './tokens.js';
import { printTokens } from './tokens-print.js';

const sources = new SourceSet();
const text = '10 PRINT "a""b" 1.5 &FF Score$ |DISC\nfoo: DATA 1, "x"\nASM\n ld a,1\n#define X 1\n\' c\n(<=@';
const file = sources.add('m.bas', text);

function sp(start: number, end: number): Span {
  return { file: file.id, start, end };
}

/** A token at `start` covering `src`, located by searching the text from `from`. */
function at(from: number, src: string): { span: Span; text: string; spaceBefore: boolean; lineStart: boolean } {
  const start = text.indexOf(src, from);
  return { span: sp(start, start + src.length), text: src, spaceBefore: true, lineStart: false };
}

describe('printTokens', () => {
  const tokens: Record<Exclude<TokenKind, PunctKind>, Token> = {
    LineNumber: { kind: 'LineNumber', value: 10, ...at(0, '10') },
    Keyword: { kind: 'Keyword', keyword: 'PRINT', ...at(0, 'PRINT') },
    String: { kind: 'String', value: 'a"b', closed: true, ...at(0, '"a""b"') },
    Number: { kind: 'Number', value: 1.5, radix: 10, isReal: true, suffix: null, ...at(0, '1.5') },
    Identifier: { kind: 'Identifier', name: 'Score', suffix: '$', key: 'score$', ...at(0, 'Score$') },
    Rsx: { kind: 'Rsx', name: 'DISC', ...at(0, '|DISC') },
    Newline: { kind: 'Newline', ...at(0, '\n') },
    Label: { kind: 'Label', name: 'foo', key: 'foo', ...at(0, 'foo:') },
    DataItem: { kind: 'DataItem', raw: 'x', quoted: true, ...at(0, '"x"') },
    AsmLine: { kind: 'AsmLine', ...at(0, ' ld a,1') },
    Directive: { kind: 'Directive', name: 'define', rest: ' X 1', restSpan: sp(0, 0), ...at(0, '#define X 1') },
    Comment: { kind: 'Comment', style: 'apostrophe', body: ' c', ...at(0, "' c") },
    Invalid: { kind: 'Invalid', ...at(0, '@') },
    EOF: { kind: 'EOF', span: sp(text.length, text.length), text: '', spaceBefore: false, lineStart: false },
  };

  it('prints one line per token kind: line:col Kind text payload', () => {
    const out = printTokens(Object.values(tokens), sources).trimEnd().split('\n');
    expect(out).toEqual([
      '1:1 LineNumber "10" value=10',
      '1:4 Keyword "PRINT" keyword="PRINT"',
      '1:10 String "\\"a\\"\\"b\\"" value="a\\"b" closed=true',
      '1:17 Number "1.5" value=1.5 radix=10 real=true suffix=-',
      '1:25 Identifier "Score$" name="Score" suffix="$" key="score$"',
      '1:32 Rsx "|DISC" name="DISC"',
      '1:37 Newline "\\n"',
      '2:1 Label "foo:" name="foo" key="foo"',
      '2:14 DataItem "\\"x\\"" raw="x" quoted=true',
      '4:1 AsmLine " ld a,1"',
      '5:1 Directive "#define X 1" name="define" rest=" X 1"',
      "6:1 Comment \"' c\" style=apostrophe body=\" c\"",
      '7:4 Invalid "@"',
      '7:5 EOF ""',
    ]);
  });

  it('prints punctuation under its own kind and flags macro tokens', () => {
    const punct = (kind: '(' | '<=', src: string): Token => ({ kind, ...at(text.indexOf('(<=@'), src) } as Token);
    const macro: Token = { kind: 'Keyword', keyword: 'MODE', fromMacro: true, ...at(0, 'PRINT') };
    expect(printTokens([punct('(', '('), punct('<=', '<='), macro], sources)).toBe(
      '7:1 ( "("\n7:2 <= "<="\n1:4 Keyword "PRINT" keyword="MODE" fromMacro\n',
    );
  });

  it('prints nothing for no tokens', () => {
    expect(printTokens([], sources)).toBe('');
  });
});
