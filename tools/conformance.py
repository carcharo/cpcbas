#!/usr/bin/env python3
"""conformance.py -- build every tests/conformance/*.bas program with the cpcbas CLI, run it on
an emulator and summarise. The port of cpcbuild's tests/conformance/run.py.

    npm run build                                    # the runner uses the built CLI
    python3 tools/conformance.py --emu chips                         # 6128, firmware
    python3 tools/conformance.py --emu chips --model 464 --bare      # bare metal
    python3 tools/conformance.py --emu chips --model 464 --cold      # no firmware at all
    python3 tools/conformance.py --emu cpcec --model plus            # a 6128 Plus
    python3 tools/conformance.py --list [--model M] [--bare]         # the plan, nothing runs

A program passes if its build and run ended cleanly (the run reached the END marker: no
timeout, no crash), it printed "DONE", and it printed no "FAIL" line. Each program prints one
line per check ("PASS name" or "FAIL name got=... want=...", see tests/conformance/lib/chk.bas)
and ends with "DONE" if every check ran. A FAIL line the screen wrapped (40 columns in mode 1)
is joined with its continuation when reported. Byte 12 (form feed) is dropped from every
transcript before it is read: on the 464 CLS echoes it to the printer hook, on the 6128 it does
not, and the PASS/FAIL protocol must not depend on the model.

Build: `node packages/cpcbas/dist/bin/cpcbas.js PROG.bas -D __CPC_PRINTER_ECHO__ -D CPC464|CPC6128|PLUS`
(plus `-D CPC_BAREMETAL` with --bare or --cold, `-D CPC_LINE_464` for a cold 464, as cpcrun.py
does), to a .bin (AMSDOS header included: chipsrun runs it as it is) or, for Caprice32 and
CPCEC, a .dsk. The emulators are driven through cpcbuild's tools/cpcrun.py (run_cpcec,
run_emulator, the chipsrun binary); --cpcbuild DIR says where that checkout is.

A program restricts where it runs, or says how to build it, with header lines (anywhere in the
source, `REM` then the keyword):
  REM MODELS: 6128          only on these models (464 664 6128 plus); none listed = every model
                            including plus; a list without plus does not run on plus
  REM EMUS: cap32           only on these emulators (a test that needs a disc)
  REM CPCBAS: -W 320        extra compiler arguments, space separated (in place of cpcbuild's ZXBC)
  REM DISKFILE: N.BIN=path  a data file on the disc (Caprice32 and CPCEC): the path is relative to
                            tests/conformance, `--dsk-add N.BIN=path`
  REM TYPE: text            keys typed while it runs (chips and Caprice32; CPCEC cannot type)
  REM BARE: skip <reason>   can never work bare (firmware features): SKIP under --bare/--cold
  REM BARE: only            a bare-specific test: SKIP in a normal run
  REM TIMEOUT: n            seconds of emulated time for this program, used in place of --timeout
                            when larger (cb_tilewidth needs more than 60 s)
  REM STATE: key=value ...  (chips) after the run compare the state dump the program asked for
                            (lib/bareout.bas BState(), see chipsrun.c) with these pairs
  REM XFAIL: <reason>       expected to fail, reported as XFAIL with the reason, not counted
                            against the pass total. "needs L3-XXX" says which task it waits for.
                            When such a program passes it is reported XPASS and the run fails:
                            remove the line.
  REM SIM: skip <reason>    read only by npm test (packages/cpcbas/test/conformance-sim.test.ts):
                            not run on the Z80 simulator; ignored here

Exit 0 when nothing failed, timed out, did not build or passed unexpectedly; 1 otherwise.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CONFORMANCE_DIR = REPO / "tests" / "conformance"
CLI = REPO / "packages" / "cpcbas" / "dist" / "bin" / "cpcbas.js"

END_MARKER = "\x04END\n"
STATE_LINE = "\x04STATE\n"
MODELS = ("464", "664", "6128", "plus")
OPT_LEVELS = ("0", "1", "2", "3", "s")
OPT: str | None = None  # --opt: every program is built at this optimisation level (-O L)
MODEL_DEFINE = {"464": "CPC464", "664": "CPC464", "6128": "CPC6128", "plus": "PLUS"}

XFAIL_RE = re.compile(r"^\s*REM\s+XFAIL:\s*(.*)$", re.IGNORECASE)
MODELS_RE = re.compile(r"^\s*REM\s+MODELS:\s*(.*?)\s*$", re.IGNORECASE)
EMUS_RE = re.compile(r"^\s*REM\s+EMUS:\s*(.*?)\s*$", re.IGNORECASE)
CPCBAS_RE = re.compile(r"^\s*REM\s+CPCBAS:\s*(.*?)\s*$", re.IGNORECASE)
DISKFILE_RE = re.compile(r"^\s*REM\s+DISKFILE:\s*(\S+)\s*$", re.IGNORECASE)
BARE_RE = re.compile(r"^\s*REM\s+BARE:\s*(\w+)\b\s*(.*?)\s*$", re.IGNORECASE)
TIMEOUT_RE = re.compile(r"^\s*REM\s+TIMEOUT:\s*(\d+(?:\.\d+)?)\s*$", re.IGNORECASE)
STATE_RE = re.compile(r"^\s*REM\s+STATE:\s*(.*?)\s*$", re.IGNORECASE)
TYPE_RE = re.compile(r"^\s*REM\s+TYPE:\s*(.*?)\s*$", re.IGNORECASE)
STATE_OUT_RE = re.compile(r"^chipsrun-state: (.*)$", re.MULTILINE)
ERROR_LINE_RE = re.compile(r"^Error \d+$", re.MULTILINE)


# ---------------------------------------------------------------------------------------------
# Headers
# ---------------------------------------------------------------------------------------------


@dataclass
class Headers:
    models: list[str] = field(default_factory=list)
    emus: list[str] = field(default_factory=list)
    args: list[str] = field(default_factory=list)
    diskfiles: list[tuple[str, str]] = field(default_factory=list)
    typed: list[str] = field(default_factory=list)
    bare_kind: str | None = None  # "skip" | "only" | None
    bare_reason: str = ""
    state: list[str] = field(default_factory=list)  # key=value tokens
    xfail: str | None = None
    timeout: float | None = None  # REM TIMEOUT: seconds of emulated time


def parse_headers(text: str) -> Headers:
    """Read the REM header lines of a program (any line of the source)."""
    h = Headers()
    for line in text.splitlines():
        if m := XFAIL_RE.match(line):
            if h.xfail is None:
                h.xfail = m.group(1).strip() or "expected failure"
        elif m := MODELS_RE.match(line):
            h.models += m.group(1).lower().split()
        elif m := EMUS_RE.match(line):
            h.emus += m.group(1).lower().split()
        elif m := CPCBAS_RE.match(line):
            h.args += m.group(1).split()
        elif m := DISKFILE_RE.match(line):
            name, _, path = m.group(1).partition("=")
            h.diskfiles.append((name.upper(), path))
        elif m := TYPE_RE.match(line):
            h.typed.append(m.group(1))
        elif m := BARE_RE.match(line):
            if h.bare_kind is None:
                h.bare_kind, h.bare_reason = m.group(1).lower(), m.group(2)
        elif m := STATE_RE.match(line):
            h.state += m.group(1).split()
        elif m := TIMEOUT_RE.match(line):
            if h.timeout is None:
                h.timeout = float(m.group(1))
    return h


def timeout_for(h: Headers, default: float) -> float:
    """Seconds of emulated time for a program: its REM TIMEOUT when that is larger than the run's --timeout."""
    return max(default, h.timeout) if h.timeout is not None else default


