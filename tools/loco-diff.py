#!/usr/bin/env python3
"""loco-diff.py -- the Locomotive printer-diff harness (development tooling; never part of `npm test`).

Interpreted side (L2-HARNESS): run a CPC BASIC program under the real Locomotive BASIC in an
emulator and capture what it sends to the text screen, echoed on the emulated printer by a small
hook (tools/loco-harness/echo.asm; filter in lib/loco/txt.asm).

    python3 tools/loco-diff.py --interpret FILE.bas [--model 464|6128] [--emu cap32|cpcec]
                               [--bless] [--raw] [--keep DIR] [--timeout S]
    python3 tools/loco-diff.py --compiled FILE.bas [--model 464|6128] [--emu cap32|cpcec]
    python3 tools/loco-diff.py --all [--model M] [--emu E] [--programs a,b,...]
    ... --compiled / --all [--opt L]      build the compiled side at -O L (0 1 2 3 s); blessed files stay the interpreter's

Compiled side (L2-CONF): build FILE.bas with the built CLI (`-D __CPC_PRINTER_ECHO__ -o T.dsk`), run
the disc on the same emulator and model with the printer captured, normalise the capture with
`normalise`, and diff it with the blessed transcript (tests/loco/<name>.expected, or the per-model
file; int-compare-rev is blessed for the 6128 only and compared with that file on both models).
Exit 0 on a match, 3 on a difference (the first differing line and a unified diff are printed),
5 when the compiler rejects the program ("not compiled": E002 is a feature not merged yet), 2 a hang,
4 no END marker. --all does this for every program in blessed.json on both models (or --model) and
prints a table with timings; exit 0 only if every program passed, 3 if any differs, else 5/2/4/1.

Without --bless the normalised transcript is printed. With --bless the program runs twice on each
model (464 and 6128 unless --model is given); the runs must agree with each other, and the result
is written to tests/loco/<name>.expected when both models agree (the per-model files are removed)
or to tests/loco/<name>.<model>.expected when they differ (the shared file is removed). The
program, models, emulator and the hash of each transcript are recorded in tests/loco/blessed.json.

--unfiltered builds the hook without the filter (probes: what does PRINT send for a line end?).
--raw prints the capture as the printer received it (marker and all), as Python repr.

Normaliser (shared with L2-CONF, function `normalise`): line ends to \\n; the END marker and
anything after it removed; the trailing `Ready` removed; a lone missing final newline added;
a line that starts with `~` (a timing value) is reduced to `~`, so it is compared by presence only.

Real rule (`transcripts_match`, only for the programs tests/loco/compare.json lists under "real", and under
"real-exact" in a bare build (`--bare`); a firmware build is compared byte for byte for a "real-exact" program):
each line is split into numeric tokens (Locomotive number text: `-1.5`, `.03`, `1.23457E+12`) and
the text between them; the lines match when the text parts are identical and each pair of numbers
agrees to 8 significant digits (they differ by at most one unit in the 8th digit). Every other
program is compared byte for byte.

Program headers (L4-HARNESS; `parse_headers`; a numbered REM line anywhere in the program, read by the harness only):
    REM LOCO: shot                  also compare the screens (see below)
    REM LOCO: cap32                 run on Caprice32 (CPCEC's disc is write protected, so a program that writes a file needs it; L4-FILES)
    REM LOCO-TYPE: text|text|...    keys typed on both runs (Caprice32 only: CPCEC cannot type); every entry is followed by RETURN,
                                    on the schedule of run_emulator (the first after 4 delays, the rest after 1 each)
    REM LOCO-DISK: NAME=path        a file on the disc of both runs (AMSDOS 8.3 name, no header; path relative to the program)

Screens (`REM LOCO: shot`): besides the transcript, the interpreted and the compiled program each save the screen when the
program is over, on the same emulator and model, and the two PNGs must be equal pixel for pixel (a mismatch writes a diff image,
red where the pixels differ, to --keep DIR or the temp directory). The interpreter's hook is built with SHOT (echo.asm: the
interpreter's own "Ready" is held back and the run waits there), the compiled program is built without the printer echo (its END
waits for a key, so the screen stays), and the shot is taken --shot-wait seconds after the start (CPCEC: at the end of the run, so
the program must be over by then; Caprice32: CAP32_SCRNSHOT after that many delays). blessed.json keeps the sha256 of the interpreted
shot per model ("shot"); --bless runs it twice and refuses if the two differ. No transcript line is involved: a program that prints
nothing blesses an empty transcript. tests/loco/compare.json: "bare-skip" {name: reason} (programs left out of --bare),
"bare-stop" {name: {rows, error, reason}} (a bare run that ends in a documented error is compared for its first `rows` lines),
"compiled-skip" {name: reason} (a program the compiler rejects on purpose until a task merges; skipped while it is rejected).

Exit codes: 0 ok; 1 build problem; 2 a run hung; 3 compiled output differs; 4 no END marker;
5 two runs differ (bless refused) / the compiler rejected the program (--compiled, --all).

The disc: RUN.BAS (loader: MEMORY, LOAD the hook, CALL it, RUN "T.BAS"), ECHO.BIN, T.BAS (the
program as an ASCII file, no AMSDOS header). Caprice32 types run"RUN. Requires `npm run build`,
node, and cpcbuild's tools/cpcrun.py (--cpcbuild, default: beside the main checkout).
"""
import argparse
import difflib
import hashlib
import importlib.util
import json
import math
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import zlib
from dataclasses import dataclass, field
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CLI = REPO / "packages" / "cpcbas" / "dist" / "bin" / "cpcbas.js"
LOCO = REPO / "tests" / "loco"  # --loco-dir replaces it (tests)
END_MARKER = "\x04END\n"
MODELS = ("464", "6128")
OPT_LEVELS = ("0", "1", "2", "3", "s")
OPT: str | None = None  # --opt: the compiled side is built at this optimisation level (blessed files stay the interpreter's)


