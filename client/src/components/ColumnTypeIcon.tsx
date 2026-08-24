import type { ReactNode } from "react";
import type { ColumnType } from "engine";

// One glyph per column type, drawn here rather than pulled from an
// icon set so the vocabulary stays ours: the type list is our own
// invention (engine/src/types.ts), so no off-the-shelf set has a
// "whole number (large)".
//
// Two conventions hold the seventeen together:
//   • Every base glyph lives inside the square from (2.5,2.5) to
//     (17.5,17.5) of a 24-unit canvas, so they all read at one weight.
//   • Variants of one idea share the base glyph and differ by a badge
//     in the bottom-right corner. The base shrinks to make room, its
//     stroke width scaled back up to stay a hairline like the rest.
// So the three integer widths are one hash with one, two or three
// dots; "with time zone" is the plain glyph plus a globe.

/** Hairline weight, tuned so a 20px glyph still reads on a dark sheet. */
const STROKE = 1.8;
const BASE_SCALE = 0.68;
/** Keeps the shrunk glyph pinned to the box's top-left corner. */
const BASE_SHIFT = 2.5 * (1 - BASE_SCALE);
const BASE_STROKE = STROKE / BASE_SCALE;

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      className="type-icon"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

function Badged({ base, badge }: { base: ReactNode; badge: ReactNode }) {
  return (
    <Glyph>
      <g
        transform={`translate(${BASE_SHIFT} ${BASE_SHIFT}) scale(${BASE_SCALE})`}
        strokeWidth={BASE_STROKE}
      >
        {base}
      </g>
      {badge}
    </Glyph>
  );
}

/* --- base glyphs ------------------------------------------------------ */

const HASH = (
  <>
    <path d="M8.4 3 6.6 17" />
    <path d="M14.6 3 12.8 17" />
    <path d="M3.2 7.6H16.6" />
    <path d="M3.6 12.4H17" />
  </>
);

/** Rising steps with an arrow off the top — a counter that climbs. */
const STAIRS = (
  <>
    <path d="M3 17h4.1v-4.2h4.1V8.6h4.1V4.2" />
    <path d="m12.8 6.7 2.5-2.5 2.5 2.5" />
  </>
);

const CALENDAR = (
  <>
    <rect x="3" y="5" width="14" height="12.4" rx="2.4" />
    <path d="M3 9.3h14" />
    <path d="M7 3v3.5" />
    <path d="M13 3v3.5" />
  </>
);

const CLOCK = (
  <>
    <circle cx="10" cy="10.4" r="7" />
    <path d="M10 6.1v4.5l3.1 1.8" />
  </>
);

/* --- corner badges ---------------------------------------------------- */

/** Width of an integer type, read as "how many": one dot to three. */
function dots(count: number) {
  return (
    <g fill="currentColor" stroke="none">
      {Array.from({ length: count }, (_, i) => (
        <circle key={i} cx={15.9 + (i - (count - 1) / 2) * 3.2} cy={15.9} r={1.4} />
      ))}
    </g>
  );
}

const CLOCK_BADGE = (
  <g strokeWidth={1.5}>
    <circle cx="15.9" cy="15.9" r="3.7" />
    <path d="M15.9 13.7v2.4l1.8 1.1" />
  </g>
);

/** "with time zone": the same instant, read differently around the world. */
const GLOBE_BADGE = (
  <g strokeWidth={1.35}>
    <circle cx="15.9" cy="15.9" r="3.7" />
    <path d="M12.2 15.9h7.4" />
    <path d="M15.9 12.2c1.7 1.7 1.7 5.7 0 7.4-1.7-1.7-1.7-5.7 0-7.4Z" />
  </g>
);

/* --- the map ---------------------------------------------------------- */

const ICONS: Record<ColumnType, ReactNode> = {
  "whole-number-small": <Badged base={HASH} badge={dots(1)} />,
  "whole-number": <Badged base={HASH} badge={dots(2)} />,
  "whole-number-large": <Badged base={HASH} badge={dots(3)} />,
  "auto-number-small": <Badged base={STAIRS} badge={dots(1)} />,
  "auto-number": <Badged base={STAIRS} badge={dots(2)} />,
  "auto-number-large": <Badged base={STAIRS} badge={dots(3)} />,
  // Two digits either side of a decimal point.
  "decimal-number": (
    <Glyph>
      <ellipse cx="6" cy="10" rx="3.1" ry="5.6" />
      <ellipse cx="15" cy="10" rx="3.1" ry="5.6" />
      <circle cx="10.5" cy="14.8" r="1.5" fill="currentColor" stroke="none" />
    </Glyph>
  ),
  // The "approximately equal" double tilde.
  "floating-point": (
    <Glyph>
      <path d="M3.5 8.5c2.3-2.2 4.7 2.2 7 0s4.7 2.2 7 0" />
      <path d="M3.5 13.5c2.3-2.2 4.7 2.2 7 0s4.7 2.2 7 0" />
    </Glyph>
  ),
  text: (
    <Glyph>
      <path d="M3.6 4.8h12.8" />
      <path d="M10 4.8v11.8" />
      <path d="M7 16.6h6" />
    </Glyph>
  ),
  "true-false": (
    <Glyph>
      <rect x="2.6" y="5.9" width="14.8" height="8.6" rx="4.3" />
      <circle cx="13.1" cy="10.2" r="2.3" fill="currentColor" stroke="none" />
    </Glyph>
  ),
  date: <Glyph>{CALENDAR}</Glyph>,
  time: <Glyph>{CLOCK}</Glyph>,
  "time-tz": <Badged base={CLOCK} badge={GLOBE_BADGE} />,
  "date-time": <Badged base={CALENDAR} badge={CLOCK_BADGE} />,
  "date-time-tz": <Badged base={CALENDAR} badge={GLOBE_BADGE} />,
  // Fingerprint: the one value nothing else in the table can have.
  "unique-id": (
    <Glyph>
      <path d="M3.5 13a6.5 6.5 0 0 1 13 0" />
      <path d="M6.3 13a3.7 3.7 0 0 1 7.4 0" />
      <path d="M9.1 13a0.9 0.9 0 0 1 1.8 0" />
      <path d="M3.5 13v3.4" />
      <path d="M16.5 13v3.4" />
    </Glyph>
  ),
  // A sealed box of bytes — the one type we never look inside.
  "binary-data": (
    <Glyph>
      <path d="M10 3l6.9 3.6v7.2L10 17.4l-6.9-3.6V6.6Z" />
      <path d="m3.1 6.6 6.9 3.6 6.9-3.6" />
      <path d="M10 10.2v7.2" />
    </Glyph>
  ),
};

export function ColumnTypeIcon({ type }: { type: ColumnType }) {
  return ICONS[type];
}