def plan(h: Headers, model: str, emu: str, bare: bool) -> str | None:
    """None when the program runs here, else the reason it is skipped."""
    if bare and h.bare_kind == "skip":
        return f"firmware only{': ' + h.bare_reason if h.bare_reason else ''}"
    if not bare and h.bare_kind == "only":
        return "bare metal only"
    if h.models and model not in h.models:
        return f"MODELS: {' '.join(h.models)}"
    if h.emus and emu not in h.emus:
        return f"EMUS: {' '.join(h.emus)}"
    if emu == "cpcec" and h.typed:
        return "cpcec cannot type keys"
    if emu == "chips" and h.diskfiles:
        return "needs a disc (chips has none)"
    if emu == "chips" and model in ("664", "plus"):
        return f"chips has no {model}"
    return None


def defines_for(model: str, bare: bool, cold: bool) -> list[str]:
    """The -D names the runner adds to every build."""
    d = ["__CPC_PRINTER_ECHO__", MODEL_DEFINE[model]]
    if bare:
        d.append("CPC_BAREMETAL")
        if cold and model == "464":
            # a cold start cannot see the 464 firmware's jumpblock; the 464 draws its lines
            # a little differently from the 6128 (gfxbare.asm)
            d.append("CPC_LINE_464")
    return d


