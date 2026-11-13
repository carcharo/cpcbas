"""fwm_lib.py -- shared helpers of the firmware-maths recorder (FWM-0).

Builds Locomotive BASIC programs that call a firmware maths entry through a small machine-code stub,
runs them under the real interpreter on CPCEC (through tools/loco-diff.py's `interpret`) and parses
the printed transcript. Used by tools/fwm-record.py. Development tooling; never part of `npm test`.

The stub (loaded at &8000 after MEMORY &7FFF) sets BC, DE, HL, A, IX, IY from a parameter block at
&8200, calls the entry, and stores BC, DE, HL, AF, IX, IY at &8220. It runs the call on a private
stack at &9000 (optionally pre-filled with &A5 over &8E00-&8FFF to measure the stack depth). The
operands live at &8100 (HL) and &8108 (DE) by default: in the central 32K, so the lower ROM that
FIRM JUMP enables does not hide them.
"""
import importlib.util
import re
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BASE = 0x8000
PARAM = 0x8200  # in: BC DE HL A(+pad) IX IY
OUT = 0x8220    # out: BC DE HL F A IX IY (little endian words; AF stored as F then A)
MODELS = ("464", "664", "6128", "plus")
RUN_STATS = {"runs": 0, "wall_s": 0.0}


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


_ld = None
_cpcrun = None


def wait_for_cpcec(max_wait: float = 900.0):
    """One CPCEC at a time on this machine: wait while any other cpcec process runs."""
    import subprocess
    t0 = time.time()
    while subprocess.run(["pgrep", "-x", "cpcec"], capture_output=True).returncode == 0:
        if time.time() - t0 > max_wait:
            raise RuntimeError("another cpcec has been running for %d s" % max_wait)
        time.sleep(2)


def loco_diff():
    global _ld, _cpcrun
    if _ld is None:
        _ld = _load(REPO / "tools" / "loco-diff.py", "loco_diff")
        _cpcrun = _ld.load_cpcrun(_ld.default_sibling("cpcbuild").resolve())
    return _ld, _cpcrun


def stub(fill_stack: bool) -> tuple[bytes, int, int]:
    """Return (code, offset of the call operand, offset of the lone RET used as a baseline target)."""
    c = bytearray()
    c += bytes([0xDD, 0xE5, 0xFD, 0xE5])                    # push ix / push iy
    c += bytes([0xED, 0x73, 0xF0, 0x80])                    # ld (&80F0),sp
    c += bytes([0x31, 0x00, 0x90])                          # ld sp,&9000
    if fill_stack:
        c += bytes([0x21, 0x00, 0x8E, 0x36, 0xA5, 0x11, 0x01, 0x8E, 0x01, 0xFF, 0x01, 0xED, 0xB0])
    c += bytes([0xDD, 0x2A, 0x08, 0x82])                    # ld ix,(&8208)
    c += bytes([0xFD, 0x2A, 0x0A, 0x82])                    # ld iy,(&820A)
    c += bytes([0xED, 0x4B, 0x00, 0x82])                    # ld bc,(&8200)
    c += bytes([0xED, 0x5B, 0x02, 0x82])                    # ld de,(&8202)
    c += bytes([0x2A, 0x04, 0x82])                          # ld hl,(&8204)
    c += bytes([0x3A, 0x06, 0x82])                          # ld a,(&8206)
    c += bytes([0xB7])                                      # or a   (carry clear)
    c += bytes([0xCD, 0, 0])                                # call nnnn (patched)
    call_op = len(c) - 2
    c += bytes([0xED, 0x43, 0x20, 0x82])                    # ld (&8220),bc
    c += bytes([0xED, 0x53, 0x22, 0x82])                    # ld (&8222),de
    c += bytes([0x22, 0x24, 0x82])                          # ld (&8224),hl
    c += bytes([0xF5, 0xE1, 0x22, 0x26, 0x82])              # push af / pop hl / ld (&8226),hl
    c += bytes([0xDD, 0x22, 0x28, 0x82])                    # ld (&8228),ix
    c += bytes([0xFD, 0x22, 0x2A, 0x82])                    # ld (&822A),iy
    c += bytes([0xED, 0x7B, 0xF0, 0x80])                    # ld sp,(&80F0)
    c += bytes([0xFD, 0xE1, 0xDD, 0xE1, 0xC9])              # pop iy / pop ix / ret
    ret = len(c)
    c += bytes([0xC9])                                      # a lone RET (baseline call target)
    return bytes(c), call_op, ret


def data_lines(first: int, values: list[int], per: int = 20) -> str:
    out = []
    for i in range(0, len(values), per):
        out.append(f"{first + len(out)} DATA " + ",".join(str(v) for v in values[i:i + per]))
    return "\n".join(out)


def hex5(b: bytes) -> str:
    return b.hex().upper()


# ---------------------------------------------------------------------------------------------
# the general probe program: one record per call, full register and memory dump
# ---------------------------------------------------------------------------------------------

