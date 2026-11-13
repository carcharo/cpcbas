#!/usr/bin/env python3
"""fwm-record.py -- record the CPC firmware maths behaviour on CPCEC (FWM-0). Development tooling.

Every number comes from running a Locomotive BASIC program under the real interpreter on CPCEC
(tools/loco-diff.py's `interpret`, headless): the program calls a firmware maths entry through a
machine-code stub (tools/fwm_lib.py) and prints what it finds. Nothing is estimated.

    python3 tools/fwm-record.py entries  [--models M,..]   register/behaviour sweep, stack depth, edge cases
    python3 tools/fwm-record.py vectors  [--models M,..]   golden vectors -> tests/fixtures/fwmath-vectors.json
    python3 tools/fwm-record.py literals [--models M,..]   literal corpus  -> tests/fixtures/fwmath-literals.json
    python3 tools/fwm-record.py text     [--models M,..]   number-text corpus -> tests/fixtures/fwmath-text.json
    python3 tools/fwm-record.py prep     [--models M,..]   PREP (digits for the number text) -> tests/fixtures/fwmath-prep.json
    python3 tools/fwm-record.py probes                     write the generated probes to tests/loco/probes/

Models: 464, 664, 6128, plus (all four by default; CPCEC has them all). One CPCEC at a time: the
tool refuses to start while another cpcec process is running (--force overrides). Runs are
deterministic: inputs come from fixed seeds. Inputs are shared by the models; results are stored
per model, and "=6128" stands for "identical to the 6128 list".
"""
import argparse
import json
import re
import random
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fwm_lib as L  # noqa: E402
import fwm_ops as O  # noqa: E402

REPO = L.REPO
FIX = REPO / "tests" / "fixtures"
MODELS = list(L.MODELS)
STATS = {"runs": 0, "emulator_s": 0.0, "wall_s": 0.0}


def cpcec_busy() -> bool:
    out = subprocess.run(["pgrep", "-fl", "-i", "cpcec"], capture_output=True, text=True).stdout
    return any("pgrep" not in ln and "fwm-record" not in ln for ln in out.splitlines())


def wait_for_cpcec(force: bool):
    for _ in range(120):
        if force or not cpcec_busy():
            return
        time.sleep(5)
    sys.exit("fwm-record: another cpcec has been running for 10 minutes; not starting")


# ---------------------------------------------------------------------------------------------
# input generators (fixed seeds)
# ---------------------------------------------------------------------------------------------

def hx(b: bytes) -> str:
    return b.hex().upper()


def gen_addsub(n: int, seed: int) -> list[tuple]:
    r = random.Random(seed)
    out = []
    cur = O.curated_values()
    for a in cur[:16]:
        for b in cur[:16]:
            out.append((a, b))
    # exact half-ulp ties and cancellations
    while len(out) < 700:
        a = O.rand_real(r, 0x70, 0x90, sparse=r.random() < 0.3)
        neg, m, e = O.unpack(a)
        kind = r.random()
        if kind < 0.4:      # b is exactly half an ulp of a, or one ulp, or 1.5 ulp
            eb = e - 32 + r.choice((0, 0, -1, 1))
            if eb < 1:
                continue
            b = O.mk(0x80000000 | (r.getrandbits(31) if r.random() < 0.3 else 0), eb, r.random() < 0.5)
        elif kind < 0.7:    # near cancellation
            m2 = (m ^ (1 << r.randint(0, 6))) | 0x80000000
            b = O.mk(m2, e - r.choice((0, 0, 1)) if e > 1 else e, not neg)
        else:               # sparse, equal-ish exponents
            b = O.rand_real(r, max(1, e - 3), min(255, e + 3), sparse=True)
        out.append((a, b))
    while len(out) < n:
        ea = r.randint(0x50, 0xB0)
        if r.random() < 0.03:
            ea = r.choice((1, 2, 0xFE, 0xFF))
        a = O.rand_real(r, ea, ea, sparse=r.random() < 0.15)
        d = int(r.gauss(0, 12))
        eb = min(255, max(1, ea + d))
        b = O.rand_real(r, eb, eb, sparse=r.random() < 0.15)
        out.append((a, b))
    return out[:n]


def gen_muldiv(n: int, seed: int, div: bool) -> list[tuple]:
    r = random.Random(seed)
    out = []
    cur = O.curated_values()
    for a in cur[:20]:
        for b in cur[:20]:
            if div and b == O.ZERO:
                continue
            out.append((a, b))
    while len(out) < 800:   # sparse mantissas: exact products/quotients and ties
        a = O.rand_real(r, 0x78, 0x88, sparse=True)
        b = O.rand_real(r, 0x78, 0x88, sparse=True)
        out.append((a, b))
    while len(out) < n:
        ea = r.randint(0x40, 0xC0)
        eb = r.randint(0x40, 0xC0)
        if r.random() < 0.04:
            ea, eb = r.choice(((0xFE, 0xFE), (0xFF, 0x90), (1, 1), (2, 0x70), (0x90, 0xFF), (0x70, 1), (0xC0, 0xC0)))
        a = O.rand_real(r, ea, ea)
        b = O.rand_real(r, eb, eb)
        out.append((a, b))
    return out[:n]


def gen_unary(kind: str, n: int, seed: int) -> list[bytes]:
    r = random.Random(seed)
    cur = [v for v in O.curated_values()]
    out: list[bytes] = []
    pos = lambda b: O.mk(O.unpack(b)[1], O.unpack(b)[2], False) if b != O.ZERO else b
    if kind == "SQR":
        out += [pos(v) for v in cur] + [O.from_float(x) for x in (4, 9, 16, 25, 2, 0.25, 1e10, 144, 1e-10, 1e38, 3, 5, 7)]
        while len(out) < n:
            out.append(O.mk(r.getrandbits(32) | 0x80000000, r.randint(0x20, 0xE0)))
    elif kind == "EXP":
        out += cur[:30] + [O.from_float(x) for x in (88, -88, 87.5, -87.5, 10, -10, 0.5, 1e-5, 20, 44.36)]
        while len(out) < n:
            out.append(O.rand_real(r, 0x6C, 0x87, sparse=r.random() < 0.1))
    elif kind in ("LOG", "LOG10"):
        out += [pos(v) for v in cur if v != O.ZERO] + [O.from_float(x) for x in (10, 100, 1000, 1e5, 1e-5, 0.1, 2, 4, 8, 2.718281828, 1.0000001, 0.9999999, 1e38, 1e-38)]
        while len(out) < n:
            if r.random() < 0.15:
                out.append(O.mk(r.getrandbits(32) | 0x80000000, r.choice((0x7F, 0x80, 0x81))))
            else:
                out.append(O.mk(r.getrandbits(32) | 0x80000000, r.randint(0x10, 0xF0)))
    elif kind in ("SIN", "COS", "TAN"):
        pi = 3.14159265358979
        out += cur[:30] + [O.from_float(k * pi / 2) for k in (1, 2, 3, 4, -1, -2, 0.5, 0.25, 6, 8)] + [O.from_float(x) for x in (90, 180, 360, 45, 30, 1e4, 1e5, 12345.678)]
        while len(out) < n:
            out.append(O.rand_real(r, 0x5C, 0x8F, sparse=r.random() < 0.1))
    elif kind == "ATN":
        out += cur[:35] + [O.from_float(x) for x in (1e38, -1e38, 1e-38, 100, 0.1, -0.1, 10, 1e5, 1.5, 0.9999)]
        while len(out) < n:
            out.append(O.rand_real(r, 0x60, 0xA0, sparse=r.random() < 0.1))
    else:  # generic
        out += cur
        while len(out) < n:
            out.append(O.rand_real(r, 0x40, 0xC0, sparse=r.random() < 0.1))
    return out[:n]


