/**
 * The keywords of Boriel BASIC (the fork's `src/zxbc/keywords.py`, commit e33cf0cdd0396ad6bfcceed38dd3ca688c667b9e,
 * the `KEYWORDS` dictionary: keywords and data types, upper case, `$` forms included). Copied as data; the
 * fork is read, never imported. `cpcbas migrate` renames (W702) the words of CPC BASIC's `RESERVED_WORDS`
 * that are not in this list, because a Boriel program could use those as names.
 */
export const BORIEL_KEYWORD_LIST: readonly string[] = [
  'ABS', 'ACS', 'AND', 'AS', 'ASM', 'ASN', 'AT', 'ATN', 'BAND', 'BEEP', 'BIN', 'BNOT', 'BOLD', 'BOR', 'BORDER',
  'BRIGHT', 'BXOR', 'BYREF', 'BYTE', 'BYVAL', 'CAST', 'CHR', 'CHR$', 'CIRCLE', 'CLS', 'CODE', 'CONST', 'CONTINUE',
  'COS', 'DATA', 'DECLARE', 'DIM', 'DO', 'DRAW', 'ELSE', 'ELSEIF', 'END', 'ENDIF', 'ERROR', 'EXIT', 'EXP',
  'FASTCALL', 'FIXED', 'FLASH', 'FLOAT', 'FOR', 'FUNCTION', 'GO', 'GOSUB', 'GOTO', 'IF', 'IN', 'INK', 'INKEY',
  'INKEY$', 'INT', 'INTEGER', 'INVERSE', 'ITALIC', 'LBOUND', 'LEN', 'LET', 'LN', 'LOAD', 'LONG', 'LOOP', 'MOD',
  'NEXT', 'NOT', 'ON', 'OR', 'OUT', 'OVER', 'PAPER', 'PAUSE', 'PEEK', 'PI', 'PLOT', 'POKE', 'PRINT', 'RANDOMIZE',
  'READ', 'RESTORE', 'RETURN', 'RND', 'SAVE', 'SGN', 'SHL', 'SHR', 'SIN', 'SIZEOF', 'SQR', 'STDCALL', 'STEP', 'STOP',
  'STR', 'STR$', 'STRING', 'SUB', 'TAB', 'TAN', 'THEN', 'TO', 'UBOUND', 'UBYTE', 'UINTEGER', 'ULONG', 'UNTIL', 'USR',
  'VAL', 'VERIFY', 'WEND', 'WHILE', 'XOR',
];

export const BORIEL_KEYWORDS: ReadonlySet<string> = new Set(BORIEL_KEYWORD_LIST);