def default_sibling(name: str) -> Path:
    here = REPO
    if here.parent.name == ".worktrees":
        here = here.parent.parent
    return here.parent / name


def load_cpcrun(cpcbuild: Path):
    path = cpcbuild / "tools" / "cpcrun.py"
    if not path.is_file():
        sys.exit(f"loco-diff: {path} not found (use --cpcbuild)")
    spec = importlib.util.spec_from_file_location("cpcrun", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["cpcrun"] = mod
    spec.loader.exec_module(mod)
    return mod


def normalise(raw: str) -> str | None:
    """The comparable transcript of a capture, or None when there is no END marker."""
    if END_MARKER not in raw:
        return None
    text = raw.split(END_MARKER, 1)[0].replace("\r\n", "\n").replace("\r", "\n")
    if text.endswith("Ready"):
        text = text[: -len("Ready")]
    if text and not text.endswith("\n"):
        text += "\n"
    return "".join("~\n" if line.startswith("~") else line for line in text.splitlines(keepends=True))


NUMBER = re.compile(r"(-?(?:\d+\.?\d*|\.\d+)(?:E[+-]\d+)?)")
DUMP = re.compile(r" ?:[0-9A-F](?:\n?[0-9A-F]){9}")  # a five-byte dump; the screen may have wrapped it at column 40 (follow-up 68)
SIG_DIGITS = 8


def compare_rule(name: str, bare: bool = False) -> str:
    """The rule for a program (tests/loco/compare.json): 'real' (numbers to 8 significant digits) for a program listed
    under "real"; for one listed under "real-exact" (FWM-CORE) 'exact' in a firmware build, whose REAL maths are the
    interpreter's own (the firmware's), and 'real' in a bare build (the calculator's results agree to 8 digits); else 'exact'."""
    rules = load_rules()
    if name in rules.get("real", []):
        return "real"
    return "real" if bare and name in rules.get("real-exact", []) else "exact"


def numbers_agree(a: str, b: str, digits: int = SIG_DIGITS) -> bool:
    """True when two number texts are within one unit of their `digits`-th significant digit."""
    x, y = float(a), float(b)
    if x == y:
        return True
    big = max(abs(x), abs(y))
    return abs(x - y) <= 10.0 ** (math.floor(math.log10(big)) - digits + 1) * (1 + 1e-12)


def lines_match(want: str, got: str, rule: str) -> bool:
    """One line under `rule` ('exact' or 'real')."""
    if rule == "exact" or want == got:
        return want == got
    w, g = NUMBER.split(want), NUMBER.split(got)
    if len(w) != len(g):
        return False
    # split with a group: text, number, text, ..., text
    return all(a == b if i % 2 == 0 else numbers_agree(a, b) for i, (a, b) in enumerate(zip(w, g)))


def transcripts_match(want: str, got: str, rule: str = "exact") -> bool:
    """Whole transcripts: the same lines (and final newline), each matching under `rule`."""
    if rule == "exact":
        return want == got
    w, g = want.split("\n"), got.split("\n")
    return len(w) == len(g) and all(lines_match(a, b, rule) for a, b in zip(w, g))


HEADER = re.compile(r"^\s*(?:\d+\s*)?(?:REM|')\s*LOCO(-TYPE|-DISK)?\s*:(.*)$", re.IGNORECASE)
AMSDOS_NAME = re.compile(r"^[A-Z0-9_$!#@%()\-{}~']{1,8}(\.[A-Z0-9_$!#@%()\-{}~']{0,3})?$")


class HeaderError(Exception):
    pass


@dataclass
class Headers:
    shot: bool = False
    cap32: bool = False
    typed: list[str] = field(default_factory=list)
    disk: list[tuple[str, Path]] = field(default_factory=list)


def parse_headers(text: str, base: Path | None = None) -> Headers:
    """The harness headers of a program (REM LOCO: shot, REM LOCO-TYPE: a|b, REM LOCO-DISK: NAME=path), in program order.
    Disc paths are relative to `base` (the program's directory). Raises HeaderError for an unknown flag or a bad name."""
    h = Headers()
    for line in text.splitlines():
        m = HEADER.match(line)
        if not m:
            continue
        kind, value = (m.group(1) or "").upper(), m.group(2).lstrip(" \t")
        if kind == "":
            for flag in re.split(r"[,\s]+", value.strip()):
                if flag.lower() == "shot":
                    h.shot = True
                elif flag.lower() == "cap32":
                    h.cap32 = True
                elif flag:
                    raise HeaderError(f"REM LOCO: unknown flag {flag!r} (only 'shot' and 'cap32')")
        elif kind == "-TYPE":
            h.typed += value.rstrip("\r\n").split("|")
        else:
            name, eq, path = value.strip().partition("=")
            name = name.strip().upper()
            if not eq or not path.strip() or not AMSDOS_NAME.match(name):
                raise HeaderError(f"REM LOCO-DISK: {value.strip()!r} is not NAME=path with an AMSDOS 8.3 name")
            p = Path(path.strip())
            h.disk.append((name, p if p.is_absolute() or base is None else base / p))
    return h


def headers_of(bas: Path) -> Headers:
    try:
        return parse_headers(bas.read_text(encoding="latin-1"), bas.parent)
    except HeaderError as exc:
        sys.exit(f"loco-diff: {bas.name}: {exc}")


# ---- screenshots: a small PNG reader and writer (stdlib only), and the pixel comparison

def read_png(data: bytes) -> tuple[int, int, list[bytes]]:
    """(width, height, rows of RGB bytes) of an 8-bit PNG (greyscale, RGB, palette, grey+alpha or RGBA; not interlaced)."""
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    pos, idat, plte, hdr = 8, b"", b"", None
    while pos + 8 <= len(data):
        n, kind = struct.unpack(">I4s", data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + n]
        pos += 12 + n
        if kind == b"IHDR":
            hdr = struct.unpack(">IIBBBBB", body)
        elif kind == b"PLTE":
            plte = body
        elif kind == b"IDAT":
            idat += body
        elif kind == b"IEND":
            break
    if hdr is None:
        raise ValueError("PNG without IHDR")
    w, h, depth, ctype, _, _, interlace = hdr
    if depth != 8 or interlace != 0 or ctype not in (0, 2, 3, 4, 6):
        raise ValueError(f"unsupported PNG (depth {depth}, colour type {ctype}, interlace {interlace})")
    bpp = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ctype]
    raw = zlib.decompress(idat)
    stride = w * bpp
    rows: list[bytes] = []
    prev = bytearray(stride)
    for y in range(h):
        ft = raw[y * (stride + 1)]
        line = bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        for i in range(stride):
            a = line[i - bpp] if i >= bpp else 0
            b = prev[i]
            c = prev[i - bpp] if i >= bpp else 0
            if ft == 1:
                line[i] = (line[i] + a) & 255
            elif ft == 2:
                line[i] = (line[i] + b) & 255
            elif ft == 3:
                line[i] = (line[i] + ((a + b) >> 1)) & 255
            elif ft == 4:
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
            elif ft != 0:
                raise ValueError(f"bad PNG filter {ft}")
        prev = line
        if ctype == 2:
            rows.append(bytes(line))
        elif ctype == 6:
            rows.append(bytes(v for i in range(w) for v in line[i * 4:i * 4 + 3]))
        elif ctype == 3:
            rows.append(bytes(v for px in line for v in plte[px * 3:px * 3 + 3]))
        else:
            rows.append(bytes(v for i in range(w) for v in (line[i * bpp],) * 3))
    return w, h, rows