def gen_pow(n: int, seed: int) -> list[tuple]:
    r = random.Random(seed)
    out = []
    for x in (2, 10, 3, 0.5, 1.5, 7, 1e5, 0.1):
        for y in (2, 3, -1, 0.5, 10, -2, 1 / 3, 0, 1, 20, 0.25):
            out.append((O.from_float(x), O.from_float(y)))
    for x in (-2, -8, -3, -0.5, -10):
        for y in (2, 3, -1, 0.5, 1 / 3, 4, 5):
            out.append((O.from_float(x), O.from_float(y)))
    while len(out) < n:
        a = O.mk(r.getrandbits(32) | 0x80000000, r.randint(0x70, 0x90))
        if r.random() < 0.3:
            b = O.from_float(float(r.randint(-12, 12)))
        else:
            b = O.mk(r.getrandbits(32) | 0x80000000, r.randint(0x70, 0x84), r.random() < 0.5)
        out.append((a, b))
    return out[:n]


def gen_conv(kind: str, n: int, seed: int) -> list[bytes]:
    r = random.Random(seed)
    out = []
    pts = (0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2.5, -2.5, 3.5, 0.4999999, 0.9999999, 32766.5, 32767, 32767.4, 32767.5, 32768, -32768, -32768.5, -32769,
           65535, 65535.5, 65536, -65535, -65536, 2147483647, 2147483648, -2147483648, 4294967295, 4294967296, -4294967295, 1e10, -1e10, 1e38)
    out += [O.from_float(x) for x in pts]
    hi = {"REAL2INT": 0x92, "REAL2BIN": 0xA2, "FIX": 0xA2, "INT": 0xA2}.get(kind, 0xA2)
    while len(out) < n:
        e = r.randint(0x7C, hi)
        m = r.getrandbits(32) | 0x80000000
        k = e - 0x80          # bits of integer part
        if r.random() < 0.4 and 1 <= k <= 30:     # x.5 exactly (a rounding tie)
            ip = (r.getrandbits(k) | (1 << (k - 1))) if k > 1 else 1
            m = (ip << (32 - k)) | (1 << (31 - k))
        elif r.random() < 0.2 and 1 <= k <= 30:   # x.4999.., x.5000..1
            ip = (r.getrandbits(k) | (1 << (k - 1))) if k > 1 else 1
            m = (ip << (32 - k)) | (1 << (31 - k)) + r.choice((-1, 1))
            m |= 0x80000000
        out.append(O.mk(m, e, r.random() < 0.5))
    return out[:n]


# ---------------------------------------------------------------------------------------------
# op specs: how a vector is built and which fields are kept
# ---------------------------------------------------------------------------------------------
# input record string forms (shared by models): "A B" two REAL operands; "A" one; "A|n" REAL + A register;
# "HL|n" for INT2REAL.  Result fields: r (5 bytes at HL), r4 (4 bytes), d (5 bytes at DE), a, f, hl, b, c.

def build(op: str, inp: str, model: str, tag: str) -> dict:
    ad = O.addr(op, model)
    rec = dict(tag=tag, e=f"{ad:04X}")
    if op in ("ADD", "SUB", "RSUB", "MUL", "DIV", "POW", "CMP"):
        a, b = inp.split()
        rec.update(a=a, b=b)
    elif op in ("MUL10A", "EXPADD", "BIN2REAL"):
        a, n = inp.split("|")
        rec.update(a=a, A=int(n, 16) if False else int(n))
    elif op == "INT2REAL":
        hl, n = inp.split("|")
        rec.update(hl=hl, A=int(n), b="-", a="-")
    else:
        rec.update(a=inp)
    return rec


def fields(op: str, res: dict) -> str:
    R, g = res["R"], res["regs"]
    c = g["F"] & 1
    f = g["F"] & 0xC1
    if op in ("ADD", "SUB", "RSUB", "MUL", "DIV", "POW", "SQR", "EXP", "LOG", "LOG10", "SIN", "COS", "TAN", "ATN",
              "NEG", "MUL10A", "EXPADD", "BIN2REAL"):
        return f"{R[:5].hex().upper()} {c}"
    if op == "CMP" or op == "SGN":
        return f"{g['A']:02X} {f:02X}"
    if op == "REAL2INT":
        return f"{g['HL']:04X} {f:02X}"
    if op in ("REAL2BIN", "FIX", "INT"):
        return f"{R[:4].hex().upper()} {g['BC'] >> 8:02X} {f:02X}"
    if op == "INT2REAL":
        return f"{R[8:13].hex().upper()}"
    raise KeyError(op)


FIELD_NAMES = {
    "r c": ("ADD", "SUB", "RSUB", "MUL", "DIV", "POW", "SQR", "EXP", "LOG", "LOG10", "SIN", "COS", "TAN", "ATN", "NEG",
            "MUL10A", "EXPADD", "BIN2REAL"),
}


def field_names(op: str) -> list[str]:
    if op in FIELD_NAMES["r c"]:
        return ["r", "c"]
    return {"CMP": ["a", "f"], "SGN": ["a", "f"], "REAL2INT": ["hl", "f"], "REAL2BIN": ["r4", "b", "f"],
            "FIX": ["r4", "b", "f"], "INT": ["r4", "b", "f"], "INT2REAL": ["d"]}[op]


def op_inputs() -> dict[str, list[str]]:
    d: dict[str, list[str]] = {}
    for op, seed in (("ADD", 11), ("SUB", 12), ("RSUB", 13)):
        d[op] = [f"{hx(a)} {hx(b)}" for a, b in gen_addsub(2000, 11)]   # the same pairs for all three
    d["MUL"] = [f"{hx(a)} {hx(b)}" for a, b in gen_muldiv(2000, 21, False)]
    d["DIV"] = [f"{hx(a)} {hx(b)}" for a, b in gen_muldiv(2000, 22, True)]
    d["CMP"] = [f"{hx(a)} {hx(b)}" for a, b in (gen_addsub(1000, 31) + gen_muldiv(1000, 32, False))]
    d["POW"] = [f"{hx(a)} {hx(b)}" for a, b in gen_pow(500, 41)]
    for i, op in enumerate(("SQR", "EXP", "LOG", "LOG10", "SIN", "COS", "TAN", "ATN")):
        d[op] = [hx(v) for v in gen_unary(op, 200, 50 + i)]
    d["NEG"] = [hx(v) for v in gen_unary("NEG", 200, 61)]
    d["SGN"] = [hx(v) for v in gen_unary("SGN", 200, 62)]
    d["REAL2INT"] = [hx(v) for v in gen_conv("REAL2INT", 500, 63)]
    for i, op in enumerate(("REAL2BIN", "FIX", "INT")):
        d[op] = [hx(v) for v in gen_conv(op, 200, 64 + i)]
    r = random.Random(70)
    ints = [0, 1, 2, 255, 256, 0x7FFF, 0x8000, 0xFFFF, 0x1234, 10, 100, 1000, 10000, 32767, 32768, 65535, 65534, 3, 7]
    ints += [r.getrandbits(16) for _ in range(181)]
    d["INT2REAL"] = [f"{v:04X}|{r.choice((0, 0x80))}" for v in ints]
    d["BIN2REAL"] = [f"{r.getrandbits(32):08X}00|{r.choice((0, 0x80))}" for _ in range(200)]
    for k in range(200):
        pass
    mv = [hx(v) for v in gen_unary("x", 200, 72)]
    d["MUL10A"] = [f"{mv[k]}|{(k * 7) % 100 - 50 if k >= 10 else (0, 1, 2, 3, 10, -1, -2, -3, 38, -38)[k]}" for k in range(200)]
    d["EXPADD"] = [f"{mv[k]}|{(k * 5) % 80 - 40 if k >= 6 else (0, 1, 2, -1, 100, -100)[k]}" for k in range(200)]
    # A is a signed value for MUL10A/EXPADD: the program takes it as a byte
    return d


def a_byte(s: str) -> str:
    return s


# ---------------------------------------------------------------------------------------------
# vectors
# ---------------------------------------------------------------------------------------------

def fix_a(rec: dict):
    rec["A"] = rec.get("A", 0) & 255
    return rec


