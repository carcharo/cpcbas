	org 64
	.core.CPC_PRIV_BASE EQU 40448
	.core.CPC_PRIV_SIZE EQU 1024
	.core.CPC_STACK_TOP EQU 42496
	.core.CPC_MEM_TOP EQU 42619
.core.__START_PROGRAM:
	di
	ld sp, .core.CPC_STACK_TOP
	call .core.CPC_INIT_00_BOOTSTRAP
	call .core.CPC_INIT_CB_CORE
	call .core.CPC_INIT_FRAMEHOOK
	jp .core.__MAIN_PROGRAM__
.core.ZXBASIC_USER_DATA:
	; Defines USER DATA Length in bytes
.core.ZXBASIC_USER_DATA_LEN EQU .core.ZXBASIC_USER_DATA_END - .core.ZXBASIC_USER_DATA
	.core.__LABEL__.ZXBASIC_USER_DATA_LEN EQU .core.ZXBASIC_USER_DATA_LEN
	.core.__LABEL__.ZXBASIC_USER_DATA EQU .core.ZXBASIC_USER_DATA
_i:
	DEFB 00
_buf:
	DEFB 00
_x:
	DEFB 00
_y:
	DEFB 00
_v:
	DEFB 00
_p:
	DEFB 00, 00
_finetiles:
	DEFW .LABEL.__LABEL26
_finetiles.__DATA__.__PTR__:
	DEFW _finetiles.__DATA__
	DEFW 0
	DEFW 0
_finetiles.__DATA__:
	DEFB 41h
	DEFB 0C3h
	DEFB 01h
	DEFB 03h
	DEFB 01h
	DEFB 03h
	DEFB 00h
	DEFB 00h
	DEFB 0C3h
	DEFB 41h
	DEFB 03h
	DEFB 01h
	DEFB 03h
	DEFB 01h
	DEFB 00h
	DEFB 00h
	DEFB 0C3h
	DEFB 41h
	DEFB 03h
	DEFB 01h
	DEFB 03h
	DEFB 01h
	DEFB 00h
	DEFB 00h
	DEFB 41h
	DEFB 0C3h
	DEFB 01h
	DEFB 03h
	DEFB 01h
	DEFB 03h
	DEFB 00h
	DEFB 00h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 84h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 0C8h
	DEFB 0C0h
	DEFB 0C8h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 0C0h
	DEFB 0CAh
	DEFB 0CAh
	DEFB 0CFh
	DEFB 0CFh
	DEFB 0Fh
	DEFB 0Fh
	DEFB 16h
	DEFB 29h
	DEFB 3Ch
	DEFB 16h
	DEFB 29h
	DEFB 3Ch
	DEFB 16h
	DEFB 29h
	DEFB 3Ch
	DEFB 16h
	DEFB 0C5h
	DEFB 0C5h
	DEFB 0CFh
	DEFB 0CFh
	DEFB 0Fh
	DEFB 0Fh
	DEFB 16h
	DEFB 29h
	DEFB 3Ch
	DEFB 16h
	DEFB 29h
	DEFB 3Ch
	DEFB 16h
	DEFB 29h
	DEFB 3Ch
	DEFB 16h
	DEFB 3Ch
	DEFB 3Ch
	DEFB 3Ch
	DEFB 3Ch
	DEFB 3Ch
	DEFB 3Ch
	DEFB 3Ch
	DEFB 3Ch
	DEFB 3Ch
	DEFB 3Ch
	DEFB 3Ch
	DEFB 29h
	DEFB 3Ch
	DEFB 3Ch
	DEFB 00h
	DEFB 00h
	DEFB 3Ch
	DEFB 3Ch
	DEFB 3Ch
	DEFB 3Ch
	DEFB 29h
	DEFB 3Ch
	DEFB 3Ch
	DEFB 3Ch
	DEFB 3Ch
	DEFB 3Ch
	DEFB 3Ch
	DEFB 3Ch
	DEFB 3Ch
	DEFB 3Ch
	DEFB 00h
	DEFB 00h
	DEFB 0E0h
	DEFB 0D0h
	DEFB 0E1h
	DEFB 0D2h
	DEFB 0E0h
	DEFB 0D0h
	DEFB 0E0h
	DEFB 0D0h
	DEFB 0E0h
	DEFB 0D0h
	DEFB 0E1h
	DEFB 0D2h
	DEFB 0E0h
	DEFB 0D0h
	DEFB 0E0h
	DEFB 0D0h
.LABEL.__LABEL26:
	DEFW 0000h
	DEFB 01h
_finetiles_MAP:
	DEFW .LABEL.__LABEL27
_finetiles_MAP.__DATA__.__PTR__:
	DEFW _finetiles_MAP.__DATA__
	DEFW 0
	DEFW 0
_finetiles_MAP.__DATA__:
	DEFB 00h
	DEFB 01h
	DEFB 00h
	DEFB 01h
	DEFB 00h
	DEFB 01h
	DEFB 00h
	DEFB 01h
	DEFB 00h
	DEFB 01h
	DEFB 00h
	DEFB 01h
	DEFB 00h
	DEFB 01h
	DEFB 00h
	DEFB 01h
	DEFB 00h
	DEFB 01h
	DEFB 00h
	DEFB 01h
	DEFB 00h
	DEFB 01h
	DEFB 00h
	DEFB 01h
	DEFB 00h
	DEFB 01h
	DEFB 00h
	DEFB 01h
	DEFB 00h
	DEFB 01h
	DEFB 00h
	DEFB 01h
	DEFB 00h
	DEFB 01h
	DEFB 00h
	DEFB 01h
	DEFB 00h
	DEFB 01h
	DEFB 00h
	DEFB 01h
	DEFB 01h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 03h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 04h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 00h
	DEFB 00h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 03h
	DEFB 01h
	DEFB 01h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 03h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 00h
	DEFB 00h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 04h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 04h
	DEFB 02h
	DEFB 02h
	DEFB 03h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 01h
	DEFB 01h
	DEFB 02h
	DEFB 02h
	DEFB 04h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 04h
	DEFB 03h
	DEFB 02h
	DEFB 02h
	DEFB 00h
	DEFB 00h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 01h
	DEFB 01h
	DEFB 02h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 03h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 06h
	DEFB 02h
	DEFB 00h
	DEFB 00h
	DEFB 02h
	DEFB 07h
	DEFB 07h
	DEFB 08h
	DEFB 08h
	DEFB 07h
	DEFB 07h
	DEFB 08h
	DEFB 08h
	DEFB 07h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 07h
	DEFB 07h
	DEFB 08h
	DEFB 08h
	DEFB 07h
	DEFB 07h
	DEFB 08h
	DEFB 08h
	DEFB 02h
	DEFB 01h
	DEFB 01h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 09h
	DEFB 03h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 03h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 03h
	DEFB 04h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 09h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 00h
	DEFB 00h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 09h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 03h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 03h
	DEFB 02h
	DEFB 02h
	DEFB 09h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 04h
	DEFB 02h
	DEFB 01h
	DEFB 01h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 09h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 09h
	DEFB 02h
	DEFB 04h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 00h
	DEFB 00h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 09h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 06h
	DEFB 03h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 09h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 01h
	DEFB 01h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 09h
	DEFB 03h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 08h
	DEFB 08h
	DEFB 07h
	DEFB 07h
	DEFB 08h
	DEFB 08h
	DEFB 07h
	DEFB 07h
	DEFB 08h
	DEFB 08h
	DEFB 07h
	DEFB 07h
	DEFB 08h
	DEFB 08h
	DEFB 07h
	DEFB 07h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 09h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 00h
	DEFB 00h
	DEFB 04h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 03h
	DEFB 09h
	DEFB 02h
	DEFB 04h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 09h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 09h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 01h
	DEFB 01h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 04h
	DEFB 02h
	DEFB 09h
	DEFB 02h
	DEFB 02h
	DEFB 03h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 09h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 09h
	DEFB 03h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 00h
	DEFB 00h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 09h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 03h
	DEFB 02h
	DEFB 09h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 09h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 01h
	DEFB 01h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 09h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 06h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 02h
	DEFB 02h
	DEFB 00h
	DEFB 00h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 08h
	DEFB 08h
	DEFB 07h
	DEFB 07h
	DEFB 08h
	DEFB 08h
	DEFB 07h
	DEFB 07h
	DEFB 08h
	DEFB 08h
	DEFB 07h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 09h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 08h
	DEFB 07h
	DEFB 07h
	DEFB 08h
	DEFB 08h
	DEFB 07h
	DEFB 07h
	DEFB 08h
	DEFB 08h
	DEFB 07h
	DEFB 07h
	DEFB 08h
	DEFB 02h
	DEFB 02h
	DEFB 01h
	DEFB 01h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 09h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 04h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 09h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 03h
	DEFB 00h
	DEFB 00h
	DEFB 02h
	DEFB 03h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 09h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 03h
	DEFB 09h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 01h
	DEFB 01h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 09h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 09h
	DEFB 02h
	DEFB 04h
	DEFB 02h
	DEFB 02h
	DEFB 02h
	DEFB 00h
	DEFB 00h
	DEFB 06h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 06h
	DEFB 05h
	DEFB 01h
	DEFB 01h
	DEFB 08h
	DEFB 07h
	DEFB 07h
	DEFB 08h
	DEFB 08h
	DEFB 07h
	DEFB 07h
	DEFB 08h
	DEFB 08h
	DEFB 07h
	DEFB 07h
	DEFB 08h
	DEFB 08h
	DEFB 07h
	DEFB 07h
	DEFB 08h
	DEFB 08h
	DEFB 07h
	DEFB 07h
	DEFB 08h
	DEFB 08h
	DEFB 07h
	DEFB 07h
	DEFB 08h
	DEFB 08h
	DEFB 07h
	DEFB 07h
	DEFB 08h
	DEFB 08h
	DEFB 07h
	DEFB 07h
	DEFB 08h
	DEFB 08h
	DEFB 07h
	DEFB 07h
	DEFB 08h
	DEFB 08h
	DEFB 07h
	DEFB 00h
	DEFB 00h
	DEFB 01h
	DEFB 00h
	DEFB 01h
	DEFB 00h
	DEFB 01h
	DEFB 00h
	DEFB 01h
	DEFB 00h
	DEFB 01h
	DEFB 00h
	DEFB 01h
	DEFB 00h
	DEFB 01h
	DEFB 00h
	DEFB 01h
	DEFB 00h
	DEFB 01h
	DEFB 00h
	DEFB 01h
	DEFB 00h
	DEFB 01h
	DEFB 00h
	DEFB 01h
	DEFB 00h
	DEFB 01h
	DEFB 00h
	DEFB 01h
	DEFB 00h
	DEFB 01h
	DEFB 00h
	DEFB 01h
	DEFB 00h
	DEFB 01h
	DEFB 00h
	DEFB 01h
	DEFB 00h
	DEFB 01h
	DEFB 00h
	DEFB 01h
.LABEL.__LABEL27:
	DEFW 0000h
	DEFB 01h
_finetiles_pal:
	DEFW .LABEL.__LABEL28
_finetiles_pal.__DATA__.__PTR__:
	DEFW _finetiles_pal.__DATA__
	DEFW 0
	DEFW 0
_finetiles_pal.__DATA__:
	DEFB 00h
	DEFB 01h
	DEFB 02h
	DEFB 0Bh
	DEFB 14h
	DEFB 1Ah
	DEFB 03h
	DEFB 06h
	DEFB 0Fh
	DEFB 18h
	DEFB 09h
	DEFB 12h
	DEFB 04h
	DEFB 08h
	DEFB 0Dh
	DEFB 0Ah
.LABEL.__LABEL28:
	DEFW 0000h
	DEFB 01h
_finesprites:
	DEFW .LABEL.__LABEL29
_finesprites.__DATA__.__PTR__:
	DEFW _finesprites.__DATA__
	DEFW 0
	DEFW 0
_finesprites.__DATA__:
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0AAh
	DEFB 04h
	DEFB 55h
	DEFB 08h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 00h
	DEFB 58h
	DEFB 00h
	DEFB 24h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0AAh
	DEFB 04h
	DEFB 00h
	DEFB 0F0h
	DEFB 00h
	DEFB 30h
	DEFB 55h
	DEFB 08h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 00h
	DEFB 58h
	DEFB 00h
	DEFB 0F0h
	DEFB 00h
	DEFB 30h
	DEFB 00h
	DEFB 24h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0AAh
	DEFB 04h
	DEFB 00h
	DEFB 0F0h
	DEFB 00h
	DEFB 0F0h
	DEFB 00h
	DEFB 30h
	DEFB 00h
	DEFB 30h
	DEFB 55h
	DEFB 08h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 00h
	DEFB 58h
	DEFB 00h
	DEFB 0F0h
	DEFB 00h
	DEFB 0F0h
	DEFB 00h
	DEFB 30h
	DEFB 00h
	DEFB 30h
	DEFB 00h
	DEFB 24h
	DEFB 0FFh
	DEFB 00h
	DEFB 0AAh
	DEFB 04h
	DEFB 00h
	DEFB 0F0h
	DEFB 00h
	DEFB 0F0h
	DEFB 00h
	DEFB 0F0h
	DEFB 00h
	DEFB 30h
	DEFB 00h
	DEFB 30h
	DEFB 00h
	DEFB 30h
	DEFB 55h
	DEFB 08h
	DEFB 0AAh
	DEFB 04h
	DEFB 00h
	DEFB 30h
	DEFB 00h
	DEFB 30h
	DEFB 00h
	DEFB 30h
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 55h
	DEFB 08h
	DEFB 0FFh
	DEFB 00h
	DEFB 00h
	DEFB 18h
	DEFB 00h
	DEFB 30h
	DEFB 00h
	DEFB 30h
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0AEh
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0AAh
	DEFB 04h
	DEFB 00h
	DEFB 30h
	DEFB 00h
	DEFB 30h
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 55h
	DEFB 08h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 00h
	DEFB 18h
	DEFB 00h
	DEFB 30h
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0AEh
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0AAh
	DEFB 04h
	DEFB 00h
	DEFB 30h
	DEFB 00h
	DEFB 0FFh
	DEFB 55h
	DEFB 08h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 00h
	DEFB 18h
	DEFB 00h
	DEFB 0AEh
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0AAh
	DEFB 04h
	DEFB 55h
	DEFB 08h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0AAh
	DEFB 14h
	DEFB 55h
	DEFB 28h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 00h
	DEFB 3Ch
	DEFB 00h
	DEFB 3Ch
	DEFB 00h
	DEFB 3Ch
	DEFB 00h
	DEFB 3Ch
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0AAh
	DEFB 14h
	DEFB 00h
	DEFB 7Ch
	DEFB 00h
	DEFB 0FCh
	DEFB 00h
	DEFB 0FCh
	DEFB 00h
	DEFB 0BCh
	DEFB 55h
	DEFB 28h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 00h
	DEFB 7Ch
	DEFB 00h
	DEFB 0FCh
	DEFB 00h
	DEFB 0FCh
	DEFB 00h
	DEFB 0FCh
	DEFB 00h
	DEFB 0FCh
	DEFB 00h
	DEFB 0BCh
	DEFB 0FFh
	DEFB 00h
	DEFB 0AAh
	DEFB 14h
	DEFB 00h
	DEFB 7Ch
	DEFB 00h
	DEFB 0F0h
	DEFB 00h
	DEFB 0FCh
	DEFB 00h
	DEFB 0F8h
	DEFB 00h
	DEFB 0F4h
	DEFB 00h
	DEFB 0A8h
	DEFB 55h
	DEFB 00h
	DEFB 0AAh
	DEFB 14h
	DEFB 00h
	DEFB 0FCh
	DEFB 00h
	DEFB 0F0h
	DEFB 00h
	DEFB 0FCh
	DEFB 00h
	DEFB 0F8h
	DEFB 00h
	DEFB 0F4h
	DEFB 00h
	DEFB 3Ch
	DEFB 55h
	DEFB 00h
	DEFB 0AAh
	DEFB 14h
	DEFB 00h
	DEFB 0FCh
	DEFB 00h
	DEFB 0F0h
	DEFB 00h
	DEFB 0FCh
	DEFB 00h
	DEFB 0F8h
	DEFB 00h
	DEFB 0B4h
	DEFB 00h
	DEFB 3Ch
	DEFB 55h
	DEFB 00h
	DEFB 00h
	DEFB 3Ch
	DEFB 00h
	DEFB 0FCh
	DEFB 00h
	DEFB 0A0h
	DEFB 00h
	DEFB 0FCh
	DEFB 00h
	DEFB 0F8h
	DEFB 00h
	DEFB 14h
	DEFB 00h
	DEFB 3Ch
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 3Ch
	DEFB 00h
	DEFB 0FCh
	DEFB 00h
	DEFB 0A0h
	DEFB 00h
	DEFB 0FCh
	DEFB 00h
	DEFB 0F8h
	DEFB 00h
	DEFB 14h
	DEFB 00h
	DEFB 3Ch
	DEFB 00h
	DEFB 00h
	DEFB 0AAh
	DEFB 14h
	DEFB 00h
	DEFB 0FCh
	DEFB 00h
	DEFB 0FCh
	DEFB 00h
	DEFB 0FCh
	DEFB 00h
	DEFB 3Ch
	DEFB 00h
	DEFB 3Ch
	DEFB 00h
	DEFB 3Ch
	DEFB 55h
	DEFB 00h
	DEFB 0AAh
	DEFB 14h
	DEFB 00h
	DEFB 0FCh
	DEFB 00h
	DEFB 0FCh
	DEFB 00h
	DEFB 0BCh
	DEFB 00h
	DEFB 3Ch
	DEFB 00h
	DEFB 3Ch
	DEFB 00h
	DEFB 3Ch
	DEFB 55h
	DEFB 00h
	DEFB 0AAh
	DEFB 14h
	DEFB 00h
	DEFB 7Ch
	DEFB 00h
	DEFB 0FCh
	DEFB 00h
	DEFB 3Ch
	DEFB 00h
	DEFB 3Ch
	DEFB 00h
	DEFB 3Ch
	DEFB 00h
	DEFB 28h
	DEFB 55h
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 00h
	DEFB 7Ch
	DEFB 00h
	DEFB 0BCh
	DEFB 00h
	DEFB 3Ch
	DEFB 00h
	DEFB 3Ch
	DEFB 00h
	DEFB 3Ch
	DEFB 00h
	DEFB 28h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0AAh
	DEFB 14h
	DEFB 00h
	DEFB 14h
	DEFB 00h
	DEFB 3Ch
	DEFB 00h
	DEFB 3Ch
	DEFB 00h
	DEFB 28h
	DEFB 55h
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0AAh
	DEFB 00h
	DEFB 55h
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0AAh
	DEFB 51h
	DEFB 55h
	DEFB 0A2h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0B3h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 0AAh
	DEFB 51h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0B3h
	DEFB 55h
	DEFB 22h
	DEFB 0FFh
	DEFB 00h
	DEFB 0FFh
	DEFB 00h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0B3h
	DEFB 00h
	DEFB 33h
	DEFB 0FFh
	DEFB 00h
	DEFB 0AAh
	DEFB 51h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0B3h
	DEFB 00h
	DEFB 33h
	DEFB 55h
	DEFB 22h
	DEFB 0AAh
	DEFB 51h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F0h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F2h
	DEFB 00h
	DEFB 0B1h
	DEFB 00h
	DEFB 33h
	DEFB 55h
	DEFB 22h
	DEFB 0AAh
	DEFB 51h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F0h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F2h
	DEFB 00h
	DEFB 0B1h
	DEFB 00h
	DEFB 33h
	DEFB 55h
	DEFB 22h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0A4h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F2h
	DEFB 00h
	DEFB 19h
	DEFB 00h
	DEFB 33h
	DEFB 00h
	DEFB 33h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0A4h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F2h
	DEFB 00h
	DEFB 19h
	DEFB 00h
	DEFB 33h
	DEFB 00h
	DEFB 33h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0B3h
	DEFB 00h
	DEFB 33h
	DEFB 00h
	DEFB 33h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0B3h
	DEFB 00h
	DEFB 33h
	DEFB 00h
	DEFB 33h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0B3h
	DEFB 00h
	DEFB 33h
	DEFB 00h
	DEFB 33h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0B3h
	DEFB 00h
	DEFB 33h
	DEFB 00h
	DEFB 33h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0B3h
	DEFB 00h
	DEFB 33h
	DEFB 00h
	DEFB 33h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0F3h
	DEFB 00h
	DEFB 0B3h
	DEFB 00h
	DEFB 33h
	DEFB 00h
	DEFB 33h
	DEFB 00h
	DEFB 0F3h
	DEFB 0FFh
	DEFB 00h
	DEFB 00h
	DEFB 0F3h
	DEFB 0FFh
	DEFB 00h
	DEFB 00h
	DEFB 0F3h
	DEFB 0FFh
	DEFB 00h
	DEFB 00h
	DEFB 33h
	DEFB 0FFh
	DEFB 00h
.LABEL.__LABEL29:
	DEFW 0000h
	DEFB 01h
_st:
	DEFW .LABEL.__LABEL30
_st.__DATA__.__PTR__:
	DEFW _st.__DATA__
	DEFW 0
	DEFW 0
_st.__DATA__:
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
	DEFB 00h
.LABEL.__LABEL30:
	DEFW 0000h
	DEFB 01h
.core.ZXBASIC_USER_DATA_END:
.core.__MAIN_PROGRAM__:
#line 92 "cpcbuild/lib/cpcbuild/spritelist.bas"

		push namespace core
		__SL_MAX equ 40
		pop namespace

#line 97 "cpcbuild/lib/cpcbuild/spritelist.bas"
	xor a
	call _Mode
	ld a, 16
	push af
	ld hl, _finetiles_pal.__DATA__
	push hl
	call _SetPalette
	xor a
	call _SetBorder
	call _ScreenInit
	ld hl, _finetiles.__DATA__
	call _SetTileSet
	ld a, 2
	call _SetTileWidth
	ld a, 25
	push af
	ld a, 40
	push af
	xor a
	push af
	xor a
	push af
	ld hl, _finetiles_MAP.__DATA__
	push hl
	call _TileMap
	call _EnableDoubleBuffer
	ld hl, _st.__DATA__
	ld (_p), hl
	xor a
	ld (_i), a
	jp .LABEL.__LABEL0
.LABEL.__LABEL3:
	ld hl, (_p)
	push hl
	ld a, (_i)
	ld h, 16
	call .core.__MUL8_FAST
	pop hl
	add a, 6
	ld (hl), a
	ld hl, (_p)
	inc hl
	push hl
	ld a, (_i)
	ld h, 40
	call .core.__MUL8_FAST
	pop hl
	add a, 24
	ld (hl), a
	ld a, (_i)
	and 1
	jp z, .LABEL.__LABEL5
	ld hl, (_p)
	inc hl
	inc hl
	ld a, 255
	ld (hl), a
	jp .LABEL.__LABEL6
.LABEL.__LABEL5:
	ld hl, (_p)
	inc hl
	inc hl
	ld a, 1
	ld (hl), a
.LABEL.__LABEL6:
	ld hl, (_p)
	inc hl
	inc hl
	inc hl
	push hl
	ld a, (_i)
	ld h, 3
	call .core.__MODU8_FAST
	pop hl
	inc a
	ld (hl), a
	ld hl, (_p)
	ld de, 4
	add hl, de
	ld a, 255
	ld (hl), a
	ld hl, (_p)
	ld de, 5
	add hl, de
	ld a, 255
	ld (hl), a
	ld hl, (_p)
	ld de, 8
	add hl, de
	push hl
	ld a, (_i)
	ld h, 3
	call .core.__MODU8_FAST
	ld l, a
	ld h, 0
	ld de, 256
	call .core.__MUL16_FAST
	push hl
	ld hl, _finesprites
	call .core.__ARRAY
	ex de, hl
	pop hl
	ld (hl), e
	inc hl
	ld (hl), d
	ld hl, (_p)
	ld de, 16
	add hl, de
	ld (_p), hl
	ld hl, _i
	inc (hl)
