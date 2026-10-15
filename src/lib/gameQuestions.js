/**
 * RoninClash question spreadsheet parsing (Kahoot-style layout).
 *
 * Expected columns (case-insensitive, flexible headers):
 *   # | Question | Answer 1 | Answer 2 | Answer 3 | Answer 4 |
 *   Time limit (sec) | Correct answer(s)
 *
 * Correct answer(s) accepts letters (A-D), numbers (1-4) or the option text,
 * separated by commas, semicolons, pipes or spaces for multi-answer rows.
 */

import * as XLSX from "xlsx";

/** Maximum question text length. */
export const MAX_QUESTION_LENGTH = 500;
/** Maximum option text length. */
export const MAX_OPTION_LENGTH = 200;
/** Maximum questions per game (matches the backend's MAX_QUESTIONS). */
export const MAX_QUESTIONS = 200;

/** A parsed question row (internal shape). */
export const QUESTION_KEYS = ["question", "options", "correct", "timeLimit", "multi"];

/**
 * Normalizes a spreadsheet row (object keyed by header) into a flat object
 * with standardized property names.
 */
export function normalizeRow(row) {
  const keys = Object.keys(row);
  const find = (aliases) => {
    const lk = keys.find((k) => aliases.includes(k.trim().toLowerCase()));
    return lk ? row[lk] : undefined;
  };

  return {
    no: find(["#", "no", "no.", "number"]),
    question: find(["question"]),
    a1: find(["answer 1", "answer1", "a1", "option 1", "option1"]),
    a2: find(["answer 2", "answer2", "a2", "option 2", "option2"]),
    a3: find(["answer 3", "answer3", "a3", "option 3", "option3"]),
    a4: find(["answer 4", "answer4", "a4", "option 4", "option4"]),
    timeLimit: find(["time limit (sec)", "time limit", "timelimit", "limit", "seconds"]),
    correct: find(["correct answer(s)", "correct", "correct answers", "answer"]),
  };
}

/**
 * Checks if a normalized row is empty/blank (no question and no options).
 */
export function isBlankRow(norm) {
  const { question, a1, a2, a3, a4 } = norm;
  return (
    (question === undefined || question === null || String(question).trim() === "") &&
    (a1 === undefined || a1 === null || String(a1).trim() === "") &&
    (a2 === undefined || a2 === null || String(a2).trim() === "") &&
    (a3 === undefined || a3 === null || String(a3).trim() === "") &&
    (a4 === undefined || a4 === null || String(a4).trim() === "")
  );
}

/**
 * Parses the "Correct answer(s)" cell into an array of 0-based option indexes.
 *
 * Mirrors the backend's scoring.mjs: the whole cell is matched against the
 * option texts first so multi-word options ("New York") resolve; only then is
 * the cell tokenized on commas/semicolons/pipes/"and", falling back to
 * whitespace ("A B", "1 3"). Accepts letters (A-D), numbers (1-4) or option
 * text. Tokens that don't resolve to a valid option are dropped.
 */
export function parseCorrectIndexes(correctCell, options = []) {
  if (correctCell === undefined || correctCell === null || String(correctCell).trim() === "") {
    return [];
  }
  const text = String(correctCell).trim();
  const opts = (options ?? []).map((o) => String(o ?? "").trim());

  const matchOption = (value) => {
    const lower = value.trim().toLowerCase();
    if (!lower) return -1;
    return opts.findIndex((o) => o.toLowerCase() === lower);
  };
  const resolve = (token) => {
    const upper = token.toUpperCase();
    if (/^[A-D]$/.test(upper)) return upper.charCodeAt(0) - 65;
    if (/^[1-4]$/.test(token)) return Number(token) - 1;
    return matchOption(token);
  };

  const out = new Set();

  // 1) The whole cell is one option ("New York", "yes/no", ...).
  const whole = matchOption(text);
  if (whole !== -1) out.add(whole);

  if (!out.size) {
    // 2) Explicit separators: every part must resolve whole. If any part
    //    fails, split the unresolved parts on whitespace as a fallback.
    const parts = text
      .split(/[,;/|]|\band\b/i)
      .map((p) => p.trim())
      .filter(Boolean);
    const resolved = parts.map(resolve);
    if (resolved.every((r) => r !== -1)) {
      for (const r of resolved) out.add(r);
    } else {
      for (const [i, part] of parts.entries()) {
        if (resolved[i] !== -1) {
          out.add(resolved[i]);
          continue;
        }
        for (const token of part.split(/\s+/)) {
          const idx = resolve(token);
          if (idx !== -1) out.add(idx);
        }
      }
    }
  }

  return [...out].filter((i) => i >= 0 && i < opts.length).sort((a, b) => a - b);
}

/**
 * Validates and normalizes a single normalized row into a question object.
 * Returns { question, errors } where errors is an array of strings (empty = ok).
 */
