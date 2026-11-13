/**
 * L5-GAP target 1: argument spills only where the evaluation order needs them (-O1 and above).
 * The order of evaluation is observable at every level (the transcript and the data region of each level equal -O0's);
 * the number of parking slots (`.V` hidden globals of the main program) is what the optimised levels reduce.
 */
import { describe, expect, it } from "vitest";
import { asmAt, compareLevels, type Level, type Program } from "../../../test/opt-harness.js";

const FNS = [
  "FUNCTION Bumped() AS INTEGER",
  "  g = g + 1",
  "  RETURN g",
  "END FUNCTION",
  "FUNCTION Sub3(a AS INTEGER, b AS INTEGER, c AS INTEGER) AS INTEGER",
  "  RETURN a * 100 + b * 10 + c",
  "END FUNCTION",
  "FUNCTION Cat3(a AS STRING, b AS STRING, c AS STRING) AS STRING",
  '  RETURN a + "/" + b + "/" + c',
  "END FUNCTION",
  "FUNCTION Tick() AS STRING",
  '  g$ = g$ + "+"',
  "  RETURN g$",
  "END FUNCTION",
];

const prog = (name: string, body: string[]): Program => ({ name, files: [...FNS, ...body].join("\n") });

const LEVELS: readonly Level[] = [1, 2, 3, "s"];

/** The number of hidden-global parking slots the build of `p` at `level` stores into (`ld (.V...), ...`). */
const slots = (p: Program, level: Level): number => {
  const asm = asmAt(p, level).asm;
  expect(asm).not.toBe("");
  return asm.split("\n").filter((l) => /^\s+ld \(\.?_?\.?V\d*[^)]*\),/.test(l) || /^\s+ld \(__V/.test(l)).length;
};

describe("argument spills", () => {
  const cases: Array<[string, string[], number]> = [
    // [name, body, parking slots at -O0 or more]
    ["a variable before a call is read first", ["g = 0", "PRINT Sub3(g, Bumped(), g)"], 1],
    ["two calls and a variable", ["g = 0", "PRINT Sub3(Bumped(), Bumped(), g)"], 2],
    ["calls only", ["g = 0", "PRINT Sub3(Bumped(), Bumped(), Bumped())"], 2],
    ["a literal before a call needs no slot", ["g = 0", "PRINT Sub3(7, Bumped(), 3)"], 1],
    ["a string variable, a call, a string variable", ['g$ = ""', 'PRINT Cat3(g$, Tick(), g$)'], 2],
    ["a string literal, a call, a string literal", ['g$ = ""', 'PRINT Cat3("a", Tick(), "b")'], 1],
    ["a call, then a variable read after its side effect", ["g = 0", "PRINT Sub3(Bumped(), g, 5)"], 1],
    ["a variable that a later call changes, in a procedure", ["g = 5", "PRINT Sub3(Bumped(), Bumped() + g, g)"], 2],
  ];
  for (const [name, body, atO0] of cases) {
    it(`${name}: the same transcript and data at every level`, () => {
      const p = prog(name, body);
      const v = compareLevels(p, LEVELS, { requireRun: true });
      expect(v.detail).toBe("");
      expect(v.kind).toBe("ok");
      expect(slots(p, 0)).toBeGreaterThanOrEqual(atO0);
    });
  }

  it("fewer slots at -O1 and above, never more", () => {
    for (const [, body] of cases) {
      const p = prog("x", body);
      for (const l of LEVELS) expect(slots(p, l)).toBeLessThanOrEqual(slots(p, 0));
    }
  });

  it("constants are never parked; a variable before a call is", () => {
    const lit = prog("lit", ["g = 0", "PRINT Sub3(7, Bumped(), 3)"]);
    const lit$ = prog("lit$", ['g$ = ""', 'PRINT Cat3("a", Tick(), "b")']);
    const keep = prog("keep", ["g = 0", "PRINT Sub3(g, Bumped(), g)"]);
    for (const l of LEVELS) {
      expect(slots(lit, l)).toBe(0);
      expect(slots(lit$, l)).toBe(0);
      expect(slots(keep, l)).toBeGreaterThanOrEqual(1);
    }
    expect(slots(lit, 0)).toBeGreaterThan(0);
  });
});

describe("argument spills in a procedure", () => {
  it("a FUNCTION that changes a global read by another argument: the order holds at every level", () => {
    const p = prog("inproc", [
      "FUNCTION Outer(x AS INTEGER) AS INTEGER",
      "  RETURN Sub3(g, Bumped(), x) + Sub3(x, g, Bumped())",
      "END FUNCTION",
      "g = 0",
      "PRINT Outer(9)",
      "PRINT Outer(1)",
    ]);
    const v = compareLevels(p, LEVELS, { requireRun: true });
    expect(v.detail).toBe("");
    expect(v.kind).toBe("ok");
  });
});

// R20: the first -O1 rule treated only a procedure call as an effect, so two unparked arguments could swap. Each case
// below differed from -O0 under that rule (the RND values swapped, the second ERR reported, the BYREF element's index read
// after the call); each must now equal -O0.
describe("argument spills: effects other than a procedure call", () => {
  const MORE = [
    "FUNCTION R3(a AS REAL, b AS REAL, c AS REAL) AS REAL",
    "  PRINT a; b; c",
    "  RETURN a",
    "END FUNCTION",
    "FUNCTION I3(a AS INTEGER, b AS INTEGER, c AS INTEGER) AS INTEGER",
    "  PRINT a; b; c",
    "  RETURN a",
    "END FUNCTION",
    "SUB S3(a AS INTEGER, b AS INTEGER, BYREF c AS INTEGER)",
    "  PRINT a; b; c",
    "END SUB",
  ];
  const cases: Array<[string, string[]]> = [
    ["two RNDs after a call keep their order", ["g = 0", "x = R3(Bumped(), RND, RND)"]],
    [
      "the first error is the leftmost argument's",
      ["ON ERROR GOTO 100", "g = 0: z = 0", 'e$ = ""', "x = I3(Bumped(), 7 \\ z, ASC(e$))", "END", "100 PRINT ERR: END"],
    ],
    ["a BYREF element whose index calls a procedure", ["g = 0", "DIM q(9) AS INTEGER", "S3(Bumped(), g, q(Bumped()))"]],
    ["INKEY$ and a variable after a call", ['g$ = ""', 'PRINT Cat3(Tick(), INKEY$, g$)']],
  ];
  for (const [name, body] of cases) {
    it(`${name}: the same transcript and data at every level`, () => {
      const v = compareLevels(prog(name, [...MORE, ...body]), LEVELS, { requireRun: true });
      expect(v.detail).toBe("");
      expect(v.kind).toBe("ok");
    });
  }
});
