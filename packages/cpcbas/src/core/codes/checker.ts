/**
 * Codes 230-299 (types, conversions, constants, procedures, bare-mode refusals) and
 * 320-349 (unreachable, unused results). Owner: task L2-CHECK.
 */
import type { CodeTable } from '../diagnostics.js';

export const CHECKER_CODES = {
  E230: { severity: 'error', title: 'Type mismatch', hint: 'A STRING and a number cannot be mixed; convert with STR$, VAL, ASC or CHR$.' },
  E231: { severity: 'error', title: 'Wrong number of arguments', hint: 'Give the number of arguments the declaration lists; parameters with a default may be left out.' },
  E232: { severity: 'error', title: 'Cannot assign to this', hint: 'Assign to a variable or an array element.' },
  E233: { severity: 'error', title: 'Array bound must be a non-negative integer constant', hint: 'Write a whole number or a CONST that is zero or more; arrays have bounds 0 to n.' },
  E234: { severity: 'error', title: 'Integer literal out of range', hint: 'A % literal must lie between -32768 and 32767; drop the % or use a wider type.' },
  E235: { severity: 'error', title: 'Division by zero', hint: 'The divisor is the constant zero, so the division can never succeed; change the divisor.' },
  E236: { severity: 'error', title: 'BYREF argument must be a variable of the same type', hint: 'Pass a variable or array element of exactly the parameter type, or declare the parameter BYVAL.' },
  E237: { severity: 'error', title: 'EXIT or CONTINUE outside a matching block', hint: 'EXIT FOR, WHILE and DO need an enclosing loop of that kind; EXIT SUB and EXIT FUNCTION must be inside that procedure.' },
  E238: { severity: 'error', title: 'RETURN with a value outside a FUNCTION', hint: 'Only a FUNCTION returns a value; write RETURN alone (it ends a GOSUB, in a SUB too; EXIT SUB leaves the SUB).' },
  E239: { severity: 'error', title: 'SUB and FUNCTION used the wrong way', hint: 'A SUB is called as a statement; a FUNCTION is used in an expression.' },
  E240: { severity: 'error', title: 'Wrong number of array indexes', hint: 'Give one index per dimension of the DIM.' },
  E243: { severity: 'error', title: 'A constant expression is required', hint: 'Use numbers, strings, CONSTs and operators only; variables and function calls are not known at compile time.' },
  E246: { severity: 'error', title: 'Too many initial values', hint: 'List no more values than the array has elements.' },
  E247: { severity: 'error', title: 'An array with AT cannot have an initial list', hint: 'AT puts the array over memory that already exists; use #pragma hidata to place initialised data, or assign the elements.' },
  E248: { severity: 'error', title: 'Array index out of range', hint: 'A constant index must lie between 0 and the dimension\'s upper bound; arrays are checked at compile time only.' },
  E249: { severity: 'error', title: 'A #pragma hidata array does not fit in memory', hint: 'Lower the #pragma hidata address, or make the arrays placed after it smaller.' },
  E251: { severity: 'error', title: 'RETURN alone in a procedure without a GOSUB', hint: 'A RETURN alone ends a GOSUB. To leave a SUB or FUNCTION write EXIT SUB or EXIT FUNCTION (a FUNCTION may also RETURN a value).' },
  E262: { severity: 'error', title: 'This stream cannot be used here', hint: 'Text statements take the streams #0-#7. PRINT and WRITE also take #8 (the printer) and #9 (the output file); INPUT and LINE INPUT also take #9 (the input file).' },
  E263: { severity: 'error', title: 'SYMBOL AFTER needs a constant from 0 to 256', hint: 'Write the number of the first character you will redefine as a whole number or a CONST.' },
  E264: { severity: 'error', title: 'SYMBOL AFTER given two different values', hint: 'The table of redefinable characters is set up once; use one value for the whole program.' },
  E265: { severity: 'error', title: 'PRINT USING needs something to print', hint: 'Write at least one value after the format: PRINT USING "###"; 12.' },
  E266: { severity: 'error', title: 'LINE INPUT reads into a string variable', hint: 'Use INPUT for numbers, or read the line into a variable whose name ends in $ and convert it with VAL.' },
  E267: { severity: 'error', title: 'An INPUT prompt is at most 255 characters', hint: 'Shorten the prompt text, or PRINT the first part before the INPUT.' },
  E270: { severity: 'error', title: 'Needs the firmware and is not available in bare mode', hint: 'Remove it, or build in firmware mode.' },
  E271: { severity: 'error', title: 'Firmware CALL in bare mode', hint: 'Use the runtime\'s bare-mode routine for this, or write the access in ASM.' },
  E272: { severity: 'error', title: 'RSX command in bare mode', hint: 'Bar commands need the firmware and its ROMs; build in firmware mode.' },
  E273: { severity: 'error', title: 'ENV or ENT sections have the wrong shape', hint: 'After the number come up to five sections: three values each (steps, size, pause), or `=` and two values for a hardware section (ENV: register, period; ENT: period, pause).' },
  E274: { severity: 'error', title: 'A sound argument does not fit in 16 bits', hint: 'Locomotive raises Overflow for it: SOUND, ENV, ENT and RELEASE take whole numbers from -32768 to 65535 (a SOUND duration up to 32767).' },
  E275: { severity: 'error', title: 'BEEP argument out of range', hint: 'The duration is 0 to 10 seconds and the pitch -60 to 127 semitones from middle C.' },
  E279: { severity: 'error', title: 'SAVE writes a binary file: it needs B, an address and a length', hint: 'Write SAVE "name", B, address, length [, entry]. A compiled program has no BASIC text to save, so SAVE "name" and the types A and P are refused.' },
  E280: { severity: 'error', title: 'A LOAD or SAVE address or length does not fit in 16 bits', hint: 'Addresses are 0 to 65535 (or -32768 to -1, the same addresses as a signed number) and a length is 0 to 65535.' },
  E281: { severity: 'error', title: 'The file name is empty', hint: 'AMSDOS answers "Bad command" for an empty name: give a name of up to 8 characters, a dot and 3 more.' },
  // 282: L4-FILES, unused
  W242: { severity: 'warning', title: 'Real number converted to an integer', hint: 'AND, OR, XOR, NOT, \\, MOD and shifts work on integers; write CINT(x) or INT(x) to choose the conversion.' },
  W320: { severity: 'warning', title: 'Unreachable statement', hint: 'Nothing can run this statement: remove it, or give it a line number or label that a jump targets.' },
} as const satisfies CodeTable;