def build_command(bas: Path, out: Path, defines: list[str], extra: list[str], diskfiles: list[tuple[str, str]],
                  base: Path = CONFORMANCE_DIR, org: str | None = None, opt: str | None = None) -> list[str]:
    cmd = ["node", str(CLI), str(bas), "-o", str(out)]
    for d in defines:
        cmd += ["-D", d]
    if org:
        cmd += ["--org", org]
    level = opt if opt is not None else OPT
    if level is not None:
        cmd += ["-O", level]
    cmd += extra
    for name, path in diskfiles:
        cmd += ["--dsk-add", f"{name}={base / path}"]
    return cmd


# ---------------------------------------------------------------------------------------------
# Transcripts and results
# ---------------------------------------------------------------------------------------------


def clean_transcript(text: str) -> str:
    """Drop byte 12 (the 464's CLS echo) so that "FAIL" always starts its line."""
    return text.replace("\x0c", "")


def fail_lines(output: str) -> list[str]:
    """Every FAIL line; one the screen wrapped (the text ends at "got=" or "want=", or has no
    "want=" yet) is joined with the line after it."""
    lines = output.split("\n")
    found: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("FAIL"):
            while (i + 1 < len(lines) and not lines[i + 1].startswith(("PASS", "FAIL", "DONE"))
                   and (" want=" not in line or line.endswith(("got=", "want=")))):
                i += 1
                line += lines[i]
            found.append(line)
        i += 1
    return found


def parse_state(stderr: str) -> dict[str, str] | None:
    m = STATE_OUT_RE.search(stderr)
    if not m:
        return None
    return dict(tok.partition("=")[::2] for tok in m.group(1).split())


def state_output(stderr: str, want: list[str]) -> str:
    """The PASS/FAIL lines for the `REM STATE:` pairs, from chipsrun's state dump."""
    if not want:
        return ""
    got = parse_state(stderr)
    if got is None:
        return "FAIL state_missing (no chipsrun-state line)\n"
    out = ""
    for tok in want:
        key, _, val = tok.partition("=")
        if got.get(key) != val:
            out += f"FAIL state_{key} got={got.get(key)} want={val}\n"
        else:
            out += f"PASS state_{key}\n"
    return out


