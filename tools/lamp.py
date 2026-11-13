#!/usr/bin/env python3
"""lamp.py -- Lamplighter on cpcbas: the builds, the emulator tests, the benchmark (L4-LAMP; development tooling,
never part of `npm test`; Python is for development only, the product is the TypeScript compiler).

  lamp.py build [--out DIR]       the four builds and the discs and cartridge, with the memory checks
  lamp.py [test] [-k PAT]         chipsrun, 464 and 6128 (firmware): logic, playthrough, the -D LAMP_BASIC twins,
                                  the 12 rooms and 5 scenes against golden/<model>, the sound switches, AUTOPLAY
  lamp.py [test] --plus           Caprice32 and CPCEC as a 6128 Plus, disc (the RUN"PLUS loader) and cartridge:
                                  logic, playthrough, plus_layer, the shots against golden/plus-<emu>, AUTOPLAY
  lamp.py bench [--plus] [--fork] -D BENCH steps per second with cpcbas; --fork adds the fork's rows as recorded history
                                  (tools/lamp-fork-rows.json: the last figures measured, no fork build)
  --opt L                         on every subcommand (L5-MEASURE): build cpcbas at optimiser level L (0, 1, 2, 3 or s: the
                                  CLI's -O L). The fork's recorded rows were built at its default, -O2.

The program is built by the built cpcbas CLI (`npm run build` first); the emulators and cpcbuild's tools/cpcrun.py
(read only) are found next to this checkout (../cpcbuild; --cpcbuild DIR or $CPCBUILD says otherwise).

The tests, as cpcbuild's tests/run.py and run_plus.py ran them for the fork:
  logic.bas and playthrough.bas   the game logic and the whole tower on the null platform layer (every PASS, no FAIL,
                  DONE); on 464 also with -D LAMP_BASIC (game.bas's plain BASIC versions of its assembly routines)
  screenshots     each of the 12 rooms in its entry state (-D START_ROOM=n -D SHOT=3) and five scenes, pixel for pixel
                  against the goldens copied from cpcbuild (768x272 on chipsrun, the Plus emulators' own sizes);
                  the sound switches (-D NOMUSIC, NOSFX, NOSOUND) change no pixel
  AUTOPLAY        the real platform layer (drawing, sprites, music, effects) plays the whole tower with the recorded
                  input; the title is passed by a key typed through the emulator (chipsrun --type, Caprice32's
                  autotype; CPCEC cannot type: -D AUTOPLAY_NOKEY there). The PASS lines, and a final screenshot against
                  golden/<target>/autoplay.png (blessed once from a real run: --bless-autoplay)
  plus_layer.bas  the Plus layer's hardware sprites read back from the ASIC (disc: a smaller heap above the program,
                  no loader: the program ends above the loader's buffer)
Exit status 0 when everything passed.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
GAME = REPO / "tests" / "games" / "lamplighter"
TESTS = GAME / "tests"
GOLDEN = TESTS / "golden"
CLI = REPO / "packages" / "cpcbas" / "dist" / "bin" / "cpcbas.js"
ORG = 0x40
ORG_ARG = "0x40"

# memory limits
HEAP_TOP = 0x9E00                       # firmware builds: the heap ends here
HEAP_SIZE = 4768                        # the default heap
HEAP_START = HEAP_TOP - HEAP_SIZE       # &8B60
LOADER_ORG = 0x9E00                     # RUN"PLUS (question 4)
AMSDOS_BUFFER = 0x9600                  # the 2 KB AMSDOS buffer below the loader
BARE_LIMIT = 0xB800

BARE = ["CPC_BAREMETAL", "CPC_OWNFONT"]
ROOMS = range(12)
SCENES = {
    "lit09": ["SHOT=3", "SHOT_LIT", "START_ROOM=9"],
    "lit10": ["SHOT=3", "SHOT_LIT", "START_ROOM=10"],
    "climb": ["SHOT=3", "SHOT_CLIMB", "START_ROOM=10"],
    "walk": ["SHOT=14", "SHOT_WALK", "START_ROOM=9"],
    "title": ["SHOT=1", "SHOT_TITLE"],
}
PLUS_SCENES = dict(SCENES, lit09b=["SHOT=7", "SHOT_LIT", "START_ROOM=9"])
# the sound switches change no pixels: these shots must equal the golden of the same name
SWITCHES = {
    "room09+NOMUSIC": ("room09", ["NOMUSIC"]),
    "room09+NOSFX": ("room09", ["NOSFX"]),
    "room09+NOSOUND": ("room09", ["NOSOUND"]),
}
LAMP_BASIC_SHOTS = {
    "room00+LAMP_BASIC": ("room00", ["LAMP_BASIC"]),
    "walk+LAMP_BASIC": ("walk", ["LAMP_BASIC"]),
}
AUTOPLAY_STEPS = 1100                   # steps of tests/playseq.bas (1085), for the Caprice32 hold-and-shoot wait
# plus_layer.bas ends at about &9686 (2.5 KB over the default heap at &8B60, E402): its heap goes above the program,
# at &96C0-&9DFF. AUTOPLAY on the disc ends at about &8E1D, also over the default heap: a smaller one, &9600-&9DFF.
PLUS_LAYER_HEAP = ["--heap-address", "0x96C0", "--heap", "1856"]
AUTOPLAY_DISC_HEAP = ["--heap", "2048"]


# ---------------------------------------------------------------- cpcbuild's tools

def sibling(name: str) -> Path:
    here = REPO
    if here.parent.name == ".worktrees":
        here = here.parent.parent
    return here.parent / name


_CPCRUN = None


def cpcrun():
    """cpcbuild's tools/cpcrun.py (read only), loaded once: the emulator drivers."""
    global _CPCRUN
    if _CPCRUN is None:
        root = Path(os.environ.get("CPCBUILD") or sibling("cpcbuild"))
        path = root / "tools" / "cpcrun.py"
        if not path.is_file():
            sys.exit(f"lamp: {path} not found (--cpcbuild DIR or $CPCBUILD)")
        os.environ.setdefault("CPC_ROM_DIR", str(sibling("caprice32") / "rom"))
        spec = importlib.util.spec_from_file_location("cpcrun", path)
        mod = importlib.util.module_from_spec(spec)
        sys.modules["cpcrun"] = mod
        spec.loader.exec_module(mod)
        _CPCRUN = mod
    return _CPCRUN