def write_png(w: int, h: int, rows: list[bytes]) -> bytes:
    """An RGB PNG from rows of RGB bytes."""
    def chunk(kind: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))
    raw = b"".join(b"\x00" + r for r in rows)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


def compare_shots(want: bytes, got: bytes) -> tuple[bool, str, bytes | None]:
    """Pixel-for-pixel comparison of two PNGs: (equal, detail, diff image). The diff image (a PNG) shows the pixels of `want`
    dimmed to a quarter and every differing pixel in red; None when equal. A size mismatch has no diff image."""
    w1, h1, a = read_png(want)
    w2, h2, b = read_png(got)
    if (w1, h1) != (w2, h2):
        return False, f"sizes differ: {w1}x{h1} against {w2}x{h2}", None
    out, count, first = [], 0, None
    for y in range(h1):
        if a[y] == b[y]:
            out.append(bytes(v >> 2 for v in a[y]))
            continue
        row = bytearray(v >> 2 for v in a[y])
        for x in range(w1):
            if a[y][x * 3:x * 3 + 3] != b[y][x * 3:x * 3 + 3]:
                row[x * 3:x * 3 + 3] = b"\xff\x00\x00"
                count += 1
                if first is None:
                    first = (x, y)
        out.append(bytes(row))
    if count == 0:
        return True, "", None
    return False, f"{count} pixels differ (first at x={first[0]}, y={first[1]} of {w1}x{h1})", write_png(w1, h1, out)


def load_rules() -> dict:
    path = LOCO / "compare.json"
    return json.loads(path.read_text()) if path.is_file() else {}


def bare_skip_reason(name: str) -> str | None:
    """tests/loco/compare.json "bare-skip": why a program is left out of a --bare run."""
    return load_rules().get("bare-skip", {}).get(name)


def bare_stop(name: str) -> dict | None:
    """tests/loco/compare.json "bare-stop": a program whose bare run ends in a documented runtime error ({rows, error, reason})."""
    return load_rules().get("bare-stop", {}).get(name)


def compiled_skip_reason(name: str) -> str | None:
    """tests/loco/compare.json "compiled-skip": why the compiler rejecting a program is expected for now."""
    return load_rules().get("compiled-skip", {}).get(name)


def bare_stop_text(seen: str, stop: dict) -> str | None:
    """The transcript of a bare run that stopped on its documented error (the capture has no END marker): the text before the
    error, ending in a newline, or None when the error never appeared."""
    at = seen.rfind(stop["error"])
    if at < 0:
        return None
    return seen[:at].replace("\r\n", "\n").replace("\r", "\n").rstrip("\n") + "\n"


