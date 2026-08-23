// Splits pasted SQL into individual statements so each one can be
// parsed on its own — one unreadable statement becomes one skip-list
// line instead of failing the whole import. Splitting means finding
// the semicolons that really end statements, which requires walking
// the text and ignoring semicolons that sit inside:
//   'strings' (with '' escapes), E'strings' (with \ escapes),
//   "quoted identifiers", $tag$ dollar-quoted bodies $tag$,
//   -- line comments, and /* block comments */ (which Postgres nests).
// Two pasted-dump extras: a line starting with \ is a psql command
// (its own "statement", parse will reject it with a plain reason),
// and after COPY ... FROM stdin the raw data lines up to \. are
// swallowed so row data never gets mistaken for statements.

export interface SqlStatement {
  text: string;
  /** 1-based line where the statement's first character sits. */
  line: number;
}

export function splitSqlStatements(sql: string): SqlStatement[] {
  const statements: SqlStatement[] = [];
  let contentStart = -1; // index of the statement's first real character
  let startLine = 1; // line that character sits on
  let line = 1;
  let i = 0;

  // Call before consuming any character that belongs to the statement
  // (not comments or whitespace), so the emitted text and its line
  // number both begin at real content — leading comments fall away.
  function markContent(): void {
    if (contentStart === -1) {
      contentStart = i;
      startLine = line;
    }
  }

  function currentText(end: number): string {
    return contentStart === -1 ? "" : sql.slice(contentStart, end).trim();
  }

  function emit(end: number): void {
    const text = currentText(end);
    if (text !== "") statements.push({ text, line: startLine });
    contentStart = -1;
  }

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (ch === "\n") {
      line++;
      i++;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\r") {
      i++;
      continue;
    }

    if (ch === "-" && next === "-") {
      const eol = sql.indexOf("\n", i);
      i = eol === -1 ? sql.length : eol;
      continue;
    }

    if (ch === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === "\n") line++;
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      continue;
    }

    // psql meta-command: only when it opens a statement. Runs to end
    // of line and carries no semicolon.
    if (ch === "\\" && contentStart === -1) {
      markContent();
      const eol = sql.indexOf("\n", i);
      const end = eol === -1 ? sql.length : eol;
      emit(end);
      i = end;
      continue;
    }

    if (ch === "'" || ((ch === "e" || ch === "E") && next === "'")) {
      markContent();
      const backslashEscapes = ch !== "'";
      i += backslashEscapes ? 2 : 1;
      while (i < sql.length) {
        if (sql[i] === "\n") line++;
        if (backslashEscapes && sql[i] === "\\") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2; // '' is an escaped quote, not the end
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    if (ch === '"') {
      markContent();
      i++;
      while (i < sql.length) {
        if (sql[i] === "\n") line++;
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    if (ch === "$") {
      // Dollar quote: $tag$ ... $tag$ where tag is a (possibly empty)
      // identifier. A lone $ that doesn't open one is just a character.
      const open = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i, i + 70));
      if (open) {
        markContent();
        const tag = open[0];
        const close = sql.indexOf(tag, i + tag.length);
        const end = close === -1 ? sql.length : close + tag.length;
        for (let j = i; j < end; j++) if (sql[j] === "\n") line++;
        i = end;
        continue;
      }
    }

    if (ch === ";") {
      const wasCopy = /^copy\b[\s\S]*\bfrom\s+stdin/i.test(currentText(i));
      emit(i);
      i++;
      if (wasCopy) {
        // Swallow raw COPY data rows until the \. terminator line.
        const terminator = /(^|\n)\\\.(\r?\n|$)/.exec(sql.slice(i));
        const end = terminator
          ? i + terminator.index + terminator[0].length
          : sql.length;
        for (let j = i; j < end; j++) if (sql[j] === "\n") line++;
        i = end;
      }
      continue;
    }

    markContent();
    i++;
  }

  emit(sql.length); // last statement may have no trailing semicolon
  return statements;
}