export function validateRow(norm, rowIndex) {
  const errors = [];
  const { question, a1, a2, a3, a4, timeLimit, correct } = norm;

  // Question text
  if (!question || String(question).trim() === "") {
    errors.push("Row " + rowIndex + ": question text is required");
  } else if (String(question).length > MAX_QUESTION_LENGTH) {
    errors.push("Row " + rowIndex + ": question exceeds " + MAX_QUESTION_LENGTH + " characters");
  }

  // Options must be contiguous from Answer 1 — the backend reads them that
  // way, so a gap (Answer 2 blank but Answer 3 filled) would silently shift
  // every later option. Flag it instead of guessing.
  const cells = [a1, a2, a3, a4].map((o) =>
    o === undefined || o === null ? "" : String(o).trim()
  );
  const gapIndex = cells.findIndex(
    (c, i) => c === "" && cells.slice(i + 1).some((x) => x !== "")
  );
  if (gapIndex !== -1) {
    errors.push(
      "Row " +
        rowIndex +
        ": Answer " +
        (gapIndex + 1) +
        " is blank — answers must be filled in order from Answer 1"
    );
  }
  const rawOptions = gapIndex === -1 ? cells.filter(Boolean) : cells.slice(0, gapIndex);
  if (rawOptions.length < 2) {
    errors.push("Row " + rowIndex + ": at least 2 answer options are required");
  }
  for (const opt of rawOptions) {
    if (opt.length > MAX_OPTION_LENGTH) {
      errors.push("Row " + rowIndex + ": option exceeds " + MAX_OPTION_LENGTH + " characters");
    }
  }

  // Time limit (optional, defaults to 20)
  let limit = 20;
  if (timeLimit !== undefined && timeLimit !== null && String(timeLimit).trim() !== "") {
    const parsed = Number(timeLimit);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 3600) {
      errors.push("Row " + rowIndex + ": time limit must be a number between 1 and 3600");
    } else {
      limit = Math.round(parsed);
    }
  }

  // Correct answer(s)
  const correctIndexes = parseCorrectIndexes(correct, rawOptions);
  if (correctIndexes.length === 0) {
    errors.push("Row " + rowIndex + ": correct answer(s) must match at least one option");
  }
  if (correctIndexes.length > 1 && rawOptions.length < correctIndexes.length) {
    errors.push("Row " + rowIndex + ": too many correct answers for the given options");
  }

  if (errors.length > 0) {
    return { question: null, errors };
  }

  return {
    question: {
      question: String(question).trim(),
      options: rawOptions,
      correct: correctIndexes,
      timeLimit: limit,
      multi: correctIndexes.length > 1,
    },
    errors: [],
  };
}

/**
 * Parses an XLSX file (ArrayBuffer or Uint8Array) and returns the validation
 * result with an array of questions and row-level errors.
 *
 * @param {ArrayBuffer|Uint8Array} buffer
 * @returns {Promise<{ questions: Question[], rowErrors: {row: number, errors: string[]}[] }>}
 */
export async function parseQuestionsFile(buffer) {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { questions: [], rowErrors: [{ row: 0, errors: ["Spreadsheet has no sheets"] }] };
  }
  const worksheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
  if (!rows.length) {
    return { questions: [], rowErrors: [{ row: 0, errors: ["Spreadsheet is empty"] }] };
  }

  // Header row detection: find the first row that has a "question" column
  let headerRowIndex = -1;
  let headerMap = {};
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const lower = row.map((c) => String(c).trim().toLowerCase());
    if (lower.includes("question")) {
      headerRowIndex = i;
      headerMap = {};
      lower.forEach((h, idx) => { if (h) headerMap[h] = idx; });
      break;
    }
  }
  if (headerRowIndex === -1) {
    return { questions: [], rowErrors: [{ row: 0, errors: ["Could not find a header row with a 'Question' column"] }] };
  }

  // Build header aliases for flexible matching
  const findHeaderIdx = (aliases) => {
    for (const a of aliases) {
      if (headerMap[a] !== undefined) return headerMap[a];
    }
    return -1;
  };

  const colNo = findHeaderIdx(["#", "no", "no.", "number"]);
  const colQuestion = findHeaderIdx(["question"]);
  const colA1 = findHeaderIdx(["answer 1", "answer1", "a1", "option 1", "option1"]);
  const colA2 = findHeaderIdx(["answer 2", "answer2", "a2", "option 2", "option2"]);
  const colA3 = findHeaderIdx(["answer 3", "answer3", "a3", "option 3", "option3"]);
  const colA4 = findHeaderIdx(["answer 4", "answer4", "a4", "option 4", "option4"]);
  const colTimeLimit = findHeaderIdx(["time limit (sec)", "time limit", "timelimit", "limit", "seconds"]);
  const colCorrect = findHeaderIdx(["correct answer(s)", "correct", "correct answers", "answer"]);

  const questions = [];
  const rowErrors = [];

  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;
    if (row.every((c) => c === undefined || c === null || String(c).trim() === "")) continue;

    const get = (idx) => (idx >= 0 ? row[idx] : undefined);

    const norm = {
      no: get(colNo),
      question: get(colQuestion),
      a1: get(colA1),
      a2: get(colA2),
      a3: get(colA3),
      a4: get(colA4),
      timeLimit: get(colTimeLimit),
      correct: get(colCorrect),
    };

    if (isBlankRow(norm)) continue;

    const { question, errors } = validateRow(norm, r + 1); // 1-based spreadsheet row
    if (errors.length) {
      rowErrors.push({ row: r + 1, errors });
    } else {
      questions.push(question);
    }
  }

  if (questions.length > MAX_QUESTIONS) {
    rowErrors.push({
      row: 0,
      errors: [`At most ${MAX_QUESTIONS} questions are allowed (found ${questions.length})`],
    });
  }

  return { questions, rowErrors };
}