.LABEL.__LABEL0:
	ld a, 3
	ld hl, (_i - 1)
	cp h
	jp nc, .LABEL.__LABEL3
	xor a
	ld (_buf), a
.LABEL.__LABEL7:
	ld hl, _st.__DATA__
	push hl
	ld a, (_buf)
	ld l, a
	ld h, 0
	ex de, hl
	pop hl
	add hl, de
	ld (_p), hl
	xor a
	ld (_i), a
	jp .LABEL.__LABEL10
.LABEL.__LABEL13:
	ld hl, (_p)
	ld de, 4
	add hl, de
	ld a, (hl)
	ld (_x), a
	sub 255
	jp z, .LABEL.__LABEL16
	ld a, 16
	push af
	ld a, 8
	push af
	ld hl, (_p)
	ld de, 6
	add hl, de
	ld a, (hl)
	push af
	ld a, (_x)
	push af
	ld a, 40
	push af
	ld hl, _finetiles_MAP.__DATA__
	push hl
	call _TileRestore
.LABEL.__LABEL16:
	ld hl, (_p)
	ld de, 16
	add hl, de
	ld (_p), hl
	ld hl, _i
	inc (hl)
.LABEL.__LABEL10:
	ld a, 3
	ld hl, (_i - 1)
	cp h
	jp nc, .LABEL.__LABEL13
	ld hl, _st.__DATA__
	ld (_p), hl
	xor a
	ld (_i), a
	jp .LABEL.__LABEL17
.LABEL.__LABEL20:
	ld hl, (_p)
	inc hl
	inc hl
	ld a, (hl)
	ld (_v), a
	ld hl, (_p)
	ld a, (_v)
	add a, (hl)
	ld (_x), a
	cp 2
	sbc a, a
	ld d, a
	ld a, 70
	ld hl, (_x - 1)
	cp h
	sbc a, a
	or d
	jp z, .LABEL.__LABEL23
	ld a, (_v)
	neg
	ld (_v), a
	ld hl, (_p)
	inc hl
	inc hl
	ld a, (_v)
	ld (hl), a
	ld hl, (_x - 1)
	ld a, (_v)
	add a, h
	ld h, a
	ld a, (_v)
	add a, h
	ld (_x), a
.LABEL.__LABEL23:
	ld hl, (_p)
	inc hl
	inc hl
	inc hl
	ld a, (hl)
	ld (_v), a
	ld hl, (_p)
	inc hl
	ld a, (_v)
	add a, (hl)
	ld (_y), a
	cp 8
	sbc a, a
	ld d, a
	ld a, 176
	ld hl, (_y - 1)
	cp h
	sbc a, a
	or d
	jp z, .LABEL.__LABEL25
	ld a, (_v)
	neg
	ld (_v), a
	ld hl, (_p)
	inc hl
	inc hl
	inc hl
	ld a, (_v)
	ld (hl), a
	ld hl, (_y - 1)
	ld a, (_v)
	add a, h
	ld h, a
	ld a, (_v)
	add a, h
	ld (_y), a
.LABEL.__LABEL25:
	ld hl, (_p)
	ld a, (_x)
	ld (hl), a
	ld hl, (_p)
	inc hl
	ld a, (_y)
	ld (hl), a
	ld hl, (_p)
	ld de, 8
	add hl, de
	ld a, (hl)
	inc hl
	ld h, (hl)
	ld l, a
	push hl
	ld a, 16
	push af
	ld a, 8
	push af
	ld a, (_y)
	ld l, a
	ld h, 0
	push hl
	ld a, (_x)
	ld l, a
	ld h, 0
	push hl
	call _PutSpriteMasked
	ld hl, (_p)
	ld de, 4
	add hl, de
	push hl
	ld a, (_buf)
	ld l, a
	ld h, 0
	ex de, hl
	pop hl
	add hl, de
	ld a, (_x)
	ld (hl), a
	ld hl, (_p)
	ld de, 6
	add hl, de
	push hl
	ld a, (_buf)
	ld l, a
	ld h, 0
	ex de, hl
	pop hl
	add hl, de
	ld a, (_y)
	ld (hl), a
	ld hl, (_p)
	ld de, 16
	add hl, de
	ld (_p), hl
	ld hl, _i
	inc (hl)
.LABEL.__LABEL17:
	ld a, 3
	ld hl, (_i - 1)
	cp h
	jp nc, .LABEL.__LABEL20
	call _FlipBuffer
	ld a, 1
	ld hl, (_buf - 1)
	sub h
	ld (_buf), a
	call _ScanKeys
	ld a, 66
	call _KeyDown
	or a
	jp z, .LABEL.__LABEL7
	call _DisableDoubleBuffer
	xor a
	call _SetTileWidth
	ld hl, 0
	ld b, h
	ld c, l
.core.__END_PROGRAM:
	jp .core.__CPC_END
_Mode:
#line 120 "src/lib/arch/cpc/stdlib/cpc.bas"

		push namespace core
		and 3
		push af
		call .core.__FW_CALL
		defw $BC0E
		pop af
		call __CPC_SET_MODE_VARS
		call CLS
		pop namespace

#line 131 "src/lib/arch/cpc/stdlib/cpc.bas"
_Mode__leave:
	ret
_SetBorder:
#line 165 "src/lib/arch/cpc/stdlib/cpc.bas"

		call .core.__CPC_SET_BORDER

#line 168 "src/lib/arch/cpc/stdlib/cpc.bas"
_SetBorder__leave:
	ret
_CbReserve4000:
#line 26 "cpcbuild/lib/cpcbuild/reserve.bas"

		push namespace core
__CPC_RESERVE_4000:
		pop namespace

#line 31 "cpcbuild/lib/cpcbuild/reserve.bas"
_CbReserve4000__leave:
	ret
_ScreenInit:
#line 41 "cpcbuild/lib/cpcbuild/display.bas"

		push namespace core
		call __CB_SYNC
		pop namespace

#line 46 "cpcbuild/lib/cpcbuild/display.bas"
_ScreenInit__leave:
	ret
_EnableDoubleBuffer:
	call _CbReserve4000
#line 66 "cpcbuild/lib/cpcbuild/display.bas"

		push namespace core
		call __CB_DBUF_ON
		pop namespace

#line 71 "cpcbuild/lib/cpcbuild/display.bas"
_EnableDoubleBuffer__leave:
	ret
_DisableDoubleBuffer:
#line 75 "cpcbuild/lib/cpcbuild/display.bas"

		push namespace core
		call __CB_DBUF_OFF
		pop namespace

#line 80 "cpcbuild/lib/cpcbuild/display.bas"
_DisableDoubleBuffer__leave:
	ret
_FlipBuffer:
#line 84 "cpcbuild/lib/cpcbuild/display.bas"

		push namespace core
		call __CB_FLIP
		pop namespace

#line 89 "cpcbuild/lib/cpcbuild/display.bas"
_FlipBuffer__leave:
	ret
_PutSpriteMasked:
	push ix
	ld ix, 0
	add ix, sp
#line 44 "cpcbuild/lib/cpcbuild/sprites.bas"

		push namespace core
		call __CB_PUT_MASKED
		pop namespace

#line 49 "cpcbuild/lib/cpcbuild/sprites.bas"
_PutSpriteMasked__leave:
	ld sp, ix
	pop ix
	exx
	pop hl
	pop bc
	pop bc
	pop bc
	pop bc
	ex (sp), hl
	exx
	ret
_SetTileSet:
#line 55 "cpcbuild/lib/cpcbuild/tiles.bas"

		ld (.core.CB_TILESET), hl

#line 58 "cpcbuild/lib/cpcbuild/tiles.bas"
_SetTileSet__leave:
	ret
_SetTileWidth:
#line 62 "cpcbuild/lib/cpcbuild/tiles.bas"

		push namespace core
		PROC
		LOCAL __STW_SET
		ld   b, a
		ld   a, 1
		dec  b
		jr   z, __STW_SET
		inc  a
		dec  b
		jr   z, __STW_SET
		inc  a
		dec  b
		dec  b
		jr   z, __STW_SET
		xor  a
__STW_SET:
		ld   (CB_TILEW), a
		ENDP
		pop namespace

#line 83 "cpcbuild/lib/cpcbuild/tiles.bas"
_SetTileWidth__leave:
	ret
_TileMap:
	push ix
	ld ix, 0
	add ix, sp
#line 133 "cpcbuild/lib/cpcbuild/tiles.bas"

		push namespace core
		ld l, (ix+4)
		ld h, (ix+5)
		ld e, (ix+7)
		ld d, (ix+9)
		ld c, (ix+11)
		ld b, (ix+13)
		call __CB_TILEMAP
		pop namespace

#line 144 "cpcbuild/lib/cpcbuild/tiles.bas"
_TileMap__leave:
	ld sp, ix
	pop ix
	exx
	pop hl
	pop bc
	pop bc
	pop bc
	pop bc
	ex (sp), hl
	exx
	ret
_TileRestore:
	push ix
	ld ix, 0
	add ix, sp
#line 164 "cpcbuild/lib/cpcbuild/tiles.bas"

		push namespace core
		ld l, (ix+4)
		ld h, (ix+5)
		ld e, (ix+9)
		ld d, (ix+11)
		ld c, (ix+13)
		ld b, (ix+15)
		ld a, (ix+7)
		call __CB_TILE_RESTORE
		pop namespace

#line 176 "cpcbuild/lib/cpcbuild/tiles.bas"
_TileRestore__leave:
	exx
	ld hl, 12
__EXIT_FUNCTION:
	ld sp, ix
	pop ix
	pop de
	add hl, sp
	ld sp, hl
	push de
	exx
	ret
_ScanKeys:
#line 95 "cpcbuild/lib/cpcbuild/keyboard.bas"

		push namespace core
		call __CB_SCAN_KEYS
		pop namespace

#line 100 "cpcbuild/lib/cpcbuild/keyboard.bas"
_ScanKeys__leave:
	ret
_KeyDown:
#line 104 "cpcbuild/lib/cpcbuild/keyboard.bas"

		push namespace core
		call __CB_KEY_DOWN
		pop namespace

#line 109 "cpcbuild/lib/cpcbuild/keyboard.bas"
_KeyDown__leave:
	ret
_SetPalette:
	push ix
	ld ix, 0
	add ix, sp
#line 33 "cpcbuild/lib/cpcbuild/palette.bas"

		push namespace core
		ld l, (ix+4)
		ld h, (ix+5)
		ld b, (ix+7)
		ld c, 0
		call __CB_PAL_UPLOAD
		pop namespace

#line 42 "cpcbuild/lib/cpcbuild/palette.bas"
_SetPalette__leave:
	ld sp, ix
	pop ix
	exx
	pop hl
	pop bc
	ex (sp), hl
	exx
	ret
	;; --- end of user code ---
#line 1 "src/lib/arch/zx48k/runtime/arith/div8.asm"
	    ; --------------------------------
	    push namespace core

__DIVU8:	; 8 bit unsigned integer division
	    ; Divides (Top of stack, High Byte) / A
	    pop hl	; --------------------------------
	    ex (sp), hl	; CALLEE

__DIVU8_FAST:	; Does A / H
	    ld l, h
	    ld h, a		; At this point do H / L

	    ld b, 8
	    xor a		; A = 0, Carry Flag = 0

__DIV8LOOP:
	    sla	h
	    rla
	    cp	l
	    jr	c, __DIV8NOSUB
	    sub	l
	    inc	h

__DIV8NOSUB:
	    djnz __DIV8LOOP

	    ld	l, a		; save remainder
	    ld	a, h		;

	    ret			; a = Quotient,


	    ; --------------------------------
__DIVI8:		; 8 bit signed integer division Divides (Top of stack) / A
	    pop hl		; --------------------------------
	    ex (sp), hl

__DIVI8_FAST:
	    ld e, a		; store operands for later
	    ld c, h

	    or a		; negative?
	    jp p, __DIV8A
	    neg			; Make it positive

__DIV8A:
	    ex af, af'
	    ld a, h
	    or a
	    jp p, __DIV8B
	    neg
	    ld h, a		; make it positive

__DIV8B:
	    ex af, af'

	    call __DIVU8_FAST

	    ld a, c
	    xor e		; bit 7 of A = 1 if result is negative

	    ld a, h		; Quotient
	    ret p		; return if positive

	    neg
	    ret


__MODU8:		; 8 bit module. REturns A mod (Top of stack) (unsigned operands)
	    pop hl
	    ex (sp), hl	; CALLEE

__MODU8_FAST:	; __FASTCALL__ entry
	    call __DIVU8_FAST
	    ld a, l		; Remainder

	    ret		; a = Modulus


__MODI8:		; 8 bit module. REturns A mod (Top of stack) (For singed operands)
	    pop hl
	    ex (sp), hl	; CALLEE

__MODI8_FAST:	; __FASTCALL__ entry
	    call __DIVI8_FAST
	    ld a, l		; remainder

	    ret		; a = Modulus

	    pop namespace
#line 54 "cpcbuild/lib/cpcbuild/palette.bas"
#line 1 "src/lib/arch/zx48k/runtime/arith/mul16.asm"
	    push namespace core

__MUL16:	; Mutiplies HL with the last value stored into de stack
	    ; Works for both signed and unsigned

	    PROC

	    LOCAL __MUL16LOOP
	    LOCAL __MUL16NOADD

	    ex de, hl
	    pop hl		; Return address
	    ex (sp), hl ; CALLEE caller convention

__MUL16_FAST:
	    ld b, 16
	    ld a, h
	    ld c, l
	    ld hl, 0

__MUL16LOOP:
	    add hl, hl  ; hl << 1
	    sla c
	    rla         ; a,c << 1
	    jp nc, __MUL16NOADD
	    add hl, de

__MUL16NOADD:
	    djnz __MUL16LOOP

	    ret	; Result in hl (16 lower bits)

	    ENDP

	    pop namespace
#line 55 "cpcbuild/lib/cpcbuild/palette.bas"
#line 1 "src/lib/arch/zx48k/runtime/arith/mul8.asm"
	    push namespace core

__MUL8:		; Performs 8bit x 8bit multiplication
	    PROC

	    ;LOCAL __MUL8A
	    LOCAL __MUL8LOOP
	    LOCAL __MUL8B
	    ; 1st operand (byte) in A, 2nd operand into the stack (AF)
	    pop hl	; return address
	    ex (sp), hl ; CALLE convention

;;__MUL8_FAST: ; __FASTCALL__ entry
	;;	ld e, a
	;;	ld d, 0
	;;	ld l, d
	;;
	;;	sla h
	;;	jr nc, __MUL8A
	;;	ld l, e
	;;
;;__MUL8A:
	;;
	;;	ld b, 7
;;__MUL8LOOP:
	;;	add hl, hl
	;;	jr nc, __MUL8B
	;;
	;;	add hl, de
	;;
;;__MUL8B:
	;;	djnz __MUL8LOOP
	;;
	;;	ld a, l ; result = A and HL  (Truncate to lower 8 bits)

__MUL8_FAST: ; __FASTCALL__ entry, a = a * h (8 bit mul) and Carry

	    ld b, 8
	    ld l, a
	    xor a

__MUL8LOOP:
	    add a, a ; a *= 2
	    sla l
	    jp nc, __MUL8B
	    add a, h

__MUL8B:
	    djnz __MUL8LOOP

	    ret		; result = HL
	    ENDP

	    pop namespace
#line 56 "cpcbuild/lib/cpcbuild/palette.bas"
#line 1 "src/lib/arch/cpc/runtime/array/array.asm"
; vim: ts=4:et:sw=4:
	; Copyleft (K) by Jose M. Rodriguez de la Rosa
	;  (a.k.a. Boriel)
;  http://www.boriel.com
	; -------------------------------------------------------------------
	; Simple array Index routine
	; Number of total indexes dimensions - 1 at beginning of memory
	; HL = Start of array memory (First two bytes contains N-1 dimensions)
	; Dimension values on the stack, (top of the stack, highest dimension)
	; E.g. A(2, 4) -> PUSH <4>; PUSH <2>

	; For any array of N dimension A(aN-1, ..., a1, a0)
	; and dimensions D[bN-1, ..., b1, b0], the offset is calculated as
	; O = [a0 + b0 * (a1 + b1 * (a2 + ... bN-2(aN-1)))]
; What I will do here is to calculate the following sequence:
	; ((aN-1 * bN-2) + aN-2) * bN-3 + ...
	;
; Amstrad CPC override: only change from zx48k's version is LBOUND_PTR's
	; storage address. zx48k uses the Spectrum ROM's MEMBOT sysvar; on the
	; CPC that address falls inside ordinary program RAM (the compiled .bin
	; starts at $0040), so ARRAY_SCRATCH (sysvars.asm) is a dedicated 8-byte
	; scratch area in the private runtime block instead (same fix zx81sd's
	; own array/array.asm applies).

#line 1 "src/lib/arch/zx48k/runtime/arith/fmul16.asm"
	;; Performs a faster multiply for little 16bit numbs


	    push namespace core

__FMUL16:
	    xor a
	    or h
	    jp nz, __MUL16_FAST
	    or l
	    ret z

	    cp 33
	    jp nc, __MUL16_FAST

	    ld b, l
	    ld l, h  ; HL = 0

1:
	    add hl, de
	    djnz 1b
	    ret

	    pop namespace
#line 26 "src/lib/arch/cpc/runtime/array/array.asm"
#line 1 "src/lib/arch/cpc/runtime/sysvars.asm"
	; -----------------------------------------------------------------------
	; Amstrad CPC system variables
	;
	; zx48k's own sysvars.asm and the runtime files ported from it hard-code
	; Spectrum sysvar addresses ($5C00-$5CB5), which are ordinary program RAM
	; on the CPC (inside the code/data area, $0040 up); using them as-is would
	; silently corrupt the compiled program. This file relocates them into the
	; private runtime block instead ($9E00-$A1FF, 1 KB -- see
	; .core.CPC_PRIV_BASE / CPC_PRIV_SIZE, emitted as EQUs by
	; src/arch/cpc/backend/main.py's prologue).
	;
	; This file only defines the *names and offsets*; CPC_INIT_00_BOOTSTRAP
	; (bootstrap.asm) fills them in at runtime.
	;
; Layout ($9E00 + offset), all byte offsets from SYSVAR_BASE:
	;
	;   Offset  Size  Name               Note
	;   ------  ----  -----------------  ---------------------------------
	;   $00     2     CHARS              pointer to charset (8x8 cells);
	;                                     unused by print.asm now (the
	;                                     firmware draws its own glyphs) but
	;                                     kept for zx48k source parity
	;   $02     2     UDG                pointer to UDG charset (ditto)
	;   $04     2     COORDS             last PLOT/graphics coords (X,Y)
	;   $06     1     FLAGS2             screen flags (OVER/BOLD/ITALIC)
	;   $07     1     ECHO_E             reserved, unused for now
	;   $08     2     DFCC               unused by print.asm now (no VRAM
	;                                     pointer to track -- the firmware
	;                                     owns screen addressing); kept so
	;                                     any stray reference still assembles
	;   $0A     2     DFCCL              ditto, unused
;   $0C     2     S_POSN             vestigial: __LOAD_S_POSN/
	;                                     __SAVE_S_POSN (sposn.asm) now read
	;                                     the firmware's own live cursor via
	;                                     TXT_GET_CURSOR/TXT_SET_CURSOR
	;                                     instead of caching it here. Kept
	;                                     zeroed by bootstrap.asm; nothing
	;                                     reads or writes it any more
	;   $0E     1     ATTR_P             permanent attribute (INK/PAPER/etc.)
	;   $0F     1     MASK_P             permanent transparency mask -- kept
	;                                     immediately after ATTR_P because
	;                                     ink.asm/paper.asm/bright.asm/
	;                                     flash.asm (byte-for-byte zx48k)
	;                                     reach it with a plain `inc de`/
	;                                     `inc hl` from ATTR_P
	;   $10     1     ATTR_T             temporary attribute (same encoding
	;                                     as ATTR_P; see the bit layout below)
	;   $11     1     MASK_T             temporary transparency mask, same
	;                                     adjacency rule as MASK_P
	;   $12     1     P_FLAG             permanent print flags (OVER/INVERSE)
	;   $13     1     TV_FLAG            flags controlling output to screen
	;   $14     8     MEM0               scratch buffer; print.asm reuses it
	;                                     to stash a control code's first
	;                                     parameter byte across two
	;                                     __PRINTCHAR calls (AT's row, TAB's
	;                                     first byte) now that it doesn't need
	;                                     it for character bitmap generation
	;   $1C     2     SCREEN_ADDR        pointer to the screen bitmap base
	;   $1E     2     SCREEN_ATTR_ADDR   placeholder -- the CPC has no
	;                                    per-cell attribute byte in memory
	;                                    the way the Spectrum does
	;   $20     1     ERR_NR             error code (-1 = no error)
	;   $21     2     FRAMES             software frame counter
	;   $23     2     RANDOM_SEED_LOW    RNG seed, low 16 bits
	;   $25     8     ARRAY_SCRATCH      LBOUND_PTR/UBOUND_PTR/RET_ADDR/
	;                                    TMP_ARR_PTR (2 bytes each)
	;   $2D     2     CHR_SCRATCH        return-address scratch for CHR$()
	;   $2F     4     DIVF_SCRATCH       TMP (2B) + ERR_SP (2B) for float
	;                                    division
	;   $33     2     FW_BC              firmware's BC' shadow (fwcall.asm's
	;                                    gate); seeded from the live BC' by
	;                                    CPC_INIT_00_BOOTSTRAP before
	;                                    anything else can disturb it
	;   $35     1     IN_FW              "inside the firmware gate" flag,
	;                                    set/cleared by fwcall.asm around
	;                                    every call; for a future IM1
	;                                    front-end (Sec6.1 stage 2) to tell
	;                                    a firmware call from user code
	;   $36     6     MODF16_SCRATCH     return addr + divider DE/HL for
	;                                    MOD16.16, kept separate from
	;                                    ARRAY_SCRATCH (the two must not alias)
	;   $3C     1     PRINT_STATE        print.asm's control-code state
;                                    machine: 0 = idle, nonzero = "the
	;                                    next __PRINTCHAR byte is a parameter
	;                                    for control code N" (see print.asm)
	;   $3D     2     PPC                current line number, for BREAK
	;                                    (break.asm); matches zx48k's PPC
	;                                    23621 by name/role only -- our
	;                                    error.asm doesn't print it (no ROM
	;                                    error formatter here), it's kept
	;                                    only so CHECK_BREAK's calling
	;                                    convention matches zx48k's exactly
	;                                    (see break.asm)
;   $3F     2     FP_STKBOT          fp_calc.asm: base of the FP number
	;                                    stack (ROM STKBOT $5C63)
;   $41     2     FP_STKEND          fp_calc.asm: next free slot in the
	;                                    FP number stack (ROM STKEND $5C65).
	;                                    MUST stay immediately followed by
	;                                    FP_BREG -- see the note in
	;                                    fp_calc.asm (ENT-TABLE loads both
	;                                    with one `ld bc,(FP_STKEND+1)`)
;   $43     1     FP_BREG            fp_calc.asm: literal currently being
	;                                    executed (ROM BREG $5C67)
;   $44     2     FP_MEM             fp_calc.asm: pointer to the MEM
	;                                    area, 6 cells of 5 bytes (ROM MEM
	;                                    $5C68)
;   $46     60    FP_CALC_STACK      fp_calc.asm: the FP number stack
	;                                    itself (12 numbers max)
;   $82     30    FP_MEM_AREA        fp_calc.asm: the MEM area (6 cells)
;   $A0     8     PEN_MAP            colour.asm: Spectrum colour 0-7 ->
	;                                    pen of the current screen mode
