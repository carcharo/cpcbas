/**
 * L2-PROC on the simulator: SUB, FUNCTION and DEF FN through the real pipeline helper
 * (front end, bind, check, lower, generate, link, assemble, test Z80). Each program prints a
 * transcript compared with the hand-computed Locomotive-style output; every lowered program
 * passes verifyIr (`runSource` returns `problems`).
 */
import { describe, expect, it } from "vitest";
import {
  lowerSource,
  normalise,
  runSource,
} from "../../../test/compile-helper.js";

const run = (source: string): string => {
  const r = runSource(source);
  expect(r.built.problems).toEqual([]);
  expect(r.stopped).toBe("rst0");
  return normalise(r.printer) as string;
};

describe("SUB and FUNCTION", () => {
  it("BYVAL and BYREF integer parameters and a default", () => {
    expect(
      run(
        [
          "SUB Bump(BYREF a AS INTEGER, BYVAL b AS INTEGER, c AS INTEGER = 10)",
          "  a = a + b + c",
          "  b = 99",
          "END SUB",
          "x = 1",
          "y = 5",
          "Bump x, y",
          "PRINT x; y",
          "Bump x, y, 100",
          "PRINT x; y",
        ].join("\n"),
      ),
    ).toBe(" 16  5 \n 121  5 \n");
  });

  it("a FUNCTION returns through name = expr and through RETURN expr", () => {
    expect(
      run(
        [
          "FUNCTION Square(n AS INTEGER) AS INTEGER",
          "  Square = n * n",
          "END FUNCTION",
          "FUNCTION Pick(n AS INTEGER) AS INTEGER",
          "  IF n > 0 THEN RETURN 100 + n",
          "  Pick = -1",
          "END FUNCTION",
          "PRINT Square(7); Square(-3); Pick(5); Pick(-5)",
        ].join("\n"),
      ),
    ).toBe(" 49  9  105 -1 \n");
  });

  it("a procedure can be called before its definition", () => {
    expect(
      run(
        'PRINT Twice(21)\nShow 7\nFUNCTION Twice(n AS INTEGER) AS INTEGER\n  Twice = n + n\nEND FUNCTION\nSUB Show(n AS INTEGER)\n  PRINT "n="; n\nEND SUB',
      ),
    ).toBe(" 42 \nn= 7 \n");
  });

  it("recursion: factorial of 7 as LONG and Fibonacci 15", () => {
    expect(
      run(
        [
          "FUNCTION Fact(n AS LONG) AS LONG",
          "  IF n <= 1 THEN RETURN 1",
          "  RETURN n * Fact(n - 1)",
          "END FUNCTION",
          "FUNCTION Fib(n AS INTEGER) AS INTEGER",
          "  IF n < 2 THEN RETURN n",
          "  RETURN Fib(n - 1) + Fib(n - 2)",
          "END FUNCTION",
          "PRINT Fact(7); Fib(15)",
        ].join("\n"),
      ),
    ).toBe(" 5040  610 \n");
  });

  it("a FOR limit, a SELECT subject and a MIN spill live in the frame: recursion keeps its own (follow-up 28)", () => {
    const src = [
      "SUB Count(d AS INTEGER, n AS INTEGER)",
      "  DIM k AS INTEGER",
      "  FOR k = 1 TO n",
      "    SELECT CASE d * 1",
      "      CASE 0: PRINT \"z\";",
      "      CASE ELSE: PRINT d; k;",
      "    END SELECT",
      "    IF d > 0 THEN Count d - 1, MIN(n - 1 + d * 0, 9)",
      "  NEXT",
      "END SUB",
      "Count 2, 2",
      "PRINT",
    ].join("\n");
    // With a shared global limit, the inner call's limit 1 would end the outer loop after k = 1.
    expect(run(src)).toBe(" 2  1  1  1  2  2  1  1 \n");
    const low = lowerSource(src);
    expect(low.diagnostics).toEqual([]);
    expect(low.ir.globals.filter((g) => g.label.startsWith(".V."))).toEqual([]);
  });

  it("every parameter type takes the right frame slot (BYTE, UBYTE, LONG, INTEGER in one frame)", () => {
    expect(
      run(
        [
          "FUNCTION Mix(a AS UBYTE, b AS INTEGER, c AS LONG, d AS BYTE) AS LONG",
          "  RETURN a + b * 10 + c * 1000 + d",
          "END FUNCTION",
          "PRINT Mix(200, -3, 4, -5)",
        ].join("\n"),
      ),
    ).toBe(" 4165 \n");
  });

  it("locals are zeroed on each call and keep their value inside one call", () => {
    expect(
      run(
        [
          "FUNCTION Count(inc AS INTEGER) AS INTEGER",
          "  DIM total AS INTEGER",
          "  total = total + inc",
          "  total = total + inc",
          "  Count = total",
          "END FUNCTION",
          "PRINT Count(3); Count(3); Count(4)",
        ].join("\n"),
      ),
    ).toBe(" 6  6  8 \n");
  });

  it("a local DIM with an initial value is set on each call", () => {
    expect(
      run(
        "FUNCTION Next1() AS INTEGER\n  DIM n AS INTEGER = 10\n  n = n + 1\n  RETURN n\nEND FUNCTION\nPRINT Next1(); Next1()",
      ),
    ).toBe(" 11  11 \n");
  });

  it("EXIT SUB from a loop", () => {
    expect(
      run(
        [
          "SUB Upto(limit AS INTEGER)",
          "  FOR i = 1 TO 100",
          "    IF i > limit THEN EXIT SUB",
          "    PRINT i;",
          "  NEXT",
          '  PRINT "never";',
          "END SUB",
          "Upto 4",
          'PRINT "done"',
        ].join("\n"),
      ),
    ).toBe(" 1  2  3  4 done\n");
  });

  it("EXIT FUNCTION returns what was assigned so far", () => {
    expect(
      run(
        "FUNCTION F(n AS INTEGER) AS INTEGER\n  F = 5\n  IF n = 0 THEN EXIT FUNCTION\n  F = 6\nEND FUNCTION\nPRINT F(0); F(1)",
      ),
    ).toBe(" 5  6 \n");
  });

  it("a BYREF swap of two INTEGERs, and BYREF passed on to another procedure", () => {
    expect(
      run(
        [
          "SUB Exch(BYREF a AS INTEGER, BYREF b AS INTEGER)",
          "  DIM t AS INTEGER",
          "  t = a: a = b: b = t",
          "END SUB",
          "SUB ExchTwice(BYREF a AS INTEGER, BYREF b AS INTEGER)",
          "  Exch a, b",
          "  Exch a, b",
          "  Exch a, b",
          "END SUB",
          "x = 1: y = 2",
          "Exch x, y",
          "PRINT x; y",
          "ExchTwice x, y",
          "PRINT x; y",
        ].join("\n"),
      ),
    ).toBe(" 2  1 \n 1  2 \n");
  });

  it("a BYREF parameter of a UBYTE and of a LONG writes through", () => {
    expect(
      run(
        "SUB Set(BYREF a AS UBYTE, BYREF b AS LONG)\n  a = 250\n  b = 100000\nEND SUB\nDIM p AS UBYTE\nDIM q AS LONG\nSet p, q\nPRINT p; q",
      ),
    ).toBe(" 250  100000 \n");
  });

  it("a FUNCTION result inside an expression keeps the pending operand", () => {
    expect(
      run(
        "FUNCTION Two() AS INTEGER\n  RETURN 2\nEND FUNCTION\nx = 10\nPRINT x * Two() + x - Two()",
      ),
    ).toBe(" 28 \n");
  });

  it("arguments run left to right when one of them calls a procedure", () => {
    expect(
      run(
        [
          "FUNCTION Bumped() AS INTEGER",
          "  g = g + 1",
          "  RETURN g",
          "END FUNCTION",
          "FUNCTION Sub3(a AS INTEGER, b AS INTEGER, c AS INTEGER) AS INTEGER",
          "  RETURN a * 100 + b * 10 + c",
          "END FUNCTION",
          "g = 0",
          "PRINT Sub3(g, Bumped(), g)",
          "PRINT Sub3(Bumped(), Bumped(), Bumped())",
        ].join("\n"),
      ),
    ).toBe(" 11 \n 234 \n");
  });

  it("procedures use globals and a call inside an argument of a call", () => {
    expect(
      run(
        "FUNCTION Add(a AS INTEGER, b AS INTEGER) AS INTEGER\n  RETURN a + b + base\nEND FUNCTION\nbase = 1000\nPRINT Add(Add(1, 2), Add(3, 4))",
      ),
    ).toBe(" 3010 \n");
  });
});