@dataclass
class Result:
    path: Path
    headers: Headers
    skip_reason: str | None = None
    exit_code: int | None = None  # 0 clean, 1 build/usage error, 2 timeout, 4 no END marker
    output: str = ""
    stderr: str = ""
    seconds: float = 0.0
    timeout_s: float = 0.0  # the emulated seconds the run was given (set by run_one)

    @property
    def xfail_reason(self) -> str | None:
        return self.headers.xfail

    @property
    def fail_lines(self) -> list[str]:
        return fail_lines(self.output)

    @property
    def reached_done(self) -> bool:
        return "\nDONE" in ("\n" + self.output)

    @property
    def ok(self) -> bool:
        return self.exit_code == 0 and self.reached_done and not self.fail_lines

    @property
    def status(self) -> str:
        if self.skip_reason is not None:
            return "SKIP"
        if self.ok:
            return "XPASS" if self.xfail_reason else "PASS"
        if self.xfail_reason:
            return "XFAIL"
        return {2: "TIMEOUT", 1: "BUILDERR"}.get(self.exit_code or 0, "FAIL")

    def first_problem(self) -> str:
        """One line saying why the program did not pass."""
        if self.exit_code == 1:
            err = [ln for ln in self.stderr.splitlines() if ln.strip()]
            errors = [ln for ln in err if "error" in ln]
            return (errors or err or ["build failed"])[0].strip()
        if self.exit_code == 2:
            msg = f"timeout after {self.timeout_s:g} s emulated (REM TIMEOUT: n raises it)" if self.timeout_s else "timeout (hang)"
            last = [ln for ln in self.output.splitlines() if ln.strip()]
            return msg + (f"; last transcript line: {last[-1].strip()[:60]}" if last else "")
        if self.exit_code == 4:
            return "reached address 0 without the END marker (crash, reset or runtime error)"
        if self.fail_lines:
            return self.fail_lines[0]
        if not self.reached_done:
            return "did not print DONE"
        return ""


@dataclass
class Counts:
    passed: int = 0
    failed: int = 0
    timeout: int = 0
    builderr: int = 0
    xfail: int = 0
    xpass: int = 0
    skipped: int = 0
    total: int = 0

    @property
    def ok(self) -> bool:
        return not (self.failed or self.timeout or self.builderr or self.xpass)


def count(results: list[Result]) -> Counts:
    c = Counts()
    for r in results:
        s = r.status
        if s == "SKIP":
            c.skipped += 1
        elif s == "PASS":
            c.passed += 1
        elif s == "XFAIL":
            c.xfail += 1
        elif s == "XPASS":
            c.xpass += 1
        elif s == "TIMEOUT":
            c.timeout += 1
        elif s == "BUILDERR":
            c.builderr += 1
        else:
            c.failed += 1
    c.total = len(results) - c.skipped
    return c


def summary_line(c: Counts) -> str:
    return (f"{c.passed}/{c.total} passed, {c.failed} failed, {c.timeout} timed out, "
            f"{c.builderr} build errors, {c.xfail} expected failures, {c.xpass} unexpected passes"
            + (f", {c.skipped} skipped (other model/emulator/mode)" if c.skipped else ""))


# ---------------------------------------------------------------------------------------------
# Running
# ---------------------------------------------------------------------------------------------

_cpcrun = None


def load_cpcrun(cpcbuild: Path):
    global _cpcrun
    if _cpcrun is None:
        path = cpcbuild.resolve() / "tools" / "cpcrun.py"
        if not path.is_file():
            sys.exit(f"conformance.py: {path} not found (--cpcbuild DIR)")
        spec = importlib.util.spec_from_file_location("cpcrun", path)
        mod = importlib.util.module_from_spec(spec)
        sys.modules["cpcrun"] = mod
        spec.loader.exec_module(mod)
        _cpcrun = mod
    return _cpcrun


def default_cpcbuild() -> Path:
    here = REPO
    if here.parent.name == ".worktrees":
        here = here.parent.parent
    return here.parent / "cpcbuild"