;   $A8     1     GFX_XSHIFT         colour.asm: mode pixel x -> firmware
;                                    virtual x shift (mode 0: 2, 1: 1,
;                                    2: 0)
;   $A9     1     TXT_COLS           colour.asm: text columns of the
	;                                    current mode (20/40/80)
;   $AA     1     GRA_PEN_CUR        gfx.asm: graphics pen last given to
	;                                    the firmware ($FF = unknown)
;   $AB     1     GRA_MODE_CUR       gfx.asm: graphics write mode last
	;                                    given to the firmware ($FF = unknown)
;   $AC     9     SOUND_BLK          beep.asm: SOUND_QUEUE block (the
	;                                    firmware reads it, so it must be in
	;                                    the central 32K -- it is)
;   $B5     10    CIRC_VARS          circle.asm: centre X/Y, x, y, d
;   $BF     1     PAUSE_TICK         pause.asm: last 300 Hz tick count
	;   $C0    17     (free)             was the cpcbuild library's state; the
	;                                    library now keeps it in its own storage
;   $D1     16    SND_ENV            fwsound.asm: volume envelope data
	;                                    buffer for SOUND_AMPL_ENVELOPE
;   $E1     2     GM_VEC             isr.asm: game-mode handler address
	;                                    (0 = normal mode; framehook.asm)
;   $E3     2     FH_ADDR            framehook.asm: frame hook routine
	;                                    (0 = none)
;   $E5     4     FH_FRAMES          framehook.asm: frames counted
;   $E9     1     GM_COUNT           framehook.asm: interrupts since the
	;                                    last frame (game mode)
;   $EA     9     FH_BLOCK           framehook.asm: KL_NEW_FRAME_FLY event
	;                                    block (must be in central RAM)
	;   ------  ----
	;   $F3     (243 bytes used)
	;
	; --- ATTR_P / ATTR_T bit layout (one byte, same shape as zx48k's) ------
	;
	;   bit   Meaning
	;   ---   ------------------------------------------------------------
;   0-2   ink: a Spectrum colour 0-7 (ink.asm, unchanged from zx48k),
	;         turned into a pen of the current mode through PEN_MAP
	;         (colour.asm) whenever it reaches the firmware
;   3-5   paper: a Spectrum colour 0-7, mapped the same way
	;   6     BRIGHT flag (bright.asm) -- accepted, ignored (notes.md Q5)
	;   7     FLASH flag (flash.asm) -- accepted, ignored (notes.md Q5)
	;
	; $F3 bytes used out of CPC_PRIV_SIZE ($400 = 1024). CPC_SYSVARS_USED
	; below lets it be compared against .core.CPC_PRIV_SIZE by eye whenever
	; this table grows.

	    push namespace core

	SYSVAR_BASE         EQU .core.CPC_PRIV_BASE

	CHARS               EQU SYSVAR_BASE + $00   ; DW -- pointer to charset (8x8 cells)
	UDG                 EQU SYSVAR_BASE + $02   ; DW -- pointer to UDG charset
	COORDS              EQU SYSVAR_BASE + $04   ; DW -- last PLOT/graphics coordinates (X,Y)
	FLAGS2              EQU SYSVAR_BASE + $06   ; DB -- screen flags (OVER/BOLD/ITALIC)
	ECHO_E              EQU SYSVAR_BASE + $07   ; DB -- (reserved, unused for now)
	DFCC                EQU SYSVAR_BASE + $08   ; DW -- unused (no VRAM pointer to track)
	DFCCL               EQU SYSVAR_BASE + $0A   ; DW -- unused (ditto)
	S_POSN              EQU SYSVAR_BASE + $0C   ; DW -- vestigial, see table above
	ATTR_P              EQU SYSVAR_BASE + $0E   ; DB -- permanent attribute (INK/PAPER/etc.)
	MASK_P              EQU SYSVAR_BASE + $0F   ; DB -- permanent transparency mask
	ATTR_T              EQU SYSVAR_BASE + $10   ; DB -- temporary attribute
	MASK_T              EQU SYSVAR_BASE + $11   ; DB -- temporary transparency mask
	P_FLAG              EQU SYSVAR_BASE + $12   ; DB -- permanent print flags (OVER/INVERSE)
	TV_FLAG             EQU SYSVAR_BASE + $13   ; DB -- flags controlling output to screen
	MEM0                EQU SYSVAR_BASE + $14   ; 8B -- scratch buffer, see table above

	SCREEN_ADDR         EQU SYSVAR_BASE + $1C   ; DW -- pointer to the screen bitmap base
	SCREEN_ATTR_ADDR    EQU SYSVAR_BASE + $1E   ; DW -- placeholder, see table above

	ERR_NR              EQU SYSVAR_BASE + $20   ; DB -- error code (-1 = no error)
	FRAMES              EQU SYSVAR_BASE + $21   ; DW -- software frame counter
	RANDOM_SEED_LOW     EQU SYSVAR_BASE + $23   ; DW -- RNG seed, low 16 bits

	ARRAY_SCRATCH       EQU SYSVAR_BASE + $25   ; 8B -- LBOUND_PTR/UBOUND_PTR/RET_ADDR/TMP_ARR_PTR
	CHR_SCRATCH         EQU SYSVAR_BASE + $2D   ; 2B -- return-address scratch for CHR$()
	DIVF_SCRATCH        EQU SYSVAR_BASE + $2F   ; 4B -- TMP (2B) + ERR_SP (2B) for float division

	FW_BC               EQU SYSVAR_BASE + $33   ; 2B -- firmware's BC' shadow (fwcall.asm)
	IN_FW               EQU SYSVAR_BASE + $35   ; 1B -- "inside firmware gate" flag (fwcall.asm)

	MODF16_SCRATCH      EQU SYSVAR_BASE + $36   ; 6B -- return addr + divider DE/HL for MOD16.16

	PRINT_STATE         EQU SYSVAR_BASE + $3C   ; 1B -- print.asm's control-code state machine
	PPC                 EQU SYSVAR_BASE + $3D   ; DW -- current line number (break.asm CHECK_BREAK)

	; --- fp_calc.asm's own sysvars (equivalent to the ROM's STKBOT/STKEND/
	; BREG/MEM $5C63-$5C69) -- kept contiguous and in this exact order, see
	; the table above and fp_calc.asm's own header.
	FP_STKBOT           EQU SYSVAR_BASE + $3F   ; DW -- base of the FP number stack
	FP_STKEND           EQU SYSVAR_BASE + $41   ; DW -- next free slot in the FP number stack
	FP_BREG             EQU SYSVAR_BASE + $43   ; DB -- literal currently being executed
	FP_MEM              EQU SYSVAR_BASE + $44   ; DW -- pointer to the MEM area (6 cells x 5B)
	FP_CALC_STACK       EQU SYSVAR_BASE + $46   ; 60B -- the FP number stack (12 numbers max)
	FP_CALC_STACK_END   EQU FP_CALC_STACK + 60
	FP_MEM_AREA         EQU SYSVAR_BASE + $82   ; 30B -- the MEM area (6 cells x 5B)

	PEN_MAP             EQU SYSVAR_BASE + $A0   ; 8B -- Spectrum colour -> pen (colour.asm)
	GFX_XSHIFT          EQU SYSVAR_BASE + $A8   ; DB -- mode pixel x -> virtual x shift
	TXT_COLS            EQU SYSVAR_BASE + $A9   ; DB -- text columns in the current mode
	GRA_PEN_CUR         EQU SYSVAR_BASE + $AA   ; DB -- cached graphics pen ($FF = unknown)
	GRA_MODE_CUR        EQU SYSVAR_BASE + $AB   ; DB -- cached graphics write mode ($FF = unknown)
	SOUND_BLK           EQU SYSVAR_BASE + $AC   ; 9B -- SOUND_QUEUE block (beep.asm)
	CIRC_VARS           EQU SYSVAR_BASE + $B5   ; 10B -- CIRCLE state (circle.asm)
	PAUSE_TICK          EQU SYSVAR_BASE + $BF   ; DB -- PAUSE's last tick count (pause.asm)

	; $C0-$D0 are free (17 bytes).
	SND_ENV             EQU SYSVAR_BASE + $D1   ; 16B -- envelope data buffer (fwsound.asm)
	GM_VEC              EQU SYSVAR_BASE + $E1   ; DW -- game-mode handler (0 = normal; isr.asm)
	FH_ADDR             EQU SYSVAR_BASE + $E3   ; DW -- frame hook routine (0 = none)
	FH_FRAMES           EQU SYSVAR_BASE + $E5   ; 4B -- frames counted (framehook.asm)
	GM_COUNT            EQU SYSVAR_BASE + $E9   ; DB -- interrupts since last frame (game mode)
	FH_BLOCK            EQU SYSVAR_BASE + $EA   ; 9B -- frame-flyback event block (framehook.asm)

; --- Bare-metal text (txtbare.asm, Phase 6 B2): $100-$13F and $200-$21F,
	; clear of the sysvars above so parallel additions there cannot collide.
	; PAL_SHADOW reuses the 17 free bytes at $C0 (bare mode keeps no firmware
	; ink table, so BORDER reads the pen colours from here).
	PAL_SHADOW          EQU SYSVAR_BASE + $C0   ; 17B -- colour (0-26) of pens 0-15 and the border
	BT_MODE             EQU SYSVAR_BASE + $100  ; DB -- current screen mode 0-3
	BT_BPC              EQU SYSVAR_BASE + $101  ; DB -- screen bytes per glyph row (4/2/1)
	BT_PPB              EQU SYSVAR_BASE + $102  ; DB -- pixels per screen byte (2/4/8)
	BT_MASK             EQU SYSVAR_BASE + $103  ; DB -- pen number mask (15/3/1)
	BT_FILL             EQU SYSVAR_BASE + $104  ; DB -- screen byte of an all-paper row (scroll fill)
BT_MX               EQU SYSVAR_BASE + $105  ; DB -- mode 2: ink mask xor paper mask
BT_MP               EQU SYSVAR_BASE + $106  ; DB -- mode 2: paper mask
	BT_BUF              EQU SYSVAR_BASE + $108  ; 8B -- SCREEN$ glyph bitmap being matched
	BT_TRAMP            EQU SYSVAR_BASE + $120  ; 32B -- font copy routine (runs with the lower ROM in)
	BT_PIX              EQU SYSVAR_BASE + $140  ; 64B -- SCREEN$ cell pixels (pen numbers)
	BT_TBL              EQU SYSVAR_BASE + $200  ; 16B, page aligned -- screen byte per glyph-bit group

; --- cpcbuild's cpcplus library (Phase 7 P3), both modes: $300-$37F. The
	; ASIC register page replaces RAM at &4000-&7FFF while it is paged in, so the
	; code that pages it in (page in, copy, page out) cannot live in the
	; program, which may reach into that range; the library copies its small
	; routines here at start-up (#init, lib/cpcplus/plus.asm) and bounces data
	; through PL_BUF. Free in both memory maps (the firmware layout's $9E00 block
	; and the bare layout's $BC00 block have no other users above $F3 / $21F).
	; PL_TRAMP2 ($380-$3F5) holds the library's second routine block (the fast
; paths for raster handlers). Free elsewhere: $F3-$FF, $220-$2FF and $3F6-$3FF
	; in bare mode ($F3-$2FF and $3F6-$3FF in firmware mode).
; CPC_EXIT_VEC (bare mode only, $1F0-$1F1): a routine __CPC_RESET calls
	; before it resets the machine (END), 0 = none. A library that leaves
; hardware state behind (cpcplus's raster interrupts: PRI stops the
	; firmware's six interrupts per frame) points it at its cleanup.
	CPC_EXIT_VEC        EQU SYSVAR_BASE + $1F0  ; DW -- cleanup routine called by END's reset (bare mode), 0 = none
	PL_TRAMP            EQU SYSVAR_BASE + $300  ; 64B -- paged-access routines (plus.asm copies them here)
	PL_BUF              EQU SYSVAR_BASE + $340  ; 64B -- bounce buffer for data between the ASIC page and RAM at &4000-&7FFF
	PL_TRAMP2           EQU SYSVAR_BASE + $380  ; 118B -- cpcplus fast-path routines (raster handlers; plus.asm copies them here)

	CPC_SYSVARS_USED    EQU $F3                 ; bytes used above; compare by eye against
	                                             ; .core.CPC_PRIV_SIZE when this table grows

; --- Screen constants (CPC mode 1: 40 columns x 25 rows) ----------------
; The column count follows the screen mode at run time (TXT_COLS above:
	; 20/40/80); these constants are the boot-time mode 1 values. Only the
	; row count is the same in every mode.
	; SCR_COLS keeps zx48k's own "columns + 1" convention (see zx48k's
; sysvars.asm: SCR_COLS EQU 33 for 32 visible columns). SCR_COLS_VISIBLE
	; is the plain visible-column count, used by print.asm/sposn.asm's
	; explicit 0-39 range checks and arithmetic, where the "+1" convention
	; would just have to be undone again.

	SCR_COLS            EQU 41      ; columns + 1 (40 columns visible)
	SCR_COLS_VISIBLE    EQU 40      ; columns visible (0-39, 0-based)
	SCR_ROWS            EQU 25      ; rows visible (0-24, 0-based)
	SCR_SIZE            EQU (SCR_ROWS << 8) + SCR_COLS

	    pop namespace
#line 27 "src/lib/arch/cpc/runtime/array/array.asm"

#line 31 "src/lib/arch/cpc/runtime/array/array.asm"

	    push namespace core

__ARRAY_PTR:   ;; computes an array offset from a pointer
	    ld c, (hl)
	    inc hl
	    ld h, (hl)
	    ld l, c    ;; HL <-- [HL]

__ARRAY:
	    PROC

	    LOCAL LOOP
	    LOCAL ARRAY_END
	    LOCAL TMP_ARR_PTR            ; Ptr to Array DATA region. Stored temporarily
	    LOCAL LBOUND_PTR, UBOUND_PTR ; LBound and UBound PTR indexes
	    LOCAL RET_ADDR               ; Contains the return address popped from the stack

LBOUND_PTR EQU ARRAY_SCRATCH   ; cpc: dedicated scratch, not MEMBOT
	UBOUND_PTR EQU LBOUND_PTR + 2  ; Next 2 bytes for UBOUND PTR
	RET_ADDR EQU UBOUND_PTR + 2    ; Next 2 bytes for RET_ADDR
	TMP_ARR_PTR EQU RET_ADDR + 2   ; Next 2 bytes for TMP_ARR_PTR

	    ld e, (hl)
	    inc hl
	    ld d, (hl)
	    inc hl      ; DE <-- PTR to Dim sizes table
	    ld (TMP_ARR_PTR), hl  ; HL = Array __DATA__.__PTR__
	    inc hl
	    inc hl
	    ld c, (hl)
	    inc hl
	    ld b, (hl)  ; BC <-- Array __LBOUND__ PTR
	    ld (LBOUND_PTR), bc  ; Store it for later

#line 73 "src/lib/arch/cpc/runtime/array/array.asm"

	    ex de, hl   ; HL <-- PTR to Dim sizes table, DE <-- dummy
	    ex (sp), hl	; Return address in HL, PTR Dim sizes table onto Stack
	    ld (RET_ADDR), hl ; Stores it for later

	    exx
	    pop hl		; Will use H'L' as the pointer to Dim sizes table
	    ld c, (hl)	; Loads Number of dimensions from (hl)
	    inc hl
	    ld b, (hl)
	    inc hl		; Ready
	    exx

	    ld hl, 0	; HL = Element Offset "accumulator"

LOOP:
	    ex de, hl   ; DE = Element Offset
	    ld hl, (LBOUND_PTR)
	    ld a, h
	    or l
	    ld b, h
	    ld c, l
	    jr z, 1f
	    ld c, (hl)
	    inc hl
	    ld b, (hl)
	    inc hl
	    ld (LBOUND_PTR), hl
1:
	    pop hl      ; Get next index (Ai) from the stack
	    sbc hl, bc  ; Subtract LBOUND

#line 123 "src/lib/arch/cpc/runtime/array/array.asm"

	    add hl, de	; Adds current index

	    exx			; Checks if B'C' = 0
	    ld a, b		; Which means we must exit (last element is not multiplied by anything)
	    or c
	    jr z, ARRAY_END		; if B'Ci == 0 we are done
	    dec bc				; Decrements loop counter

	    ld e, (hl)			; Loads next dimension size into D'E'
	    inc hl
	    ld d, (hl)
	    inc hl
	    push de
	    exx

	    pop de				; DE = Max bound Number (i-th dimension)

	    call __FMUL16        ; HL <= HL * DE mod 65536
	    jp LOOP

ARRAY_END:
	    ld a, (hl)
	    exx

#line 153 "src/lib/arch/cpc/runtime/array/array.asm"
	    LOCAL ARRAY_SIZE_LOOP

	    ex de, hl
	    ld hl, 0
	    ld b, a
ARRAY_SIZE_LOOP:
	    add hl, de
	    djnz ARRAY_SIZE_LOOP

#line 163 "src/lib/arch/cpc/runtime/array/array.asm"

	    ex de, hl
	    ld hl, (TMP_ARR_PTR)
	    ld a, (hl)
	    inc hl
	    ld h, (hl)
	    ld l, a
	    add hl, de  ; Adds element start
	    ld de, (RET_ADDR)
	    push de
	    ret

	    ENDP

	    pop namespace
#line 57 "cpcbuild/lib/cpcbuild/palette.bas"
#line 1 "src/lib/arch/cpc/runtime/ay.asm"
	; -----------------------------------------------------------------------
	; Amstrad CPC AY-3-8912 register access
	;
	; Written from scratch for this project (MIT); see core.asm. From the
	; public documentation of the 8255 PPI and the AY-3-8912 as wired in the
	; CPC (cpcwiki.eu, CPC Firmware Guide); no library code.
	;
; The AY sits behind the PPI: port A (&F4xx) is the AY's data bus, and
	; port C (&F6xx) bits 7-6 are the AY's BDIR and BC1 lines (11 = latch a
	; register number, 10 = write data, 01 = read data, 00 = inactive). Port C
	; bits 5-4 are the cassette write data and motor (kept as they are) and
	; bits 3-0 select the keyboard row, which the firmware's own scan (inside
	; its 300 Hz interrupt handler) changes. So every access here has to run
	; with interrupts off, or the handler could slip a keyboard scan between
	; two of the OUTs. The raw routines do not touch the interrupt flag (a
	; caller that already has interrupts off, like the Play library, pays for
	; neither DI nor EI); the _DI variants wrap them and return with
	; interrupts on, as every compiled-code routine does.
	;
	; The PPI must be as the firmware leaves it, control word &82 (port A
	; output, B input, C output).
	;
; Who owns the sound chip: the firmware's sound manager (SOUND/BEEP) runs
	; from the interrupt handler and writes the AY by itself whenever a note
	; is queued, so a program that uses these routines directly must not
	; also queue firmware sounds. Call SOUND_RESET (&BCA7) once first to make
	; the manager idle (Play does).
	;
; Bare-metal mode (-D CPC_BAREMETAL): there is no firmware sound manager,
	; so nothing else writes the AY; BEEP, Play, the music player and these
	; routines are the only users (one at a time).
	;
	; Cost (CPC "NOP" units of 1 us, every instruction rounded up to a whole
; number of them; IN/OUT are 4): __CPC_AY_WRITE 53 us plus 5 for the CALL,
	; 58 us measured (tests/stress/play_tempo.bas). The DI variants add the
; DI, EI, CALL and RET: 12 us.

	    push namespace core

	; __CPC_AY_WRITE -- writes AY register A with the value in C. Interrupts
	; must be off on entry; they are left as they were. Port C is left as it
	; was (cassette bits kept, AY inactive, keyboard row 0). The AY's
	; register select is left on A.
; Firmware entries called: none.
; Registers clobbered: AF, BC, DE (HL is not touched).
__CPC_AY_WRITE:
	    ld   e, c               ; E = value
	    ld   d, a               ; D = register
	    ld   b, $F6
	    in   a, (c)             ; port C (the low byte of the port is not decoded)
	    and  $30                ; cassette bits
	    ld   c, a               ; C = port C "inactive" value
	    ld   a, d
	    ld   b, $F4
	    out  (c), a             ; port A = register number
	    ld   b, $F6
	    ld   a, c
	    or   $C0
    out  (c), a             ; AY: latch register
    out  (c), c             ; AY: inactive
	    ld   b, $F4
	    out  (c), e             ; port A = value
	    ld   b, $F6
	    ld   a, c
	    or   $80
    out  (c), a             ; AY: write
    out  (c), c             ; AY: inactive
	    ret

; __CPC_AY_WRITE_DI -- as __CPC_AY_WRITE, for code that has interrupts on:
	; di, write, ei. Returns with interrupts on, whatever they were on entry.