def record_ops(models: list[str], ops: list[str] | None, chunk: int = 250) -> dict:
    inputs = op_inputs()
    out = {}
    reg_summary: dict = {}
    for op, inp in inputs.items():
        if ops and op not in ops:
            continue
        res_models: dict[str, list[str]] = {}
        for m in models:
            if O.addr(op, m) is None:
                continue
            outs: list[str] = []
            regs_seen = {k: set() for k in ("BC", "DE", "HL", "IX", "IY")}
            second_changed = 0
            hangs = 0
            for i0 in range(0, len(inp), chunk):
                part = inp[i0:i0 + chunk]
                recs = [fix_a(build(op, s, m, f"v{i0 + j}")) for j, s in enumerate(part)]
                t = time.time()
                got = L.run_probe(recs, m)
                STATS["wall_s"] += time.time() - t
                STATS["runs"] += 1
                for j, s in enumerate(part):
                    v = got.get(f"v{i0 + j}", {})
                    if v.get("hang") or "R" not in v:
                        outs.append("HANG")
                        hangs += 1
                        continue
                    outs.append(fields(op, v))
                    g = v["regs"]
                    rec = recs[j]
                    exp = dict(BC=0x1234, DE=0x8108, HL=0x8100, IX=0x5678, IY=0x9ABC)
                    if op == "INT2REAL":
                        exp["HL"] = int(rec["hl"], 16)
                    for k in regs_seen:
                        regs_seen[k].add("same" if g[k] == exp[k] else "changed")
                    if op in ("ADD", "SUB", "RSUB", "MUL", "DIV", "POW", "CMP") and v["R"][8:13].hex().upper() != rec["b"]:
                        second_changed += 1
            res_models[m] = outs
            reg_summary.setdefault(op, {})[m] = dict(
                regs={k: ("preserved" if s == {"same"} else "corrupt" if s == {"changed"} else "sometimes")
                      for k, s in regs_seen.items()},
                second_operand_changed=second_changed, hangs=hangs)
            print(f"  {op} {m}: {len(outs)} vectors, hangs {hangs}", file=sys.stderr, flush=True)
        # compress identical lists
        base = res_models.get("6128")
        comp = {}
        for m, v in res_models.items():
            comp[m] = "=6128" if (base is not None and m != "6128" and v == base) else v
        out[op] = dict(fields=field_names(op), inputs=inp, results=comp)
    return dict(ops=out, registers=reg_summary)


def record_rnd(models: list[str]) -> dict:
    """RND sequences through the entry: 1000 values from the boot state; RND(0) repeats the last."""
    res = {}
    for m in models:
        sb = 0xB8E4 if m == "464" else 0xB100
        body = f'''10 sb=&{sb:X}:FOR t=1 TO 1000:e=&{O.addr("RND", m):X}:ra=0:GOSUB 8000
20 ad=&8100:n=5:GOSUB 8100:PRINT " ";:NEXT:PRINT
30 e=&{O.addr("RND0", m):X}:GOSUB 8000:ad=&8100:n=5:GOSUB 8100:PRINT
40 END
'''
        raw = L.run_custom(body, m, 300)
        txt = raw.replace("\r", "").replace("\n", "")
        vals = [v for v in txt.replace("Ready", " ").split() if len(v) == 10 and all(c in "0123456789ABCDEF" for c in v)]
        res[m] = vals
        STATS["runs"] += 1
    return res


SEED_ARGS = ["0", "1", "2", "3", "10", "100", "1000", "12345", "32767", "65535", "123456", "0.5", "0.25", "1.5", "-1", "-0.5",
             "3.14159", "0.1", "1E10", "1E-10", "7", "-7", "255", "256"]


def record_rnd_seeded(models: list[str]) -> dict:
    """RANDOMIZE <arg>, then 50 RNDs through the entry: the arg's bytes, the seed bytes at &B100 (&B8E4 on the 464)
    and the values."""
    res = {}
    for m in models:
        sb = 0xB8E4 if m == "464" else 0xB100
        data = ",".join(SEED_ARGS)
        body = (f"10 sb=&{sb:X}:READ nn\n"
                f"20 FOR j=1 TO nn:READ a$:ar!=VAL(a$):RANDOMIZE ar!\n"
                '30 PRINT "A";HEX$(j,2);:FOR k=0 TO 4:PRINT RIGHT$("0"+HEX$(PEEK(@ar!+k)),2);:NEXT\n'
                '40 ad=sb:n=4:GOSUB 8100\n'
                f"50 FOR t=1 TO 50:e=&{O.addr('RND', m):X}:ra=0:GOSUB 8000:ad=&8100:n=5:GOSUB 8100:NEXT:PRINT \".\"\n"
                "60 NEXT:END\n"
                f"9900 DATA {len(SEED_ARGS)},{data}\n")
        raw = L.run_custom(body, m, 600)
        txt = "".join(raw.split())
        rows = []
        import re as _re
        for mt in _re.finditer(r"A([0-9A-F]{2})([0-9A-F]{10})([0-9A-F]{8})((?:[0-9A-F]{10}){50})\.", txt):
            rows.append(dict(arg=SEED_ARGS[int(mt.group(1), 16) - 1], arg_bytes=mt.group(2), seed=mt.group(3),
                             values=[mt.group(4)[i:i + 10] for i in range(0, 500, 10)]))
        assert len(rows) == len(SEED_ARGS), f"{m}: {len(rows)} seeded runs"
        res[m] = rows
        STATS["runs"] += 1
    return res


def cmd_rnd(args):
    models = args.models
    boot = record_rnd(models)
    seeded = record_rnd_seeded(models)
    path = FIX / "fwmath-vectors.json"
    doc = json.loads(path.read_text())
    b6 = boot.get("6128")
    doc["rnd_from_boot"] = {m: ("=6128" if m != "6128" and v == b6 else v) for m, v in boot.items()}
    s6 = seeded.get("6128")
    doc["rnd_seeded"] = {m: ("=6128" if m != "6128" and v == s6 else v) for m, v in seeded.items()}
    path.write_text(json.dumps(doc, separators=(",", ":")) + "\n")
    print(f"wrote {path} ({path.stat().st_size} bytes)", file=sys.stderr)


