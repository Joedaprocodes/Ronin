import { useMemo, useRef, useState } from "react";
import { FileUp, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import CountryCodeInput from "@/components/CountryCodeInput";
import { normalizePhone } from "@/lib/utils";
import { usePhonePreferences } from "@/context/PhonePreferencesContext";
import { useContactsData } from "@/context/ContactsDataContext";

/**
 * Import contacts by pasting "name, phone" lines or picking a CSV/TXT file.
 *
 * Parsing happens in the browser (no dependency). Rows are split quote-aware on
 * comma, semicolon or tab. When the first line looks like a header (it names a
 * phone or name column) those columns are used, so spreadsheet/Google Forms
 * exports import cleanly. Otherwise the most phone-like field becomes the
 * number and the rest the name. Date/time and email fields are never taken as a
 * phone, and a number must hold 7–15 digits (E.164) to be kept.
 */

const MAX_ROWS = 2000;
const FILE_ACCEPT = ".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain";

function countDigits(value) {
  return (String(value).match(/\d/g) || []).length;
}

/** Split a line on comma, semicolon or tab, honouring "quoted, fields". */
function splitFields(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === "," || char === ";" || char === "\t") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields.map((field) => field.trim());
}

/**
 * Whether a field can be a phone number: 7–15 digits and not obviously a
 * date/time (`/`, `:`) or an email (`@`).
 */
function isPhoneCandidate(field) {
  if (/[/:@]/.test(field)) return false;
  const digits = countDigits(field);
  return digits >= 7 && digits <= 15;
}