; Firmware entries called: none.
; Registers clobbered: AF, BC, DE.
__CPC_AY_WRITE_DI:
	    di
	    call __CPC_AY_WRITE
	    ei
	    ret

	; __CPC_AY_READ -- A = AY register -> A = its value (bits the register
	; doesn't implement read as 0). Interrupts must be off on entry; they are
	; left as they were. Port A is switched to input for the read and back
	; to output, which clears the PPI's output latches, so the cassette bits
	; are written back at once (the motor is off for a few microseconds only,
	; and only if it was on). Port C is left as in __CPC_AY_WRITE. Reading
	; register 14 (the keyboard port) gives the keyboard row selected by port
	; C bits 3-0, which is row 0 here.
; Firmware entries called: none.
; Registers clobbered: AF, BC, DE.
__CPC_AY_READ:
	    ld   d, a               ; D = register
	    ld   b, $F6
	    in   a, (c)
	    and  $30
	    ld   e, a               ; E = port C "inactive" value
	    ld   b, $F4
	    out  (c), d             ; port A = register number
	    ld   b, $F6
	    ld   a, e
	    or   $C0
    out  (c), a             ; AY: latch register
    out  (c), e             ; AY: inactive
	    ld   bc, $F792
	    out  (c), c             ; port A becomes an input
	    ld   a, e
	    or   $40
	    ld   b, $F6
    out  (c), a             ; AY: read
	    ld   b, $F4
	    in   a, (c)             ; the value
	    ld   d, a
	    ld   b, $F6
    out  (c), e             ; AY: inactive (before port A drives the bus again)
	    ld   bc, $F782
	    out  (c), c             ; port A back to output (clears the latches)
	    ld   b, $F6
	    out  (c), e             ; cassette bits back
	    ld   a, d
	    ret

; __CPC_AY_READ_DI -- as __CPC_AY_READ, for code that has interrupts on:
	; di, read, ei. Returns with interrupts on.
; Firmware entries called: none.
; Registers clobbered: AF, BC, DE.
__CPC_AY_READ_DI:
	    di
	    call __CPC_AY_READ
	    ei
	    ret

#line 159 "src/lib/arch/cpc/runtime/ay.asm"

	    pop namespace
#line 58 "cpcbuild/lib/cpcbuild/palette.bas"
#line 1 "src/lib/arch/cpc/runtime/bootstrap.asm"
	; -----------------------------------------------------------------------
	; Amstrad CPC bootstrap -- captures FW_BC, initialises the private
	; runtime block's sysvars, and sets the initial screen mode
	;
	; Registered with #init, so the compiler inserts
	; "call .core.CPC_INIT_00_BOOTSTRAP" in the prologue (src/arch/cpc/
	; backend/main.py's emit_prologue()).
	;
	; Forced into every program via common.REQUIRES (backend/main.py's
; Backend.init()) rather than pulled in transitively: this must run
	; even in programs with no PRINT/arrays/etc. that would otherwise never
	; #include sysvars.asm.
	;
; Naming: #init calls are emitted in sorted label order (sorted() over
	; the raw strings passed to every #init directive -- see
	; src/arch/z80/backend/main.py's emit_prologue and
	; src/zxbc/zxbparser.py's preproc_line_init). FW_BC must be captured from
	; the live BC' before anything else can disturb it (see fwcall.asm's
	; header), which means this routine must be the first #init call, full
	; stop -- not just first among the cpc runtime's own files, but first
	; against anything any future #include might add. ".core.CPC_INIT_FP_CALC"
	; (fp_calc.asm) would otherwise sort before ".core.CPC_INIT_SYSVARS" (F <
; S), so the routine is named CPC_INIT_00_BOOTSTRAP: the "00_" digit
	; prefix sorts before any plausible future "CPC_INIT_<LETTER>..." name
	; (digits are below uppercase letters in ASCII), which is a stronger
	; guarantee than just renaming past today's one clash. Nothing else
	; references the old CPC_INIT_SYSVARS name.

#line 33 "src/lib/arch/cpc/runtime/bootstrap.asm"


#line 1 "src/lib/arch/cpc/runtime/fwcall.asm"
	; -----------------------------------------------------------------------
	; Amstrad CPC firmware call gate
	;
	; Every firmware jumpblock entry goes through RST 1 LOW JUMP, which uses
	; B' = &7F (gate array port) and C' = current ROM/mode config, and the
	; 300 Hz interrupt handler also uses BC' and branches on AF' carry
	; ("already inside an interrupt"). Compiled code clobbers both freely
	; (SUB epilogues pop into BC'; div8/div16/float pushes use AF'). So every
; firmware call goes through this gate: with interrupts off it sets IN_FW,
	; restores BC' from the FW_BC shadow and clears AF' carry, makes the call
	; with interrupts on, then (off again) captures BC' back (mode/ROM
	; changes) and clears IN_FW. Outside the gate interrupts go through
	; isr.asm, which does the same register hand-over for the firmware's
	; interrupt handler; IN_FW tells it the firmware's registers are already
	; loaded. The gate always returns with interrupts on.
	;
	; Usage (A, F, BC, DE, HL go in as set and come back as the firmware left
; them, flags included):
	;
	;     call .core.__FW_CALL        ; or .core.__FW_CALL_IX for CAS_* entries,
	;     defw $BB5A                  ; which corrupt IX (Boriel's frame pointer)
	;
	; Clobbers BC', DE', HL', AF' (never meaningful to compiled code across a
	; call). Not re-entrant (the interrupt handler never calls it).
; Cost: about 220 T-states plus the firmware routine.



; Bare-metal mode (-D CPC_BAREMETAL): there is no firmware, so the gate is
	; not defined at all. Anything that still calls the firmware fails to
	; build with "undefined label __FW_CALL" -- that is how firmware-only
	; features (LOAD/SAVE, firmware sound, direct firmware calls in asm) are
	; refused in bare mode.


	    push namespace core

__FW_CALL:
	    PROC
	    di                  ; IN_FW and BC' must change together (isr.asm)
	    exx                 ; alternate bank is scratch; caller's regs stay put
	    pop  hl             ; HL -> defw after the call
	    ld   e, (hl)
	    inc  hl
	    ld   d, (hl)        ; DE = firmware entry
	    inc  hl
	    push hl             ; return past the defw
	    ld   (__FW_CALL_TARGET + 1), de
	    ld   hl, IN_FW
	    ld   (hl), 1
	    ld   bc, (FW_BC)    ; becomes BC' after the exx below
	    ex   af, af'
	    or   a              ; AF' carry clear, or the ISR takes its nested path
	    ex   af, af'
	    exx
	    ei
__FW_CALL_TARGET:
	    call $FFFF          ; operand patched above
	    di
	    exx
	    ld   (FW_BC), bc    ; keep mode/ROM changes for the next call
	    ld   hl, IN_FW
	    ld   (hl), 0
	    exx
	    ei
	    ret
	    ENDP

__FW_CALL_IX:
	    PROC
	    di
	    exx
	    pop  hl
	    ld   e, (hl)
	    inc  hl
	    ld   d, (hl)
	    inc  hl
	    push hl
	    ld   (__FW_CALL_IX_TARGET + 1), de
	    ld   hl, IN_FW
	    ld   (hl), 1
	    ld   bc, (FW_BC)
	    ex   af, af'
	    or   a
	    ex   af, af'
	    exx
	    ei
	    push ix
__FW_CALL_IX_TARGET:
	    call $FFFF
	    pop  ix
	    di
	    exx
	    ld   (FW_BC), bc
	    ld   hl, IN_FW
	    ld   (hl), 0
	    exx
	    ei
	    ret
	    ENDP

	    pop namespace
#line 104 "src/lib/arch/cpc/runtime/fwcall.asm"
#line 36 "src/lib/arch/cpc/runtime/bootstrap.asm"
#line 1 "src/lib/arch/cpc/runtime/isr.asm"
	; -----------------------------------------------------------------------
	; Amstrad CPC interrupt front-end
	;
	; Compiled code runs with interrupts on. The firmware's 300 Hz handler
	; needs BC' = its own value (B' = &7F, the Gate Array port; C' = the
	; ROM/mode configuration) and AF' carry clear (carry set means "interrupt
	; inside an interrupt"), but compiled code uses the alternate registers
	; freely (SUB epilogues, 32-bit/float pushes, the FP calculator). So the
; RAM vector at &0038 is pointed here: this handler saves both register
	; banks, hands the firmware its BC' (the FW_BC shadow, fwcall.asm) and a
	; clear AF' carry, runs the original handler, keeps any change it made
	; to BC', and restores everything.
	;
	; The RAM vector is only seen while the lower ROM is off, i.e. while our
	; code (or firmware code running from RAM) executes. With the lower ROM
	; on, the ROM's own &0038 goes straight to the firmware.
	;
	; Inside a firmware call (IN_FW = 1, set by the gate) the alternate
	; registers already hold the firmware's values, so the handler jumps
	; straight to the original. IN_FW also stays 1 while the original runs
; from here: it ends with "ei; ret", so an interrupt can arrive before
	; our "di", and the firmware's registers are still loaded then.
	;
	; The original handler (RAM &B941 on the 6128, &B939 on the 464; the
	; same code in both ROMs) is read from the vector at boot.
	;
; Game mode (framehook.asm, opt-in): when GM_VEC is non-zero, interrupts
	; outside firmware calls go to the handler it points to instead of the
	; firmware, which then only runs during firmware calls. GM_VEC is zero
	; (normal mode) unless a program switches game mode on.
	;
; Cost: about 250 T-states on top of the firmware's handler, 300 times
	; a second. See cpcbuild docs/phase4d-design.md.



#line 64 "src/lib/arch/cpc/runtime/isr.asm"

	    push namespace core

	; __CPC_ISR_INSTALL -- points the RAM vector at &0038 to __CPC_ISR,
	; keeping the original jump target. Call with interrupts off (the
	; bootstrap does, before its first firmware call).
; Firmware entries called: none. Registers clobbered: AF, HL.
__CPC_ISR_INSTALL:
	    ld   hl, ($0039)
	    ld   (__CPC_ISR_ORIG + 1), hl
	    ld   a, $C3             ; JP nn
	    ld   ($0038), a
	    ld   hl, __CPC_ISR
	    ld   ($0039), hl
	    ret

	; __CPC_ISR -- the IM 1 handler (entered with interrupts off).
; Registers clobbered: none.
__CPC_ISR:
	    push af
	    ld   a, (IN_FW)
	    or   a
	    jr   nz, __CPC_ISR_DIRECT
	    ld   a, (GM_VEC + 1)
	    or   a
    jr   nz, __CPC_ISR_GAME ; game mode (framehook.asm): skip the firmware
	    inc  a                  ; A = 1
	    ld   (IN_FW), a         ; an interrupt during the chain goes direct
	    push bc
	    push de
	    push hl
	    push ix                 ; event routines may use IX/IY
	    push iy
	    ex   af, af'
	    push af                 ; the program's AF'
	    exx
	    push bc                 ; the program's BC', DE', HL'
	    push de
	    push hl
	    ld   bc, (FW_BC)        ; the firmware's BC'
	    exx
	    or   a                  ; AF' (active now) carry clear
	    ex   af, af'
	    call __CPC_ISR_ORIG     ; returns with interrupts on
	    di
	    exx
	    ld   (FW_BC), bc        ; keep a ROM/mode change
	    pop  hl
	    pop  de
	    pop  bc
	    exx
	    pop  af
	    ex   af, af'            ; the program's AF' back
	    pop  iy
	    pop  ix
	    pop  hl
	    pop  de
	    pop  bc
	    xor  a
	    ld   (IN_FW), a
	    pop  af
	    ei
	    ret

; Game mode: jump to the handler in GM_VEC with HL as it was and the
	; program's AF still on the stack (the handler ends "pop af; ei; ret").
__CPC_ISR_GAME:
	    push hl
	    ld   hl, (GM_VEC)
	    ex   (sp), hl
	    ret

__CPC_ISR_DIRECT:
	    pop  af
__CPC_ISR_ORIG:
	    jp   $FFFF              ; patched by __CPC_ISR_INSTALL

	    pop namespace
#line 143 "src/lib/arch/cpc/runtime/isr.asm"
#line 37 "src/lib/arch/cpc/runtime/bootstrap.asm"
#line 1 "src/lib/arch/cpc/runtime/colour.asm"
	; -----------------------------------------------------------------------
	; Amstrad CPC -- Spectrum colours to pens, and the per-mode screen
	; variables (cpcbuild/docs/notes.md, 2026-10-01, question 4)
	;
	; INK/PAPER/BORDER take Spectrum colours 0-7 (black, blue, red,
	; magenta, green, cyan, yellow, white). A CPC mode has 2, 4 or 16 pens
	; instead, so each colour goes through PEN_MAP, a fixed per-mode table
; picking the pen whose *firmware default* colour is nearest:
	;
	;   Spectrum   0  1  2  3  4  5  6  7
;   mode 0     5  6  3  7 12  2  1  4   exact: black, bright blue, bright
	;                                       red, bright magenta, bright green,
	;                                       bright cyan, bright yellow,
	;                                       bright white
	;   mode 1     0  0  3  3  2  2  1  1   blue, yellow, cyan, red palette
	;   mode 2     0  0  0  0  1  1  1  1   blue, yellow palette (by brightness)
	;
	; So the default "white on black" is the CPC's own yellow on blue in
	; mode 1. SetInk (cpc.bas) changes a pen's colour, not this table.
	;
	; The same mode switch also sets GFX_XSHIFT (mode pixels to firmware
	; virtual coordinates, gfx.asm) and TXT_COLS (print.asm/sposn.asm), and
	; forgets the graphics pen/write-mode cache (gfx.asm), since the
	; firmware's mode change resets its graphics state.



	    push namespace core

	; __CPC_SET_MODE_VARS -- A = screen mode (0-3; 3 is the undocumented
	; 4-pen 160x200 hardware mode, treated as mode 0 geometry with mode 1
	; pens). Loads PEN_MAP, GFX_XSHIFT and TXT_COLS for that mode and marks
	; the graphics pen/mode cache unknown. Called by the bootstrap (mode 1)
	; and by cpc.bas's Mode after SCR_SET_MODE.
; Firmware entry called: none (memory only).
; Registers clobbered: AF, BC, DE, HL.
__CPC_SET_MODE_VARS:
	    PROC
	    LOCAL __SMV_MAPS, __SMV_PARAMS

	    and  3
	    ld   l, a
	    ld   h, 0
	    add  hl, hl
	    add  hl, hl
	    add  hl, hl             ; HL = mode * 8
	    ld   de, __SMV_MAPS
	    add  hl, de
	    ld   de, PEN_MAP
	    ld   bc, 8
	    ldir                    ; A (the mode) survives

	    add  a, a
	    ld   e, a
	    ld   d, 0
	    ld   hl, __SMV_PARAMS
	    add  hl, de
	    ld   a, (hl)
	    ld   (GFX_XSHIFT), a
	    inc  hl
	    ld   a, (hl)
	    ld   (TXT_COLS), a

	    ld   a, $FF
	    ld   (GRA_PEN_CUR), a
	    ld   (GRA_MODE_CUR), a
	    ret

__SMV_MAPS:
	    DEFB 5, 6, 3, 7, 12, 2, 1, 4    ; mode 0
	    DEFB 0, 0, 3, 3, 2, 2, 1, 1     ; mode 1
	    DEFB 0, 0, 0, 0, 1, 1, 1, 1     ; mode 2
	    DEFB 0, 0, 3, 3, 2, 2, 1, 1     ; mode 3

__SMV_PARAMS:                       ; GFX_XSHIFT, TXT_COLS
    DEFB 2, 20                      ; mode 0: 160 pixels, 20 columns
    DEFB 1, 40                      ; mode 1: 320 pixels, 40 columns
    DEFB 0, 80                      ; mode 2: 640 pixels, 80 columns
	    DEFB 2, 20                      ; mode 3
	    ENDP

	; __INK_TO_PEN -- A = Spectrum colour (bits 0-2 used) -> A = pen of the
	; current mode.
; Firmware entry called: none.
; Registers clobbered: AF.
__INK_TO_PEN:
	    push hl
	    and  7
	    ld   hl, PEN_MAP
	    add  a, l
	    ld   l, a
	    adc  a, h
	    sub  l
	    ld   h, a
	    ld   a, (hl)
	    pop  hl
	    ret

	    pop namespace
#line 38 "src/lib/arch/cpc/runtime/bootstrap.asm"



	    push namespace core

	; CPC_INIT_00_BOOTSTRAP -- captures FW_BC, zero-fills the private
	; runtime block ($9E00-$A1FF, .core.CPC_PRIV_BASE for
	; .core.CPC_PRIV_SIZE bytes), installs the interrupt front-end, sets the
	; few sysvars that need a non-zero default, then sets screen MODE 1
	; through the firmware gate (which turns interrupts on for good).
	;
	; FW_BC is captured first, before the zero-fill, but can't be written
	; to its sysvar slot yet -- that slot is about to be zeroed along with
; the rest of the block. So it's parked on the stack (already valid:
	; the prologue sets SP before calling #init routines) and only written
	; out to FW_BC once the zero-fill is done.
	;
; Firmware entry called: SCR_SET_MODE (&BC0E, via the gate, once
	; FW_BC/IN_FW exist) -- see fwcall.asm for what that call clobbers.
