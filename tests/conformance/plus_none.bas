REM MODELS: 464 664 6128
REM SIM: skip waits for frame flybacks (WaitRetrace), which the simulator does not generate; chipsrun runs it
REM Conformance: the cpcplus library on a CPC without ASIC (Phase 7 P2):
REM PlusAvailable() = 0 and every call a no-op with nothing disturbed (RAM at
REM &4000, interrupt state, the clock). First probe with a byte < &80 at &4000
REM (the probe writes it, so it has to put it back) and interrupts on.
REM
REM Ported from cpcbuild. Changed with the language: $XX is &XX, bAND/bOR/bXOR are AND/OR/XOR,
REM STR$ is N$/T$ (Locomotive puts a space before a number that is not negative), CHR$ 13 is
REM CHR$(13).
#define PN_BYTE 37
#include "lib/plusnone_body.bas"