class RunFailure(Exception):
    def __init__(self, code: int, message: str, seen: str | None = None):
        super().__init__(message)
        self.code = code
        self.seen = seen  # what the printer had received (a hang), when known



def pick_emu(emu: str | None, headers: "Headers") -> str:
    """The emulator of a run: the one given, else CPCEC (fast), or Caprice32 for a program with REM LOCO-TYPE (CPCEC cannot
    type) or REM LOCO: cap32 (CPCEC cannot write to a disc). R13 decision."""
    return emu or ("cap32" if headers.typed or headers.cap32 else "cpcec")


SHOT_WAIT = 20.0  # seconds after the start at which the screen is taken (CPCEC: emulated seconds; Caprice32: about one second per delay)


def emulate(cpcrun, emu: str, dsk: Path, stem: str, model: str, timeout: float, printer: Path, env: dict, *,
            typed: list[str] | None = None, end_on_marker: bool = False, shot: Path | None = None,
            shot_wait: float = SHOT_WAIT) -> None:
    """One emulator run of a disc; the printer capture goes to `printer`. With `shot` (a PNG path) the run is a screenshot run:
    it ends `shot_wait` seconds after the start with the screen saved there (CPCEC: its end-of-run grab, Caprice32: a
    CAP32_SCRNSHOT after that many delays). `typed` needs Caprice32 (CPCEC cannot type). Raises RunFailure for a hang."""
    if typed and emu == "cpcec":
        raise RunFailure(1, "REM LOCO-TYPE needs --emu cap32 (CPCEC has no typed input)")
    try:
        if shot is not None:
            if emu == "cpcec":
                try:
                    cpcrun.run_cpcec(dsk, printer, shot_wait, env, model, shot=shot)
                except cpcrun.TimeoutHit:
                    pass  # the shot run ends at its frame limit: that is how it stops
            else:
                sd = shot.parent / (shot.name + ".d")
                shutil.rmtree(sd, ignore_errors=True)
                sd.mkdir(parents=True)
                cpcrun.run_emulator(dsk, stem, printer, shot_wait * 4 + 60, env, model, typed=typed, shot_dir=sd,
                                    shot_wait=max(1, round(shot_wait)))
                pngs = sorted(sd.glob("*.png"))
                if pngs:
                    shutil.move(str(pngs[-1]), shot)
                shutil.rmtree(sd, ignore_errors=True)
            if not shot.is_file():
                raise RunFailure(1, f"{model}: the emulator saved no screenshot")
        elif emu == "cpcec":
            cpcrun.run_cpcec(dsk, printer, timeout, env, model)
        else:
            cpcrun.run_emulator(dsk, stem, printer, timeout, env, model, typed=typed, end_on_marker=end_on_marker)
    except cpcrun.TimeoutHit:
        seen = printer.read_bytes().decode("latin-1") if printer.exists() else ""
        raise RunFailure(2, f"{model}: timeout after {timeout}s (no Ready or END: an infinite loop, or an error that opens "
                            f"the line editor); printed so far: {seen!r}", seen) from None
    except cpcrun.BuildError as exc:
        raise RunFailure(1, f"{model}: {exc}") from None


def interpret(cpcrun, bas: Path, model: str, emu: str, timeout: float, keep: Path | None,
              unfiltered: bool = False, headers: Headers | None = None, shot: Path | None = None,
              shot_wait: float = SHOT_WAIT) -> str:
    """Run bas under the interpreter and return the raw printer capture. The program's headers (typed keys, disc files)
    apply; with `shot` the run is a screenshot run (the hook holds back "Ready") and the PNG is saved there."""
    env = cpcrun.subprocess_env()
    headers = headers if headers is not None else headers_of(bas)
    emu = pick_emu(emu, headers)
    tmp = Path(tempfile.mkdtemp(prefix="loco-diff-"))
    try:
        dsk, printer = tmp / "loco.dsk", tmp / "printer.dat"
        cmd = ["node", str(REPO / "tools" / "loco-harness" / "build.mjs"), "--bas", str(bas), "--dsk", str(dsk)]
        cmd += ["--unfiltered"] if unfiltered else []
        cmd += ["--shot"] if shot is not None else []
        for name, path in headers.disk:
            cmd += ["--file", f"{name}={path}"]
        p = subprocess.run(cmd, capture_output=True, text=True)
        sys.stderr.write(p.stderr)
        if p.returncode != 0:
            raise RunFailure(1, "disc build failed (npm run build first?)")
        emulate(cpcrun, emu, dsk, "RUN", model, timeout, printer, env, typed=headers.typed, end_on_marker=True, shot=shot,
                shot_wait=shot_wait)
        raw = printer.read_bytes().decode("latin-1") if printer.exists() else ""
        if keep:
            keep.mkdir(parents=True, exist_ok=True)
            shutil.copy(dsk, keep / f"{bas.stem}.{model}.{'shot.' if shot else ''}dsk")
            (keep / f"{bas.stem}.{model}.raw").write_bytes(raw.encode("latin-1"))
        return raw
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


class NotCompiled(Exception):
    """The compiler rejected the program (cpcbas exit code other than 0)."""


def blessed_record(name: str) -> dict:
    return json.loads((LOCO / "blessed.json").read_text())[name]