; Registers clobbered: AF, BC, DE, HL (and, transiently, BC'/DE'/HL').
CPC_INIT_00_BOOTSTRAP:
	    PROC

	    ; Capture the firmware's BC' immediately -- see the header above
	    ; and fwcall.asm's contract. Parked on the stack, not yet in FW_BC.
	    exx
	    push bc
	    exx

	    ; Zero-fill the whole private block; sysvars set below simply
	    ; overwrite their own zeroed slot. This also zeroes FW_BC's and
	    ; IN_FW's slots -- the captured value is still safe on the stack.
	    ld   hl, .core.CPC_PRIV_BASE
	    ld   (hl), 0
	    ld   de, .core.CPC_PRIV_BASE + 1
	    ld   bc, .core.CPC_PRIV_SIZE - 1
	    ldir

	    ; Now write the captured FW_BC out to its (freshly-zeroed) slot.
	    ; IN_FW stays 0, which the zero-fill already set.
	    pop  bc
	    ld   (FW_BC), bc

	    ; Our interrupt front-end (isr.asm) goes in before anything enables
    ; interrupts: the first firmware call below returns with them on,
	    ; and they stay on from then on.
	    call __CPC_ISR_INSTALL

    ; ERR_NR: -1 means "no error", not 0 (matches the ZX Spectrum manual's
	    ; convention).
	    ld   a, $FF
	    ld   (ERR_NR), a

    ; Initial permanent attribute: INK 7 / PAPER 0 (white on black), which
	    ; colour.asm maps to the firmware's own default pens, pen 1 on pen 0
	    ; in mode 1 (yellow on blue). Set here, not by print.asm, because
	    ; PLOT/DRAW/CIRCLE use it too in programs that never PRINT; left at 0
	    ; it would be black on black, i.e. invisible.
	    ld   a, 7
	    ld   (ATTR_P), a

    ; SCREEN_ADDR: mode 1 screen base. SCREEN_ATTR_ADDR is left zeroed --
	    ; see the placeholder note in sysvars.asm.
	    ld   hl, $C000
	    ld   (SCREEN_ADDR), hl

	    ; Cursor at the top-left of the text window.
	    ld   hl, 0
	    ld   (S_POSN), hl

	    ; Screen mode 1 (40x25, 4 colours). SCR_SET_MODE also resets the
	    ; text/graphics windows to full-screen, the graphics origin, and
	    ; the current stream -- and, confirmed in the emulator (see
	    ; cpc-port-notes.md Phase 2 results), clears the screen and homes
	    ; the firmware's own text cursor, even though the Firmware Guide's
	    ; own entry for &BC0E doesn't spell that out explicitly.
	    ld   a, 1
	    call .core.__FW_CALL
	    defw $BC0E
	    ld   a, 1
    call __CPC_SET_MODE_VARS    ; colour.asm: pen map, widths for mode 1

    ; Empty the key buffer: the RETURN that submitted RUN"<prog> can
	    ; still be in it, and the first INKEY$ or PAUSE would see it.
	    jp   __CPC_FLUSH_KEYS

	    ENDP

	; __CPC_FLUSH_KEYS -- discards every character waiting in the firmware's
	; key buffer. KM_FLUSH (&BD3D) does this on the 664/6128 only, so this
	; reads characters with KM_READ_CHAR (&BB09, every model) until it
	; reports none (Carry clear).
; Registers clobbered: AF (main); BC', DE', HL', AF' (the gate).
__CPC_FLUSH_KEYS:
	    call .core.__FW_CALL
	    defw $BB09
	    jr   c, __CPC_FLUSH_KEYS
	    ret

	; __CPC_WAIT_KEY -- flushes stale keys, then waits for a new keypress
	; (KM_WAIT_KEY, &BB18). END and runtime errors use it so the program's
	; last screen stays visible until a key is pressed (notes.md question 1).
; Registers clobbered: AF (main); BC', DE', HL', AF' (the gate).
__CPC_WAIT_KEY:
	    call __CPC_FLUSH_KEYS
	    call .core.__FW_CALL
	    defw $BB18
	    ret

	; __CPC_END -- the single choke point for a *clean* END (src/arch/cpc/
	; backend/generic.py's _end emits "jp .core.__CPC_END" for every END in
	; the program, instead of a bare RST 0). Reaching address 0 by itself
; doesn't prove the program reached END: a crash that happens to reset
	; the machine, or a runtime error (error.asm's __ERROR, also RST 0 after
	; printing "Error n"), lands there too. This is forced into every build
	; (bootstrap.asm is in common.REQUIRES unconditionally -- see the file
	; header), so it's the one place a distinguishing marker can live for
	; every program, not just ones that happen to #include some other file.
	;
	; Under -D __CPC_PRINTER_ECHO__ (cpcbuild's cpcrun.py test harness),
	; sends __CPC_END_MARKER -- a line containing only "\x04END" -- to the
	; printer via MC_PRINT_CHAR (&BD2B), through the gate, before the RST 0.
	; \x04 (ASCII EOT) as the first byte makes the line unlike anything a
	; Boriel program can PRINT (print.asm's control-code table drops or
	; diverts every code below 32 except 6/8/13-23) and unlike the
	; "NOT IMPLEMENTED" (stub.asm) / "Error n" (error.asm) text the same
	; transcript can otherwise contain, so cpcrun.py can grep for it
	; unambiguously and strip it from the reported transcript.
	;
	; Without the flag it waits for a key first (__CPC_WAIT_KEY), so the
	; program's output stays on screen (notes.md question 1), then resets.
	;
; Firmware entries called: MC_PRINT_CHAR (&BD2B) in printer-echo builds;
; KM_READ_CHAR/KM_WAIT_KEY otherwise. Registers clobbered: none (never
	; returns).
#line 176 "src/lib/arch/cpc/runtime/bootstrap.asm"

__CPC_END:
#line 203 "src/lib/arch/cpc/runtime/bootstrap.asm"
	    call __CPC_WAIT_KEY
	    di
	    rst  0
#line 207 "src/lib/arch/cpc/runtime/bootstrap.asm"

	    pop namespace
#line 210 "src/lib/arch/cpc/runtime/bootstrap.asm"
#line 59 "cpcbuild/lib/cpcbuild/palette.bas"
#line 1 "src/lib/arch/cpc/runtime/cls.asm"
	;; Clears the text screen and homes the cursor, via the firmware.
	;;
	;; zx48k's CLS clears the Spectrum bitmap and attribute areas directly
	;; and resets its own cursor/VRAM-pointer sysvars; there is no VRAM to
	;; touch here, and no local cursor cache to reset (see sposn.asm). The
;; one thing that needs doing by hand is the *colour* to clear to:
	;; TXT_CLEAR_WINDOW clears using the firmware's *current* PAPER, and
	;; Sinclair BASIC's CLS always clears to the permanent attribute's
	;; paper (not any temporary one left over from the last PRINT), so the
	;; permanent paper is pushed to the firmware first.




#line 18 "src/lib/arch/cpc/runtime/cls.asm"

	    push namespace core

CLS:
	    PROC
#line 35 "src/lib/arch/cpc/runtime/cls.asm"
    ; Firmware entries called (via the gate): TXT_SET_PAPER (&BB96, A =
	    ; paper pen) then TXT_CLEAR_WINDOW (&BB6C), which clears the
	    ; current window with that paper and homes the cursor to its
	    ; top-left corner (0,0 for the default full-screen window).
    ; Registers clobbered: AF, HL (main); BC', DE', HL', AF' (the gate).

	    ld a, (ATTR_P)
	    rrca
	    rrca
    rrca                   ; paper: bits 3-5 of ATTR_P -> bits 0-2
	    call __INK_TO_PEN      ; -> pen of the current mode (colour.asm)
	    call .core.__FW_CALL
	    defw $BB96              ; TXT_SET_PAPER

	    call .core.__FW_CALL
	    defw $BB6C               ; TXT_CLEAR_WINDOW

	    ret
#line 54 "src/lib/arch/cpc/runtime/cls.asm"

	    ENDP

	    pop namespace
#line 60 "cpcbuild/lib/cpcbuild/palette.bas"

#line 1 "cpcbuild/lib/cpcbuild/core.asm"
	; -----------------------------------------------------------------------
	; cpcbuild library core -- screen addressing for direct screen writes
	;
	; Written from scratch for this project (MIT, like Boriel's runtime),
	; from public documentation of the CPC's screen layout; no code from
	; CPCtelera or other libraries.
	;
; Library coordinates: x in BYTES (0-79), y in pixel
	; lines (0-199), from the top-left. A byte is 2 pixels in mode 0, 4 in
	; mode 1, 8 in mode 2, in every mode 80 bytes per line.
	;
; Screen layout: 16 KB at CB_BASE*256 (&C000, or &4000 for the
	; double-buffer back screen), as eight 2 KB blocks, one per pixel line
; within a character row: line y is in block (y AND 7), at byte
	; (y >> 3) * 80 + x of that block -- plus the hardware-scroll offset
	; (below), wrapping within the 2 KB block.
	;
; Hardware scroll (Q-4c.3): when the firmware scrolls text it moves the
	; CRTC's start address rather than copying the screen, so after a
	; scroll the top-left byte is at CB_OFFSET (0-&7FE) into each block.
	; __CB_SYNC reads it from the firmware (SCR_GET_LOCATION); the library
	; calls it in ScreenInit and after every WaitRetrace/FlipBuffer. All
	; addresses below include it, and wrap at the end of the 2 KB block.
	; Because of the offset, a row of bytes can cross the end of its block
; (it continues at the block's start): __CB_ROW_WRAPS tells a drawing
	; routine when to use the careful per-byte path (__CB_INC_X).
	;
	; The CB_* variables (CB_BASE ... CB_TILESET, at the end of this file; CB_KEYS
	; is in keys.asm) are this library's own storage, in the program image, so
	; the compiler's private runtime block (sysvars.asm) knows nothing of them.
	; Zero when the program loads; CPC_INIT_CB_CORE sets the defaults.






	    push namespace core

; CPC_INIT_CB_CORE -- start-up defaults: draw on and show &C000, no
	; scroll offset yet (the bootstrap's SCR_SET_MODE has just reset it).
; Firmware entry called: none. Registers clobbered: AF.
CPC_INIT_CB_CORE:
	    ld   a, $C0
	    ld   (CB_BASE), a
	    ld   (CB_SHOWN), a
	    ret

	; __CB_SYNC -- reads the firmware's screen base and hardware-scroll
	; offset. Outside double buffering, the library draws on the screen the
	; firmware shows; with double buffering on, CB_BASE/CB_SHOWN are kept
	; by FlipBuffer and only the offset is read.
; Firmware entry called: SCR_GET_LOCATION (&BC0B, -> A = base high
	; byte, HL = offset in bytes).
; Registers clobbered: AF, HL (main); BC', DE', HL', AF' (the gate).
	;
; Bare-metal mode (-D CPC_BAREMETAL): no firmware to ask. The shown
	; screen is always &C000 outside double buffering and the scroll offset
; is 0: the bare runtime never moves the CRTC start address except by
	; this library's FlipBuffer (its text scrolls in software). If the bare
	; text ever scrolls with the CRTC start address, this is the one place to
	; read that offset from (replace the "ld hl, 0" below).
; Registers clobbered: AF, HL.
__CB_SYNC:
#line 76 "cpcbuild/lib/cpcbuild/core.asm"
	    call .core.__FW_CALL
	    defw $BC0B
	    ld   (CB_OFFSET), hl
	    ld   l, a
	    ld   a, (CB_DBUF)
	    or   a
	    ret  nz
	    ld   a, l
	    ld   (CB_BASE), a
	    ld   (CB_SHOWN), a
	    ret
#line 88 "cpcbuild/lib/cpcbuild/core.asm"

	; __CB_ADDR -- B = y (pixel line 0-199), C = x (byte 0-79) -> HL = its
	; address on the screen the library draws on. No range check.
; Firmware entry called: none.
; Registers clobbered: AF, DE, HL. B and C are preserved.
__CB_ADDR:
	    ld   a, b
	    and  $F8                ; 8 * (y >> 3)
	    ld   l, a
	    ld   h, 0
	    add  hl, hl             ; 16 * (y >> 3)
	    ld   d, h
	    ld   e, l
	    add  hl, hl
	    add  hl, hl             ; 64 * (y >> 3)
	    add  hl, de             ; 80 * (y >> 3)
	    ld   e, c
	    ld   d, 0
	    add  hl, de             ; + x
	    ld   de, (CB_OFFSET)
	    add  hl, de             ; + scroll offset
	    ld   a, h
	    and  $07                ; wrap within the 2 KB block
	    ld   h, a
	    ld   a, b
	    and  $07
	    add  a, a
	    add  a, a
	    add  a, a               ; block (y AND 7) * 8 (high byte)
	    or   h
	    ld   h, a
	    ld   a, (CB_BASE)
	    or   h
	    ld   h, a
	    ret

	; __CB_NEXT_LINE -- HL = an address on line y -> the same x on line
	; y + 1. Line 199 goes on to an address past the bottom of the screen;
	; callers clip before that.
; Firmware entry called: none.
; Registers clobbered: AF, HL.
__CB_NEXT_LINE:
	    ld   a, h
	    add  a, 8               ; next block = next pixel line
	    ld   h, a
	    and  $38
	    ret  nz                 ; same character row
    ld   a, l               ; crossed into the next character row:
	    add  a, 80              ; block 0, 80 bytes on, wrapping within it
	    ld   l, a
	    ld   a, h
	    adc  a, 0
	    and  $07
	    ld   h, a
	    ld   a, (CB_BASE)
	    or   h
	    ld   h, a
	    ret

	; __CB_INC_X -- HL = HL + 1 within its 2 KB block (the byte after the
	; block's last one is its first). The slow path for rows that wrap.
; Firmware entry called: none.
; Registers clobbered: AF, HL.
__CB_INC_X:
	    inc  l
	    ret  nz
	    inc  h
	    ld   a, h
	    and  $07
	    ret  nz
	    ld   a, h
	    sub  8
	    ld   h, a
	    ret

	; __CB_ROW_WRAPS -- HL = the first byte of a row, C = its width in bytes
	; (1-80) -> Carry set if the row crosses the end of its 2 KB block (use
	; __CB_INC_X), clear if plain INC HL / LDI work for the whole row.
; Firmware entry called: none.
; Registers clobbered: AF, DE.
__CB_ROW_WRAPS:
	    PROC
	    LOCAL __CRW_FITS, __CRW_WRAPS

	    ld   a, h
	    and  $07
	    ld   d, a
	    ld   a, l
	    add  a, c
	    ld   e, a
	    ld   a, d
    adc  a, 0               ; A:E = position in block + width
	    cp   $08
	    jr   c, __CRW_FITS      ; < &800
	    jr   nz, __CRW_WRAPS
	    ld   a, e
	    or   a
    jr   z, __CRW_FITS      ; exactly &800: ends on the block's last byte
__CRW_WRAPS:
	    scf
	    ret
__CRW_FITS:
	    or   a
	    ret
	    ENDP

	; Library state. CB_BASE and CB_SHOWN must stay adjacent and in this order
	; (FlipBuffer swaps them with one 16-bit load and store).
CB_BASE:    defb 0          ; high byte of the screen the library draws on
CB_SHOWN:   defb 0          ; high byte of the screen being displayed
CB_OFFSET:  defw 0          ; the firmware's hardware-scroll offset, 0-&7FE
CB_DBUF:    defb 0          ; 1 = double buffering on
CB_TILESET: defw 0          ; current tileset address (tiles.asm)
CB_TILEW:   defb 0          ; tile width: 0 = the mode's, else 1 + log2 bytes (tiles.asm)

	    pop namespace
#line 62 "cpcbuild/lib/cpcbuild/palette.bas"
#line 1 "cpcbuild/lib/cpcbuild/dbuf.asm"
	; -----------------------------------------------------------------------
; cpcbuild library -- double buffering: start, stop, flip
	;
	; Written from scratch for this project (MIT); see core.asm and display.asm
	; (the notes on double buffering and on bare-metal mode there apply).
	; EnableDoubleBuffer, DisableDoubleBuffer and FlipBuffer. FlipBuffer waits
	; for the flyback with __CB_WAIT_RETRACE (retrace.asm).

#line 1 "cpcbuild/lib/cpcbuild/retrace.asm"
	; -----------------------------------------------------------------------
	; cpcbuild library -- frame flyback wait (WaitRetrace)
	;
	; Written from scratch for this project (MIT); see core.asm and display.asm
	; (the notes on double buffering and on bare-metal mode there apply).


#line 11 "cpcbuild/lib/cpcbuild/retrace.asm"

	    push namespace core

	; __CB_WAIT_RETRACE -- waits for the start of the next frame flyback, BC
	; times (0 counts as 1), then re-reads the scroll offset. Each wait
	; first lets any flyback in progress finish (PPI port B bit 0, read
	; directly), so every count is a new frame; the wait itself is the
	; firmware's, with interrupts on, so the firmware's frame work (palette,
	; keyboard, sound) runs.
; Firmware entries called: MC_WAIT_FLYBACK (&BD19), SCR_GET_LOCATION
	; (&BC0B).
; Registers clobbered: AF, BC, HL (main); BC', DE', HL', AF' (the gate).
__CB_WAIT_RETRACE:
#line 33 "cpcbuild/lib/cpcbuild/retrace.asm"
	    PROC
	    LOCAL __CWR_LOOP, __CWR_INFLY

	    ld   a, b
	    or   c
	    jr   nz, __CWR_LOOP
	    inc  c
__CWR_LOOP:
	    push bc
    ld   b, $F5             ; PPI port B: bit 0 = frame flyback
__CWR_INFLY:
	    in   a, (c)
	    rra
	    jr   c, __CWR_INFLY
	    call .core.__FW_CALL
	    defw $BD19              ; MC_WAIT_FLYBACK
	    pop  bc
	    dec  bc
	    ld   a, b
	    or   c
	    jr   nz, __CWR_LOOP
	    jp   __CB_SYNC
	    ENDP
#line 57 "cpcbuild/lib/cpcbuild/retrace.asm"

	    pop namespace
#line 10 "cpcbuild/lib/cpcbuild/dbuf.asm"
#line 1 "cpcbuild/lib/cpcbuild/setbase.asm"
	; -----------------------------------------------------------------------
	; cpcbuild library -- showing a screen (the CRTC start address)
	;
	; Written from scratch for this project (MIT); see core.asm and display.asm
	; (the notes on double buffering and on bare-metal mode there apply).



	    push namespace core

; __CB_SET_BASE -- A = base high byte (&00, &40, &80 or &C0): shows that
	; 16 KB screen (and, in firmware mode, makes the firmware's text go there
	; too). Takes effect at the next frame.
; Firmware entry called: SCR_SET_BASE (&BC08).
; Registers clobbered: AF (main); BC', DE', HL', AF' (the gate).
	;
; Bare-metal mode (-D CPC_BAREMETAL): CRTC registers 12 and 13 directly
	; (start address = base, plus CB_OFFSET/2 words; the CRTC reads it at the
	; start of the next frame, so writing after the flyback is safe). The
	; bare runtime's text base (SCREEN_ADDR) is pointed at the same screen,
	; so PRINT follows the shown screen as the firmware's does. Hardware
; used: CRTC (&BCxx/&BDxx).
; Registers clobbered: AF, BC, DE, HL.
__CB_SET_BASE:
#line 51 "cpcbuild/lib/cpcbuild/setbase.asm"
	    call .core.__FW_CALL
	    defw $BC08
	    ret
#line 55 "cpcbuild/lib/cpcbuild/setbase.asm"

	    pop namespace
#line 11 "cpcbuild/lib/cpcbuild/dbuf.asm"

	    push namespace core

; __CB_DBUF_ON -- starts double buffering: copies the shown screen to
	; the back screen (&4000), then draws there while &C000 is shown.
	; Does nothing if already on.
; Firmware entry called: SCR_SET_BASE (&BC08, A = &C0) so that &C000 is
	; shown, then __CB_SYNC's.
; Registers clobbered: AF, BC, DE, HL (main); BC', DE', HL', AF'.
__CB_DBUF_ON:
	    ld   a, (CB_DBUF)
	    or   a
	    ret  nz
	    ld   a, $C0
    call __CB_SET_BASE      ; SCR_SET_BASE: show &C000
	    ld   hl, $C000
	    ld   de, $4000
	    ld   bc, $4000
	    ldir
	    ld   a, 1
	    ld   (CB_DBUF), a
	    ld   a, $40
	    ld   (CB_BASE), a
	    ld   a, $C0
	    ld   (CB_SHOWN), a
	    jp   __CB_SYNC

	; __CB_DBUF_OFF -- stops double buffering, leaving &C000 shown with the
	; last frame on it (copied from &4000 if that was showing).
; Firmware entry called: SCR_SET_BASE (&BC08), then __CB_SYNC's.
; Registers clobbered: AF, BC, DE, HL (main); BC', DE', HL', AF'.
__CB_DBUF_OFF:
	    PROC
	    LOCAL __CDO_SHOWN_C0

	    ld   a, (CB_DBUF)
	    or   a
	    ret  z
	    ld   a, (CB_SHOWN)
	    cp   $C0
	    jr   z, __CDO_SHOWN_C0
	    ld   hl, $4000
	    ld   de, $C000
	    ld   bc, $4000
	    ldir
	    ld   a, $C0
    call __CB_SET_BASE      ; SCR_SET_BASE: show &C000
__CDO_SHOWN_C0:
	    xor  a
	    ld   (CB_DBUF), a
	    jp   __CB_SYNC          ; CB_BASE = CB_SHOWN = &C0 again
	    ENDP

	; __CB_FLIP -- shows the screen just drawn and draws on the other one
	; from now on. Waits for the frame flyback first, so the switch happens
	; between frames (the CRTC takes the new start address at the next
	; frame). Without double buffering it just waits for the flyback.
; Firmware entries called: MC_WAIT_FLYBACK (&BD19, via
	; __CB_WAIT_RETRACE), SCR_SET_BASE (&BC08, A = new base), SCR_GET_LOCATION.
; Registers clobbered: AF, BC, DE, HL (main); BC', DE', HL', AF'.
__CB_FLIP:
	    ld   bc, 1
	    call __CB_WAIT_RETRACE
	    ld   a, (CB_DBUF)
	    or   a
	    ret  z
	    ld   a, (CB_BASE)
    call __CB_SET_BASE      ; SCR_SET_BASE: show the screen just drawn
	    ld   hl, (CB_BASE)      ; L = CB_BASE, H = CB_SHOWN (adjacent)
	    ld   a, l
	    ld   l, h
	    ld   h, a
	    ld   (CB_BASE), hl      ; swapped
	    jp   __CB_SYNC

	    pop namespace
#line 63 "cpcbuild/lib/cpcbuild/palette.bas"
#line 1 "cpcbuild/lib/cpcbuild/keys.asm"
	; -----------------------------------------------------------------------
	; cpcbuild library -- keyboard matrix scan
	;
	; Written from scratch for this project (MIT); see core.asm. From the
	; public documentation of the 8255 PPI, the AY-3-8912's I/O port and the
	; keyboard matrix (cpcwiki.eu, CPC Firmware Guide); no library code.
	;
	; The CPC keyboard is a matrix of 10 rows x 8 columns, read through the
; AY-3-8912: PPI port C bits 0-3 pick the row, bits 6-7 are the AY's
	; BDIR (bit 7) and BC1 (bit 6) lines (&C0 = select register, &40 =
	; read it), and the AY's port A (register 14) returns the 8 column bits,
	; 0 = pressed. Row 9 is joystick 0 (and DEL). A firmware key
	; number is row * 8 + bit.
	;
	; CB_KEYS (at the end of this file) holds the last scan, one byte per row,
; as read (bit = 0: pressed). It is the library's own storage, in the
	; program image.

	    push namespace core

	; __CB_SCAN_KEYS -- reads the 10 rows into CB_KEYS, straight from the
	; hardware, with interrupts off so the firmware's own keyboard scan (in
	; its interrupt handler) cannot interleave with this one; returns with
	; interrupts on.
	;
; Afterwards the PPI is as the firmware leaves it: control word &82
	; (port A output, B input, C output), port C = the cassette bits it had
; before (bits 4-5: motor and write data) with the AY lines (bits 6-7)
	; and row bits (0-3) inactive, AY register 14 selected (the register
	; the firmware's own scan selects too). Writing the PPI control word
	; clears its output latches, so the cassette bits are put back at once;
	; the motor is off for a few microseconds only if it was on.
; Firmware entries called: none.
; Registers clobbered: AF, BC, DE, HL.
__CB_SCAN_KEYS:
	    PROC
	    LOCAL __CSK_LOOP

	    di
	    ld   b, $F6
    in   a, (c)             ; port C: keep the cassette bits (4, 5)
	    and  $30
	    ld   d, a
	    ld   bc, $F40E
	    out  (c), c             ; port A = 14 (AY register number)
	    ld   b, $F6
	    or   $C0
    out  (c), a             ; AY: select register
    out  (c), d             ; AY: inactive
	    ld   bc, $F792
	    out  (c), c             ; port A becomes an input
	    ld   a, d
	    or   $40                ; BC1 only = read; low nibble = row 0
	    ld   e, a
	    ld   hl, CB_KEYS
__CSK_LOOP:
	    ld   b, $F6
    out  (c), e             ; select the row, AY: read
	    ld   b, $F4
	    in   a, (c)
	    ld   (hl), a
	    inc  hl
	    inc  e
	    ld   a, e
	    and  $0F
	    cp   10
	    jr   nz, __CSK_LOOP
	    ld   bc, $F782
	    out  (c), c             ; port A back to output (clears the latches)
	    ld   b, $F6
	    out  (c), d             ; cassette bits back, AY inactive, row 0
	    ei
	    ret
	    ENDP

	; __CB_KEY_DOWN -- A = firmware key number (0-79) -> A = 1 if that key
	; was down at the last scan, else 0 (also 0 for numbers above 79).
; Firmware entries called: none.
; Registers clobbered: AF, BC, HL.
__CB_KEY_DOWN:
	    PROC
	    LOCAL __CKD_SHIFT, __CKD_LOOP, __CKD_TEST, __CKD_NO

	    cp   80
	    jr   nc, __CKD_NO
	    ld   c, a
	    and  7
	    ld   b, a               ; B = bit number
	    ld   a, c
	    rrca
	    rrca
	    rrca
	    and  $1F                ; A = row
	    ld   hl, CB_KEYS
	    add  a, l
	    ld   l, a
	    jr   nc, __CKD_SHIFT
	    inc  h
__CKD_SHIFT:
	    ld   a, 1
	    inc  b
	    jr   __CKD_TEST
__CKD_LOOP:
	    add  a, a
__CKD_TEST:
	    djnz __CKD_LOOP         ; A = 1 << bit
	    and  (hl)
	    jr   nz, __CKD_NO       ; bit set = not pressed
	    ld   a, 1
	    ret
__CKD_NO:
	    xor  a
	    ret
	    ENDP

	; __CB_ANY_KEY -- A = 1 if any key was down at the last scan, else 0.
; Firmware entries called: none.
; Registers clobbered: AF, B, HL.
__CB_ANY_KEY:
	    PROC
	    LOCAL __CAK_LOOP

	    ld   hl, CB_KEYS
	    ld   b, 10
	    ld   a, $FF
__CAK_LOOP:
	    and  (hl)
	    inc  hl
	    djnz __CAK_LOOP
	    inc  a                  ; $FF (nothing down) -> 0
	    ret  z
	    ld   a, 1
	    ret
	    ENDP

CB_KEYS:    defs 10         ; the last matrix scan, rows 0-9 (bit = 0: pressed)

	    pop namespace
#line 64 "cpcbuild/lib/cpcbuild/palette.bas"
#line 1 "cpcbuild/lib/cpcbuild/palette.asm"
	; -----------------------------------------------------------------------
	; cpcbuild library -- palette, firmware and Gate Array together
	;
	; Written from scratch for this project (MIT); see core.asm. From the
	; public documentation of the Gate Array's colour registers and colour
	; numbers (cpcwiki.eu), checked in the emulator (tools/palette_check.py).
	;
	; This file holds the palette upload only; the colour tables and the
	; Gate Array write (__CPC_SET_INK, __CPC_GA_SET ...) are the compiler's
	; own runtime, src/lib/arch/cpc/runtime/gacolour.asm, shared with SetInk
	; and SetBorder in cpc.bas.

#line 1 "src/lib/arch/cpc/runtime/gacolour.asm"
	; -----------------------------------------------------------------------
	; Colours -- firmware and Gate Array together (SetInk, SetBorder)
	;
	; Written from scratch for this project (MIT); see cpc.bas. From the
	; public documentation of the Gate Array's colour registers and colour
	; numbers (cpcwiki.eu), checked in the emulator (cpcbuild's
	; tools/palette_check.py).
	;
; A colour change goes two ways (notes.md, Q-4c palette decision): through
	; the firmware (SCR_SET_INK / SCR_SET_BORDER), so its own ink tables stay
	; right, and straight to the Gate Array, so it shows at once instead of
	; at the firmware's next ink update.
	;
; Gate Array write (port &7Fxx): first a pen-select byte (0-15, or &10
	; for the border), then a colour byte &40 + hardware colour code (0-31).
	; The firmware numbers colours 0-26; __CPC_HWCOL maps them to the codes.




	    push namespace core

	; Firmware colour number (0-26) -> Gate Array colour byte (&40 + code).
__CPC_HWCOL:
	    defb $54, $44, $55, $5C, $58, $5D, $4C, $45, $4D     ;  0- 8
	    defb $56, $46, $57, $5E, $40, $5F, $4E, $47, $4F     ;  9-17
	    defb $52, $42, $53, $5A, $59, $5B, $4A, $43, $4B     ; 18-26

	; __CPC_GA_SET -- writes one colour to the Gate Array only (the firmware's
	; tables are not touched). A = pen 0-15, or 16 for the border; C =
	; firmware colour 0-26. Out-of-range values are ignored. The two writes
	; are made with interrupts off (the firmware's interrupt handler selects
	; pens too, for flashing inks), and it returns with interrupts on.
; Firmware entries called: none. In bare-metal mode the colour is also kept
	; in PAL_SHADOW (the pen's colour, for BORDER).
; Registers clobbered: AF, BC, HL.
__CPC_GA_SET:
	    PROC
	    LOCAL __CGS_NOADD

	    cp   17
	    ret  nc
	    ld   b, a               ; B = pen select byte
	    ld   a, c
	    cp   27
	    ret  nc
#line 55 "src/lib/arch/cpc/runtime/gacolour.asm"
	    ld   hl, __CPC_HWCOL
	    add  a, l
	    ld   l, a
	    jr   nc, __CGS_NOADD
	    inc  h
__CGS_NOADD:
	    ld   c, (hl)            ; C = colour byte
	    ld   a, b
	    ld   b, $7F             ; port &7Fxx; the low byte is ignored
	    di
	    out  (c), a             ; select the pen
    out  (c), c             ; colour: data = C
	    ei
	    ret
	    ENDP

; __CPC_SET_INK -- A = pen (0-15), C = firmware colour 0-26: sets it in
; the firmware (not flashing: both inks the same) and on the Gate Array.
	; Colours above 26 and pens above 15 are ignored (the firmware itself
	; wraps pen 16 round to pen 0, so it is not passed on).
; Firmware entry called: SCR_SET_INK (&BC32, A = pen, B and C = colour).
; Registers clobbered: AF, BC, DE, HL (main); BC', DE', HL', AF' (the gate).
__CPC_SET_INK:
	    cp   16
	    ret  nc
	    ld   b, a
	    ld   a, c
	    cp   27
	    ret  nc
	    ld   a, b

	    ld   b, c
	    push af
	    push bc
	    call .core.__FW_CALL
	    defw $BC32
	    pop  bc
	    pop  af
#line 94 "src/lib/arch/cpc/runtime/gacolour.asm"
    jp   __CPC_GA_SET           ; bare-metal mode: the Gate Array only

; __CPC_SET_BORDER -- A = firmware colour 0-26: sets the border in the
	; firmware and on the Gate Array. Colours above 26 are ignored.
; Firmware entry called: SCR_SET_BORDER (&BC38, B and C = colour).
; Registers clobbered: AF, BC, DE, HL (main); BC', DE', HL', AF' (the gate).
__CPC_SET_BORDER:
	    cp   27
	    ret  nc
	    ld   b, a
	    ld   c, a

	    push bc
	    call .core.__FW_CALL
	    defw $BC38
	    pop  bc
#line 111 "src/lib/arch/cpc/runtime/gacolour.asm"
	    ld   a, 16
    jp   __CPC_GA_SET           ; bare-metal mode: the Gate Array only

	    pop namespace
#line 14 "cpcbuild/lib/cpcbuild/palette.asm"

	    push namespace core

	; __CB_PAL_UPLOAD -- HL = list of firmware colours, B = count, C = first
; pen: pen C gets the first colour, C+1 the next, and so on, each set
	; with __CPC_SET_INK. Stops after pen 15; a count of 0 does nothing.
; Firmware entry called: SCR_SET_INK (&BC32), once per pen.
; Registers clobbered: AF, BC, DE, HL (main); BC', DE', HL', AF' (the gate).
__CB_PAL_UPLOAD:
	    PROC
	    LOCAL __CPU_LOOP

__CPU_LOOP:
	    ld   a, b
	    or   a
	    ret  z
	    ld   a, c
	    cp   16
	    ret  nc
	    push bc
	    push hl
	    ld   c, (hl)
	    call __CPC_SET_INK    ; A = pen, C = colour
	    pop  hl
	    pop  bc
	    inc  hl
	    inc  c
	    djnz __CPU_LOOP
	    ret
	    ENDP

	    pop namespace
#line 65 "cpcbuild/lib/cpcbuild/palette.bas"
#line 1 "cpcbuild/lib/cpcbuild/sprmask.asm"
	; -----------------------------------------------------------------------
	; cpcbuild library -- PutSpriteMasked (clipped masked sprite)
	;
	; Written from scratch for this project (MIT); see core.asm and
	; sprcommon.asm (the set-up and the unrolled fast paths all three sprite
	; routines share).

#line 1 "cpcbuild/lib/cpcbuild/sprcommon.asm"
	; -----------------------------------------------------------------------
	; cpcbuild library -- sprite routines' shared set-up and unrolled driver
	;
	; Written from scratch for this project (MIT); see core.asm.
	;
	; Sprite data is already in screen-byte format (2 pixels per byte in mode
	; 0, 4 in mode 1, 8 in mode 2), row-major, top row first, w bytes per
	; row; masked data is (mask, pixels) byte pairs. x is in bytes, y in
; lines, from the top-left, and may be off the screen: the part outside
	; 0-79 / 0-199 is clipped away (the source bytes and rows are skipped,
	; the data keeps its full w-byte row layout). The clip itself is
	; __CB_CLIP_RECT in clip.asm.
	;
; Each routine reads its parameters from the calling sub's IX frame:
	; x = (ix+4), y = (ix+6) (16-bit), w = (ix+9), h = (ix+11), data or
; buffer address = (ix+12) (16-bit). Three tiers: a sprite of width 1, 2,
	; 4 or 8 that is not clipped at its sides, when no row of the screen can
	; wrap (__CB_NOWRAP), takes the unrolled loops (__CB_SPR_UNROLLED, the
	; row driver __CB_FAST_ROWS); otherwise rows that don't wrap around the
	; end of their 2 KB block (hardware-scroll offset) use LDIR / plain
	; increments; rows that do use __CB_INC_X per byte. __CB_SPR_PREP skips
	; the clipper for a sprite entirely on the screen.
	;
	; This file holds what PutSprite (sprput.asm), PutSpriteMasked
; (sprmask.asm) and GetBlock (sprget.asm) all use: each of those
	; includes it.

#line 1 "cpcbuild/lib/cpcbuild/clip.asm"
	; -----------------------------------------------------------------------
	; cpcbuild library -- rectangle clipping
	;
	; Written from scratch for this project (MIT); see core.asm.
	; The clip shared by FillRect (fill.asm) and the sprite routines
	; (sprcommon.asm); kept in a file of its own so that PutSprite doesn't
	; carry FillRect.



	    push namespace core

	; __CB_CLIP1 -- clips one axis. HL = position (signed 16-bit), A = size
	; (0-255), E = the axis limit (80 bytes across, 200 lines down).
	; Returns Carry set if nothing is visible. Otherwise Carry clear,
	; L = first visible position (0 if the start was off the left/top),
	; D = how many items were cut off at the start, C = the visible count.
; Firmware entry called: none. Registers clobbered: AF, C, D, HL
	; (E is preserved).
__CB_CLIP1:
	    PROC
	    LOCAL __CC1_POS, __CC1_LIMIT, __CC1_EMPTY, __CC1_OK

	    or   a
	    jr   z, __CC1_EMPTY
	    ld   c, a
	    bit  7, h
	    jr   z, __CC1_POS
    xor  a                  ; negative: HL = -HL
	    sub  l
	    ld   l, a
	    sbc  a, a
    sub  h                  ; (0 - L borrow) folded: A = -H - borrow
	    ld   h, a
	    or   a
    jr   nz, __CC1_EMPTY    ; cut off 256 or more: more than any size
	    ld   a, l
	    cp   c
	    jr   nc, __CC1_EMPTY    ; cut off all of it
	    ld   d, a
	    ld   a, c
	    sub  d
	    ld   c, a               ; visible = size - cut
	    ld   l, 0
	    jr   __CC1_LIMIT
__CC1_POS:
	    ld   a, h
	    or   a
	    jr   nz, __CC1_EMPTY
	    ld   a, l
	    cp   e
	    jr   nc, __CC1_EMPTY    ; starts at or past the limit
	    ld   d, 0
__CC1_LIMIT:
	    ld   a, e
	    sub  l                  ; room left before the limit (>= 1)
	    cp   c
	    jr   nc, __CC1_OK
	    ld   c, a               ; cut at the far edge
__CC1_OK:
	    or   a
	    ret
__CC1_EMPTY:
	    scf
	    ret
	    ENDP

	; __CB_CLIP_RECT -- clips a rectangle to the screen. HL = x, DE = y
	; (signed 16-bit, in bytes and lines), B = width (bytes), C = height
	; (lines). Returns Carry set if nothing is visible. Otherwise Carry
	; clear, HL = the screen address of the visible top-left byte, and
	; the variables __CBC_CW (visible width), __CBC_CH (visible height),
	; __CBC_SX (bytes cut off at the left) and __CBC_SY (rows cut off at the
	; top) are set.
; Firmware entry called: none.
; Registers clobbered: AF, BC, DE, HL.
__CB_CLIP_RECT:
	    PROC
	    LOCAL __CCR_EMPTY

	    ld   a, c
	    ld   (__CBC_H), a
	    push de                 ; y
	    ld   a, b
	    ld   e, 80
	    call __CB_CLIP1
	    jr   c, __CCR_EMPTY
	    ld   a, l
	    ld   (__CBC_X0), a
	    ld   a, d
	    ld   (__CBC_SX), a
	    ld   a, c
	    ld   (__CBC_CW), a
	    pop  hl                 ; y
	    ld   a, (__CBC_H)
	    ld   e, 200
	    call __CB_CLIP1
	    ret  c
	    ld   a, d
	    ld   (__CBC_SY), a
	    ld   a, c
	    ld   (__CBC_CH), a
	    ld   b, l               ; first visible line
	    ld   a, (__CBC_X0)
	    ld   c, a
	    jp   __CB_ADDR          ; leaves Carry clear
__CCR_EMPTY:
	    pop  hl
	    scf
	    ret
	    ENDP


	; Clip results (word-sized where a "ld bc,(...)" wants the high byte 0).
__CBC_CW:  DEFW 0
__CBC_CH:  DEFB 0
__CBC_SX:  DEFB 0
__CBC_SY:  DEFB 0
__CBC_X0:  DEFB 0
__CBC_H:   DEFB 0

	    pop namespace
#line 29 "cpcbuild/lib/cpcbuild/sprcommon.asm"
#line 1 "cpcbuild/lib/cpcbuild/nowrap.asm"
	; -----------------------------------------------------------------------
	; cpcbuild library -- the "no row can wrap" test used by the fast paths
	;
	; Written from scratch for this project (MIT); see core.asm. Kept in a
	; file of its own (not core.asm) so that programs that use only the
	; display and keyboard routines don't carry it.
	; -----------------------------------------------------------------------



	    push namespace core

	; __CB_NOWRAP -- Carry set if no row on the screen can wrap around the
	; end of its 2 KB block, i.e. the hardware-scroll offset is 48 or less
	; (the last row's last byte is then at offset + 24*80 + 79 < 2048). True
	; whenever the text hasn't scrolled, so then the routines can skip the
	; per-row __CB_ROW_WRAPS test and use their unrolled fast paths.
; Firmware entry called: none. Registers clobbered: AF.
__CB_NOWRAP:
	    ld   a, (CB_OFFSET + 1)
	    or   a
    ret  nz                 ; 256 or more: Carry clear
	    ld   a, (CB_OFFSET)
	    cp   49                 ; Carry set if 48 or less
	    ret

	    pop namespace
#line 30 "cpcbuild/lib/cpcbuild/sprcommon.asm"

	    push namespace core

	; __CB_SPR_PREP -- common set-up. A = bytes per item in the data (1, or
	; 2 for masked pairs). Clips the rectangle; returns Carry set if nothing
	; is visible. Otherwise Carry clear, HL = screen address of the first
	; visible byte, DE = address in the data/buffer of the first visible item
	; (data + (SY*w + SX) * A), and __CBS_SKIP = bytes to add to the data
	; pointer after each row ((w - visible width) * A); __CBC_CH is the
	; row count. A sprite entirely on the screen (x, y in 0-255, 1-80 wide, 1-200
; high, fitting) skips the clipper: its address is computed directly and
	; __CBS_SKIP is 0.
; Firmware entry called: none. Registers clobbered: AF, BC, DE, HL.
__CB_SPR_PREP:
	    PROC
	    LOCAL __CSP_ONE1, __CSP_ONE2, __CSP_NOSY, __CSP_MUL, __CSP_CLIP

	    ld   e, a               ; (kept in E for the clipper path)
	    ld   a, (ix+5)
	    or   (ix+7)
    jr   nz, __CSP_CLIP     ; x or y outside 0-255: needs the clipper
	    ld   c, (ix+4)          ; C = x
	    ld   b, (ix+6)          ; B = y
	    ld   l, (ix+9)          ; L = w
	    ld   h, (ix+11)         ; H = h
	    ld   a, l
	    dec  a
	    cp   80
	    jr   nc, __CSP_CLIP     ; w is not 1-80
	    ld   a, 80
    sub  l                  ; 80 - w: the last x that fits
	    cp   c
	    jr   c, __CSP_CLIP
	    ld   a, h
	    dec  a
	    cp   200
	    jr   nc, __CSP_CLIP     ; h is not 1-200
	    ld   a, 200
    sub  h                  ; 200 - h: the last y that fits
	    cp   b
	    jr   c, __CSP_CLIP
    ld   a, l               ; entirely on screen: nothing to clip
	    ld   (__CBC_CW), a
	    ld   a, h
	    ld   (__CBC_CH), a
	    call __CB_ADDR
	    ld   de, 0
	    ld   (__CBS_SKIP), de
	    ld   e, (ix+12)
	    ld   d, (ix+13)
	    or   a
	    ret
__CSP_CLIP:
	    ld   a, e
	    ld   (__CBS_K), a
	    ld   l, (ix+4)
	    ld   h, (ix+5)
	    ld   e, (ix+6)
	    ld   d, (ix+7)
	    ld   b, (ix+9)
	    ld   c, (ix+11)
	    call __CB_CLIP_RECT
	    ret  c
	    push hl                 ; screen address
	    ld   a, (ix+9)
	    ld   hl, __CBC_CW
	    sub  (hl)               ; w - visible width
	    ld   l, a
	    ld   h, 0
	    ld   a, (__CBS_K)
	    dec  a
	    jr   z, __CSP_ONE1
	    add  hl, hl
__CSP_ONE1:
	    ld   (__CBS_SKIP), hl
	    ld   hl, 0              ; offset = SY * w + SX
	    ld   a, (__CBC_SY)
	    or   a
	    jr   z, __CSP_NOSY
	    ld   e, (ix+9)
	    ld   d, 0
	    ld   b, a
__CSP_MUL:
	    add  hl, de
	    djnz __CSP_MUL
__CSP_NOSY:
	    ld   a, (__CBC_SX)
	    ld   e, a
	    ld   d, 0
	    add  hl, de
	    ld   a, (__CBS_K)
	    dec  a
	    jr   z, __CSP_ONE2
	    add  hl, hl
__CSP_ONE2:
	    ld   e, (ix+12)
	    ld   d, (ix+13)
	    add  hl, de
	    ex   de, hl             ; DE = data pointer
	    pop  hl                 ; HL = screen address
	    or   a
	    ret
	    ENDP

	; ---------------------------------------------------------------------
	; Unrolled fast paths (PutSprite, PutSpriteMasked, GetBlock)
	;
	; Used when the whole sprite is drawn without clipping at its sides
	; (visible width = w), no row can wrap in its 2 KB block (__CB_NOWRAP)
	; and the width is 1, 2, 4 or 8 bytes; anything else takes the generic
	; loops above. The choice is made once per call (__CB_SPR_UNROLLED), then
	; __CB_FAST_ROWS walks the rows one character row at a time (a "group" of
	; up to 8 rows, which are 2 KB apart) and calls the width's inner loop.
	; An inner loop gets A = rows in the group (1-8), HL = screen address of
	; its first row, DE = data/buffer address; it returns with HL = the first
	; row's address + 2 KB per row (the row after the group, in block terms)
	; and DE = data after the group. It may clobber AF, BC, DE, HL.
	;
	; The copy loops are LDI chains (20 CPC T-states a byte, the cheapest way
	; to move a byte); the stepping to the next 2 KB block is done with the
	; screen address in HL (ADD HL,BC), so it needs no page-crossing care. The
	; masked loops come in two forms, chosen per group by the width's gate
; (__CMWn): "F" steps with INC L / INC E and needs the screen row (low
	; byte <= 256 - n) and the data of the group (low byte <= 255 - 16 n,
	; i.e. 8 rows of 2n bytes) not to cross a 256-byte page; "S" uses
	; INC HL / INC DE and handles any address.
	; ---------------------------------------------------------------------

	; __CB_SPR_UNROLLED -- HL = screen address of the first visible byte,
	; DE = data address (as returned by __CB_SPR_PREP), BC = the routine's
	; table (the inner loops for widths 1, 2, 4, 8 as four DEFWs). Draws the
	; whole sprite and returns Carry clear, or, if this draw does not qualify
	; (rows can wrap, clipped at a side, or a width other than 1/2/4/8),
	; returns Carry set having drawn nothing (HL, DE preserved).
; Firmware entry called: none. Registers clobbered: AF, BC, DE, HL.
__CB_SPR_UNROLLED:
	    PROC
	    LOCAL __CSU_NO, __CSU_GO

	    push hl
	    push de
	    push bc
	    call __CB_NOWRAP        ; Carry set if no row can wrap
	    pop  hl                 ; HL = table (flags kept)
	    jr   nc, __CSU_NO
	    ld   de, (__CBS_SKIP)
	    ld   a, d
	    or   e
	    jr   nz, __CSU_NO       ; clipped at a side (leaves D = 0 otherwise)
	    ld   a, (__CBC_CW)
	    cp   1
	    jr   z, __CSU_GO
	    ld   e, 2
	    cp   2
	    jr   z, __CSU_GO
	    ld   e, 4
	    cp   4
	    jr   z, __CSU_GO
	    ld   e, 6
	    cp   8
	    jr   nz, __CSU_NO
__CSU_GO:
	    add  hl, de
	    ld   e, (hl)
	    inc  hl
	    ld   d, (hl)
	    ld   (__CBS_INN), de
	    pop  de
	    pop  hl
	    call __CB_FAST_ROWS
	    or   a
	    ret
__CSU_NO:
	    pop  de
	    pop  hl
	    scf
	    ret
	    ENDP

; __CB_FAST_ROWS -- the row driver: HL = screen address of the first
	; row, DE = data, __CBC_CH = rows (>= 1), __CBS_INN = the inner loop.
	; Draws all the rows, group by group (the first group ends at the end of
	; the character row it starts in, the others have 8 rows). Each inner
	; loop is entered by a RET (its address pushed) and ends by jumping to
	; __CFR_NEXT, which returns to the driver's caller when no rows are left;
	; otherwise HL (= the group's first row + 2 KB per row, i.e. in "block 8")
; becomes the first row of the next character row: back 16 KB to block 0
	; and on 80 bytes (nothing wraps on this path, so a plain add is right).
; Firmware entry called: none. Registers clobbered: AF, BC, DE, HL.
__CB_FAST_ROWS:
	    PROC
	    LOCAL __CFR_GRP, __CFR_CMP, __CFR_FULL, __CFR_GO

	    ld   a, h
	    cpl
	    and  $38
	    rrca
	    rrca
    rrca                    ; 7 - block: this line's place in its character row
	    inc  a                  ; A = rows left in this character row (1-8)
	    jr   __CFR_CMP
__CFR_GRP:
	    ld   a, 8
__CFR_CMP:
	    ld   c, a
	    ld   a, (__CBC_CH)      ; rows left
	    cp   c
	    jr   c, __CFR_FULL
	    sub  c
    ld   (__CBC_CH), a      ; this group: C rows, then A are left
	    ld   a, c
	    jr   __CFR_GO
__CFR_FULL:                 ; fewer than a full group left: all of them
	    ld   c, a               ; (A = rows left, 1-7)
	    xor  a
	    ld   (__CBC_CH), a
	    ld   a, c
__CFR_GO:
	    ld   bc, (__CBS_INN)
	    push bc
	    ret
__CFR_NEXT:
	    ld   a, (__CBC_CH)
	    or   a
	    ret  z
	    ld   a, h
	    sub  $40
	    ld   h, a
	    ld   bc, 80
	    add  hl, bc
	    jr   __CFR_GRP
	    ENDP


__CBS_INN: DEFW 0

__CBS_K:    DEFB 0
__CBS_SKIP: DEFW 0


	    pop namespace
#line 9 "cpcbuild/lib/cpcbuild/sprmask.asm"

	    push namespace core

; __CB_PUT_MASKED -- PutSpriteMasked's body: data is (mask, pixels)
	; pairs; each screen byte becomes (screen AND mask) OR pixels.
; Firmware entry called: none. Registers clobbered: AF, BC, DE, HL.
__CB_PUT_MASKED:
	    PROC
	    LOCAL __CPM_ROW, __CPM_SLOW, __CPM_SLOWLP, __CPM_FASTLP, __CPM_TAIL, __CPM_FAST, __CPM_FLP, __CPM_FSAME

	    ld   a, 2
	    call __CB_SPR_PREP
	    ret  c
	    ld   bc, __CPM_TAB
    call __CB_SPR_UNROLLED  ; width 1/2/4/8, unclipped, no wrap: done
	    ret  nc
	    call __CB_NOWRAP
	    jr   nc, __CPM_ROW
__CPM_FAST:                 ; no row can wrap: no per-row test
	    push hl
	    ex   de, hl             ; HL = data, DE = screen
	    ld   a, (__CBC_CW)
	    ld   b, a
__CPM_FLP:
	    ld   a, (de)
	    and  (hl)
	    inc  hl
	    or   (hl)
	    inc  hl
	    ld   (de), a
	    inc  de
	    djnz __CPM_FLP
	    ex   de, hl             ; DE = data after the row
	    ld   hl, (__CBS_SKIP)
	    add  hl, de
	    ex   de, hl
	    pop  hl
	    ld   a, (__CBC_CH)
	    dec  a
	    ret  z
	    ld   (__CBC_CH), a
    ld   a, h               ; next line: usually just the next 2 KB block
	    add  a, 8
	    ld   h, a
	    and  $38
	    jr   nz, __CPM_FSAME
	    ld   a, h               ; crossed into the next character row
	    sub  8
	    ld   h, a
	    call __CB_NEXT_LINE
__CPM_FSAME:
	    jr   __CPM_FAST
__CPM_ROW:
	    push hl                 ; row start
	    push de                 ; data
	    ld   bc, (__CBC_CW)
	    call __CB_ROW_WRAPS
	    pop  de
	    jr   c, __CPM_SLOW
	    ex   de, hl             ; HL = data, DE = screen
	    ld   b, c
__CPM_FASTLP:
	    ld   a, (de)            ; screen
	    and  (hl)               ; AND mask
	    inc  hl
	    or   (hl)               ; OR pixels
	    inc  hl
	    ld   (de), a
	    inc  de
	    djnz __CPM_FASTLP
	    ex   de, hl             ; DE = data after the row
	    jr   __CPM_TAIL
__CPM_SLOW:
	    ld   b, c
__CPM_SLOWLP:
	    ld   a, (de)            ; mask
	    inc  de
	    and  (hl)               ; AND screen
	    ld   c, a
	    ld   a, (de)            ; pixels
	    inc  de
	    or   c
	    ld   (hl), a
	    call __CB_INC_X         ; keeps B and C
	    djnz __CPM_SLOWLP
__CPM_TAIL:
	    ld   hl, (__CBS_SKIP)
	    add  hl, de
	    ex   de, hl
	    pop  hl
	    ld   a, (__CBC_CH)
	    dec  a
	    ret  z
	    ld   (__CBC_CH), a
	    call __CB_NEXT_LINE
	    jr   __CPM_ROW
	    ENDP


; PutSpriteMasked inner loops, width N: the gate __CMWn (A = rows) picks F or
	; S; both swap to HL = data, DE = screen (AND (HL) / OR (HL) read the
	; data) and come back swapped. F keeps the screen row's low byte in C and
	; restores it per row; S steps the screen address back N with the borrow.
__CMW1:
	    ld   b, a               ; rows
	    ld   a, 255
	    cp   l
	    jr   c, __CMS1         ; the screen row could cross a page
	    ld   a, 239
	    cp   e
	    jr   c, __CMS1         ; the data could cross a page
__CMF1:
	    ex   de, hl             ; HL = data, DE = screen
	    ld   c, e               ; screen row start (low byte)
__CMF1L:
	    ld   a, (de)            ; screen
	    and  (hl)               ; AND mask
	    inc  l
	    or   (hl)               ; OR pixels
	    inc  l
	    ld   (de), a
	    inc  e
	    ld   e, c
	    ld   a, d
	    add  a, 8               ; next 2 KB block
	    ld   d, a
	    djnz __CMF1L
	    ex   de, hl             ; HL = screen + 2 KB, DE = data
	    jp   __CFR_NEXT
__CMS1:
	    ex   de, hl             ; HL = data, DE = screen
__CMS1L:
	    ld   a, (de)            ; screen
	    and  (hl)               ; AND mask
	    inc  hl
	    or   (hl)               ; OR pixels
	    inc  hl
	    ld   (de), a
	    inc  de
	    ld   a, e
	    sub  1
	    ld   e, a
	    ld   a, d
	    sbc  a, 0               ; borrow from the low byte
	    add  a, 8               ; next 2 KB block
	    ld   d, a
	    djnz __CMS1L
	    ex   de, hl             ; HL = screen + 2 KB, DE = data
	    jp   __CFR_NEXT
__CMW2:
	    ld   b, a               ; rows
	    ld   a, 254
	    cp   l
	    jr   c, __CMS2         ; the screen row could cross a page
	    ld   a, 223
	    cp   e
	    jr   c, __CMS2         ; the data could cross a page
__CMF2:
	    ex   de, hl             ; HL = data, DE = screen
	    ld   c, e               ; screen row start (low byte)
__CMF2L:
	    ld   a, (de)            ; screen
	    and  (hl)               ; AND mask
	    inc  l
	    or   (hl)               ; OR pixels
	    inc  l
	    ld   (de), a
	    inc  e
	    ld   a, (de)            ; screen
	    and  (hl)               ; AND mask
	    inc  l
	    or   (hl)               ; OR pixels
	    inc  l
	    ld   (de), a
	    inc  e
	    ld   e, c
	    ld   a, d
	    add  a, 8               ; next 2 KB block
	    ld   d, a
	    djnz __CMF2L
	    ex   de, hl             ; HL = screen + 2 KB, DE = data
	    jp   __CFR_NEXT
__CMS2:
	    ex   de, hl             ; HL = data, DE = screen
__CMS2L:
	    ld   a, (de)            ; screen
	    and  (hl)               ; AND mask
	    inc  hl
	    or   (hl)               ; OR pixels
	    inc  hl
	    ld   (de), a
	    inc  de
	    ld   a, (de)            ; screen
	    and  (hl)               ; AND mask
	    inc  hl
	    or   (hl)               ; OR pixels
	    inc  hl
	    ld   (de), a
	    inc  de
	    ld   a, e
	    sub  2
	    ld   e, a
	    ld   a, d
	    sbc  a, 0               ; borrow from the low byte
	    add  a, 8               ; next 2 KB block
	    ld   d, a
	    djnz __CMS2L
	    ex   de, hl             ; HL = screen + 2 KB, DE = data
	    jp   __CFR_NEXT
__CMW4:
	    ld   b, a               ; rows
	    ld   a, 252
	    cp   l
	    jr   c, __CMS4         ; the screen row could cross a page
	    ld   a, 191
	    cp   e
	    jr   c, __CMS4         ; the data could cross a page
__CMF4:
	    ex   de, hl             ; HL = data, DE = screen
	    ld   c, e               ; screen row start (low byte)
__CMF4L:
	    ld   a, (de)            ; screen
	    and  (hl)               ; AND mask
	    inc  l
	    or   (hl)               ; OR pixels
	    inc  l
	    ld   (de), a
	    inc  e
	    ld   a, (de)            ; screen
	    and  (hl)               ; AND mask
	    inc  l
	    or   (hl)               ; OR pixels
	    inc  l
	    ld   (de), a
	    inc  e
	    ld   a, (de)            ; screen
	    and  (hl)               ; AND mask
	    inc  l
	    or   (hl)               ; OR pixels
	    inc  l
	    ld   (de), a
	    inc  e
	    ld   a, (de)            ; screen
	    and  (hl)               ; AND mask
	    inc  l
	    or   (hl)               ; OR pixels
	    inc  l
	    ld   (de), a
	    inc  e
	    ld   e, c
	    ld   a, d
	    add  a, 8               ; next 2 KB block
	    ld   d, a
	    djnz __CMF4L
	    ex   de, hl             ; HL = screen + 2 KB, DE = data
	    jp   __CFR_NEXT
__CMS4:
	    ex   de, hl             ; HL = data, DE = screen
__CMS4L:
	    ld   a, (de)            ; screen
	    and  (hl)               ; AND mask
	    inc  hl
	    or   (hl)               ; OR pixels
	    inc  hl
	    ld   (de), a
	    inc  de
	    ld   a, (de)            ; screen
	    and  (hl)               ; AND mask
	    inc  hl
	    or   (hl)               ; OR pixels
	    inc  hl
	    ld   (de), a
	    inc  de
	    ld   a, (de)            ; screen
	    and  (hl)               ; AND mask
	    inc  hl
	    or   (hl)               ; OR pixels
	    inc  hl
	    ld   (de), a
	    inc  de
	    ld   a, (de)            ; screen
	    and  (hl)               ; AND mask
	    inc  hl
	    or   (hl)               ; OR pixels
	    inc  hl
	    ld   (de), a
	    inc  de
	    ld   a, e
	    sub  4
	    ld   e, a
	    ld   a, d
	    sbc  a, 0               ; borrow from the low byte
	    add  a, 8               ; next 2 KB block
	    ld   d, a
	    djnz __CMS4L
	    ex   de, hl             ; HL = screen + 2 KB, DE = data
	    jp   __CFR_NEXT
__CMW8:
	    ld   b, a               ; rows
	    ld   a, 248
	    cp   l
	    jr   c, __CMS8         ; the screen row could cross a page
	    ld   a, 127
	    cp   e
	    jr   c, __CMS8         ; the data could cross a page
__CMF8:
	    ex   de, hl             ; HL = data, DE = screen
	    ld   c, e               ; screen row start (low byte)
__CMF8L:
	    ld   a, (de)            ; screen
	    and  (hl)               ; AND mask
	    inc  l
	    or   (hl)               ; OR pixels
	    inc  l
	    ld   (de), a
	    inc  e
	    ld   a, (de)            ; screen
	    and  (hl)               ; AND mask
	    inc  l
	    or   (hl)               ; OR pixels
	    inc  l
	    ld   (de), a
	    inc  e
	    ld   a, (de)            ; screen
	    and  (hl)               ; AND mask
	    inc  l
	    or   (hl)               ; OR pixels
	    inc  l
	    ld   (de), a
	    inc  e
	    ld   a, (de)            ; screen
	    and  (hl)               ; AND mask
	    inc  l
	    or   (hl)               ; OR pixels
	    inc  l
	    ld   (de), a
	    inc  e
	    ld   a, (de)            ; screen
	    and  (hl)               ; AND mask
	    inc  l
	    or   (hl)               ; OR pixels
	    inc  l
	    ld   (de), a
	    inc  e
	    ld   a, (de)            ; screen
	    and  (hl)               ; AND mask
	    inc  l
	    or   (hl)               ; OR pixels
	    inc  l
	    ld   (de), a
	    inc  e
	    ld   a, (de)            ; screen
	    and  (hl)               ; AND mask
	    inc  l
	    or   (hl)               ; OR pixels
	    inc  l
	    ld   (de), a
	    inc  e
	    ld   a, (de)            ; screen
	    and  (hl)               ; AND mask
	    inc  l
	    or   (hl)               ; OR pixels
	    inc  l
	    ld   (de), a
	    inc  e
	    ld   e, c
	    ld   a, d
	    add  a, 8               ; next 2 KB block
	    ld   d, a
	    djnz __CMF8L
	    ex   de, hl             ; HL = screen + 2 KB, DE = data
	    jp   __CFR_NEXT
__CMS8:
	    ex   de, hl             ; HL = data, DE = screen
__CMS8L:
	    ld   a, (de)            ; screen
	    and  (hl)               ; AND mask
	    inc  hl
	    or   (hl)               ; OR pixels
	    inc  hl
	    ld   (de), a
	    inc  de
	    ld   a, (de)            ; screen
	    and  (hl)               ; AND mask
	    inc  hl
	    or   (hl)               ; OR pixels
	    inc  hl
	    ld   (de), a
	    inc  de
	    ld   a, (de)            ; screen
	    and  (hl)               ; AND mask
	    inc  hl
	    or   (hl)               ; OR pixels
	    inc  hl
	    ld   (de), a
	    inc  de
	    ld   a, (de)            ; screen
	    and  (hl)               ; AND mask
	    inc  hl
	    or   (hl)               ; OR pixels
	    inc  hl
	    ld   (de), a
	    inc  de
	    ld   a, (de)            ; screen
	    and  (hl)               ; AND mask
	    inc  hl
	    or   (hl)               ; OR pixels
	    inc  hl
	    ld   (de), a
	    inc  de
	    ld   a, (de)            ; screen
	    and  (hl)               ; AND mask
	    inc  hl
	    or   (hl)               ; OR pixels
	    inc  hl
	    ld   (de), a
	    inc  de
	    ld   a, (de)            ; screen
	    and  (hl)               ; AND mask
	    inc  hl
	    or   (hl)               ; OR pixels
	    inc  hl
	    ld   (de), a
	    inc  de
	    ld   a, (de)            ; screen
	    and  (hl)               ; AND mask
	    inc  hl
	    or   (hl)               ; OR pixels
	    inc  hl
	    ld   (de), a
	    inc  de
	    ld   a, e
	    sub  8
	    ld   e, a
	    ld   a, d
	    sbc  a, 0               ; borrow from the low byte
	    add  a, 8               ; next 2 KB block
	    ld   d, a
	    djnz __CMS8L
	    ex   de, hl             ; HL = screen + 2 KB, DE = data
	    jp   __CFR_NEXT

__CPM_TAB:
	    DEFW __CMW1, __CMW2, __CMW4, __CMW8


	    pop namespace
#line 66 "cpcbuild/lib/cpcbuild/palette.bas"
#line 1 "cpcbuild/lib/cpcbuild/tilemap.asm"
	; -----------------------------------------------------------------------
; cpcbuild library -- TileMap and TileMapPart: a map of tiles
	;
	; Written from scratch for this project (MIT); see core.asm.
	;
	; A tile is W bytes x 8 lines, W = 1 << s with s from __CB_TXS
; (tiledraw.asm): the mode's GFX_XSHIFT (colour.asm) unless SetTileWidth
; fixed it, so by default 8x8 pixels: 1 byte in mode 2, 2 in mode 1, 4 in
; mode 0. Tile data: per tile its 8 rows top first, each row's bytes left to right,
	; so a tile is 8 * W bytes. Tile n is at CB_TILESET + n * 8 * W.
	; Tile cell (cx, cy) is byte column cx * W, pixel line cy * 8, so a tile
; starts on pixel line 0 of a character row: its 8 lines are in the 8
	; successive 2 KB blocks, i.e. the next line is H + 8, with no
	; character-row crossing. With a hardware-scroll offset a tile's row can
; still cross the end of its block (core.asm): that is checked once per
	; tile and a per-byte path (__CB_INC_X) is used then.
	;
	; None of these routines calls the firmware, and none uses IX, IY or the
	; shadow registers. Cells off the screen draw nothing.
	;
; This file: __CB_TILEMAP / __CB_TILEMAP_S, __CB_TILE_PTR and the fast
	; row loops. It draws through the drawers in tiledraw.asm; the single
	; tile routine (tile8.asm) is not needed.


#line 1 "cpcbuild/lib/cpcbuild/tiledraw.asm"
	; -----------------------------------------------------------------------
	; cpcbuild library -- 8x8 tile drawers (the core of DoTile8, DoTile16, TileMap)
	;
	; Written from scratch for this project (MIT); see core.asm.
	;
; A tile is W bytes x 8 lines, W = 1 << s with s from __CB_TXS (below):
	; the mode's GFX_XSHIFT (colour.asm) unless SetTileWidth fixed it, so by
; default 8x8 pixels: 1 byte in mode 2, 2 in mode 1, 4 in mode 0. Tile
; data: per tile its 8 rows top first, each row's bytes left to right,
	; so a tile is 8 * W bytes. Tile n is at CB_TILESET + n * 8 * W.
	; Tile cell (cx, cy) is byte column cx * W, pixel line cy * 8, so a tile
; starts on pixel line 0 of a character row: its 8 lines are in the 8
	; successive 2 KB blocks, i.e. the next line is H + 8, with no
	; character-row crossing. With a hardware-scroll offset a tile's row can
; still cross the end of its block (core.asm): that is checked once per
	; tile and a per-byte path (__CB_INC_X) is used then.
	;
	; None of these routines calls the firmware, and none uses IX, IY or the
	; shadow registers. Cells off the screen draw nothing.
	;
; This file: the unrolled drawers per mode and __CB_TILE_DRAW. The cell
	; address and placement are in tile8.asm, the maps in tilemap.asm.


	    push namespace core

	; Unrolled tile drawers, one per width W (4, 2, 1 bytes). The tile's 8 rows
	; are copied with LDI chains; the screen address is stepped to the next
	; row (+2 KB) between rows through HL (ADD HL,BC), so no page-crossing
	; care is needed. The caller guarantees no row wraps in its 2 KB block.
; __CTD_Gn: HL = the tile's data, DE = its screen address (on pixel line 0
	; of a character row). On return DE = screen address + 7 * 2 KB + W (so
	; the tile's address plus W is D - $38) and HL = the data after the tile.
; __CTD_Un: HL = screen address, DE = data (swaps, then as Gn).
; Firmware entry called: none. Registers clobbered: AF, BC, DE, HL.
__CTD_U4:
	    ex   de, hl
__CTD_G4:
	    ldi
	    ldi
	    ldi
	    ldi
	    ex   de, hl
	    ld   bc, $800 - 4
	    add  hl, bc
	    ex   de, hl
	    ldi
	    ldi
	    ldi
	    ldi
	    ex   de, hl
	    ld   bc, $800 - 4
	    add  hl, bc
	    ex   de, hl
	    ldi
	    ldi
	    ldi
	    ldi
	    ex   de, hl
	    ld   bc, $800 - 4
	    add  hl, bc
	    ex   de, hl
	    ldi
	    ldi
	    ldi
	    ldi
	    ex   de, hl
	    ld   bc, $800 - 4
	    add  hl, bc
	    ex   de, hl
	    ldi
	    ldi
	    ldi
	    ldi
	    ex   de, hl
	    ld   bc, $800 - 4
	    add  hl, bc
	    ex   de, hl
	    ldi
	    ldi
	    ldi
	    ldi
	    ex   de, hl
	    ld   bc, $800 - 4
	    add  hl, bc
	    ex   de, hl
	    ldi
	    ldi
	    ldi
	    ldi
	    ex   de, hl
	    ld   bc, $800 - 4
	    add  hl, bc
	    ex   de, hl
	    ldi
	    ldi
	    ldi
	    ldi
	    ret
__CTD_U2:
	    ex   de, hl
__CTD_G2:
	    ldi
	    ldi
	    ex   de, hl
	    ld   bc, $800 - 2
	    add  hl, bc
	    ex   de, hl
	    ldi
	    ldi
	    ex   de, hl
	    ld   bc, $800 - 2
	    add  hl, bc
	    ex   de, hl
	    ldi
	    ldi
	    ex   de, hl
	    ld   bc, $800 - 2
	    add  hl, bc
	    ex   de, hl
	    ldi
	    ldi
	    ex   de, hl
	    ld   bc, $800 - 2
	    add  hl, bc
	    ex   de, hl
	    ldi
	    ldi
	    ex   de, hl
	    ld   bc, $800 - 2
	    add  hl, bc
	    ex   de, hl
	    ldi
	    ldi
	    ex   de, hl
	    ld   bc, $800 - 2
	    add  hl, bc
	    ex   de, hl
	    ldi
	    ldi
	    ex   de, hl
	    ld   bc, $800 - 2
	    add  hl, bc
	    ex   de, hl
	    ldi
	    ldi
	    ret
__CTD_U1:
	    ex   de, hl
__CTD_G1:
	    ldi
	    ex   de, hl
	    ld   bc, $800 - 1
	    add  hl, bc
	    ex   de, hl
	    ldi
	    ex   de, hl
	    ld   bc, $800 - 1
	    add  hl, bc
	    ex   de, hl
	    ldi
	    ex   de, hl
	    ld   bc, $800 - 1
	    add  hl, bc
	    ex   de, hl
	    ldi
	    ex   de, hl
	    ld   bc, $800 - 1
	    add  hl, bc
	    ex   de, hl
	    ldi
	    ex   de, hl
	    ld   bc, $800 - 1
	    add  hl, bc
	    ex   de, hl
	    ldi
	    ex   de, hl
	    ld   bc, $800 - 1
	    add  hl, bc
	    ex   de, hl
	    ldi
	    ex   de, hl
	    ld   bc, $800 - 1
	    add  hl, bc
	    ex   de, hl
	    ldi
	    ret

; __CB_TXS -- A = s, the tile width in bytes being 1 << s (0-2): the
	; mode's GFX_XSHIFT, or the width SetTileWidth fixed (CB_TILEW = s + 1).
; Firmware entry called: none. Registers clobbered: AF.
__CB_TXS:
	    ld   a, (CB_TILEW)
	    or   a
	    jr   z, __CB_TXS_M
	    dec  a
	    ret
__CB_TXS_M:
	    ld   a, (GFX_XSHIFT)
	    ret

	; __CB_TILE_DRAW -- HL = screen address of the tile's first byte (on
	; pixel line 0 of a character row), DE = its data -> draws the tile.
	; The row-wrap test is only needed in the last 256 bytes of a block; a
	; tile that can't wrap goes to the unrolled drawer for its width.
; Firmware entry called: none.
; Registers clobbered: AF, BC, DE, HL.
__CB_TILE_DRAW:
	    PROC
	    LOCAL __CTD_FAST, __CTD_F1, __CTD_F2
	    LOCAL __CTD_L4, __CTD_SLOW, __CTD_SL, __CTD_SI, __CTD_W

	    ld   a, h
	    and  $07
	    cp   $07
	    jr   nz, __CTD_FAST     ; only the block's last 256 bytes can wrap
	    call __CB_TXS
	    ld   c, 1
	    or   a
	    jr   z, __CTD_W
__CTD_SL:
	    sla  c
	    dec  a
	    jr   nz, __CTD_SL
__CTD_W:                    ; C = width in bytes
	    push de
	    call __CB_ROW_WRAPS
	    pop  de
	    jr   c, __CTD_SLOW
__CTD_FAST:
	    call __CB_TXS
	    or   a
	    jr   z, __CTD_F1
	    dec  a
	    jr   z, __CTD_F2
	    jp   __CTD_U4
__CTD_F2:
	    jp   __CTD_U2
__CTD_F1:
	    jp   __CTD_U1
__CTD_SLOW:                 ; C = width; per-byte, wrapping in the block
	    ld   b, 8
__CTD_SI:
	    push hl
	    push bc
__CTD_L4:
	    ld   a, (de)
	    ld   (hl), a
	    inc  de
	    call __CB_INC_X
	    dec  c
	    jr   nz, __CTD_L4
	    pop  bc
	    pop  hl
	    ld   a, h
	    add  a, 8
	    ld   h, a
	    djnz __CTD_SI
	    ret
	    ENDP

	    pop namespace
#line 27 "cpcbuild/lib/cpcbuild/tilemap.asm"

	    push namespace core

	; __CB_TILE_PTR -- HL = tile number (0-1023) -> DE = its data address.
; Firmware entry called: none.
; Registers clobbered: AF, DE, HL.
__CB_TILE_PTR:
	    PROC
	    LOCAL __CTP_DONE

	    add  hl, hl
	    add  hl, hl
	    add  hl, hl             ; * 8
	    call __CB_TXS
	    or   a
	    jr   z, __CTP_DONE
	    add  hl, hl             ; * 16 (W = 2)
	    dec  a
	    jr   z, __CTP_DONE
	    add  hl, hl             ; * 32 (W = 4)
__CTP_DONE:
	    ld   de, (CB_TILESET)
	    add  hl, de
	    ex   de, hl
	    ret
	    ENDP

	; __CB_TILEMAP -- HL = map (row-major bytes), D = cell
	; y, E = cell x, B = height, C = width (in tiles; the map is C bytes per
; row). __CB_TILEMAP_S: the same with A = the map's row length in bytes
	; (>= C), for a block out of a wider map. Draws the block of 8x8 tiles with its top-left at cell (x, y),
	; skipping cells off the screen. Per row the first address comes from
; __CB_ADDR, then each tile's is the previous plus W. Two row loops:
	; when no row of the screen can wrap in its block (__CB_NOWRAP) the fast
	; one (__CTM_F4/F2/F1, one per width, see below) draws each tile with the
	; unrolled drawer and no wrap handling; otherwise the general one wraps
	; at the block end by clearing bit 3 of H (valid because a tile starts in
	; block 0, so a carry out of the block is the only way that bit gets set)
	; and draws through __CB_TILE_DRAW, which checks the tile for a wrap.
; Firmware entry called: none.
; Registers clobbered: AF, BC, DE, HL.
__CB_TILEMAP:
	    PROC
	    LOCAL __CTM_LIM, __CTM_LIMD, __CTM_SH, __CTM_SHD, __CTM_ROW
	    LOCAL __CTM_TILE, __CTM_V1, __CTM_R1, __CTM_FROW, __CTM_RS, __CTM_RD
	    LOCAL __CTM_FM2, __CTM_FM1, __CTM_FNEXT, __CTM_TAIL

	    ld   a, c               ; map rows are as long as the block
__CB_TILEMAP_S:             ; (entry with A = map row length)
	    ld   (__CTM_ROWMAP), hl
	    ld   (__CTM_W), a
	    ld   a, d
	    cp   25
	    ret  nc
	    ld   (__CTM_Y), a
	    ld   a, 25
	    sub  d                  ; rows left on the screen
	    cp   b
	    jr   nc, __CTM_R1
	    ld   b, a
__CTM_R1:
	    ld   a, b
	    or   a
	    ret  z
	    ld   (__CTM_ROWS), a
	    call __CB_TXS
	    ld   d, a
	    ld   a, 80
__CTM_LIM:                  ; A = cells per screen row
	    dec  d
	    jp   m, __CTM_LIMD
	    srl  a
	    jr   __CTM_LIM
__CTM_LIMD:
	    ld   d, a
	    ld   a, e
	    cp   d
	    ret  nc                 ; x off the right edge
	    ld   a, d
	    sub  e                  ; cells left in the row
	    cp   c
	    jr   c, __CTM_V1
	    ld   a, c
__CTM_V1:
	    or   a
	    ret  z                  ; width 0
	    ld   (__CTM_VIS), a
	    call __CB_TXS
	    ld   d, a
    ld   a, e               ; x * W: first byte column
	    ld   e, 1               ; E = W
__CTM_SH:
	    dec  d
	    jp   m, __CTM_SHD
	    add  a, a
	    sla  e
	    jr   __CTM_SH
__CTM_SHD:
	    ld   (__CTM_XB), a
	    ld   d, 0
	    ld   (__CTM_WB), de
	    call __CB_TXS           ; run length in bytes = visible tiles * W
	    ld   b, a
	    ld   a, (__CTM_VIS)
	    inc  b
__CTM_RS:
	    dec  b
	    jr   z, __CTM_RD
	    add  a, a
	    jr   __CTM_RS
__CTM_RD:
	    ld   (__CTM_RUNB), a
    call __CB_NOWRAP        ; Carry set: no row can wrap
	    ld   a, 0
	    adc  a, 0
	    ld   (__CTM_FAST), a
__CTM_ROW:
	    ld   a, (__CTM_FAST)
	    or   a
	    jr   nz, __CTM_FROW
	    ld   a, (__CTM_Y)
	    add  a, a
	    add  a, a
	    add  a, a
	    ld   b, a
	    ld   a, (__CTM_XB)
	    ld   c, a
	    call __CB_ADDR
	    ld   a, (__CTM_VIS)
	    ld   (__CTM_CNT), a
	    ld   de, (__CTM_ROWMAP)
	    ld   (__CTM_MPTR), de
__CTM_TILE:
	    push hl
	    ld   hl, (__CTM_MPTR)
	    ld   a, (hl)
	    inc  hl
	    ld   (__CTM_MPTR), hl
	    ld   l, a
	    ld   h, 0
	    call __CB_TILE_PTR
	    pop  hl
	    push hl
	    call __CB_TILE_DRAW
	    pop  hl
	    ld   de, (__CTM_WB)
	    add  hl, de
	    res  3, h               ; wrap at the block end
	    ld   a, (__CTM_CNT)
	    dec  a
	    ld   (__CTM_CNT), a
	    jr   nz, __CTM_TILE
__CTM_TAIL:
	    ld   a, (__CTM_W)
	    ld   e, a
	    ld   d, 0
	    ld   hl, (__CTM_ROWMAP)
	    add  hl, de
	    ld   (__CTM_ROWMAP), hl
	    ld   a, (__CTM_Y)
	    inc  a
	    ld   (__CTM_Y), a
	    ld   a, (__CTM_ROWS)
	    dec  a
	    ld   (__CTM_ROWS), a
	    jr   nz, __CTM_ROW
	    ret
__CTM_FROW:                 ; fast row: the whole run of tiles
	    ld   a, (__CTM_Y)
	    add  a, a
	    add  a, a
	    add  a, a
	    ld   b, a
	    ld   a, (__CTM_XB)
	    ld   c, a
	    call __CB_ADDR
	    ex   de, hl             ; DE = address of the first tile
	    ld   a, (__CTM_RUNB)
	    add  a, e
	    ld   (__CTM_END), a     ; the low byte the run ends at
	    ld   hl, (__CTM_ROWMAP)
	    call __CB_TXS
	    or   a
	    jr   z, __CTM_FM1
	    dec  a
	    jr   z, __CTM_FM2
	    call __CTM_F4
	    jr   __CTM_FNEXT
__CTM_FM2:
	    call __CTM_F2
	    jr   __CTM_FNEXT
__CTM_FM1:
	    call __CTM_F1
__CTM_FNEXT:
	    jp   __CTM_TAIL
	    ENDP

; The fast row loops, one per width W = 4, 2, 1 (by default modes 0, 1, 2): HL = the
	; map row, DE = screen address of the first tile; draws tiles until the
	; screen address' low byte reaches __CTM_END (the run is at most 80 bytes,
; so the low byte is unambiguous). Per tile: its data address is
	; TILESET + n * 8 W (the shift by 3 + log2 W is done by rotating the
	; byte, which is shorter than shifting a pair); the drawer leaves DE at
	; the tile's address + 7 * 2 KB + W, so the next tile's address is DE - 7 * 2 KB.
; Firmware entry called: none. Registers clobbered: AF, BC, DE, HL.
__CTM_F4:
	    ld   a, (hl)
	    inc  hl
	    push hl
	    rrca
	    rrca
    rrca                    ; n * 32 as a pair: high = n >> 3, low = n << 5
	    ld   l, a
	    and  $1F
	    ld   h, a
	    ld   a, l
	    and  $E0
	    ld   l, a
	    ld   bc, (CB_TILESET)
	    add  hl, bc
	    call __CTD_G4
	    ld   a, d
	    sub  $38
	    ld   d, a
	    pop  hl
	    ld   a, (__CTM_END)
	    cp   e
	    jr   nz, __CTM_F4
	    ret
__CTM_F2:
	    ld   a, (hl)
	    inc  hl
	    push hl
	    rrca
	    rrca
	    rrca
    rrca                    ; n * 16: high = n >> 4, low = n << 4
	    ld   l, a
	    and  $0F
	    ld   h, a
	    ld   a, l
	    and  $F0
	    ld   l, a
	    ld   bc, (CB_TILESET)
	    add  hl, bc
	    call __CTD_G2
	    ld   a, d
	    sub  $38
	    ld   d, a
	    pop  hl
	    ld   a, (__CTM_END)
	    cp   e
	    jr   nz, __CTM_F2
	    ret
__CTM_F1:
	    ld   a, (hl)
	    inc  hl
	    push hl
	    rlca
	    rlca
    rlca                    ; n * 8: high = n >> 5, low = n << 3
	    ld   l, a
	    and  $07
	    ld   h, a
	    ld   a, l
	    and  $F8
	    ld   l, a
	    ld   bc, (CB_TILESET)
	    add  hl, bc
	    call __CTD_G1
	    ld   a, d
	    sub  $38
	    ld   d, a
	    pop  hl
	    ld   a, (__CTM_END)
	    cp   e
	    jr   nz, __CTM_F1
	    ret


	; Working storage of __CB_TILEMAP (never executed; in the code stream).
__CTM_ROWMAP:  defw 0
__CTM_MPTR:    defw 0
__CTM_WB:      defw 0
__CTM_W:       defb 0
__CTM_VIS:     defb 0
__CTM_CNT:     defb 0
__CTM_Y:       defb 0
__CTM_ROWS:    defb 0
__CTM_XB:      defb 0
__CTM_RUNB:    defb 0
__CTM_END:     defb 0
__CTM_FAST:    defb 0

	    pop namespace
#line 67 "cpcbuild/lib/cpcbuild/palette.bas"
#line 1 "cpcbuild/lib/cpcbuild/tilerestore.asm"
	; -----------------------------------------------------------------------
; cpcbuild library -- TileRestore: redraw the tiles under a rectangle
	;
	; Written from scratch for this project (MIT); see core.asm.
	;
	; A tile is W bytes x 8 lines, W = 1 << s with s from __CB_TXS
; (tiledraw.asm): the mode's GFX_XSHIFT (colour.asm) unless SetTileWidth
; fixed it, so by default 8x8 pixels: 1 byte in mode 2, 2 in mode 1, 4 in
; mode 0. Tile data: per tile its 8 rows top first, each row's bytes left to right,
	; so a tile is 8 * W bytes. Tile n is at CB_TILESET + n * 8 * W.
	; Tile cell (cx, cy) is byte column cx * W, pixel line cy * 8, so a tile
; starts on pixel line 0 of a character row: its 8 lines are in the 8
	; successive 2 KB blocks, i.e. the next line is H + 8, with no
	; character-row crossing. With a hardware-scroll offset a tile's row can
; still cross the end of its block (core.asm): that is checked once per
	; tile and a per-byte path (__CB_INC_X) is used then.
	;
	; None of these routines calls the firmware, and none uses IX, IY or the
	; shadow registers. Cells off the screen draw nothing.
	;
; This file: __CB_TILE_RESTORE, which uses the map routines' fast row
	; loops and __CB_TILEMAP_S (tilemap.asm).




	    push namespace core

	; __CB_TILE_RESTORE -- redraws the tiles under a screen rectangle, from
; a map laid out from screen cell (0, 0): HL = map, A = its row length
	; in bytes, E = x (byte column), D = y (pixel line), C = width in bytes
	; (>= 1), B = height in lines (>= 1). Draws every 8x8 cell the rectangle
	; touches (cells x >> s .. (x + w - 1) >> s and y >> 3 .. (y + h - 1) >> 3,
	; where the tile is 2^s bytes wide). Meant for erasing a sprite in one
; call, so the usual case is short: when every cell is on the screen and
	; no row can wrap (__CB_NOWRAP) it works out the first screen address
	; and map byte once and runs the fast row loop of the width (__CTM_F4/F2/
	; F1) row by row, stepping 80 bytes and one map row. Otherwise it goes
	; through __CB_TILEMAP_S, which clips and wraps.
; Firmware entry called: none.
; Registers clobbered: AF, BC, DE, HL.
__CB_TILE_RESTORE:
	    PROC
	    LOCAL __CTR_SH, __CTR_SHD, __CTR_CL, __CTR_CLD, __CTR_XS, __CTR_XSD
	    LOCAL __CTR_RS, __CTR_RSD, __CTR_FS, __CTR_MUL, __CTR_MULN
	    LOCAL __CTR_ROW, __CTR_CALL, __CTR_SLOW, __CTR_SM, __CTR_SMD

	    ld   (__CTR_STRIDE), a
	    ld   (__CTR_MAP), hl
	    ld   a, d               ; last cell row = (y + h - 1) >> 3
	    add  a, b
	    dec  a
	    rrca
	    rrca
	    rrca
	    and  $1F
	    ld   b, a
	    ld   a, d               ; first cell row = y >> 3
	    rrca
	    rrca
	    rrca
	    and  $1F
	    ld   d, a
	    ld   a, b
	    sub  d
	    inc  a
	    ld   b, a               ; B = cell rows
	    ld   a, e               ; C = last byte column, x + w - 1
	    add  a, c
	    dec  a
	    ld   c, a
	    call __CB_TXS
__CTR_SH:                   ; to cell columns: C = last, E = first
	    or   a
	    jr   z, __CTR_SHD
	    srl  c
	    srl  e
	    dec  a
	    jr   __CTR_SH
__CTR_SHD:
	    ld   a, c
	    sub  e
	    inc  a
	    ld   c, a               ; C = cell columns
    ; --- the short way: every cell on the screen, no row can wrap ---
	    ld   a, d
	    add  a, b
	    cp   26
	    jp   nc, __CTR_SLOW     ; below the last cell row
	    push bc
    call __CB_TXS           ; cells per screen row: 80 >> s
	    ld   b, a
	    inc  b
	    ld   a, 80
__CTR_CL:
	    dec  b
	    jr   z, __CTR_CLD
	    srl  a
	    jr   __CTR_CL
__CTR_CLD:
	    ld   b, a
	    ld   a, e
	    add  a, c
	    dec  a                  ; last cell column
	    cp   b
	    pop  bc
	    jp   nc, __CTR_SLOW     ; off the right edge
    call __CB_NOWRAP        ; Carry set: no row can wrap (A only)
	    jp   nc, __CTR_SLOW
	    ld   a, b
	    ld   (__CTR_ROWS), a
	    push de
	    push bc
	    ld   a, d               ; screen address of cell (E, D)
	    add  a, a
	    add  a, a
	    add  a, a
	    ld   b, a               ; B = pixel line
	    ld   c, e
	    call __CB_TXS
__CTR_XS:
	    or   a
	    jr   z, __CTR_XSD
	    sla  c                  ; C = byte column
	    dec  a
	    jr   __CTR_XS
__CTR_XSD:
	    call __CB_ADDR
	    ld   (__CTR_SCR), hl
	    pop  bc
	    call __CB_TXS           ; run length in bytes = columns << s
	    ld   h, a
	    ld   a, c
__CTR_RS:
	    dec  h
	    jp   m, __CTR_RSD
	    add  a, a
	    jr   __CTR_RS
__CTR_RSD:
	    ld   (__CTR_RUNB), a
	    call __CB_TXS           ; the width's fast row loop
	    ld   hl, __CTM_F1
	    or   a
	    jr   z, __CTR_FS
	    ld   hl, __CTM_F2
	    dec  a
	    jr   z, __CTR_FS
	    ld   hl, __CTM_F4
__CTR_FS:
	    ld   (__CTR_CALL + 1), hl
	    pop  de
    ld   a, (__CTR_STRIDE)  ; HL = first row * stride (row < 32: 5 steps)
	    ld   c, e               ; C = first column
	    ld   e, a
	    ld   a, d
	    add  a, a
	    add  a, a
	    add  a, a               ; row in the top 5 bits
	    ld   d, 0
	    ld   hl, 0
	    ld   b, 5
__CTR_MUL:
	    add  hl, hl
	    add  a, a
	    jr   nc, __CTR_MULN
	    add  hl, de
__CTR_MULN:
	    djnz __CTR_MUL
	    ld   b, 0
	    add  hl, bc             ; + first column
	    ld   de, (__CTR_MAP)
	    add  hl, de             ; HL = map byte of the first cell
__CTR_ROW:
	    push hl
	    ld   de, (__CTR_SCR)
	    ld   a, (__CTR_RUNB)
	    add  a, e
	    ld   (__CTM_END), a
__CTR_CALL:
	    call __CTM_F4           ; operand set above
	    pop  hl
	    ld   de, (__CTR_STRIDE) ; the next map row (high byte always 0)
	    add  hl, de
	    ex   de, hl
    ld   hl, (__CTR_SCR)    ; the next cell row: 80 on, nothing wraps
	    ld   bc, 80
	    add  hl, bc
	    ld   (__CTR_SCR), hl
	    ex   de, hl
	    ld   a, (__CTR_ROWS)
	    dec  a
	    ld   (__CTR_ROWS), a
	    jr   nz, __CTR_ROW
	    ret
	    ; --- the general way, through __CB_TILEMAP_S ---
__CTR_SLOW:
	    push bc
	    push de
	    ld   a, d               ; HL = map + first row * stride + first column
	    ld   d, 0
	    ld   hl, (__CTR_MAP)
	    add  hl, de
	    ld   de, (__CTR_STRIDE)
__CTR_SM:
	    or   a
	    jr   z, __CTR_SMD
	    add  hl, de
	    dec  a
	    jr   __CTR_SM
__CTR_SMD:
	    pop  de
	    pop  bc
	    ld   a, (__CTR_STRIDE)
	    jp   __CB_TILEMAP_S
	    ENDP

__CTR_STRIDE:  defw 0       ; low byte only; the high byte stays 0
__CTR_MAP:     defw 0
__CTR_SCR:     defw 0
__CTR_RUNB:    defb 0
__CTR_ROWS:    defb 0

	    pop namespace
#line 68 "cpcbuild/lib/cpcbuild/palette.bas"
#line 1 "src/lib/arch/cpc/runtime/framehook.asm"
	; -----------------------------------------------------------------------
	; Amstrad CPC frame hook and game mode (stdlib/framehook.bas)
	;
	; One routine (FH_ADDR, e.g. a music player) runs once per frame, at the
	; frame flyback, in every mode; FH_FRAMES counts the frames.
	;
; Normal mode: the routine runs from a firmware frame-flyback event
; (KL_NEW_FRAME_FLY &BCD7) registered at start-up: class &80
	; (asynchronous, FAR address) with ROM select &FF, so both ROMs are off
	; while it runs and it can live anywhere, program code at &0040+
	; included. The event block (FH_BLOCK) is in the private block, in the
	; central 32K as the firmware requires. Measured (Caprice32 and chips,
; 464 and 6128): it runs exactly once per frame, also while the program
	; waits inside a firmware call, entered with interrupts ON; the firmware
	; does not preserve IX around it.
	;
; Game mode (GameMode(1)): GM_VEC points isr.asm at __CPC_GM_ISR, so
	; interrupts outside firmware calls no longer run the firmware's handler
	; (its key buffer, 300 Hz clock, sound queue and ink refresh stop until
	; game mode is switched off; they still run during firmware calls).
; __CPC_GM_ISR runs the frame routine itself: on the interrupt that sees
	; VSYNC (PPI port B bit 0), or on the 6th interrupt since the last frame
	; when a DI section delayed the interrupt past the VSYNC pulse
; (interrupts are never lost: exactly 6 per frame). Frames that arrive
	; during a firmware call still reach the firmware, which runs the event;
	; either way GM_COUNT restarts, so each frame runs the routine once.
	;
	; The frame routine (FH_ADDR) runs with interrupts off and every register
	; saved; it must not call the firmware (the gate turns interrupts on),
	; PRINT, or use floats or strings.
	;
	; The frame work itself (__CPC_FH_RUN, __CPC_GM_ISR) is in framecore.asm.
; Bare-metal mode (-D CPC_BAREMETAL): there is no firmware event; isr.asm
	; counts frames and runs the hook on every frame, so this file adds
; nothing (and GameMode() has no effect: bare mode is always "game mode").


#line 1 "src/lib/arch/cpc/runtime/framecore.asm"
	; -----------------------------------------------------------------------
; Amstrad CPC frame core: counts frames and runs the frame hook
	;
	; __CPC_FH_RUN is one frame's work (count it, call FH_ADDR); __CPC_GM_ISR
	; decides which interrupt is the frame one (VSYNC on PPI port B, or the
	; 6th interrupt since the last frame when a DI section hid the pulse).
; Used by framehook.asm (firmware mode: game mode and the frame event) and
	; by isr.asm in bare-metal mode (-D CPC_BAREMETAL), where every interrupt
	; goes through __CPC_GM_ISR and frames are always counted.



	    push namespace core

; __CPC_FH_RUN -- one frame: restarts GM_COUNT, counts the frame (32-bit
	; FH_FRAMES) and calls the routine at FH_ADDR if it isn't 0. Call with
	; interrupts off.
; Registers clobbered: none (all of AF..HL, IX, IY and the alternate bank
	; are saved around the routine).
__CPC_FH_RUN:
	    PROC
	    LOCAL __FH_NOCARRY, __FH_CALL

	    push af
	    push bc
	    push de
	    push hl
	    push ix
	    push iy
	    exx
	    push bc
	    push de
	    push hl
	    exx
	    ex   af, af'
	    push af
	    ex   af, af'

	    xor  a
	    ld   (GM_COUNT), a
	    ld   hl, (FH_FRAMES)
	    inc  hl
	    ld   (FH_FRAMES), hl
	    ld   a, h
	    or   l
	    jr   nz, __FH_NOCARRY
	    ld   hl, (FH_FRAMES + 2)
	    inc  hl
	    ld   (FH_FRAMES + 2), hl
__FH_NOCARRY:
	    ld   hl, (FH_ADDR)
	    ld   a, h
	    or   l
	    call nz, __FH_CALL

	    ex   af, af'
	    pop  af
	    ex   af, af'
	    exx
	    pop  hl
	    pop  de
	    pop  bc
	    exx
	    pop  iy
	    pop  ix
	    pop  hl
	    pop  de
	    pop  bc
	    pop  af
	    ret

__FH_CALL:
	    jp   (hl)
	    ENDP

	; __CPC_GM_ISR -- the game-mode interrupt handler. isr.asm jumps here
	; for interrupts outside firmware calls while GM_VEC is set, with
	; interrupts off and the program's AF on the stack.
; Registers clobbered: none.
__CPC_GM_ISR:
	    PROC
	    LOCAL __GM_FRAME, __GM_DONE

	    push bc
	    ld   a, (GM_COUNT)
	    inc  a
	    ld   (GM_COUNT), a
    ld   b, $F5             ; PPI port B: bit 0 = VSYNC
	    in   a, (c)
	    rra
	    jr   c, __GM_FRAME
	    ld   a, (GM_COUNT)
	    cp   6
	    jr   c, __GM_DONE       ; not a frame interrupt
__GM_FRAME:
	    call __CPC_FH_RUN
__GM_DONE:
	    pop  bc
	    pop  af
	    ei
	    ret
	    ENDP

	    pop namespace
#line 39 "src/lib/arch/cpc/runtime/framehook.asm"






	    push namespace core

	; CPC_INIT_FRAMEHOOK -- registers the frame-flyback event.
; Firmware entry called: KL_NEW_FRAME_FLY (&BCD7: HL = event block,
	; B = event class, C = ROM select, DE = routine), via the gate.
; Registers clobbered: AF, BC, DE, HL (and the gate's).
CPC_INIT_FRAMEHOOK:
	    ld   hl, FH_BLOCK
	    ld   de, __CPC_FH_EVENT
    ld   bc, $80FF          ; async, far address; ROM select &FF: both off
	    call __FW_CALL
	    defw $BCD7
	    ret

	; __CPC_FH_EVENT -- the firmware event routine (entered with interrupts
	; on, both ROMs off).
; Registers clobbered: none (see __CPC_FH_RUN).
__CPC_FH_EVENT:
	    di
	    call __CPC_FH_RUN
	    ei
	    ret

	    pop namespace
#line 70 "src/lib/arch/cpc/runtime/framehook.asm"
#line 69 "cpcbuild/lib/cpcbuild/palette.bas"

#line 1 "src/lib/arch/cpc/runtime/fwsound.asm"
	; -----------------------------------------------------------------------
	; Amstrad CPC firmware sound manager, non-blocking entries
	;
	; The firmware's sound manager plays queued notes from its 300 Hz
	; interrupt handler, which is always running in compiled code (isr.asm),
	; so a note can be queued and the program carries on. BEEP (beeper.asm)
	; queues one and then waits; these routines never wait. The sound block
	; (SOUND_BLK) and the envelope buffer (SND_ENV) live in the private block
	; (central 32K), where the firmware can read them with the ROMs enabled.
; The firmware copies both (checked: tests/conformance/sound.bas), so
	; they can be reused at once.
	;
	; All firmware calls go through the IX-preserving gate (the sound manager
	; corrupts IX, which is the BASIC frame pointer).
	;
; Sound block (9 bytes): 0 channels (bit 0-2: A/B/C), rendezvous (3-5),
	; hold (6), flush (7); 1 volume envelope; 2 tone envelope; 3-4 tone
	; period; 5 noise period; 6 start volume; 7-8 duration in 1/100 s.





	    push namespace core

	; __CPC_SND_QUEUE -- queue one note without waiting.
; In: A = channel byte (bits 0-2 channels, 3-5 rendezvous, 7 flush; bit 6
	; hold is cleared, nothing would release it), HL = tone period (clamped
	; to 4095), DE = duration in 1/100 s (0 = one run of the volume
	; envelope), B = start volume (0-15), C = volume envelope (0 = none).
	; With no envelope the 464's firmware (1.0, found from its interrupt
	; handler's address, isr.asm) takes volumes 0-7 and doubles them, so v
; is passed as min(7, (v + 1) / 2) there: the AY gets the even volume
	; nearest v (15 -> 14, 1 -> 2), as close as that firmware can get.
; Out: A = 1 if queued, 0 if the channel's queue was full.
; Firmware entries called: SOUND_QUEUE (&BCAA, HL = block; Carry =
	; queued; corrupts IX, so via __FW_CALL_IX).
; Registers clobbered: AF, BC, DE, HL (main); BC', DE', HL', AF' (gate).
__CPC_SND_QUEUE:
	    and  $BF
	    ld   (SOUND_BLK + 0), a
	    ld   a, h
	    and  $F0
	    jr   z, __SND_PER_OK
	    ld   hl, 4095
__SND_PER_OK:
	    ld   (SOUND_BLK + 3), hl
	    ld   (SOUND_BLK + 7), de
	    ld   a, b
	    and  $0F
	    ld   b, a
	    ld   a, c
	    or   a
	    jr   nz, __SND_VOL_OK       ; with an envelope every model takes 0-15
	    ld   a, (__CPC_ISR_ORIG + 1)
    cp   $39                    ; firmware 1.0 (the 464): handler at &B939
	    jr   nz, __SND_VOL_OK
	    ld   a, b                   ; its volumes are 0-7 (doubled into the AY's
    inc  a                      ; 0-15): nearest = min(7, (v + 1) / 2)
	    srl  a
	    cp   8
	    jr   c, __SND_VOL_464
	    ld   a, 7
__SND_VOL_464:
	    ld   b, a
__SND_VOL_OK:
	    ld   a, b
	    ld   (SOUND_BLK + 6), a
	    ld   a, c
	    ld   (SOUND_BLK + 1), a
	    xor  a
	    ld   (SOUND_BLK + 2), a     ; no tone envelope
	    ld   (SOUND_BLK + 5), a     ; no noise
	    ld   hl, SOUND_BLK
	    call .core.__FW_CALL_IX
    defw $BCAA                  ; SOUND_QUEUE: Carry = queued
	    sbc  a, a                   ; A = 0 or $FF
	    and  1
	    ret

	; __CPC_SND_CHECK -- A = channel bit (1, 2 or 4) -> A = SOUND_CHECK
; status: bits 0-2 free queue slots (0-4), bit 3-5 rendezvous waiting
	; for A/B/C, bit 6 held, bit 7 a sound is playing.
; Firmware entries called: SOUND_CHECK (&BCAD).
; Registers clobbered: AF, BC, DE, HL (as the firmware leaves them);
	; BC', DE', HL', AF' (the gate).
__CPC_SND_CHECK:
	    call .core.__FW_CALL_IX
	    defw $BCAD
	    ret

	; __CPC_SND_BUSY -- A = channel bit -> A = 1 if that channel is playing
	; or has anything queued (fewer than 4 free slots, or status bit 7), else 0.
; Registers clobbered: as __CPC_SND_CHECK, and C.
__CPC_SND_BUSY:
	    PROC
	    LOCAL __SB_DONE
	    call __CPC_SND_CHECK
	    ld   c, a
	    and  7
	    cp   4
	    ld   a, 1
	    jr   c, __SB_DONE
	    bit  7, c
	    jr   nz, __SB_DONE
	    xor  a
__SB_DONE:
	    ret
	    ENDP

	; __CPC_SND_ENV -- A = envelope number (1-15), HL = user data of B
	; sections (3 bytes each, 1-5), copied after a section count into SND_ENV
	; and given to SOUND_AMPL_ENVELOPE.
; Firmware entries called: SOUND_AMPL_ENVELOPE (&BCBC, A = number,
	; HL = 16 byte data).
; Registers clobbered: AF, BC, DE, HL; BC', DE', HL', AF' (the gate).
__CPC_SND_ENV:
	    PROC
	    LOCAL __SE_OK
	    ex   af, af'            ; keep the envelope number
	    ld   a, b
	    or   a
	    ret  z                  ; no sections
	    cp   6
	    jr   c, __SE_OK
	    ld   a, 5
__SE_OK:
	    ld   de, SND_ENV
	    ld   (de), a
	    inc  de
	    ld   b, a
	    add  a, a
	    add  a, b               ; 3 * sections
	    ld   c, a
	    ld   b, 0
	    ldir
	    ex   af, af'
	    ld   hl, SND_ENV
	    call .core.__FW_CALL_IX
	    defw $BCBC              ; SOUND_AMPL_ENVELOPE
	    ret
	    ENDP

; __CPC_SND_RESET -- SOUND_RESET (&BCA7): empties every queue, silences
	; the chip.
; Registers clobbered: AF, BC, DE, HL; BC', DE', HL', AF' (the gate).
__CPC_SND_RESET:
	    call .core.__FW_CALL_IX
	    defw $BCA7
	    ret

	    pop namespace
#line 71 "cpcbuild/lib/cpcbuild/palette.bas"


	END
