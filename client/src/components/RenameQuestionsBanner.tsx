import type { ReactNode } from "react";
import type { RenameQuestion } from "engine";

// The "was this a rename?" banner (decisions.md #5, #19): one shared
// shell for the diff view, the merge view (which labels questions per
// side) and the compare view. Callers phrase each question; answers
// are ephemeral — they re-shape the view that owns them and die with
// it.

export interface RenameQuestionItem {
  key: string;
  text: ReactNode;
  answer: (rename: boolean) => void;
}

/** The standard phrasing of one question; the merge view prefixes it
 *  with the side it came from. */
export function describeRenameQuestion(question: RenameQuestion): ReactNode {
  return question.kind === "table" ? (
    <>
      Was table <code>{question.from}</code> renamed to <code>{question.to}</code>?
    </>
  ) : (
    <>
      In <code>{question.table}</code>: was <code>{question.from}</code> renamed
      to <code>{question.to}</code>?
    </>
  );
}

export function RenameQuestionsBanner({
  title,
  hint,
  items,
}: {
  title: string;
  hint: string;
  items: RenameQuestionItem[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="diff-questions">
      <h3>{title}</h3>
      <p className="diff-questions-hint">{hint}</p>
      <ul>
        {items.map((item) => (
          <li key={item.key}>
            <span className="diff-question-text">{item.text}</span>
            <button type="button" className="btn" onClick={() => item.answer(true)}>
              Yes, renamed
            </button>
            <button type="button" className="btn" onClick={() => item.answer(false)}>
              No
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