def probe_program(records: list[dict], fill_stack: bool = False) -> str:
    """records: dict(tag, e (hex str, or 'RET' for the baseline), a, b (hex of 5 bytes or ''), A (int),
    bc, de, hl (hex words or ''), pa (hex address or ''), pd (hex data), xa (hex address), xn (count))."""
    code, call_op, ret_off = stub(fill_stack)
    lines = [
        "10 MEMORY &7FFF:DEFINT a-z:MODE 2",
        f"20 FOR i=0 TO {len(code) - 1}:READ b:POKE &8000+i,b:NEXT",
        "25 POKE &8208,&78:POKE &8209,&56:POKE &820A,&BC:POKE &820B,&9A",
        '30 READ tg$:IF tg$="." THEN END',
        "40 READ e$,a$,b$,ra,bc$,de$,hl$,pa$,pd$,xa$,xn",
        "50 FOR k=0 TO 39:POKE &8100+k,0:NEXT",
        '60 IF a$<>"-" THEN h$=a$:ad=&8100:GOSUB 910',
        '65 IF b$<>"-" THEN h$=b$:ad=&8108:GOSUB 910',
        f'70 IF e$="RET" THEN e$="{(BASE + ret_off):04X}"',
        f"75 h$=e$:GOSUB 900:POKE &{BASE + call_op:04X},v AND 255:POKE &{BASE + call_op + 1:04X},((v AND &FF00)\\256) AND 255",
        '80 h$=bc$:GOSUB 900:POKE &8200,v AND 255:POKE &8201,((v AND &FF00)\\256) AND 255',
        '82 h$=de$:GOSUB 900:POKE &8202,v AND 255:POKE &8203,((v AND &FF00)\\256) AND 255',
        '84 h$=hl$:GOSUB 900:POKE &8204,v AND 255:POKE &8205,((v AND &FF00)\\256) AND 255',
        "86 POKE &8206,ra",
        '88 IF pa$<>"-" THEN h$=pa$:GOSUB 900:ad=v:h$=pd$:GOSUB 910',
        "90 CALL &8000",
        '100 PRINT tg$;"R ";e$;" ";:ad=&8100:n=24:GOSUB 920:PRINT',
        '110 PRINT tg$;"G ";:ad=&8220:n=12:GOSUB 920:PRINT',
    ]
    if fill_stack:
        lines += ["120 i=&8E00:WHILE PEEK(i)=&A5 AND i<&9000:i=i+1:WEND",
                  '125 PRINT tg$;"S ";&9000-i']
    lines += [
        '130 IF xa$<>"-" THEN PRINT tg$;"X ";xa$;" ";:h$=xa$:GOSUB 900:ad=v:n=xn:GOSUB 920:PRINT',
        "140 GOTO 30",
        "900 v=VAL(\"&\"+h$):RETURN",
        '910 FOR k=0 TO LEN(h$)/2-1:POKE ad+k,VAL("&"+MID$(h$,2*k+1,2)):NEXT:RETURN',
        '920 FOR k=0 TO n-1:PRINT RIGHT$("0"+HEX$(PEEK(ad+k)),2);:NEXT:RETURN',
        data_lines(1000, list(code)),
    ]
    out = []
    for r in records:
        out.append("DATA " + ",".join([
            r["tag"], r["e"], r.get("a", "-") or "-", r.get("b", "-") or "-", str(r.get("A", 0)),
            r.get("bc", "1234"), r.get("de", "8108"), r.get("hl", "8100"),
            r.get("pa", "-") or "-", r.get("pd", "-") or "-", r.get("xa", "-") or "-", str(r.get("xn", 0))]))
    out.append("DATA .")
    n = 2000
    for d in out:
        lines.append(f"{n} {d}")
        n += 1
    return "\n".join(lines) + "\n"


def parse_probe(raw: str) -> dict:
    """tag -> dict(R=bytes 24 at &8100, regs=dict, S=depth, X=bytes)."""
    res: dict[str, dict] = {}
    text = raw.replace("\r\n", "\n").replace("\r", "\n")
    for ln in text.split("\n"):
        m = re.match(r"^(\w+?)([RGSX]) (.*)$", ln.strip())
        if not m:
            continue
        tag, kind, rest = m.groups()
        d = res.setdefault(tag, {})
        if kind == "R":
            parts = rest.split()
            if len(parts) < 2 or len(parts[1]) != 48:
                continue
            d["e"] = parts[0]
            d["R"] = bytes.fromhex(parts[1])
        elif kind == "G":
            if len(rest.strip()) != 24:
                continue
            b = bytes.fromhex(rest.strip())
            w = lambda i: b[i] | (b[i + 1] << 8)
            d["regs"] = dict(BC=w(0), DE=w(2), HL=w(4), F=b[6], A=b[7], IX=w(8), IY=w(10))
        elif kind == "S":
            d["S"] = int(rest)
        elif kind == "X":
            parts = rest.split()
            d["X"] = bytes.fromhex(parts[1]) if len(parts) > 1 else b""
    return res