/** Index of the most phone-like field, preferring a "+"-prefixed one. */
function pickPhoneField(fields) {
  let best = -1;
  let bestScore = -1;

  fields.forEach((field, index) => {
    if (!isPhoneCandidate(field)) return;
    const score = countDigits(field) + (field.startsWith("+") ? 100 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  });

  return best;
}

/** Index of the first header cell containing any keyword, or -1. */
function findColumn(headerFields, keywords) {
  for (let i = 0; i < headerFields.length; i += 1) {
    const header = headerFields[i].toLowerCase();
    if (keywords.some((keyword) => header.includes(keyword))) return i;
  }
  return -1;
}

/**
 * Turn pasted/file text into { name, phone } rows, dropping anything that
 * doesn't contain a plausible phone number. `countryCode` is applied to any
 * number that doesn't already carry one (see normalizePhone).
 *
 * @param {string} text
 * @param {string} countryCode
 * @returns {{name: string, phone: string}[]}
 */
function parseContactLines(text, countryCode) {
  const lines = String(text ?? "")
    .replace(/^\uFEFF/, "") // drop a UTF-8 BOM from the first cell
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  // A header row lets us read the right columns from a real CSV export.
  const headerFields = splitFields(lines[0]);
  const phoneColumn = findColumn(headerFields, ["phone", "mobile", "tel", "whatsapp"]);
  const nameColumn = findColumn(headerFields, ["name"]);
  const hasHeader = phoneColumn !== -1 || nameColumn !== -1;
  const dataLines = hasHeader ? lines.slice(1) : lines;

  const rows = [];
  for (const line of dataLines) {
    const fields = splitFields(line);
    if (fields.length === 0) continue;

    const phoneIndex =
      hasHeader && phoneColumn !== -1 ? phoneColumn : pickPhoneField(fields);
    if (phoneIndex === -1 || !fields[phoneIndex]) continue;

    const phone = normalizePhone(fields[phoneIndex], countryCode);
    const digits = countDigits(phone);
    if (digits < 7 || digits > 15) continue;

    const name =
      hasHeader && nameColumn !== -1
        ? (fields[nameColumn] ?? "").trim()
        : fields
            .filter((_, index) => index !== phoneIndex)
            .join(" ")
            .trim();

    rows.push({ name, phone });
  }

  return rows;
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function ResultView({ result }) {
  const skipped = result.skipped ?? [];
  return (
    <div className="space-y-3">
      <div className="rounded-lg border p-3 text-sm">
        <p className="font-medium">
          {result.imported} {result.imported === 1 ? "contact" : "contacts"}{" "}
          imported.
        </p>
        {skipped.length > 0 ? (
          <p className="mt-0.5 text-muted-foreground">
            {skipped.length} row{skipped.length === 1 ? "" : "s"} skipped.
          </p>
        ) : null}
      </div>

      {skipped.length > 0 ? (
        <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border p-3 text-xs text-muted-foreground">
          {skipped.slice(0, 100).map((skip, index) => (
            <li key={index} className="flex items-center justify-between gap-2">
              <span className="truncate">{skip.phone || "—"}</span>
              <span className="shrink-0">{skip.reason}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default function ImportContactsSheet({ onClose }) {
  const { importContacts } = useContactsData();
  const { countryCode } = usePhonePreferences();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const fileInputRef = useRef(null);

  const rows = useMemo(
    () => parseContactLines(text, countryCode),
    [text, countryCode]
  );
  const tooMany = rows.length > MAX_ROWS;
  const canImport = rows.length > 0 && !tooMany && !importing && !result;

  async function handleFile(file) {
    if (!file) return;
    try {
      const content = await readFileAsText(file);
      setText(content);
      setFileName(file.name);
      setResult(null);
      setError("");
    } catch {
      setError("Couldn't read that file.");
    }
  }

  async function handleImport() {
    if (!canImport) return;
    setImporting(true);
    setError("");
    try {
      const res = await importContacts(rows.slice(0, MAX_ROWS));
      setResult(res);
    } catch (err) {
      setError(err?.message || "Couldn't import contacts.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent side="bottom" className="max-h-[90svh]">
        <SheetHeader>
          <SheetTitle>Import contacts</SheetTitle>
          <SheetDescription>
            Paste one contact per line as{" "}
            <span className="font-medium text-foreground">name, phone</span>{" "}
            (the name is optional), or choose a CSV/TXT file.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-3 overflow-y-auto px-4">
          {result ? (
            <ResultView result={result} />
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <Label htmlFor="import-country-code" className="flex-1">
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">Country code</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      Applied to numbers pasted without one.
                    </span>
                  </span>
                </Label>
                <CountryCodeInput
                  id="import-country-code"
                  aria-label="Country code"
                  className="w-24 shrink-0"
                  disabled={importing}
                />
              </div>

              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={8}
                placeholder={
                  "Ada Lovelace, +234 814 685 8279\n+234 802 000 0000"
                }
                disabled={importing}
              />

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importing}
                >
                  <FileUp className="size-4" />
                  Choose file
                </Button>
                {fileName ? (
                  <span className="truncate text-xs text-muted-foreground">
                    {fileName}
                  </span>
                ) : null}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept={FILE_ACCEPT}
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) handleFile(file);
                  // Reset so picking the same file again still fires onChange.
                  event.target.value = "";
                }}
              />

              {tooMany ? (
                <p role="alert" className="text-sm text-destructive">
                  Too many rows ({rows.length}). Import up to {MAX_ROWS} at a
                  time.
                </p>
              ) : rows.length > 0 ? (
                <p className="text-sm text-muted-foreground">
                  {rows.length} {rows.length === 1 ? "contact" : "contacts"} ready
                  to import.
                </p>
              ) : text.trim() ? (
                <p className="text-sm text-muted-foreground">
                  No valid numbers found yet.
                </p>
              ) : null}

              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </>
          )}
        </div>

        <SheetFooter className="flex-row gap-2">
          {result ? (
            <Button className="flex-1" onClick={onClose}>
              Done
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                className="flex-1"
                onClick={onClose}
                disabled={importing}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={handleImport}
                disabled={!canImport}
              >
                {importing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Upload className="size-4" />
                )}
                Import{rows.length > 0 && !tooMany ? ` (${rows.length})` : ""}
              </Button>
            </>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