# ---------------------------------------------------------------- compile and pack

def strip_amsdos(data: bytes) -> bytes:
    """The image of a cpcbas .bin: the 128-byte AMSDOS header removed after checking its length field."""
    if len(data) < 128:
        raise ValueError("shorter than an AMSDOS header")
    length = data[24] | (data[25] << 8)
    if length + 128 != len(data):
        raise ValueError(f"header length {length} but {len(data) - 128} bytes follow")
    return data[128:]


OPT: str | None = None  # --opt L: passed to every cpcbas compile as `-O L`
OPT_LEVELS = ("0", "1", "2", "3", "s")


def opt_args() -> list[str]:
    """The CLI arguments of --opt (empty when it was not given)."""
    return [] if OPT is None else ["-O", OPT]


def compile_cli(src: Path, out: Path, defines: list[str], extra: list[str] | None = None, mapfile: Path | None = None,
                echo: bool = True, cwd: Path | None = None) -> tuple[bool, str]:
    """One compile with the built CLI. `echo` adds -D __CPC_PRINTER_ECHO__ (the test runs read the printer)."""
    cmd = ["node", str(CLI), "--org", ORG_ARG, str(src), "-o", str(out)]
    if echo:
        cmd += ["-D", "__CPC_PRINTER_ECHO__"]
    for d in defines:
        cmd += ["-D", d]
    if mapfile:
        cmd += ["-M", str(mapfile)]
    cmd += opt_args()
    cmd += extra or []
    out.unlink(missing_ok=True)
    p = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd)
    ok = p.returncode == 0 and out.is_file()
    text = p.stderr + p.stdout
    if not ok:
        errs = [ln for ln in text.splitlines() if "error" in ln.lower()]
        return False, "; ".join(errs[:3]) or text.strip()[-300:]
    return True, text


def pack_dsk(out: Path, files: list[tuple[str, bytes, int]], tmp: Path) -> None:
    """An AMSDOS disc from (NAME, image, load address): `cpcbas dsk`."""
    specs = []
    for name, data, load in files:
        f = tmp / (name.replace(".", "_") + ".raw")
        f.write_bytes(data)
        specs.append(f"{name}={f}@{load:#x}")
    p = subprocess.run(["node", str(CLI), "dsk", "-o", str(out), *specs], capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"cpcbas dsk: {p.stderr.strip()}")


_LOADER: dict[Path, bytes] = {}