def expected_for(name: str, model: str) -> str:
    """The blessed transcript for a program on a model (the shared file, else the per-model one,
    else any blessed one: a program blessed for one model is compared with it on both)."""
    rec = blessed_record(name)["files"]
    file = rec.get("all") or rec.get(model) or next(iter(rec.values()))
    return (LOCO / file).read_text(encoding="latin-1")


def build_compiled(cpcrun, bas: Path, tmp: Path, bare: bool = False, echo: bool = True,
                   headers: Headers | None = None, opt: str | None = None) -> tuple[Path, str]:
    """Build bas with the cpcbas CLI into tmp; returns (dsk, AMSDOS stem to run). The source is
    copied to an 8-character alphanumeric name first so the program on the disc has a name the
    emulator can type (cpcrun.amsdos_stem). `echo` False (the screenshot build) leaves out the printer echo, so that END
    waits for a key and the screen stays. The program's REM LOCO-DISK files go on the disc (--dsk-add)."""
    headers = headers if headers is not None else headers_of(bas)
    stem = cpcrun.amsdos_stem(bas)
    src = tmp / f"{stem}.bas"
    shutil.copy(bas, src)
    dsk = tmp / f"{stem}{'' if echo else '-shot'}.dsk"
    cmd = ["node", str(CLI), str(src)] + (["-D", "__CPC_PRINTER_ECHO__"] if echo else []) + ["-o", str(dsk)]
    cmd += ["-D", "CPC_BAREMETAL"] if bare else []
    level = opt if opt is not None else OPT
    cmd += ["-O", level] if level is not None else []
    for name, path in headers.disk:
        cmd += ["--dsk-add", f"{name}={path}"]
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0 or not dsk.is_file():
        raise NotCompiled((p.stderr + p.stdout).strip() or f"cpcbas exit {p.returncode}")
    return dsk, stem


def run_compiled(cpcrun, dsk: Path, stem: str, model: str, emu: str, timeout: float, tmp: Path,
                 typed: list[str] | None = None, shot: Path | None = None, shot_wait: float = SHOT_WAIT,
                 marker: bool = False) -> str:
    """Run a built disc and return the raw printer capture (with `shot`, a screenshot run that saves the PNG there)."""
    printer = tmp / f"printer-{model}.dat"
    emulate(cpcrun, emu, dsk, stem, model, timeout, printer, cpcrun.subprocess_env(), typed=typed, end_on_marker=(bool(typed) or marker) and shot is None, shot=shot, shot_wait=shot_wait)  # a typed run has no other way to stop; a program that wrote a disc file (REM LOCO: cap32) does not reach Caprice32's address-0 breakpoint
    return printer.read_bytes().decode("latin-1") if printer.exists() else ""


def first_difference(want: str, got: str, rule: str = "exact") -> str:
    """'line N: expected <...> got <...>' for the first differing line (under `rule`)."""
    w, g = want.splitlines(), got.splitlines()
    for i in range(max(len(w), len(g))):
        a = w[i] if i < len(w) else "<end of transcript>"
        b = g[i] if i < len(g) else "<end of transcript>"
        if not lines_match(a, b, rule):
            return f"line {i + 1}: expected {a!r}, got {b!r}"
    return "transcripts differ only in the final newline"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def shot_check(cpcrun, bas: Path, model: str, emu: str, timeout: float, tmp: Path, headers: Headers, bare: bool,
               shot_wait: float, out_dir: Path) -> tuple[str, str, str]:
    """The screen comparison of a program with `REM LOCO: shot` on one model: (status, detail, diff). The interpreter's shot
    is checked against the blessed sha256 (the emulator did not drift) and compared pixel for pixel with the compiled one."""
    name = bas.stem
    rec = blessed_record(name)
    want_sha = rec.get("shot", {}).get(model)
    if want_sha is None:
        return "fail", f"no blessed shot sha256 for {model} (run --bless)", ""
    # the sha256 is of one emulator's PNG: another emulator's shot has other colours (and size), so it is not checked there
    check_sha = rec.get("emulator") == ("Caprice32" if emu == "cap32" else "CPCEC")
    ishot, cshot = tmp / f"interp-{model}.png", tmp / f"compiled-{model}.png"
    interpret(cpcrun, bas, model, emu, timeout, None, headers=headers, shot=ishot, shot_wait=shot_wait)
    dsk, stem = build_compiled(cpcrun, bas, tmp, bare, echo=False, headers=headers)
    run_compiled(cpcrun, dsk, stem, model, emu, timeout, tmp, headers.typed, shot=cshot, shot_wait=shot_wait)
    notes = []
    if check_sha and sha256(ishot.read_bytes()) != want_sha:
        notes.append(f"the interpreted shot is not the blessed one (sha256 {sha256(ishot.read_bytes())}, blessed {want_sha})")
    equal, detail, diff = compare_shots(ishot.read_bytes(), cshot.read_bytes())
    diff_text = ""
    if not equal:
        out_dir.mkdir(parents=True, exist_ok=True)
        for tag, src in (("interpreted", ishot), ("compiled", cshot)):
            shutil.copy(src, out_dir / f"{name}.{model}.{tag}.png")
        if diff is not None:
            (out_dir / f"{name}.{model}.diff.png").write_bytes(diff)
            diff_text = f"diff image: {out_dir / f'{name}.{model}.diff.png'}"
        notes.append(f"shot: {detail}")
    return ("fail", "; ".join(notes), diff_text) if notes else ("pass", "", "")


