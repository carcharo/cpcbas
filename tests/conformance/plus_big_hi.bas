REM MODELS: plus
REM Conformance: as plus_big.bas with a program of about 32 KB, so that the library's code
REM lies above &8000 and the pictures it copies are in &4000-&7FFF (Phase 7 P3).
REM CPCBAS: --heap 512
REM BARE: skip the bare runtime (text, graphics) is 3 KB bigger, so a program with the library above &8000 ends past &A67B, which the firmware's loader (RUN" from disc) cannot load; plus_big.bas covers bare
REM
REM Ported from cpcbuild. Changed with the language: $XX is &XX, bAND/bOR/bXOR are AND/OR/XOR,
REM STR$ is N$/T$ (Locomotive puts a space before a number that is not negative), CHR$ 13 is
REM CHR$(13).
#define PB_LIB_HIGH
#define PB_PAD1 17000
#define PB_PAD2 11000
#include "lib/plusbig_body.bas"