def run_one(bas: Path, opts: argparse.Namespace) -> Result:
    import time

    text = bas.read_text(encoding="latin-1")
    h = parse_headers(text)
    r = Result(bas, h)
    r.skip_reason = plan(h, opts.model, opts.emu, opts.bare)
    if r.skip_reason is not None:
        return r
    cpcrun = load_cpcrun(opts.cpcbuild)
    r.timeout_s = timeout_for(h, opts.timeout)
    t0 = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="conformance-") as tmp_name:
        tmp = Path(tmp_name)
        ext = "bin" if opts.emu == "chips" else "dsk"
        out = tmp / f"prog.{ext}"
        stem = cpcrun.amsdos_stem(bas)
        source = bas
        if opts.emu != "chips":
            # The CLI names the disc file after the source (CB_TILER.BIN) and Caprice32 cannot
            # type an underscore into run"NAME: build a one-line wrapper named as cpcrun.py
            # names it (letters and digits, 8 at most). CPCEC runs the only file, any name.
            source = tmp / f"{stem}.bas"
            source.write_text(f'#include "{bas.resolve()}"\n')
        cmd = build_command(source, out, defines_for(opts.model, opts.bare, opts.cold), h.args, h.diskfiles, org=opts.org,
                            opt=getattr(opts, "opt", None))
        p = subprocess.run(cmd, capture_output=True, text=True)
        if p.returncode != 0 or not out.is_file():
            r.exit_code, r.stderr = 1, p.stderr + p.stdout
            r.seconds = time.monotonic() - t0
            return r
        if opts.emu == "chips":
            r.exit_code, r.output, r.stderr = run_chips(cpcrun, out, opts, h)
        else:
            r.exit_code, r.output, r.stderr = run_disc(cpcrun, out, stem, tmp, opts, h)
    r.output = clean_transcript(r.output)
    if opts.emu == "chips" and r.exit_code == 0:
        r.output += state_output(r.stderr, h.state)
    r.seconds = time.monotonic() - t0
    return r


def run_chips(cpcrun, binary: Path, opts: argparse.Namespace, h: Headers) -> tuple[int, str, str]:
    """chipsrun on the AMSDOS .bin the CLI wrote. Returns (code, transcript, stderr); the
    codes are chipsrun's: 0 clean, 2 timeout, 4 reached address 0 without the marker."""
    import os

    timeout = timeout_for(h, opts.timeout)
    cmd = [str(cpcrun.chipsrun_bin()), "--model", opts.model, "--rom-dir",
           os.environ.get("CPC_ROM_DIR") or str(opts.cpcbuild.resolve().parent / "caprice32" / "rom"),
           "--timeout", str(timeout)]
    if opts.cold:
        cmd.append("--cold")
    if opts.end_on_marker:
        cmd.append("--end-on-marker")
    for t in h.typed:
        cmd += ["--type", t]
    cmd.append(str(binary))
    try:
        p = subprocess.run(cmd, capture_output=True, timeout=timeout * 4 + 60)
    except subprocess.TimeoutExpired:
        return 2, "", "chipsrun did not return"
    code = p.returncode if p.returncode in (0, 2, 4) else 1
    return code, p.stdout.decode("latin-1"), p.stderr.decode("latin-1")


def run_disc(cpcrun, dsk: Path, stem: str, tmp: Path, opts: argparse.Namespace, h: Headers) -> tuple[int, str, str]:
    """Caprice32 or CPCEC on the .dsk. Returns (code, transcript, stderr) with cpcrun.py's codes."""
    printer = tmp / "printer.dat"
    env = cpcrun.subprocess_env()
    timeout = timeout_for(h, opts.timeout)
    try:
        if opts.emu == "cpcec":
            cpcrun.run_cpcec(dsk, printer, timeout, env, opts.model)
        else:
            cpcrun.run_emulator(dsk, stem, printer, timeout, env, opts.model, h.typed, opts.end_on_marker)
    except cpcrun.TimeoutHit:
        return 2, "", f"timeout after {timeout}s"
    except cpcrun.BuildError as exc:
        return 1, "", str(exc)
    text = (printer.read_bytes() if printer.exists() else b"").decode("latin-1")
    text = text.replace(STATE_LINE, "")
    if END_MARKER in text:
        # the marker is the last output; Caprice32 runs a few instructions past the
        # address-0 breakpoint and can print junk after it
        return 0, text.split(END_MARKER, 1)[0], ""
    m = ERROR_LINE_RE.search(text)
    return 4, text, f"no END marker{' (runtime error ' + repr(m.group(0)) + ')' if m else ''}"