def compare_compiled(cpcrun, bas: Path, models: list[str], emu: str, timeout: float, keep: Path | None,
                     quiet: bool = False, bare: bool = False, shot_wait: float = SHOT_WAIT) -> dict[str, dict]:
    """Build once, run on each model; returns {model: {status, seconds, detail, diff}} with status
    pass | fail | not-compiled | hang | no-marker | error."""
    name = bas.stem
    headers = headers_of(bas)
    emu = pick_emu(emu, headers)
    tmp = Path(tempfile.mkdtemp(prefix="loco-compiled-"))
    out: dict[str, dict] = {}
    stop = bare_stop(name) if bare else None
    try:
        try:
            dsk, stem = build_compiled(cpcrun, bas, tmp, bare, headers=headers)
        except NotCompiled as exc:
            first = next((l for l in str(exc).splitlines() if "error" in l), str(exc).splitlines()[0] if str(exc) else "")
            return {m: {"status": "not-compiled", "seconds": 0.0, "detail": first, "diff": "", "emu": emu} for m in models}
        for model in models:
            t0 = time.monotonic()
            res = {"status": "pass", "seconds": 0.0, "detail": "", "diff": "", "emu": emu}
            try:
                raw = ""
                try:
                    raw = run_compiled(cpcrun, dsk, stem, model, emu, min(timeout, stop.get("timeout", timeout)) if stop else timeout,
                                       tmp, headers.typed, marker=headers.cap32)
                except RunFailure as exc:
                    # a bare run that ends in its documented error prints the error and never the END marker
                    stopped = bare_stop_text(exc.seen or "", stop) if stop and exc.code == 2 else None
                    if stopped is None:
                        raise
                    want = DUMP.sub("", "".join(expected_for(name, model).splitlines(keepends=True)[: stop["rows"]]))
                    text = DUMP.sub("", stopped)
                    if len(stopped.splitlines()) != stop["rows"] or not transcripts_match(want, text, "real"):
                        res.update(status="fail", detail=f"bare stop: first {stop['rows']} lines: "
                                   + first_difference(want, text, "real"))
                    else:
                        res["detail"] = f"first {stop['rows']} lines match, then {stop['error']} ({stop['reason']})"
                    raw = None
                if raw is not None:
                    if keep:
                        keep.mkdir(parents=True, exist_ok=True)
                        shutil.copy(dsk, keep / f"{name}.{model}.dsk")
                        (keep / f"{name}.{model}.raw").write_bytes(raw.encode("latin-1"))
                    text = normalise(raw)
                    if text is None:
                        res.update(status="no-marker", detail=f"no END marker; capture {raw!r}")
                    else:
                        want = expected_for(name, model)
                        rule = compare_rule(name, bare)
                        if bare and rule == "real":
                            # the calculator's results are not the firmware's bit for bit: the five-byte dumps of the
                            # "real-exact" programs (" :ABAAAA2A7F") are left out, the numbers agree to 8 digits
                            want, text = DUMP.sub("", want), DUMP.sub("", text)
                        if not transcripts_match(want, text, rule):
                            res.update(status="fail", detail=first_difference(want, text, rule),
                                       diff="".join(difflib.unified_diff(want.splitlines(keepends=True),
                                                                          text.splitlines(keepends=True),
                                                                          f"{name}.expected", f"compiled-{model}")))
                if headers.shot and res["status"] == "pass":
                    status, detail, diff = shot_check(cpcrun, bas, model, emu, timeout, tmp, headers, bare, shot_wait,
                                                      keep or Path(tempfile.gettempdir()) / "loco-diff-shots")
                    if status != "pass":
                        res.update(status=status, detail=detail, diff=diff)
            except NotCompiled as exc:
                res.update(status="not-compiled", detail=str(exc).splitlines()[0] if str(exc) else "")
            except RunFailure as exc:
                res.update(status="hang" if exc.code == 2 else "error", detail=str(exc))
            res["seconds"] = time.monotonic() - t0
            out[model] = res
        return out
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


STATUS_CODE = {"pass": 0, "skipped": 0, "fail": 3, "not-compiled": 5, "hang": 2, "no-marker": 4, "error": 1}


def worst_code(results: list[str]) -> int:
    """Exit code for a set of statuses: 0 all passed (or skipped on purpose); else a difference (3) outranks the rest."""
    bad = [s for s in results if s not in ("pass", "skipped")]
    if not bad:
        return 0
    return 3 if "fail" in bad else max(STATUS_CODE[s] for s in bad)


def compiled_one(cpcrun, bas: Path, models: list[str], emu: str, timeout: float, keep: Path | None, bare: bool = False,
                 shot_wait: float = SHOT_WAIT) -> int:
    results = compare_compiled(cpcrun, bas, models, emu, timeout, keep, bare=bare, shot_wait=shot_wait)
    for model, r in results.items():
        print(f"{bas.stem} {model} ({r.get('emu', emu)}): {r['status'].upper()} in {r['seconds']:.1f}s" + (f"  {r['detail']}" if r["detail"] else ""))
        if r["diff"]:
            sys.stdout.write(r["diff"] if r["diff"].endswith("\n") else r["diff"] + "\n")
    return worst_code([r["status"] for r in results.values()])


