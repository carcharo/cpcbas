#!/usr/bin/env python3
"""Run the reference compiler (zxbc) with the CPC runtime include path, plus an override directory.

CPCBAS_OVERRIDE (a directory with the patched lib/runtime files, tools/import-runtime.py PATCHED) is searched before the
reference's runtime, so the program's expanded assembler carries the patched files. Run from the reference checkout:

    cd ../zxbasic && CPCBAS_OVERRIDE=/abs/dir poetry run python /abs/path/zxbc-driver.py --arch cpc ... prog.bas -f asm -o out.asm
"""
import os
import sys

from src.zxbc import zxbc
from src.zxbpp import zxbpp

_original_set_include_path = zxbpp.set_include_path


def _override_set_include_path():
    _original_set_include_path()
    over = os.environ.get("CPCBAS_OVERRIDE")
    if over:
        seen = set()
        for paths in list(zxbpp.INCLUDE_MAP.values()) + [zxbpp.INCLUDEPATH]:
            if id(paths) not in seen:
                seen.add(id(paths))
                paths.insert(0, over)


zxbpp.set_include_path = _override_set_include_path

if __name__ == "__main__":
    sys.exit(zxbc.main(sys.argv[1:]))
