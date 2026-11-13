REM MODELS: 464 664 6128
REM SIM: skip waits for frame flybacks (WaitRetrace), which the simulator does not generate; chipsrun runs it
REM Conformance: as plus_none.bas but the first probe runs with a byte >= &80 at
REM &4000 (the probe needs no write then) and with interrupts off (the state
REM must stay off).
REM
REM Ported from cpcbuild. Changed with the language: $XX is &XX, bAND/bOR/bXOR are AND/OR/XOR,
REM STR$ is N$/T$ (Locomotive puts a space before a number that is not negative), CHR$ 13 is
REM CHR$(13).
#define PN_BYTE 229
#define PN_DI
#include "lib/plusnone_body.bas"
