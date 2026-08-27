// The runtime boundary passed to compiled JavaScript.
// Bundles the shared statement executor with the expression helper functions,
// so compiled code calls runtime.executeProgram(...) and runtime.eq(...) etc.

import { executeProgram } from "./execute";
import { sql } from "./sql";
import { registerTable } from "./data-sources";

export const domsql = {
  executeProgram,
  registerTable,
  ...sql,
};

export type DomSql = typeof domsql;
