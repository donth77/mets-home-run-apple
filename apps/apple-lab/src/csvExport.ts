export type CsvValue = string | number | boolean | null | undefined;

export interface CsvColumn<Row> {
  header: string;
  value: (row: Row) => CsvValue;
}

function protectSpreadsheetFormula(value: string) {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function encodeCsvField(value: CsvValue) {
  const text = protectSpreadsheetFormula(value == null ? "" : String(value));
  return `"${text.replaceAll('"', '""')}"`;
}

export function createCsv<Row>(rows: readonly Row[], columns: readonly CsvColumn<Row>[]) {
  const header = columns.map((column) => encodeCsvField(column.header)).join(",");
  const body = rows.map((row) => columns.map((column) => encodeCsvField(column.value(row))).join(","));
  return [header, ...body].join("\r\n");
}

export function downloadCsv(fileName: string, csv: string) {
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName.endsWith(".csv") ? fileName : `${fileName}.csv`;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}