describe("FASTCALL", () => {
  it("a FASTCALL SUB with one UBYTE parameter and no locals", () => {
    expect(
      run(
        "SUB FASTCALL Poke1(v AS UBYTE)\n  POKE &C7F0, v\nEND SUB\nPoke1 200\nPRINT PEEK(&C7F0)\nx = 77\nPoke1 x\nPRINT PEEK(&C7F0)",
      ),
    ).toBe(" 200 \n 77 \n");
  });

  it("a FASTCALL SUB with locals, a FASTCALL FUNCTION, and two parameters", () => {
    expect(
      run(
        [
          "SUB FASTCALL Twice(v AS INTEGER)",
          "  DIM w AS INTEGER",
          "  w = v + v",
          "  PRINT w;",
          "END SUB",
          "FUNCTION FASTCALL Inc(v AS INTEGER) AS INTEGER",
          "  RETURN v + 1",
          "END FUNCTION",
          "FUNCTION FASTCALL Mul(a AS INTEGER, b AS INTEGER) AS INTEGER",
          "  RETURN a * b",
          "END FUNCTION",
          "Twice 21",
          "Twice Inc(4)",
          "PRINT Inc(Inc(1)); Mul(6, -7)",
        ].join("\n"),
      ),
    ).toBe(" 42  10  3 -42 \n");
  });

  it("a FASTCALL BYREF parameter", () => {
    expect(
      run(
        "SUB FASTCALL Inc(BYREF a AS INTEGER)\n  a = a + 1\nEND SUB\nx = 4\nInc x\nInc x\nPRINT x",
      ),
    ).toBe(" 6 \n");
  });

  it("a FASTCALL whose body ignores its parameter has no frame", () => {
    const low = lowerSource(
      "SUB FASTCALL Nop(v AS UBYTE)\n  POKE &C7F0, 3\nEND SUB\nNop 1",
    );
    expect(low.diagnostics).toEqual([]);
    expect(low.irText).toContain("enter 0");
    expect(low.ir.procedures[0]?.params[0]?.offset).toBe(0);
  });
});