def loader_image(tmp: Path) -> bytes:
    """loader_plus.asm assembled by `cpcbas asm` (cached per process)."""
    key = GAME / "loader_plus.asm"
    if key not in _LOADER:
        out = tmp / "loader_plus.bin"
        p = subprocess.run(["node", str(CLI), "asm", str(key), "-o", str(out)], capture_output=True, text=True)
        if p.returncode != 0:
            raise RuntimeError(f"cpcbas asm: {p.stderr.strip()}")
        _LOADER[key] = out.read_bytes()
    return _LOADER[key]


# ---------------------------------------------------------------- build

def check_firmware_end(name: str, end: int) -> str | None:
    if end > HEAP_START:
        return f"{name} ends at &{end:04X}, above the heap at &{HEAP_START:04X}"
    return None


def check_plus_end(name: str, end: int) -> str | None:
    """The disc build is loaded by RUN"PLUS at &9E00 over the AMSDOS buffer at &9600: it must end below the buffer
    (and below the heap, which the compiler checks too)."""
    if end > AMSDOS_BUFFER:
        return f"{name} ends at &{end:04X}, above the AMSDOS buffer at &{AMSDOS_BUFFER:04X}"
    return check_firmware_end(name, end)


def cmd_build(args: argparse.Namespace) -> int:
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    problems: list[str] = []
    sizes: dict[str, int] = {}
    builds = [("lamp464", ["CPC464"]), ("lamp6128", ["CPC6128"]), ("lampplus", ["PLUS"]),
              ("lamppluc", ["PLUS", *BARE])]
    for name, defs in builds:
        binf = out / f"{name}.bin"
        ok, text = compile_cli(GAME / "main.bas", binf, defs, mapfile=out / f"{name}.map", echo=False)
        if not ok:
            problems.append(f"{name}: {text}")
            continue
        image = strip_amsdos(binf.read_bytes())
        sizes[name] = len(image)
        end = ORG + len(image)
        msg = {"lamp464": check_firmware_end, "lamp6128": check_firmware_end, "lampplus": check_plus_end}.get(name)
        bad = msg(name, end) if msg else None
        if name == "lamppluc" and end > BARE_LIMIT:
            bad = f"{name} ends at &{end:04X}, above the bare limit &{BARE_LIMIT:04X}"
        where = {"lamp464": f"{HEAP_START - end} bytes below the heap (&{HEAP_START:04X})",
                 "lamp6128": f"{HEAP_START - end} bytes below the heap (&{HEAP_START:04X})",
                 "lampplus": f"{HEAP_START - end} bytes below the heap, {AMSDOS_BUFFER - end} below the AMSDOS buffer (&{AMSDOS_BUFFER:04X}), loader at &{LOADER_ORG:04X}",
                 "lamppluc": f"{BARE_LIMIT - end} bytes below &{BARE_LIMIT:04X}"}[name]
        print(f"{name:9} {len(image):6d} bytes, &{ORG:04X}-&{end:04X}, {where}")
        if bad:
            problems.append(bad)
    if problems:
        for p in problems:
            print(f"lamp build: {p}", file=sys.stderr)
        return 1
    # the cartridge: -f cpr is cpcbas's own packer (boot stub, image from &0040, entry &0040)
    ok, text = compile_cli(GAME / "main.bas", out / "lampplus.cpr", ["PLUS", *BARE], echo=False)
    if not ok:
        print(f"lamp build: lampplus.cpr: {text}", file=sys.stderr)
        return 1
    print(f"lampplus.cpr {(out / 'lampplus.cpr').stat().st_size} bytes (the 464 Plus build, run in place of the system cartridge)")
    # the discs: one file each for the 464 and the 6128 (RUN"LAMP464, RUN"LAMP6128), the Plus disc with its loader
    for name in ("lamp464", "lamp6128"):
        image = strip_amsdos((out / f"{name}.bin").read_bytes())
        pack_dsk(out / f"{name}.dsk", [(f"{name.upper()}.BIN", image, ORG)], out)
        print(f"{name}.dsk   {name.upper()}.BIN: RUN\"{name.upper()}")
    loader = loader_image(out)
    plus = strip_amsdos((out / "lampplus.bin").read_bytes())
    pack_dsk(out / "lampplus.dsk", [("PLUS.BIN", loader, LOADER_ORG), ("LAMPPLUS.BIN", plus, ORG)], out)
    lend = LOADER_ORG + len(loader)
    print(f"lampplus.dsk PLUS.BIN {len(loader)} bytes at &{LOADER_ORG:04X}-&{lend:04X}, buffer &{AMSDOS_BUFFER:04X}-&{LOADER_ORG - 1:04X}: RUN\"PLUS")
    if lend > 0xA600:
        print(f"lamp build: the loader ends at &{lend:04X}, above HIMEM", file=sys.stderr)
        return 1
    return 0


