/**
 * RFC 4180 CSV writing, for exporting rows as a file.
 *
 * Kept dependency-free (and React-free) so the escaping rules can be exercised
 * directly: a spreadsheet is unforgiving about one unescaped comma or quote.
 */

/**
 * A field, quoted only when it needs to be. Non-strings are stringified;
 * `null`/`undefined` become "".
 *
 * Quoting is required when the text contains a comma, a quote or a line break —
 * and when it starts or ends with whitespace, which a reader would trim.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function csvField(value) {
  const text = value == null ? "" : String(value);
  const needsQuotes = /[",\r\n]/.test(text) || text !== text.trim();
  return needsQuotes ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Rows (usually header first) as an RFC 4180 CSV string with CRLF endings and
 * no trailing newline. {@link downloadCsv} adds the BOM when writing a file.
 *
 * @param {unknown[][]} rows
 * @returns {string}
 */
export function toCsv(rows) {
  return (rows ?? [])
    .map((row) => (row ?? []).map(csvField).join(","))
    .join("\r\n");
}

/**
 * Save `text` as a CSV download.
 *
 * The leading BOM is deliberate: without it Excel on Windows reads the file in
 * the system codepage and mangles accented names (Obi, Ada → Obi, Ada?).
 *
 * @param {string} filename
 * @param {string} text
 * @returns {void}
 */
export function downloadCsv(filename, text) {
  const blob = new Blob([`\uFEFF${text}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // The click starts an async download; keep the URL alive until then.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