def run_all(cpcrun, models: list[str], emu: str, timeout: float, keep: Path | None, only: list[str] | None,
            bare: bool = False, shot_wait: float = SHOT_WAIT) -> int:
    names = sorted(json.loads((LOCO / "blessed.json").read_text()))
    if only:
        names = [n for n in names if n in only]
    rows, statuses, diffs, skips = [], [], [], []
    t_all = time.monotonic()
    for name in names:
        reason = bare_skip_reason(name) if bare else None
        if reason is not None:
            results = {m: {"status": "skipped", "seconds": 0.0, "detail": f"bare-skip: {reason}", "diff": ""} for m in models}
            skips.append((name, f"bare-skip: {reason}"))
        else:
            results = compare_compiled(cpcrun, LOCO / f"{name}.bas", models, emu, timeout, keep, bare=bare, shot_wait=shot_wait)
            why = compiled_skip_reason(name)
            if why is not None:
                for r in results.values():
                    if r["status"] == "not-compiled":
                        r.update(status="skipped", detail=f"compiled-skip: {why}")
                if all(r["status"] == "skipped" for r in results.values()):
                    skips.append((name, f"compiled-skip: {why}"))
                elif any(r["status"] != "skipped" for r in results.values()):
                    print(f"  note: {name} is in compiled-skip but compiles now: remove it", file=sys.stderr)
        for model in models:
            r = results[model]
            statuses.append(r["status"])
            rows.append((name, model, r.get("emu", emu or "-"), r["status"], r["seconds"], r["detail"]))
            if r["diff"]:
                diffs.append((name, model, r["diff"]))
            print(f"  {name} {model}: {r['status']} ({r['seconds']:.1f}s)", file=sys.stderr, flush=True)
    w = max(len(n) for n, *_ in rows)
    if skips:
        print("skipped on purpose (tests/loco/compare.json):")
        for name, why in skips:
            print(f"  {name}: {why}")
    print(f"{'program'.ljust(w)}  model  emu     result        time   first differing line / note")
    for name, model, e, status, secs, detail in rows:
        print(f"{name.ljust(w)}  {model.ljust(5)}  {e.ljust(6)}  {status.ljust(12)}  {secs:5.1f}s  {detail}")
    npass, nskip = statuses.count("pass"), statuses.count("skipped")
    ran = len(statuses) - nskip
    print(f"{npass}/{ran} passed, {statuses.count('fail')} differ, {statuses.count('not-compiled')} not compiled, "
          f"{ran - npass - statuses.count('fail') - statuses.count('not-compiled')} other, {nskip} skipped on purpose; "
          f"total {time.monotonic() - t_all:.0f}s")
    for name, model, diff in diffs:
        print(f"\n--- {name} {model}\n{diff}", end="")
    return worst_code(statuses)


def bless(cpcrun, bas: Path, models: list[str], emu: str, timeout: float, keep: Path | None,
          shot_wait: float = SHOT_WAIT) -> int:
    name = bas.stem
    headers = headers_of(bas)
    emu = pick_emu(emu, headers)
    results: dict[str, str] = {}
    shots: dict[str, str] = {}
    for model in models:
        texts = []
        for attempt in (1, 2):
            raw = interpret(cpcrun, bas, model, emu, timeout, keep, headers=headers)
            text = normalise(raw)
            if text is None:
                print(f"{name} {model}: no END marker; capture {raw!r}", file=sys.stderr)
                return 4
            texts.append(text)
        if texts[0] != texts[1]:
            print(f"{name} {model}: two runs differ (not deterministic); nothing blessed\n--- run 1\n{texts[0]}--- run 2\n{texts[1]}",
                  file=sys.stderr)
            return 5
        results[model] = texts[0]
        if headers.shot:
            png = []
            with tempfile.TemporaryDirectory(prefix="loco-shot-") as d:
                for attempt in (1, 2):
                    out = Path(d) / f"s{attempt}.png"
                    interpret(cpcrun, bas, model, emu, timeout, keep, headers=headers, shot=out, shot_wait=shot_wait)
                    png.append(out.read_bytes())
            if png[0] != png[1]:
                equal, detail, _ = compare_shots(png[0], png[1])
                print(f"{name} {model}: two screenshots differ ({detail or 'same pixels, different file'}); nothing blessed", file=sys.stderr)
                return 5
            shots[model] = sha256(png[0])
    LOCO.mkdir(parents=True, exist_ok=True)
    shared = LOCO / f"{name}.expected"
    per = {m: LOCO / f"{name}.{m}.expected" for m in MODELS}
    if len(models) == len(MODELS) and len(set(results.values())) == 1:
        shared.write_bytes(results[models[0]].encode("latin-1"))
        for f in per.values():
            f.unlink(missing_ok=True)
        written = {"all": shared}
    else:
        if len(models) < len(MODELS):
            print(f"{name}: blessed for {models} only (per-model file)", file=sys.stderr)
        shared.unlink(missing_ok=True)
        for m, text in results.items():
            per[m].write_bytes(text.encode("latin-1"))
        written = {m: per[m] for m in results}
    record_blessing(name, bas, written, results, emu, shots)
    for key, path in written.items():
        print(f"blessed {name} ({key}) -> {path.relative_to(REPO) if path.is_relative_to(REPO) else path}")
    for m, sha in shots.items():
        print(f"blessed {name} shot ({m}) sha256 {sha}")
    return 0