# ---------------------------------------------------------------- pictures

def compare(actual, gold: Path, label: str, tag: str = "") -> list[tuple[str, str, str]]:
    """Pixel for pixel against the golden; on a difference the actual and a diff picture are written next to it."""
    from PIL import Image, ImageChops

    suffix = f".{tag}" if tag else ""
    act = gold.with_suffix(f"{suffix}.actual.png")
    diff = gold.with_suffix(f"{suffix}.diff.png")
    if not gold.exists():
        act.parent.mkdir(parents=True, exist_ok=True)
        actual.save(act)
        return [("FAIL", label, f"no golden; actual at {act}")]
    g = Image.open(gold).convert("RGB")
    if actual.size != g.size:
        actual.save(act)
        return [("FAIL", label, f"size {actual.size} != golden {g.size}")]
    d = ImageChops.difference(actual, g).convert("L").point(lambda v: 255 if v else 0)
    n = d.histogram()[255]
    if n == 0:
        for f in (act, diff):
            f.unlink(missing_ok=True)
        return [("PASS", label, "")]
    actual.save(act)
    dim = actual.point(lambda v: v // 4)
    dim.paste(Image.new("RGB", actual.size, (255, 0, 0)), mask=d)
    dim.save(diff)
    return [("FAIL", label, f"{n} pixels differ; see {act.name} and {diff.name} in {gold.parent}")]


def bless(actual, gold: Path, label: str) -> list[tuple[str, str, str]]:
    """--bless-autoplay: writes the golden of an AUTOPLAY final shot from a real run (the only golden this tool writes)."""
    gold.parent.mkdir(parents=True, exist_ok=True)
    actual.save(gold, optimize=True)
    return [("BLESSED", label, str(gold))]


def check_transcript(label: str, out: str, need: tuple[str, ...] = ()) -> list[tuple[str, str, str]]:
    fails = re.findall(r"^FAIL.*$", out, re.M)
    passes = len(re.findall(r"^PASS", out, re.M))
    if fails:
        return [("FAIL", label, "; ".join(fails[:5]))]
    if "\nDONE" not in "\n" + out:
        return [("FAIL", label, "no DONE")]
    missing = [n for n in need if f"PASS {n}" not in out]
    if missing:
        return [("FAIL", label, f"missing PASS lines: {missing}")]
    return [("PASS", label, f"{passes} checks")]


AUTOPLAY_PASSES = ("won", "all 28 lamps", "ended in room 0")


def shot_defs(name: str, scenes: dict[str, list[str]]) -> list[str]:
    return scenes[name] if name in scenes else ["SHOT=3", f"START_ROOM={int(name[4:])}"]


# ---------------------------------------------------------------- chipsrun (464, 6128)

def chips_run(binf: Path, model: str, timeout: float, typed: list[str] | None = None, shot_dir: Path | None = None
              ) -> tuple[int, str, str]:
    cr = cpcrun()
    cmd = [str(cr.chipsrun_bin()), "--model", model, "--rom-dir", os.environ["CPC_ROM_DIR"], "--timeout", str(timeout)]
    for t in typed or []:
        cmd += ["--type", t]
    if shot_dir:
        cmd += ["--shot-dir", str(shot_dir)]
    cmd.append(str(binf))
    try:
        p = subprocess.run(cmd, capture_output=True, timeout=timeout * 4 + 60, stdin=subprocess.DEVNULL)
    except subprocess.TimeoutExpired:
        return 2, "", "chipsrun did not return"
    return p.returncode, p.stdout.decode("latin-1"), p.stderr.decode("latin-1")


def chips_prog(model: str, src: Path, defines: list[str], timeout: float, typed=None, shot_dir=None, extra=None):
    """Compile src for the model and run it on chipsrun. Returns (ok, exit code, transcript, message)."""
    with tempfile.TemporaryDirectory(prefix="lamp-") as t:
        binf = Path(t) / "prog.bin"
        flag = {"464": "CPC464", "6128": "CPC6128"}[model]
        ok, text = compile_cli(src, binf, [flag, *defines], extra=extra, cwd=src.parent)
        if not ok:
            return False, 1, "", f"compile: {text}"
        code, out, err = chips_run(binf, model, timeout, typed, shot_dir)
        return True, code, out, err.strip()[-300:]


def chips_logic(model: str, prog: str, timeout: float, defines: list[str] | None = None):
    label = f"{model}/{prog}" + ("+" + "+".join(defines) if defines else "")
    ok, code, out, msg = chips_prog(model, TESTS / f"{prog}.bas", defines or [], timeout)
    if code != 0:
        return [("ERROR", label, f"exit {code}: {msg}")]
    return check_transcript(label, out)


def chips_shot(model: str, name: str, timeout: float):
    from PIL import Image

    label = f"{model}/{name}"
    extra: list[str] = []
    gname = name
    if name in SWITCHES:
        gname, extra = SWITCHES[name]
    elif name in LAMP_BASIC_SHOTS:
        gname, extra = LAMP_BASIC_SHOTS[name]
    defs = shot_defs(gname, SCENES)
    with tempfile.TemporaryDirectory(prefix="lamp-shot-") as t:
        ok, code, out, msg = chips_prog(model, GAME / "main.bas", [*defs, *extra], timeout, shot_dir=Path(t))
        if code != 0:
            return [("ERROR", label, f"exit {code}: {msg}")]
        shots = sorted(Path(t).glob("*.png"))
        if not shots:
            return [("ERROR", label, "took no screenshot")]
        return compare(Image.open(shots[0]).convert("RGB"), GOLDEN / model / f"{gname}.png", label)


def chips_autoplay(model: str, timeout: float, do_bless: bool):
    from PIL import Image

    label = f"{model}/autoplay"
    with tempfile.TemporaryDirectory(prefix="lamp-ap-") as t:
        ok, code, out, msg = chips_prog(model, GAME / "main.bas", ["AUTOPLAY"], timeout, typed=[" "], shot_dir=Path(t))
        if code != 0:
            return [("ERROR", label, f"exit {code}: {msg}; transcript {out.strip()[-120:]!r}")]
        res = check_transcript(label, out, AUTOPLAY_PASSES)
        shots = sorted(Path(t).glob("final.png"))
        if not shots:
            return [("ERROR", label, "no final screenshot")]
        a = Image.open(shots[0]).convert("RGB")
        gold = GOLDEN / model / "autoplay.png"
        res += bless(a, gold, label + " final shot") if do_bless else compare(a, gold, label + " final shot")
        return res


def chips_jobs(models: list[str], timeout: float, do_bless: bool) -> list:
    jobs = []
    for m in models:
        if not do_bless:
            jobs.append((f"{m}/logic", lambda m=m: chips_logic(m, "logic", timeout)))
            jobs.append((f"{m}/playthrough", lambda m=m: chips_logic(m, "playthrough", timeout)))
            if m == "464":
                for prog in ("logic", "playthrough"):
                    jobs.append((f"{m}/{prog}+LAMP_BASIC", lambda m=m, p=prog: chips_logic(m, p, timeout, ["LAMP_BASIC"])))
            names = [f"room{r:02d}" for r in ROOMS] + list(SCENES)
            if m == "464":
                names += list(SWITCHES) + list(LAMP_BASIC_SHOTS)
            for n in names:
                jobs.append((f"{m}/{n}", lambda m=m, n=n: chips_shot(m, n, timeout)))
        jobs.append((f"{m}/autoplay", lambda m=m: chips_autoplay(m, timeout, do_bless)))
    return jobs


# ---------------------------------------------------------------- Plus: Caprice32 and CPCEC

def plus_run(src: Path, emu: str, variant: str, defines: list[str], timeout: float, shot_dir: Path | None = None,
             steps: int = 0, typed: list[str] | None = None, extra: list[str] | None = None, hold: bool = False
             ) -> tuple[int, str]:
    """src as the Plus disc (the firmware build behind the RUN"PLUS loader; a program that does not fit under the
    loader's buffer runs on its own disc) or the cartridge, on cap32 or cpcec. Returns (exit status, the printer
    text up to the END marker): 0 clean, 1 build, 2 timeout, 4 no END marker."""
    cr = cpcrun()
    defines = ["PLUS", *defines]
    if variant == "cart":
        defines = [*BARE, *defines]
    if hold:
        defines = [*defines, "SHOT_HOLD"]
    env = cr.subprocess_env()
    with tempfile.TemporaryDirectory(prefix="lamp-plus-") as t:
        tmp = Path(t)
        binf = tmp / "prog.bin"
        ok, text = compile_cli(src, binf, defines, extra=extra, cwd=src.parent)
        if not ok:
            return 1, text
        image = strip_amsdos(binf.read_bytes())
        printer = tmp / "printer.dat"
        stem = "PLUS"
        if variant == "cart":
            medium = tmp / "prog.cpr"
            ok, text = compile_cli(src, medium, defines, extra=extra, cwd=src.parent)
            if not ok:
                return 1, text
        else:
            medium = tmp / "prog.dsk"
            if ORG + len(image) <= AMSDOS_BUFFER:
                pack_dsk(medium, [("PLUS.BIN", loader_image(tmp), LOADER_ORG), ("LAMPPLUS.BIN", image, ORG)], tmp)
            else:
                stem = "PROG"
                pack_dsk(medium, [("PROG.BIN", image, ORG)], tmp)
        wait = (2 * steps) // 42 + (14 if variant == "disc" else 6)
        try:
            if emu == "cpcec":
                cr.run_cpcec(medium, printer, timeout, env, "plus", None, shot_dir)
            elif variant == "cart":
                cr.run_emulator(None, "", printer, timeout, env, "plus", typed, False, medium, shot_dir, wait)
            else:
                cr.run_emulator(medium, stem, printer, timeout, env, "plus", typed, False, None, shot_dir, wait)
        except cr.TimeoutHit:
            return 2, ""
        except cr.BuildError as e:
            return 1, str(e)
        out = printer.read_bytes().decode("latin-1") if printer.exists() else ""
    out = out.replace("\x04STATE\n", "")
    if cr.END_MARKER in out:
        return 0, out.split(cr.END_MARKER, 1)[0]
    return (0 if shot_dir else 4), out


def plus_logic(emu: str, variant: str, src: str, timeout: float):
    label = f"{emu}/{variant}/{src.removesuffix('.bas')}"
    extra = PLUS_LAYER_HEAP if (src == "plus_layer.bas" and variant == "disc") else None
    code, out = plus_run(TESTS / src, emu, variant, [], timeout, extra=extra)
    if code != 0:
        return [("ERROR", label, f"exit {code}: {out.strip()[-200:]}")]
    return check_transcript(label, out)


def plus_shot_image(emu: str, variant: str, defs: list[str], steps: int, timeout: float, name: str = "room"):
    from PIL import Image

    with tempfile.TemporaryDirectory(prefix="lamp-plus-shot-") as t:
        shot_dir = Path(t)
        code, out = plus_run(GAME / "main.bas", emu, variant, defs, timeout, shot_dir, steps, hold=(emu == "cap32"))
        if code != 0:
            return None, f"exit {code}: {out.strip()[-200:]}"
        if emu == "cap32" and not re.search(r"\x04SHOT ", out):
            return None, "no SHOT line: the game did not reach the shot (raise the wait)"
        shots = sorted(shot_dir.glob("*.png"))
        if len(shots) != 1:
            return None, f"{len(shots)} screenshots"
        return Image.open(shots[0]).convert("RGB"), ""


def plus_shot(emu: str, variant: str, name: str, timeout: float):
    label = f"{emu}/{variant}/{name}"
    defs = shot_defs(name, PLUS_SCENES)
    steps = 50 if name == "title" else int([d for d in defs if d.startswith("SHOT=")][0][5:])
    a, err = plus_shot_image(emu, variant, defs, steps, timeout)
    if a is None:
        return [("ERROR", label, err)]
    return compare(a, GOLDEN / f"plus-{emu}" / f"{name}.png", label, variant)


def plus_autoplay(emu: str, variant: str, timeout: float, do_bless: bool):
    """Two runs on Caprice32 (the shot holds the program, so the PASS lines come from a run without the hold), one on CPCEC."""
    label = f"{emu}/{variant}/autoplay"
    defs = ["AUTOPLAY"] + (["AUTOPLAY_NOKEY"] if emu == "cpcec" else [])
    # the disc build takes seconds to load behind the loader: the key waits 8 more CAP32_DELAYs for the title
    typed = ["CAP32_DELAY" * (8 if variant == "disc" else 0) + " "] if emu == "cap32" else None
    heap = AUTOPLAY_DISC_HEAP if variant == "disc" else None
    code, out = plus_run(GAME / "main.bas", emu, variant, defs, timeout, typed=typed, extra=heap)
    if code != 0:
        return [("ERROR", label, f"exit {code}: {out.strip()[-200:]}")]
    res = check_transcript(label, out, AUTOPLAY_PASSES)
    from PIL import Image

    with tempfile.TemporaryDirectory(prefix="lamp-plus-ap-") as t:
        code, out2 = plus_run(GAME / "main.bas", emu, variant, defs, timeout, Path(t), AUTOPLAY_STEPS, typed=typed,
                              hold=(emu == "cap32"), extra=heap)
        if code != 0:
            return res + [("ERROR", label + " final shot", f"exit {code}: {out2.strip()[-200:]}")]
        shots = sorted(Path(t).glob("*.png"))
        if len(shots) != 1:
            return res + [("ERROR", label + " final shot", f"{len(shots)} screenshots")]
        a = Image.open(shots[0]).convert("RGB")
    gold = GOLDEN / f"plus-{emu}" / "autoplay.png"
    if do_bless:
        return res + (bless(a, gold, label + " final shot") if variant == "disc"
                      else [("PASS", label + " final shot", "(the golden comes from the disc build)")])
    return res + compare(a, gold, label + " final shot", variant)


def flame_test(emu: str):
    from PIL import Image, ImageChops

    label = f"{emu}/flame cycling"
    a, b = GOLDEN / f"plus-{emu}" / "lit09.png", GOLDEN / f"plus-{emu}" / "lit09b.png"
    if not a.exists() or not b.exists():
        return [("FAIL", label, "goldens missing")]
    box = ImageChops.difference(Image.open(a).convert("RGB"), Image.open(b).convert("RGB")).getbbox()
    if box is None:
        return [("FAIL", label, "lit09 and lit09b are the same picture: the flame did not cycle")]
    return [("PASS", label, f"pictures differ (box {box})")]


def plus_jobs(emus: list[str], variants: list[str], timeout: float, do_bless: bool) -> list:
    jobs = []
    names = [f"room{r:02d}" for r in ROOMS] + list(PLUS_SCENES)
    for e in emus:
        for v in variants:
            if not do_bless:
                for src in ("logic.bas", "playthrough.bas", "plus_layer.bas"):
                    jobs.append((f"{e}/{v}/{src}", lambda e=e, v=v, s=src: plus_logic(e, v, s, timeout)))
                for n in names:
                    jobs.append((f"{e}/{v}/{n}", lambda e=e, v=v, n=n: plus_shot(e, v, n, timeout)))
            jobs.append((f"{e}/{v}/autoplay", lambda e=e, v=v: plus_autoplay(e, v, timeout, do_bless)))
    return jobs


# ---------------------------------------------------------------- bench

def parse_info(out: str) -> str | None:
    """The BENCH line, whatever the PRINT spacing: cpcbas prints numbers the Locomotive way (a space before and
    after, a 40-column wrap), the fork's Boriel PRINT does not. Returns `steps=250 frames=499 per second=25.1 ...`."""
    m = re.search(r"INFOsteps=(\d+)frames=(\d+)persecond=([\d.]+)late=(\d+)longest=(\d+)", re.sub(r"\s+", "", out))
    if not m:
        return None
    return f"steps={m[1]} frames={m[2]} per second={m[3]} late={m[4]} longest={m[5]}"


def bench_chips(model: str, extra_defs: list[str]) -> str:
    ok, code, out, msg = chips_prog(model, GAME / "main.bas", ["BENCH", *extra_defs], 120)
    return parse_info(out) or f"(no result: exit {code} {msg})"


FORK_ROWS = REPO / "tools" / "lamp-fork-rows.json"


def fork_rows() -> tuple[str, dict[str, str]]:
    """The fork's last measured BENCH figures (tools/lamp-fork-rows.json): a header saying where and when they were
    measured, and the rows by label. The fork no longer builds Lamplighter (the sources are CPC BASIC now), so these are
    history, not a measurement."""
    d = json.loads(FORK_ROWS.read_text())
    head = f"recorded {d['date']}, {d['source']}"
    return head, d["rows"]


def bench_plus_cpcec(variant: str, extra_defs: list[str]) -> str:
    code, out = plus_run(GAME / "main.bas", "cpcec", variant, ["BENCH", *extra_defs], 120)
    return parse_info(out) or f"(no result: exit {code} {out.strip()[-120:]})"


def cmd_bench(args: argparse.Namespace) -> int:
    rows = []
    history = fork_rows() if args.fork else None
    if not args.plus:
        for model in ("464", "6128"):
            for extra in ([], ["NOGAMEMODE"], ["NOPACE"]):
                tag = "+".join(extra) or "default"
                label = f"chips {model} {tag}"
                if history:
                    rows.append((label, "fork*", history[1].get(label, "-")))
                rows.append((label, "cpcbas", bench_chips(model, extra)))
    else:
        for variant in ("disc", "cart"):
            for extra in ([], ["NOPACE"]):
                tag = "+".join(extra) or "paced"
                label = f"cpcec plus {variant} {tag}"
                if history:
                    rows.append((label, "fork*", history[1].get(label, "-")))
                rows.append((label, "cpcbas", bench_plus_cpcec(variant, extra)))
    for where, who, line in rows:
        print(f"{where:30} {who:7} {line}")
    if history:
        print(f"* fork rows: {history[0]}")
    return 0


# ---------------------------------------------------------------- main

def cmd_test(args: argparse.Namespace) -> int:
    if not CLI.is_file():
        print(f"lamp: {CLI} missing; run `npm ci && npm run build` first", file=sys.stderr)
        return 1
    if args.plus:
        emus = args.emu or ["cap32", "cpcec"]
        variants = args.variant or ["disc", "cart"]
        jobs = plus_jobs(emus, variants, args.timeout, args.bless_autoplay)
    else:
        models = [args.model] if args.model else ["464", "6128"]
        jobs = chips_jobs(models, args.timeout, args.bless_autoplay)
    jobs = [j for j in jobs if args.pattern in j[0]]
    bad = 0
    with ThreadPoolExecutor(max_workers=args.jobs) as ex:
        for results in ex.map(lambda j: j[1](), jobs):
            for status, label, msg in results:
                print(f"{status:7} {label} {msg}".rstrip(), flush=True)
                if status in ("FAIL", "ERROR"):
                    bad += 1
    if args.plus and not args.pattern and not args.bless_autoplay:
        for e in (args.emu or ["cap32", "cpcec"]):
            for status, label, msg in flame_test(e):
                print(f"{status:7} {label} {msg}".rstrip(), flush=True)
                bad += status == "FAIL"
    print(f"{len(jobs)} tests, {bad} failed")
    return 1 if bad else 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd")
    b = sub.add_parser("build", help="the four builds, the discs and the cartridge")
    opt_help = "cpcbas optimiser level for every build: 0, 1, 2, 3 or s (the CLI's -O L; default: the CLI's default)"
    ap.add_argument("--opt", choices=OPT_LEVELS, default=None, help=opt_help)
    b.add_argument("--out", type=Path, default=GAME / "build", help="output directory (default tests/games/lamplighter/build, git-ignored)")
    t = sub.add_parser("test", help="the emulator tests (the default command)")
    n = sub.add_parser("bench", help="-D BENCH steps per second")
    for p in (b, t, n):
        p.add_argument("--opt", choices=OPT_LEVELS, default=argparse.SUPPRESS, help=opt_help)
    n.add_argument("--plus", action="store_true", help="CPCEC as a 6128 Plus, disc and cartridge (default: chipsrun 464 and 6128)")
    n.add_argument("--fork", action="store_true", help="also the fork's rows, as recorded history (tools/lamp-fork-rows.json; the fork is not run)")
    for p in (ap, t):
        # given before `test` or after it: the subcommand's copies must not overwrite what the top level parsed (R18: `--plus test`
        # ran chipsrun), so only the top level has defaults
        d = (lambda v: v) if p is ap else (lambda v: argparse.SUPPRESS)
        p.add_argument("--plus", action="store_true", default=d(False), help="Caprice32 and CPCEC as a 6128 Plus (default: chipsrun 464 and 6128)")
        p.add_argument("--model", choices=("464", "6128"), default=d(None))
        p.add_argument("--emu", action="append", choices=("cap32", "cpcec"), default=d(None))
        p.add_argument("--variant", action="append", choices=("disc", "cart"), default=d(None))
        p.add_argument("-k", dest="pattern", default=d(""), help="only tests whose label contains this")
        p.add_argument("-j", dest="jobs", type=int, default=d(4))
        p.add_argument("--timeout", type=float, default=d(90))
        p.add_argument("--bless-autoplay", action="store_true", default=d(False),
                       help="write the AUTOPLAY final shots as the goldens (the only golden this tool writes; from a real run, once)")
    ap.add_argument("--cpcbuild", type=Path, help="the cpcbuild checkout (tools/cpcrun.py and the emulators)")
    args = ap.parse_args(argv)
    if args.cpcbuild:
        os.environ["CPCBUILD"] = str(args.cpcbuild)
    global OPT
    OPT = args.opt
    if args.cmd == "build":
        return cmd_build(args)
    if args.cmd == "bench":
        return cmd_bench(args)
    return cmd_test(args)


if __name__ == "__main__":
    sys.exit(main())
