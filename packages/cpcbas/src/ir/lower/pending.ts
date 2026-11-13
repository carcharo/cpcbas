/**
 * The dispatch points of the features later tasks lower. Each function reports E002
 * "not implemented yet" at the construct; the task that owns the feature replaces the
 * body (or the whole function) here, so the rest of the lowering does not change:
 * Procedures and calls are in `proc.ts`; DATA, READ and RESTORE are in `data.ts`.
 */
export { lowerCallExpr, lowerProcedures, lowerReturnValue, lowerSubCall } from './proc.js';

export { lowerDataTable, lowerRead, lowerRestore } from './data.js';
