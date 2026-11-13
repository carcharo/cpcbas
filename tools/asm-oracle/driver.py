#!/usr/bin/env python3
"""Run the reference assembler (zxbasm) with the CPC runtime include path.

zxbasm on its own searches the zx48k runtime. This driver sets the
architecture to "cpc" before the preprocessor builds its include path, then
calls zxbasm.main with the remaining arguments.

Run from the reference checkout, so that `src` is importable:

    cd ../zxbasic && poetry run python /abs/path/driver.py in.asm -o out.bin -M out.map
"""
import os
import sys

from src.api import config
from src.zxbasm import zxbasm
from src.zxbpp import zxbpp

_original_set_include_path = zxbpp.set_include_path


def _cpc_set_include_path():
    config.OPTIONS.architecture = "cpc"
    _original_set_include_path()
    # CPCBAS_LIB: a directory searched after the runtime (the BASIC library's cpcbuild/, cpcplus/, music/ asm).
    extra = os.environ.get("CPCBAS_LIB")
    if extra:
        zxbpp.INCLUDE_MAP.setdefault("cpc", []).append(extra)
        if zxbpp.INCLUDEPATH is not zxbpp.INCLUDE_MAP.get("cpc"):
            zxbpp.INCLUDEPATH.append(extra)
    # CPCBAS_OVERRIDE: the patched lib/runtime files (tools/import-runtime.py PATCHED), searched before the reference's runtime.
    over = os.environ.get("CPCBAS_OVERRIDE")
    if over:
        seen = set()
        for paths in list(zxbpp.INCLUDE_MAP.values()) + [zxbpp.INCLUDEPATH]:
            if id(paths) not in seen:
                seen.add(id(paths))
                paths.insert(0, over)


zxbpp.set_include_path = _cpc_set_include_path

if __name__ == "__main__":
    sys.exit(zxbasm.main(sys.argv[1:]))
