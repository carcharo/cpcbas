REM MODELS: plus
REM Conformance: the cpcplus library in a program of about 20 KB (Phase 7 P3): its code and
REM the sprite pictures it copies lie in &4000-&7FFF, where the ASIC register page appears.
REM See lib/plusbig_body.bas. Plus, Caprice32 only.
REM
REM Ported from cpcbuild. Changed with the language: $XX is &XX, bAND/bOR/bXOR are AND/OR/XOR,
REM STR$ is N$/T$ (Locomotive puts a space before a number that is not negative), CHR$ 13 is
REM CHR$(13).
#define PB_PAD1 17000
#define PB_PAD2 1500
#include "lib/plusbig_body.bas"