def find_programs(args: argparse.Namespace) -> list[Path]:
    files = args.files or sorted(CONFORMANCE_DIR.glob("*.bas"))
    if args.pattern:
        files = [f for f in files if args.pattern in f.name]
    return files


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="*", type=Path, help="specific .bas files (default: all of tests/conformance)")
    ap.add_argument("--timeout", type=float, default=60.0, help="seconds of emulated time per program (default 60)")
    ap.add_argument("-k", dest="pattern", default=None, help="only programs whose name contains PATTERN")
    ap.add_argument("-j", dest="jobs", type=int, default=1, help="parallel jobs (default 1: one emulator at a time)")
    ap.add_argument("--model", choices=MODELS, default="6128", help="CPC model (default 6128; plus = 6128 Plus)")
    ap.add_argument("--emu", choices=("chips", "cap32", "cpcec"), default="chips",
                    help="emulator (default chips; cap32 = Caprice32, cpcec = CPCEC headless: tests that type keys are skipped there)")
    ap.add_argument("--org", default=None, metavar="ADDR", help="build every program at this origin (e.g. 0x40)")
    ap.add_argument("--bare", action="store_true", help="build with -D CPC_BAREMETAL; skip `REM BARE: skip` tests")
    ap.add_argument("--cold", action="store_true", help="chips only: cold start with no firmware (implies --bare)")
    ap.add_argument("--opt", choices=OPT_LEVELS, default=None, metavar="L",
                    help="build every program at optimisation level L (0, 1, 2, 3 or s): `-O L`; the pass rule is unchanged")
    ap.add_argument("--end-on-marker", action="store_true", help="end each run at the END marker, not at the reset")
    ap.add_argument("--cpcbuild", type=Path, default=default_cpcbuild(), help="the cpcbuild checkout (tools/cpcrun.py)")
    ap.add_argument("--list", action="store_true", help="print the plan (run, skip with the reason, XFAIL) and run nothing")
    ap.add_argument("--json", type=Path, default=None, metavar="FILE", help="also write the results as JSON")
    args = ap.parse_args(argv)
    global OPT
    OPT = args.opt
    if args.model == "plus" and args.emu == "chips":
        ap.error("chips has no Plus: --model plus needs --emu cap32 or cpcec")
    if args.cold:
        args.bare = True
        if args.emu != "chips":
            ap.error("--cold needs --emu chips")

    files = find_programs(args)
    if not files:
        print("conformance.py: no conformance .bas files found", file=sys.stderr)
        return 1

    if args.list:
        for f in files:
            h = parse_headers(f.read_text(encoding="latin-1"))
            why = plan(h, args.model, args.emu, args.bare)
            tag = f"SKIP ({why})" if why else "run"
            print(f"{f.name:24} {tag}" + (f"  XFAIL: {h.xfail}" if h.xfail else ""))
        return 0

    if not CLI.is_file():
        print(f"conformance.py: {CLI} not found; run `npm run build`", file=sys.stderr)
        return 1

    results: list[Result] = []
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        futures = [pool.submit(run_one, f, args) for f in files]
        for fut in as_completed(futures):
            results.append(fut.result())
    results.sort(key=lambda r: r.path.name)

    for r in results:
        s = r.status
        print(f"{s:8} {r.path.name}" + (f"  ({r.skip_reason})" if s == "SKIP" else f"  {r.seconds:.1f}s"))
        if s == "XFAIL":
            print(f"           waiting: {r.xfail_reason}")
            if r.first_problem():
                print(f"           now: {r.first_problem()}")
        elif s == "XPASS":
            print(f"           passed although marked XFAIL ({r.xfail_reason}): remove the REM XFAIL line")
        elif s in ("FAIL", "BUILDERR", "TIMEOUT"):
            for line in (r.fail_lines or [r.first_problem()]):
                print(f"           {line}")
            if s == "FAIL" and not r.reached_done:
                print("           (did not print DONE)")
    c = count(results)
    print("\n" + summary_line(c))
    if args.json:
        args.json.write_text(json.dumps([{
            "program": r.path.name, "status": r.status, "model": args.model, "emu": args.emu,
            "bare": args.bare, "cold": args.cold, "seconds": round(r.seconds, 1),
            "detail": r.skip_reason or r.xfail_reason or r.first_problem(),
        } for r in results], indent=1))
    return 0 if c.ok else 1


if __name__ == "__main__":
    sys.exit(main())