def run_bas(text: str, model: str, timeout: float = 120, name: str = "fwm") -> str:
    """Run a Locomotive BASIC program on CPCEC under the interpreter; return the raw capture.
    Raises RuntimeError("hang:<raw>") when the program does not come back to Ready."""
    ld, cr = loco_diff()
    import tempfile
    d = Path(tempfile.mkdtemp(prefix="fwm-"))
    try:
        p = d / f"{name}.bas"
        p.write_text(text)
        try:
            wait_for_cpcec()
            t0 = time.time()
            try:
                return ld.interpret(cr, p, model, "cpcec", timeout, None)
            finally:
                RUN_STATS["runs"] += 1
                RUN_STATS["wall_s"] += time.time() - t0
                time.sleep(0.4)   # a gap between runs, so another agent's CPCEC can start
        except ld.RunFailure as exc:
            if exc.code == 2:
                raise RuntimeError("hang:" + str(exc)) from None
            raise
    finally:
        import shutil
        shutil.rmtree(d, ignore_errors=True)


def run_probe(records: list[dict], model: str, fill_stack: bool = False, timeout: float | None = None) -> dict:
    """Run records in order (state persists between them). A record whose result never appears is
    re-run alone to confirm; if it still fails it is reported as {'hang': True} and the rest re-run."""
    results: dict[str, dict] = {}
    todo = list(records)

    def complete(v):
        return v is not None and "regs" in v and "R" in v and (not fill_stack or "S" in v)

    while todo:
        tmo = timeout or (60 + 3.0 * len(todo))
        prog = probe_program(todo, fill_stack)
        try:
            raw = run_bas(prog, model, tmo)
            got = parse_probe(raw)
            results.update({r["tag"]: got.get(r["tag"], {}) for r in todo})
            break
        except RuntimeError as exc:
            m = re.search(r"printed so far: (.*)$", str(exc), re.S)
            seen = eval(m.group(1)) if m else ""
            got = parse_probe(seen)
            done = [r for r in todo if complete(got.get(r["tag"]))]
            results.update({r["tag"]: got[r["tag"]] for r in done})
            rest = [r for r in todo if r not in done]
            if not rest:
                break
            first = rest[0]
            if len(todo) > 1 and len(done) < len(todo):
                # confirm the suspect alone (fresh state: the record is stateless unless it is RND)
                try:
                    one = parse_probe(run_bas(probe_program([first], fill_stack), model, 60))
                    ok = complete(one.get(first["tag"]))
                except RuntimeError:
                    ok = False
                if ok and len(rest) > 1 and not first.get("seq"):
                    results[first["tag"]] = one[first["tag"]]
                    todo = rest[1:]
                    continue
            results[first["tag"]] = {"hang": True}
            todo = rest[1:]
    return results


# ---------------------------------------------------------------------------------------------
# hand-written probes that need the stub: prelude + GOSUB 8000 (call), GOSUB 8100 (dump)
# ---------------------------------------------------------------------------------------------

def prelude(fill_stack: bool = False) -> str:
    """Lines 1-9 and 8000+: MEMORY, stub POKEs, and subroutines.
    Variables the caller sets before GOSUB 8000: e (entry, integer), ra (A), hl, de, bc (integers),
    operands POKEd at &8100 / &8108. After the call the output block is at &8220 (PEEK words).
    GOSUB 8100: dump n bytes from ad as hex (no separator). GOSUB 8200: PRINT 5 bytes at ad as hex."""
    code, call_op, _ = stub(fill_stack)
    return "\n".join([
        "1 MEMORY &7FFF:DEFINT a-z:MODE 2",
        f"2 FOR i=0 TO {len(code) - 1}:READ b:POKE &8000+i,b:NEXT",
        "3 POKE &8208,&78:POKE &8209,&56:POKE &820A,&BC:POKE &820B,&9A",
        "4 bc=&1234:de=&8108:hl=&8100:ra=0:GOTO 10",
        "7999 END",
        f"8000 POKE &{BASE + call_op:04X},e AND 255:POKE &{BASE + call_op + 1:04X},((e AND &FF00)\\256) AND 255",
        "8001 POKE &8200,bc AND 255:POKE &8201,((bc AND &FF00)\\256) AND 255",
        "8002 POKE &8202,de AND 255:POKE &8203,((de AND &FF00)\\256) AND 255",
        "8003 POKE &8204,hl AND 255:POKE &8205,((hl AND &FF00)\\256) AND 255",
        "8004 POKE &8206,ra:CALL &8000:RETURN",
        '8100 FOR k=0 TO n-1:PRINT RIGHT$("0"+HEX$(PEEK(ad+k)),2);:NEXT:RETURN',
        data_lines(9000, list(code)),
    ]) + "\n"


def run_custom(body: str, model: str, timeout: float = 120, fill_stack: bool = False) -> str:
    return run_bas(prelude(fill_stack) + body, model, timeout)