describe("DEF FN", () => {
  it("two parameters used in an expression", () => {
    expect(
      run(
        "DEF FNadd%(a%,b%)=a%+b%*2\nDEF FNdouble%(x%)=x%*2\nPRINT FNadd%(3,4);FNadd%(FNdouble%(5),-1)\nx%=50\nPRINT FNdouble%(x%+1);x%",
      ),
    ).toBe(" 11  8 \n 102  50 \n");
  });

  it("an FN reads global variables", () => {
    expect(
      run(
        "DEF FNoff%(x%)=x%+base%\nbase%=100\nPRINT FNoff%(5)\nbase%=7\nPRINT FNoff%(5)",
      ),
    ).toBe(" 105 \n 12 \n");
  });
});

describe("what the pipeline hands over", () => {
  it("lowers a call to a procedure with the right argument bytes", () => {
    const low = lowerSource("SUB P(a AS UBYTE, b AS LONG)\nEND SUB\nP 1, 2");
    expect(low.diagnostics).toEqual([]);
    expect(low.problems).toEqual([]);
    expect(low.irText).toMatch(/call _P \(6\)|_P/);
    const p = low.ir.procedures[0];
    expect(p?.params).toEqual([
      { type: "u8", offset: 5, byref: false },
      { type: "i32", offset: 6, byref: false },
    ]);
    expect(low.ir.main.some((q) => q.op === "call" && q.argBytes === 6)).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// Strings: ownership and frees.
// ---------------------------------------------------------------------------

const word = (m: Uint8Array, a: number): number =>
  (m[a] as number) | ((m[a + 1] as number) << 8);

/** Bytes free on the heap after the run: the sum of the free list's blocks. */
function heapFreeAfter(source: string): { free: number; out: string } {
  const r = runSource(source);
  expect(r.built.problems).toEqual([]);
  expect(r.stopped).toBe("rst0");
  const heap = r.image.addr(".core.ZXBASIC_MEM_HEAP");
  let total = 0;
  let p = word(r.memory, heap + 2);
  for (let guard = 0; p !== 0 && guard < 10000; guard++) {
    total += word(r.memory, p);
    p = word(r.memory, p + 2);
  }
  return { free: total, out: normalise(r.printer) as string };
}

/** Runs `program` with `LOOPS` set to 2 and to 500 iterations and returns both heap totals. */
function leak(program: (n: number) => string): { few: number; many: number } {
  return {
    few: heapFreeAfter(program(2)).free,
    many: heapFreeAfter(program(500)).free,
  };
}

describe("strings in procedures", () => {
  it("a FUNCTION with a STRING parameter and result, used in a concatenation", () => {
    expect(
      run(
        [
          "FUNCTION Wrap(s AS STRING) AS STRING",
          '  RETURN "[" + s + "]"',
          "END FUNCTION",
          'a$ = "mid"',
          'PRINT Wrap(a$) + Wrap("x") + "!"',
          "PRINT a$",
        ].join("\n"),
      ),
    ).toBe("[mid][x]!\nmid\n");
  });

  it("frees every parameter, local and temp: 500 calls leave the heap as 2 calls do", () => {
    const { few, many } = leak((n) =>
      [
        "FUNCTION Wrap(s AS STRING) AS STRING",
        "  DIM t AS STRING",
        '  t = "<" + s',
        '  Wrap = t + ">"',
        "END FUNCTION",
        'a$ = "payload"',
        `FOR i = 1 TO ${n}`,
        "  b$ = Wrap(a$)",
        "  c$ = Wrap(b$ + a$)",
        "NEXT",
        "PRINT b$; c$",
      ].join("\n"),
    );
    expect(many).toBe(few);
  });

  it("EXIT FUNCTION and RETURN free the string parameter and local too", () => {
    const src = (n: number): string =>
      [
        "FUNCTION Pick(s AS STRING, which AS INTEGER) AS STRING",
        "  DIM t AS STRING",
        "  t = s + s",
        "  IF which = 0 THEN",
        "    Pick = t",
        "    EXIT FUNCTION",
        "  END IF",
        '  IF which = 1 THEN RETURN t + "!"',
        '  Pick = "none"',
        "END FUNCTION",
        'a$ = "ab"',
        `FOR i = 1 TO ${n}`,
        "  r$ = Pick(a$, i MOD 3)",
        "NEXT",
        'PRINT r$; Pick(a$, 0); Pick(a$, 1); Pick("q", 2)',
      ].join("\n");
    const { few, many } = leak(src);
    expect(many).toBe(few);
    expect(heapFreeAfter(src(5)).out).toBe(`none${"abab"}${"abab!"}none\n`);
  });

  it("a BYREF swap of two strings", () => {
    expect(
      run(
        [
          "SUB Exch(BYREF a AS STRING, BYREF b AS STRING)",
          "  DIM t AS STRING",
          "  t = a: a = b: b = t",
          "END SUB",
          'x$ = "one": y$ = "two"',
          "Exch x$, y$",
          "PRINT x$; y$",
        ].join("\n"),
      ),
    ).toBe("twoone\n");
  });

  it("a BYREF string parameter is borrowed (not freed by the callee) and assignment through it frees the old value", () => {
    const src = (n: number): string =>
      [
        "SUB Grow(BYREF s AS STRING)",
        '  s = s + "x"',
        '  s = "k"',
        "END SUB",
        'a$ = "start"',
        `FOR i = 1 TO ${n}`,
        "  Grow a$",
        "NEXT",
        "PRINT a$",
      ].join("\n");
    const { few, many } = leak(src);
    expect(many).toBe(few);
    expect(heapFreeAfter(src(3)).out).toBe("k\n");
  });

  it("a FASTCALL SUB with a STRING parameter frees it, unread or read", () => {
    const src = (n: number): string =>
      [
        "SUB FASTCALL Say(s AS STRING)",
        "  PRINT s;",
        "END SUB",
        "SUB FASTCALL Ignore(s AS STRING)",
        '  PRINT "-";',
        "END SUB",
        'a$ = "hi"',
        `FOR i = 1 TO ${n}`,
        "  Ignore a$",
        '  Ignore a$ + "x"',
        "NEXT",
        "Say a$",
        'Say a$ + "!"',
        "PRINT",
      ].join("\n");
    const { few, many } = leak(src);
    expect(many).toBe(few);
    expect(heapFreeAfter(src(1)).out).toBe("--hihi!\n");
  });

  it("DEF FN with string parameters frees them and returns an owned result", () => {
    const src = (n: number): string =>
      [
        'DEF FNhi$(n$)="Hi "+n$',
        "DEF FNsame$(n$)=n$",
        'a$ = "there"',
        `FOR i = 1 TO ${n}`,
        "  b$ = FNhi$(a$)",
        "  c$ = FNsame$(FNsame$(b$))",
        "NEXT",
        'PRINT b$; "|"; c$; "|"; FNhi$("a" + "b") + "!"',
      ].join("\n");
    const { few, many } = leak(src);
    expect(many).toBe(few);
    expect(heapFreeAfter(src(3)).out).toBe("Hi there|Hi there|Hi ab!\n");
  });

  it("string arguments run left to right when one of them calls a procedure", () => {
    expect(
      run(
        [
          "FUNCTION Tick() AS STRING",
          '  g$ = g$ + "+"',
          "  RETURN g$",
          "END FUNCTION",
          "FUNCTION Join(a AS STRING, b AS STRING, c AS STRING) AS STRING",
          '  RETURN a + "/" + b + "/" + c',
          "END FUNCTION",
          'g$ = ""',
          "PRINT Join(g$, Tick(), g$)",
        ].join("\n"),
      ),
    ).toBe("/+/+\n");
  });

  it("a string default parameter", () => {
    expect(
      run(
        'SUB Hello(who AS STRING = "world")\n  PRINT "hello "; who\nEND SUB\nHello\nHello "cpc"',
      ),
    ).toBe("hello world\nhello cpc\n");
  });

  it("tests/loco/deffn.bas prints its blessed transcript", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { repoRoot } = await import("../../../test/z80sim/run.js");
    const src = readFileSync(join(repoRoot, "tests/loco/deffn.bas"), "latin1");
    expect(run(src)).toBe(
      readFileSync(join(repoRoot, "tests/loco/deffn.expected"), "latin1"),
    );
  });
});

describe("a FUNCTION called as a statement", () => {
  // The checker refuses this (E239: Locomotive has no such form), so the lowering never sees
  // it; if a checker change ever let one through, the lowering stops with an internal error
  // rather than guessing what to do with the result.
  it("is E239 in the checker and an internal error past it", async () => {
    const { bind } = await import("../../binder/index.js");
    const { check } = await import("../../checker/index.js");
    const { DiagnosticBag } = await import("../../core/diagnostics.js");
    const { SourceSet } = await import("../../core/source.js");
    const { runFrontEnd } = await import("../../pipeline.js");
    const { lower } = await import("../index.js");
    const sources = new SourceSet();
    const bag = new DiagnosticBag();
    const { program } = runFrontEnd(
      {
        files: new Map([
          ["t.bas", "FUNCTION F(n AS INTEGER) AS INTEGER\n  RETURN n\nEND FUNCTION\nF 3"],
        ]),
        main: "t.bas",
      },
      sources,
      bag,
    );
    const checked = check({
      bound: bind({ program, sources, diagnostics: bag, bareMetal: false }),
      sources,
      diagnostics: bag,
    });
    expect(bag.all().map((d) => d.code)).toEqual(["E239"]);
    expect(() => lower({ checked, diagnostics: bag })).toThrow(/FUNCTION called as a statement/);
  });
});