def cmd_stack(args):
    """Stack depth again with 40 vector inputs per entry (fill pattern from &8E00, call frame included)."""
    path = FIX / "fwmath-entries.json"
    doc = json.loads(path.read_text())
    vec = json.loads((FIX / "fwmath-vectors.json").read_text())
    deep: dict = {}
    for m in args.models:
        recs, ops = [], {}
        recs.append(dict(tag="base0", e="RET", a="-", b="-"))
        for op, o in vec["ops"].items():
            if O.addr(op, m) is None:
                continue
            for k, inp in enumerate(o["inputs"][:: max(1, len(o["inputs"]) // 40)][:40]):
                rec = fix_a(build(op, inp, m, f"{op.lower()}_{k}"))
                recs.append(rec)
        deepest: dict = {}
        for rep in range(2):
            for i0 in range(0, len(recs), 200):
                part = recs[i0:i0 + 200]
                got = L.run_probe([dict(tag="base0", e="RET", a="-", b="-")] + part, m, fill_stack=True)
                for r in [dict(tag="base0")] + part:
                    v = got.get(r["tag"], {})
                    if "S" in v:
                        key = "base" if r["tag"].startswith("base") else r["tag"].rsplit("_", 1)[0]
                        deepest[key] = max(deepest.get(key, 0), v["S"])
        deep[m] = deepest
        print(f"  stack {m}: {len(recs)} calls x2, deepest {max(deepest.values())}", file=sys.stderr, flush=True)
    doc["stack_deep"] = deep
    path.write_text(json.dumps(doc, indent=0, separators=(",", ":")) + "\n")


def cmd_thresholds(args):
    """Where the functions start to fail: carry after SIN/COS/TAN/ATN of 2^k and 10^k, EXP around 88, SQR/LOG at the ends."""
    path = FIX / "fwmath-entries.json"
    doc = json.loads(path.read_text())
    res: dict = {}
    for m in args.models:
        recs, meta = [], []

        def add(op, x, tag):
            recs.append(dict(tag=tag, e=f"{O.addr(op, m):04X}", a=R(x), b="-"))
            meta.append((tag, op, x))

        i = 0
        for op in ("SIN", "COS", "TAN"):
            for k in range(14, 41, 2):
                add(op, float(2 ** k), f"t{i}"); i += 1
            for k in (6, 7, 8, 9, 10):
                add(op, 10.0 ** k, f"t{i}"); i += 1
        for x in (87.0, 88.0, 88.1, 88.2, 88.3, 88.4, 88.5, 88.6, 88.7, 88.72, 88.73):
            add("EXP", x, f"t{i}"); i += 1
        for x in (-86.0, -87.0, -87.5, -88.0, -88.5, -88.7, -88.72, -89.0):
            add("EXP", x, f"t{i}"); i += 1
        got = L.run_probe(recs, m)
        rows = []
        for tag, op, x in meta:
            v = got.get(tag, {})
            if "R" not in v:
                rows.append([op, x, "HANG"])
                continue
            rows.append([op, x, v["R"][:5].hex().upper(), v["regs"]["F"] & 1])
        res[m] = rows
        print(f"  thresholds {m}: {len(rows)}", file=sys.stderr, flush=True)
    base = res.get("6128")
    doc["thresholds"] = {m: ("=6128" if m != "6128" and v == base else v) for m, v in res.items()}
    path.write_text(json.dumps(doc, indent=0, separators=(",", ":")) + "\n")


def cmd_vectors(args):
    models = args.models
    t0 = time.time()
    data = record_ops(models, args.ops.split(",") if args.ops else None)
    rnd = record_rnd(models) if not args.ops else {}
    base = rnd.get("6128")
    comp = {m: ("=6128" if m != "6128" and v == base else v) for m, v in rnd.items()}
    doc = dict(
        format=1,
        about="Golden vectors of the CPC firmware maths entries, recorded on CPCEC (headless) through the real "
              "Locomotive interpreter's ROMs by tools/fwm-record.py. REALs are 5 bytes in Locomotive's layout as hex "
              "(mantissa LS byte first, exponent last). Inputs are shared by the models; results are per model, "
              "'=6128' meaning identical to the 6128 list.",
        recorded="2026-11-08", emulator="CPCEC (tools/cpcec, headless)", models=models,
        ops=data["ops"], registers=data["registers"], rnd_from_boot=comp)
    path = FIX / "fwmath-vectors.json"
    if args.ops and path.exists():       # merge a partial re-record
        old = json.loads(path.read_text())
        old["ops"].update(doc["ops"])
        old["registers"].update(doc["registers"])
        doc = old
    FIX.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, separators=(",", ":")) + "\n")
    print(f"wrote {path} ({path.stat().st_size} bytes) in {time.time() - t0:.0f}s wall; emulator runs {L.RUN_STATS}", file=sys.stderr)


# ---------------------------------------------------------------------------------------------
# literal corpus and number-text corpus
# ---------------------------------------------------------------------------------------------

def literal_sources() -> list[str]:
    r = random.Random(101)
    hard = ["0.1", "0.2", "0.3", "0.7", "0.9", "0.333333333", "0.666666667", "3.14159265", "2.71828183", "1.41421356",
            "1E38", "1.7E38", "1.70141183E38", "1E-38", "2E-38", "1.5E-38", "1E10", "1E15", "1E20", "1E30", "123456789",
            "4294967295", "4294967296", "16777216", "16777217", "8388608.5", "9.99999999", "99999999999", "12345678901",
            "0.000001", "0.00001", "65535", "65536", "32768", "32767", "100000", "1000000", "10000000", "0.5", "0.25",
            "0.125", "1.5", "2.5", "1E-5", "1E-10", "1E-20", "5E-39", "1.00000001", "1.0000000001", "0.99999999999",
            "1.17549435E-38", "6.02E23", "1.6E-19", "299792458", "1E37", "1E-37", "1.9999999", "3.4028235E38",
            "2147483647", "2147483648", "0.1E1", "1.E5", ".5", ".05", "255.255", "7.7", "77777777.7", "1234567.89",
            "-1.5", "-0.1", "-1E10", "-123456789", "-4294967295"]
    out = list(hard)
    while len(out) < 300:
        nd = r.randint(1, 12)
        digits = "".join(r.choice("0123456789") for _ in range(nd)).lstrip("0") or "1"
        pt = r.randint(0, len(digits))
        mant = digits[:pt] + "." + digits[pt:] if pt < len(digits) and r.random() < 0.7 else digits
        if mant.startswith("."):
            mant = "0" + mant
        if r.random() < 0.55:
            e = r.randint(-38, 38)
            # keep the value in range: mantissa exponent plus e within about 1E-38 .. 1.7E38
            approx = len(digits.split(".")[0]) + e
            if approx > 38 or approx < -37:
                continue
            mant += f"E{e}"
        out.append(mant)
    return out


def literal_program(srcs: list[str]) -> str:
    lines = ["10 MODE 2:DEFINT i:k=0"]
    n = 100
    for s in srcs:
        lines.append(f"{n} y!={s}:k=k+1:GOSUB 9000")
        n += 1
        if n >= 8990:
            raise ValueError("too many literals")
    lines.append(f"{n} END")
    lines.append('9000 PRINT k;" ";:FOR i=0 TO 4:PRINT RIGHT$("0"+HEX$(PEEK(@y!+i)),2);:NEXT:PRINT:RETURN')
    return "\n".join(lines) + "\n"


def parse_pairs(raw: str, n: int) -> dict[int, str]:
    got = {}
    for ln in raw.replace("\r", "").split("\n"):
        f = ln.split()
        if len(f) == 2 and f[0].isdigit() and len(f[1]) == 10:
            try:
                bytes.fromhex(f[1])
            except ValueError:
                continue
            got[int(f[0])] = f[1].upper()
    return got


def cmd_literals(args):
    srcs = literal_sources()
    rejected: list[str] = []
    per: dict[str, list[str]] = {}
    for m in args.models:
        while True:
            prog = literal_program(srcs)
            try:
                raw = L.run_bas(prog, m, 300, "p-fwm-literals")
            except RuntimeError as exc:
                bad = re.findall(r"(?:Syntax error|Overflow) in (\d+)", str(exc))
                if not bad:
                    raise
                k = int(bad[-1]) - 100
                print(f"  {m}: literal {srcs[k]!r} is rejected by the tokeniser", file=sys.stderr)
                rejected.append(srcs.pop(k))
                continue
            break
        got = parse_pairs(raw, len(srcs))
        assert len(got) == len(srcs), f"{m}: {len(got)} of {len(srcs)} literals"
        per[m] = [got[i + 1] for i in range(len(srcs))]
    # the rule: every literal is REAL(decimal digits as an integer) x 10^E through the firmware's REAL*10^A entry
    from decimal import Decimal
    parts, recs = [], []
    for i, src in enumerate(srcs):
        sign, digits, ex = Decimal(src.lstrip("-")).as_tuple()
        d = int("".join(map(str, digits)))
        parts.append([d, ex, 1 if src.startswith("-") else 0])
        recs.append(dict(tag=f"l{i}", e=f"{O.addr('MUL10A', '6128'):04X}", a=hx(O.from_float(float(d))), A=ex & 255))
    got = L.run_probe([r for r, p in zip(recs, parts) if p[0] != 0], "6128")
    matches = 0
    for i, (d, ex, neg) in enumerate(parts):
        v = got.get(f"l{i}")
        if not v or "R" not in v:
            continue
        r = v["R"][:5]
        if neg:
            n, m, e = O.unpack(r)
            r = O.mk(m, e, True) if m else r
        matches += hx(r) == per["6128"][i]
    print(f"  literals = REAL(digits) x MUL10A(E): {matches} of {len(srcs)} match", file=sys.stderr)
    base = per.get("6128")
    doc = dict(format=1, mul10a_matches=matches, parts=parts,
               about="Locomotive's 5-byte encoding of source literals: y!=<src> read back with PEEK(@y!+i) "
                               "(tests/loco/probes/p-fwm-literals.bas), recorded on CPCEC by tools/fwm-record.py literals.",
               models=args.models, sources=srcs, rejected=rejected,
               bytes={m: ("=6128" if base is not None and m != "6128" and v == base else v) for m, v in per.items()})
    path = FIX / "fwmath-literals.json"
    path.write_text(json.dumps(doc, indent=0, separators=(",", ":")) + "\n")
    print(f"wrote {path} ({path.stat().st_size} bytes)", file=sys.stderr)


def text_patterns() -> list[str]:
    r = random.Random(202)
    out: list[bytes] = []
    for k in range(-38, 39):          # powers of ten and their neighbours
        v = O.from_float(10.0 ** k) if -38 <= k <= 38 else None
        if v is None:
            continue
        neg, m, e = O.unpack(v)
        for dm in (-1, 0, 1):
            if (m + dm) >> 31 == 1:
                out.append(O.mk(m + dm, e))
    for x in (0.1, 0.2, 0.3, 1 / 3, 2 / 3, 0.5, 1.5, 2.5, 3.14159265, 100, 1e6, 123456789, 99999999, 999999999, 0.99999999,
              0.999999999, 12345678.9, 1e9, 1e10, 4294967295, 1e-5, 1e-4, 1e-3, 0.01):
        out.append(O.from_float(x))
        out.append(O.from_float(-x))
    out.append(O.ZERO)
    while len(out) < 2000:
        u = r.random()
        if u < 0.6:
            e = r.randint(0x60, 0xA0)
        elif u < 0.9:
            e = r.randint(1, 255)
        else:
            e = r.randint(0x78, 0x84)
        sparse = r.random() < 0.15
        m = 0x80000000
        if sparse:
            for _ in range(r.randint(0, 6)):
                m |= 1 << r.randint(0, 30)
        else:
            m = r.getrandbits(32) | 0x80000000
        out.append(O.mk(m, e, r.random() < 0.3))
    return [hx(b) for b in out[:2000]]


def text_program(pats: list[str]) -> str:
    lines = [
        "10 MODE 2:y!=1",
        "20 READ n",
        "30 FOR j=1 TO n:READ h$",
        '40 FOR i=0 TO 4:POKE @y!+i,VAL("&"+MID$(h$,2*i+1,2)):NEXT',
        '50 PRINT h$;"|";y!',
        "60 NEXT:END",
    ]
    ln = 100
    lines.append(f"{ln} DATA {len(pats)}")
    ln += 1
    for i in range(0, len(pats), 10):
        lines.append(f"{ln} DATA " + ",".join(pats[i:i + 10]))
        ln += 1
    return "\n".join(lines) + "\n"


def cmd_text(args):
    pats = text_patterns()
    prog = text_program(pats)
    per: dict[str, list[str]] = {}
    for m in args.models:
        raw = L.run_bas(prog, m, 600, "p-fwm-text")
        got = {}
        for ln in raw.replace("\r", "").split("\n"):
            if "|" in ln and len(ln.split("|")[0]) == 10:
                h, t = ln.split("|", 1)
                got[h] = t
        assert all(p in got for p in pats), f"{m}: {sum(p in got for p in pats)} of {len(pats)}"
        per[m] = [got[p] for p in pats]
    base = per.get("6128")
    doc = dict(format=1, about="PRINT y! of 2000 bit patterns written with POKE @y!+i "
                               "(tests/loco/probes/p-fwm-text.bas): the number text Locomotive prints, with its leading "
                               "space or minus sign. Recorded on CPCEC by tools/fwm-record.py text.",
               models=args.models, patterns=pats,
               text={m: ("=6128" if base is not None and m != "6128" and v == base else v) for m, v in per.items()})
    path = FIX / "fwmath-text.json"
    path.write_text(json.dumps(doc, indent=0, separators=(",", ":")) + "\n")
    print(f"wrote {path} ({path.stat().st_size} bytes)", file=sys.stderr)


# ---------------------------------------------------------------------------------------------
# PREP (FWM-PREP): the number-text digits entry
# ---------------------------------------------------------------------------------------------

def prep_extras() -> list[str]:
    """Inputs beyond the 2000 text patterns: powers of ten 1E-9..1E9 and 1 ulp either side, halves at the 9th
    digit, integers, values with 9+ significant digits, the extremes, zero, negatives."""
    from fractions import Fraction
    r = random.Random(303)
    out: list[bytes] = [O.ZERO, O.mk(0xFFFFFFFF, 255), O.mk(0xFFFFFFFF, 255, True), O.mk(0x80000000, 1),
                        O.mk(0x80000000, 1, True), O.mk(0x80000000, 129), O.mk(0x80000000, 129, True)]
    for k in range(-9, 10):
        v = O.from_float(10.0 ** k)
        neg, m, e = O.unpack(v)
        for dm in (-1, 0, 1):
            if (m + dm) >> 31 == 1:
                out.append(O.mk(m + dm, e))
                out.append(O.mk(m + dm, e, True))
    for x in (1, 2, 3, 9, 10, 99, 100, 999, 1000, 65535, 65536, 99999999, 100000000, 999999999, 1000000000,
              2147483647, 2147483648, 4294967295, 4294967296, 1e10, 1e11, 1e15, 1e38, 123456789, 1234567890, 12345678,
              0.1, 0.5, 0.25, 0.125, 1 / 3, 2 / 3, 1 / 7, 3.14159265358979, 2.718281828, 1.5, 2.5, -1.5, -0.5):
        out.append(O.from_float(x))
    # halves at the 9th significant digit (10 significant digits ending in 5) and one ulp around them
    for _ in range(30):
        d9 = r.randint(100000000, 999999999)
        ex = r.randint(-12, 12)
        x = Fraction(d9 * 10 + 5, 10 ** 9) * Fraction(10) ** ex
        v = O.from_float(float(x))
        out.append(v)
        nv, mv, ev = O.unpack(v)
        out.append(O.mk(mv ^ 1 | 0x80000000, ev))
    for _ in range(40):                      # 9 and 10 significant digits, plain
        d = r.randint(10 ** r.randint(8, 9), 10 ** 10 - 1)
        out.append(O.from_float(float(f"{d}e{r.randint(-15, 5)}")))
    for _ in range(20):                      # integers
        out.append(O.from_float(float(r.randint(1, 10 ** r.randint(1, 9)))))
    seen = set(); res = []
    for b in out:
        if hx(b) not in seen:
            seen.add(hx(b)); res.append(hx(b))
    return res


def prep_inputs() -> list[str]:
    seen = set(); res = []
    for h in text_patterns() + prep_extras():
        if h not in seen:
            seen.add(h); res.append(h)
    return res


def prep_fmt(v: dict) -> str:
    g, R = v["regs"], v["R"]
    s = f"{R[:5].hex().upper()} {g['BC']:04X}{g['DE']:04X}{g['HL']:04X}{g['F']:02X}{g['A']:02X}{g['IX']:04X}{g['IY']:04X}"
    if any(R[5:]):
        s += " +" + R[5:].hex().upper()
    return s


def cmd_prep(args):
    inputs = prep_inputs()
    path = FIX / "fwmath-prep.json"
    results: dict[str, list] = {}
    for m in args.models:
        sel = inputs if m in ("464", "6128") else inputs[::10]
        outs = []
        for i0 in range(0, len(sel), 250):
            part = sel[i0:i0 + 250]
            recs = [dict(tag=f"v{i0 + j}", e=f"{O.addr('PREP', m):04X}", a=s) for j, s in enumerate(part)]
            got = L.run_probe(recs, m)
            for j, s in enumerate(part):
                v = got.get(f"v{i0 + j}", {})
                outs.append("HANG" if v.get("hang") or "R" not in v else prep_fmt(v))
            print(f"  PREP {m}: {len(outs)}/{len(sel)}", file=sys.stderr, flush=True)
        results[m] = outs
    stack = {}
    for m in args.models:
        sel = inputs[::50][:40]
        recs = [dict(tag=f"s{j}", e=f"{O.addr('PREP', m):04X}", a=s) for j, s in enumerate(sel)]
        got = L.run_probe(recs, m, fill_stack=True)
        stack[m] = max(got[f"s{j}"].get("S", -1) for j in range(len(sel)))
    sens = {}
    for m in args.models:
        sel = inputs[::100][:20]
        base = None
        diffs = []
        for variant in (dict(), dict(bc="0000", de="FFFF", A=0x55), dict(bc="FFFF", de="0102", A=0xFF)):
            recs = [dict(tag=f"t{j}", e=f"{O.addr('PREP', m):04X}", a=s, **variant) for j, s in enumerate(sel)]
            got = L.run_probe(recs, m)
            cur = [prep_fmt(got[f"t{j}"]) for j in range(len(sel))]
            if base is None:
                base = cur
            else:
                diffs.append([(a, b) for a, b in zip(base, cur) if a != b][:3])
        sens[m] = "same output for other BC, DE, A on entry" if not any(diffs) else diffs
    base = results.get("6128")
    comp = {}
    idx = {s: k for k, s in enumerate(inputs)}
    for m, v in results.items():
        if m == "6128" or base is None:
            comp[m] = v
        else:
            sel = inputs if m == "464" else inputs[::10]
            comp[m] = [("=" if v[k] == base[idx[s]] else v[k]) for k, s in enumerate(sel)]
    doc = dict(format=1, about="PREP (the number text's digit entry) called with HL at the input REAL: bytes at (HL), then BC DE HL F A IX IY "
                               "on exit (hex), and '+' the other bytes of the 24-byte window if any are nonzero. 464/6128 all inputs, "
                               "664/plus every 10th; '=' means identical to the 6128. Recorded by tools/fwm-record.py prep.",
               models=args.models, inputs=inputs, stride={"464": 1, "664": 10, "6128": 1, "plus": 10},
               results=comp, stack_bytes=stack, register_sensitivity=sens)
    path.write_text(json.dumps(doc, indent=0, separators=(",", ":")) + "\n")
    print(f"wrote {path} ({path.stat().st_size} bytes)", file=sys.stderr)


def compiled_text_program(pats: list[str], first: int) -> str:
    """The number-text program for the cpcbas compiler: the bytes are poked in today's layout (exponent
    first, mantissa most significant byte first), i.e. the Locomotive bytes reversed."""
    lines = ["10 y! = 1", f"20 FOR j = {first} TO {first + len(pats) - 1}", "30 FOR i = 0 TO 4: READ b: POKE @y! + i, b: NEXT",
             '40 PRINT j; "|"; y!', "50 NEXT", "60 END"]
    ln = 100
    for i in range(0, len(pats), 4):
        vals = []
        for p in pats[i:i + 4]:
            vals += list(bytes.fromhex(p))[::-1]
        lines.append(f"{ln} DATA " + ",".join(str(v) for v in vals))
        ln += 1
    return "\n".join(lines) + "\n"


def cmd_textcheck(args):
    """Compile the number-text program with cpcbas and run it on CPCEC (464 and 6128); compare with the
    interpreter's text. Today's REAL layout and number text are the reference being measured."""
    import tempfile
    ld, cr = L.loco_diff()
    doc = json.loads((FIX / "fwmath-text.json").read_text())
    pats = doc["patterns"]
    want = doc["text"]["6128"]
    result = {}
    for m in [x for x in args.models if x in ("464", "6128")]:
        got: dict[int, str] = {}
        for first in range(0, len(pats), 250):
            part = pats[first:first + 250]
            d = Path(tempfile.mkdtemp())
            (d / "src").mkdir()
            src = d / "src" / "t.bas"
            src.write_text(compiled_text_program(part, first))
            L.wait_for_cpcec()
            dsk, stem = ld.build_compiled(cr, src, d)
            raw = ld.run_compiled(cr, dsk, stem, m, "cpcec", 600, d)
            time.sleep(0.4)
            for ln in raw.replace("\r", "").split("\n"):
                if "|" in ln:
                    j, t = ln.split("|", 1)
                    if j.strip().isdigit():
                        got[int(j)] = t
        diffs = [[pats[i], want[i], got.get(i)] for i in range(len(pats)) if got.get(i) != want[i]]
        result[m] = dict(compared=len(pats), missing=sum(i not in got for i in range(len(pats))), differ=len(diffs), first_differences=diffs[:60])
        print(f"  {m}: {len(pats)} patterns, {len(diffs)} differ", file=sys.stderr)
    out = dict(format=1, about="The number-text corpus printed by a cpcbas build (today's layout, firmware and library) on CPCEC, against "
                               "the interpreter's text: where today's number text differs from Locomotive's. Recorded by "
                               "tools/fwm-record.py textcheck.", result=result)
    path = FIX / "fwmath-text-compiled.json"
    path.write_text(json.dumps(out, indent=0, separators=(",", ":")) + "\n")
    print(f"wrote {path}", file=sys.stderr)


# ---------------------------------------------------------------------------------------------
# entries: jumpblock dump, KL PROBE ROM, standard sweep, stack depth, edge cases
# ---------------------------------------------------------------------------------------------

R = lambda x: hx(O.from_float(x))   # noqa: E731
MAXP, MAXN, MINP, MINN = "FFFFFF7FFF", "FFFFFFFFFF", "0000000001", "0000008001"
# exponent byte 0 with a non-zero mantissa: how the calculator's small-integer form (and junk) is read
Z1, Z2, Z3, Z4 = "0000004000", "3412000000", "FFFFFFFF00", "0000000080"


def edge_cases() -> list[dict]:
    c: list[dict] = []

    def two(op, pairs):
        for a, b in pairs:
            c.append(dict(op=op, a=a, b=b))

    def one(op, vals):
        for a in vals:
            c.append(dict(op=op, a=a))

    sums = [(MAXP, MAXP), (MAXN, MAXN), (MAXP, R(1)), (R(1), R(1)), (MINP, MINP), (R(1), R(-1)), (R(0), R(0)),
            (MAXP, MAXN), (R(1e38), R(1e38)), (R(1.5e38), R(1.5e38)), (MINP, R(1)), (Z1, R(1.5)), (R(1.5), Z1), (Z2, R(2)), (Z3, R(2)), (Z4, R(2))]
    for op in ("ADD", "SUB", "RSUB"):
        two(op, sums)
    two("MUL", [(MAXP, R(2)), (MAXP, MAXP), (MINP, MINP), (MINP, R(0.5)), (R(0), MAXP), (MAXP, R(0)), (R(1e20), R(1e20)),
                (R(1e-20), R(1e-20)), (R(-1e20), R(1e20)), (R(1e19), R(1e19)), (R(1.5), R(1e-38)), (Z1, R(2)), (R(2), Z2)])
    two("DIV", [(R(1), R(0)), (R(0), R(0)), (R(0), R(1)), (MAXP, R(0.5)), (MINP, R(2)), (R(1), MINP), (R(1), MAXP),
                (MINP, MAXP), (R(-1), R(0)), (MAXP, R(0)), (R(1e38), R(1e-5)), (R(1), Z1), (Z1, R(2))])
    one("SQR", [R(-1), R(0), MAXP, MINP, R(4), R(-4), R(2), Z1])
    one("LOG", [R(0), R(-1), R(1), MINP, MAXP, R(2.718281828), Z1])
    one("LOG10", [R(0), R(-1), R(1), R(1000), MINP, MAXP])
    one("EXP", [R(88), R(88.1), R(89), R(100), R(1000), R(-88), R(-89), R(-100), R(-1000), R(0), MAXP, MAXN, R(88.72), R(-87.3)])
    two("POW", [(R(0), R(0)), (R(0), R(-1)), (R(0), R(2)), (R(-8), R(1 / 3)), (R(-2), R(3)), (R(-2), R(2)), (R(-2), R(0.5)),
                (R(2), R(0.5)), (R(2), R(200)), (R(10), R(-50)), (R(1), MAXP), (MAXP, R(2)), (R(2), R(-200)), (R(0), R(0.5)),
                (R(-1), R(1e10)), (R(-2), R(-3)), (R(1e-38), R(2)), (R(5), R(0)), (R(2), R(127)), (R(2), R(128))])
    for op in ("SIN", "COS", "TAN"):
        one(op, [R(1e30), R(1e38), MAXP, R(1.5707963), R(3.14159265), R(1e10), R(1e5), R(100000.5), R(0), MINP, R(-1e5)])
    one("ATN", [MAXP, MAXN, MINP, R(0), R(1), R(-1)])
    ints = [0, 0.5, -0.5, 1.5, 2.5, 32766.5, 32767, 32767.4, 32767.5, 32768, 32768.5, 65535, 65535.4, 65535.5, 65536, 1e10, -1, -32767, -32768,
            -32768.5, -32769, -65535, -65536, 4294967295, 4294967296, 2147483647, 2147483648, -2147483648, -2147483649, 1e38, -1e38, 0.4999999, 0.9999999]
    for op in ("REAL2INT", "REAL2BIN", "FIX", "INT"):
        one(op, [R(x) for x in ints] + [MAXP, MINP, Z1, Z4])
    for hl in (0, 1, 0x7FFF, 0x8000, 0xFFFF):
        for a in (0, 0x80, 0x01):
            c.append(dict(op="INT2REAL", hl=f"{hl:04X}", A=a))
    for v, n in ((1, 38), (1, 39), (1, 127), (1, -128), (1, -38), (1, -39), (1, -127), (1e30, 10), (0, 5), (1, 0), (1, 100)):
        c.append(dict(op="MUL10A", a=R(v), A=n & 255))
    c.append(dict(op="MUL10A", a=MAXP, A=1))
    c.append(dict(op="MUL10A", a=MINP, A=255))
    for v, n in ((1, 127), (1, 128), (1, -127), (1, -128), (0, 5), (1, 0)):
        c.append(dict(op="EXPADD", a=R(v), A=n & 255))
    c.append(dict(op="EXPADD", a=MAXP, A=1))
    c.append(dict(op="EXPADD", a=MINP, A=255))
    for z in (Z1, Z2, Z3, Z4):
        for op in ("CMP",):
            two(op, [(z, R(1.5)), (R(1.5), z), (z, R(0))])
        one("SGN", [z])
        one("NEG", [z])
    one("NEG", [R(0), R(1), MAXP])
    one("SGN", [R(0), R(-3), R(3)])
    two("CMP", [(R(1), R(1)), (R(0), R(0)), (R(-1), R(1)), (R(1), R(-1)), (R(-2), R(-1)), (MAXP, MAXN), (MINP, R(0))])
    return c


def sweep_models(models: list[str]) -> dict:
    out: dict = {}
    for m in models:
        lo, hi = O.BLOCK[m]
        # the jumpblock bytes, from the interpreter's own PEEK
        body = ("10 FOR a=&BD34 TO &BDD0 STEP 3:PRINT HEX$(a,4);\" \";HEX$(PEEK(a),2);HEX$(PEEK(a+1),2);HEX$(PEEK(a+2),2):NEXT\n"
                "20 END\n")
        raw = L.run_bas("1 MODE 2:DEFINT a\n" + body, m, 60)
        jb = {ln[:4]: ln[5:11] for ln in raw.replace("\r", "").split("\n") if len(ln) >= 11 and ln[4] == " " and ln[:2] == "BD"}
        pr = L.run_probe([dict(tag="p0", e="B915", bc="0000")], m)["p0"]["regs"]
        out[m] = dict(jumpblock=jb, probe_rom=dict(A=pr["A"], H=pr["HL"] >> 8, L=pr["HL"] & 255), block=[lo, hi])
    return out


def cmd_entries(args):
    models = args.models
    t0 = time.time()
    doc: dict = dict(format=1, recorded="2026-11-08", about="Entry sweep, stack depth and edge cases of the CPC firmware maths, "
                     "recorded on CPCEC by tools/fwm-record.py entries. Registers are the values after the call; the stub "
                     "sets BC=1234 DE=8108 HL=8100 IX=5678 IY=9ABC A=0 (or the case's A) before it.")
    doc["models"] = sweep_models(models)
    std: dict = {}
    A15, B225 = R(1.5), R(2.25)
    for m in models:
        recs = []
        names = [n for n in O.ENTRIES if O.addr(n, m) is not None]
        for n in names:
            for v, A in (("s", 0), ("t", 3), ("u", 0x80)):
                recs.append(dict(tag=f"{n.lower()}_{v}", e=f"{O.addr(n, m):04X}", a=A15, b=B225, A=A))
        # RND is stateful: it goes last, so a failed run cannot disturb the others
        got = L.run_probe([r for r in recs if not r["tag"].startswith("rnd")] + [r for r in recs if r["tag"].startswith("rnd")], m)
        std[m] = {}
        for r in recs:
            v = got.get(r["tag"], {})
            std[m][r["tag"]] = "HANG" if v.get("hang") or "R" not in v else dict(
                R=v["R"][:13].hex().upper(), **{k: f"{x:04X}" if k not in ("A", "F") else f"{x:02X}" for k, x in v["regs"].items()})
        print(f"  sweep {m}: {len(recs)} calls", file=sys.stderr, flush=True)
    doc["standard"] = std
    # stack depth: 4 inputs x 3 runs per entry, the deepest value; baseline is a lone RET
    stack: dict = {}
    for m in models:
        names = [n for n in O.ENTRIES if O.addr(n, m) is not None and n not in ("RND", "RND0", "INT1", "INT2", "INT3")]
        inputs = [(A15, B225), (R(-2.5), R(7.5)), (R(1e30), R(3.7e-20)), (R(12345.678), R(0.001))]
        deepest: dict = {}
        for rep in range(3):
            recs = [dict(tag="base", e="RET", a=A15, b=B225)]
            for n in names:
                for k, (a, b) in enumerate(inputs):
                    recs.append(dict(tag=f"{n.lower()}_{k}", e=f"{O.addr(n, m):04X}", a=a, b=b, A=3 if n == "ANGLE" else 0))
            got = L.run_probe(recs, m, fill_stack=True)
            for r in recs:
                v = got.get(r["tag"], {})
                if "S" in v:
                    key = r["tag"].rsplit("_", 1)[0]
                    deepest[key] = max(deepest.get(key, 0), v["S"])
        stack[m] = deepest
        print(f"  stack {m}: baseline {deepest.get('base')}", file=sys.stderr, flush=True)
    doc["stack"] = stack
    # edge cases
    cases = edge_cases()
    edges = []
    per: dict = {m: [] for m in models}
    for m in models:
        recs = []
        for i, cs in enumerate(cases):
            if O.addr(cs["op"], m) is None:
                continue
            rec = dict(tag=f"e{i}", e=f"{O.addr(cs['op'], m):04X}", a=cs.get("a", "-"), b=cs.get("b", "-"), A=cs.get("A", 0))
            if "hl" in cs:
                rec["hl"] = cs["hl"]
            recs.append(rec)
        got = L.run_probe(recs, m)
        for rec in recs:
            i = int(rec["tag"][1:])
            v = got.get(rec["tag"], {})
            if v.get("hang") or "R" not in v:
                per[m].append((i, "HANG"))
            else:
                g = v["regs"]
                per[m].append((i, dict(R=v["R"][:13].hex().upper(), A=f"{g['A']:02X}", F=f"{g['F']:02X}", HL=f"{g['HL']:04X}",
                                       DE=f"{g['DE']:04X}", BC=f"{g['BC']:04X}")))
        print(f"  edges {m}: {len(recs)} cases", file=sys.stderr, flush=True)
    for i, cs in enumerate(cases):
        out = {m: dict(per[m]).get(i) for m in models if dict(per[m]).get(i) is not None}
        base = out.get("6128")
        out = {m: ("=6128" if m != "6128" and v == base else v) for m, v in out.items()}
        edges.append(dict(**cs, out=out))
    doc["edges"] = edges
    path = FIX / "fwmath-entries.json"
    path.write_text(json.dumps(doc, indent=0, separators=(",", ":")) + "\n")
    print(f"wrote {path} ({path.stat().st_size} bytes) in {time.time() - t0:.0f}s wall; runs {L.RUN_STATS}", file=sys.stderr)


# ---------------------------------------------------------------------------------------------
# probes: the generated programs, written out so they can be re-run by hand
# ---------------------------------------------------------------------------------------------

def detect_prelude() -> str:
    """Body lines that find the model with KL PROBE ROM (H = 0 464, 1 664, 2 6128, 4 Plus) and set
    m (0 = 464, 1 = 664, 2 = 6128/Plus), sb (the maths state) and the address function FN."""
    return "\n".join([
        "10 e=&B915:bc=0:GOSUB 8000:v=PEEK(&8225):m=2:IF v=0 THEN m=0 ELSE IF v=1 THEN m=1",
        "20 sb=&B100:IF m=0 THEN sb=&B8E4",
        "30 PRINT \"model version \";v;\" state \";HEX$(sb,4)",
    ])


def addr_data(names: list[str], first_line: int) -> tuple[str, str]:
    """DATA lines (464, 664, 6128 addresses per name, in order) and the READ line."""
    rows = []
    for n in names:
        rows.append("DATA " + ",".join(f"&{O.addr(n, m):04X}" for m in ("464", "664", "6128")))
    return "\n".join(f"{first_line + i} {r}" for i, r in enumerate(rows)), ""


def cmd_probes(args):
    out = REPO / "tests" / "loco" / "probes"
    # the sweep programs, one per address table
    A15, B225 = R(1.5), R(2.25)
    for m in ("464", "664", "6128"):
        recs = []
        for n in O.ENTRIES:
            if O.addr(n, m) is None:
                continue
            for v, A in (("s", 0), ("t", 3), ("u", 0x80)):
                recs.append(dict(tag=f"{n.lower()}_{v}", e=f"{O.addr(n, m):04X}", a=A15, b=B225, A=A))
        recs = [r for r in recs if not r["tag"].startswith("rnd")] + [r for r in recs if r["tag"].startswith("rnd")]
        text = (f"5 REM FWM-0: every firmware maths entry of the {m} table (the 6128 table also serves the Plus), 3 calls each\n"
                f"6 REM HL->1.5 DE->2.25; prints operands, registers after, as tools/fwm-record.py reads them\n")
        (out / f"p-fwm-entries-{m}.bas").write_text(text + L.probe_program(recs))
    srcs = literal_sources()
    (out / "p-fwm-literals.bas").write_text("5 REM FWM-0: Locomotive's encoding of 300 source literals (tools/fwm-record.py literals)\n"
                                            + literal_program(srcs))
    (out / "p-fwm-text.bas").write_text("5 REM FWM-0: the number text of 2000 bit patterns (tools/fwm-record.py text)\n"
                                        + text_program(text_patterns()))
    # angle mode and RND by entry vs BASIC, model chosen at run time
    names = ["ANGLE", "SIN", "RND", "RND0"]
    data, _ = addr_data(names, 9800)
    angle = "\n".join([
        detect_prelude(),
        "40 FOR k=1 TO 4:READ a0(k),a1(k),a2(k):NEXT",
        "50 ea=a0(1):IF m=1 THEN ea=a1(1) ELSE IF m=2 THEN ea=a2(1)",
        "60 es=a0(2):IF m=1 THEN es=a1(2) ELSE IF m=2 THEN es=a2(2)",
        "70 FOR t=0 TO 4:READ ra:e=ea:GOSUB 8000",
        '80 PRINT "A=";HEX$(ra,2);" flag ";HEX$(PEEK(sb+19),2);" regs ";:ad=&8220:n=12:GOSUB 8100:PRINT:NEXT',
        "90 FOR t=0 TO 1:READ ra:e=ea:GOSUB 8000",
        "100 POKE &8100,0:POKE &8101,0:POKE &8102,0:POKE &8103,&34:POKE &8104,&87",
        "110 ra=0:e=es:GOSUB 8000",
        '120 PRINT "entry sin(90) flag ";HEX$(PEEK(sb+19),2);" ";:ad=&8100:n=5:GOSUB 8100:PRINT:NEXT',
        '130 DEG:PRINT "BASIC DEG flag ";HEX$(PEEK(sb+19),2);:RAD:PRINT " RAD flag ";HEX$(PEEK(sb+19),2)',
        '140 DEG:y!=SIN(90):PRINT "BASIC SIN(90) DEG ";:FOR k=0 TO 4:PRINT RIGHT$("0"+HEX$(PEEK(@y!+k)),2);:NEXT:PRINT',
        '150 RAD:y!=SIN(90):PRINT "BASIC SIN(90) RAD ";:FOR k=0 TO 4:PRINT RIGHT$("0"+HEX$(PEEK(@y!+k)),2);:NEXT:PRINT',
        "160 END",
        data,
        "9900 DATA 0,1,3,128,255,1,0",
    ])
    (out / "p-fwm-angle.bas").write_text("5 REM FWM-0: SET ANGLE MODE (A=0 RAD, else DEG; the flag is at state+19) and SIN in both modes\n" + L.prelude() + angle + "\n")
    rnd = "\n".join([
        detect_prelude(),
        "40 FOR k=1 TO 4:READ a0(k),a1(k),a2(k):NEXT",
        "50 er=a0(3):er0=a0(4):IF m=1 THEN er=a1(3):er0=a1(4) ELSE IF m=2 THEN er=a2(3):er0=a2(4)",
        "60 FOR t=1 TO 6:e=er:ra=0:GOSUB 8000:PRINT \"E\";t;\" \";:ad=&8100:n=5:GOSUB 8100:PRINT \" \";:ad=sb:n=19:GOSUB 8100:PRINT \" regs \";:ad=&8220:n=12:GOSUB 8100:PRINT:NEXT",
        "70 e=er0:GOSUB 8000:PRINT \"E0 \";:ad=&8100:n=5:GOSUB 8100:PRINT",
        "80 END",
        data,
    ])
    (out / "p-fwm-rnd-entry.bas").write_text("5 REM FWM-0: the RND entries from the boot state, with the seed bytes at state+0..3 (compare p-fwm-seed.bas)\n" + L.prelude() + rnd + "\n")
    # data statements need dimensioning: DIM a0(4),a1(4),a2(4)
    for f in ("p-fwm-angle.bas", "p-fwm-rnd-entry.bas"):
        t = (out / f).read_text().replace("\n10 e=&B915", "\n9 DIM a0(4),a1(4),a2(4)\n10 e=&B915", 1)
        (out / f).write_text(t)
    print("wrote the p-fwm-* probes", file=sys.stderr)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["vectors", "entries", "literals", "text", "textcheck", "prep", "rnd", "stack", "thresholds", "probes"])
    ap.add_argument("--models", default=",".join(MODELS))
    ap.add_argument("--ops")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    args.models = args.models.split(",")
    wait_for_cpcec(args.force)
    {"vectors": cmd_vectors, "literals": cmd_literals, "text": cmd_text, "entries": cmd_entries, "probes": cmd_probes, "textcheck": cmd_textcheck, "prep": cmd_prep, "rnd": cmd_rnd, "stack": cmd_stack, "thresholds": cmd_thresholds}[args.cmd](args)


if __name__ == "__main__":
    main()
