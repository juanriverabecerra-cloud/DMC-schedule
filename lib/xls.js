// The .xls reader lives with the app (public/core/xls.js) so a phone can read a re-saved hours file
// too; the server reads ACGME's reports with the same code.
export { readXls } from "../public/core/xls.js";