def record_blessing(name: str, bas: Path, written: dict, results: dict, emu: str, shots: dict | None = None) -> None:
    db = LOCO / "blessed.json"
    data = json.loads(db.read_text()) if db.exists() else {}
    data[name] = {
        "program": f"{name}.bas",
        "emulator": "Caprice32" if emu == "cap32" else "CPCEC",
        "files": {key: path.name for key, path in sorted(written.items())},
        "sha256": {m: hashlib.sha256(t.encode("latin-1")).hexdigest() for m, t in sorted(results.items())},
    }
    if shots:
        data[name]["shot"] = dict(sorted(shots.items()))  # sha256 of the interpreted screenshot (PNG file) per model
    if compare_rule(name) != "exact":
        data[name]["compare"] = compare_rule(name)  # tests/loco/compare.json: compared with that rule
    db.write_text(json.dumps(dict(sorted(data.items())), indent=2) + "\n")


def main() -> int:
    global LOCO, OPT
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--interpret", type=Path, metavar="FILE.bas")
    ap.add_argument("--compiled", type=Path, metavar="FILE.bas", help="build with cpcbas, run, diff with the blessed transcript")
    ap.add_argument("--all", action="store_true", help="--compiled for every program in blessed.json, both models, with a table")
    ap.add_argument("--programs", help="with --all: comma-separated program names")
    ap.add_argument("--model", choices=MODELS + ("664", "plus"),
                    help="664 and plus are for CPCEC only, not for --bless (FWM-0 probes, FWM-CORE's check of the 664 and Plus tables)")
    ap.add_argument("--emu", choices=["cap32", "cpcec"], default=None,
                    help="default: CPCEC, or Caprice32 for a program with REM LOCO-TYPE (CPCEC cannot type)")
    ap.add_argument("--bless", action="store_true")
    ap.add_argument("--raw", action="store_true")
    ap.add_argument("--unfiltered", action="store_true",
                    help="probe hook that echoes every byte untouched (13, 10 and control codes too); implies --raw")
    ap.add_argument("--timeout", type=float, default=120,
                    help="seconds of emulated time per run (120: real-fn needs more than 30 since FWM-CORE)")
    ap.add_argument("--keep", type=Path)
    ap.add_argument("--shot", type=Path, metavar="FILE.png",
                    help="with --interpret (no --bless): also save the interpreted screen (shot build of the hook) to FILE.png")
    ap.add_argument("--shot-wait", type=float, default=SHOT_WAIT, metavar="S",
                    help=f"screenshot runs: seconds after the start at which the screen is taken (default {SHOT_WAIT:g}; the program must be over)")
    ap.add_argument("--bare", action="store_true",
                    help="with --compiled/--all: build with -D CPC_BAREMETAL; the \"real-exact\" programs are then compared to 8 digits")
    ap.add_argument("--loco-dir", type=Path, help="use this directory instead of tests/loco (blessed.json, compare.json, programs)")
    ap.add_argument("--cpcbuild", type=Path, default=default_sibling("cpcbuild"))
    ap.add_argument("--opt", choices=OPT_LEVELS, default=None, metavar="L",
                    help="build the compiled side at optimisation level L (0, 1, 2, 3 or s): `-O L`; the expected files stay the "
                         "interpreter's, so an optimiser can never bless its own output")
    args = ap.parse_args()
    OPT = args.opt
    if args.loco_dir:
        LOCO = args.loco_dir.resolve()
    if not (args.interpret or args.compiled or args.all):
        ap.error("give --interpret FILE.bas, --compiled FILE.bas or --all")
    cpcrun = load_cpcrun(args.cpcbuild.resolve())
    if args.model in ("664", "plus") and not (not args.bless and args.emu in (None, "cpcec")):
        ap.error("--model 664/plus: only --emu cpcec, without --bless (--interpret, --compiled or --all; the transcript compared "
                 "with is the 464/6128 one: the maths give the same results on all four models)")
    if args.compiled or args.all:
        if not CLI.is_file():
            print("loco-diff: the CLI is not built (npm run build)", file=sys.stderr)
            return 1
        models = [args.model] if args.model else list(MODELS)
        if args.all:
            return run_all(cpcrun, models, args.emu, args.timeout, args.keep, args.programs.split(",") if args.programs else None,
                           args.bare, args.shot_wait)
        return compiled_one(cpcrun, args.compiled.resolve(), models, args.emu, args.timeout, args.keep, args.bare, args.shot_wait)
    bas = args.interpret.resolve()
    try:
        if args.bless:
            return bless(cpcrun, bas, [args.model] if args.model else list(MODELS), args.emu, args.timeout, args.keep, args.shot_wait)
        if args.shot:
            interpret(cpcrun, bas, args.model or "6128", args.emu, args.timeout, args.keep, shot=args.shot.resolve(),
                      shot_wait=args.shot_wait)
            print(f"screenshot: {args.shot}")
            return 0
        raw = interpret(cpcrun, bas, args.model or "6128", args.emu, args.timeout, args.keep,
                        args.unfiltered)
    except RunFailure as exc:
        print(f"loco-diff: {exc}", file=sys.stderr)
        return exc.code
    if args.raw or args.unfiltered:
        print(repr(raw))
        return 0
    text = normalise(raw)
    if text is None:
        print(f"loco-diff: no END marker; capture {raw!r}", file=sys.stderr)
        return 4
    sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
