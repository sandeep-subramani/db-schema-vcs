import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
  /** Glyph shown before the label, on the trigger and in the list. */
  icon?: ReactNode;
  /** Indent level — a tree of options reads as an outline. */
  depth?: number;
}

/** Menu sheet never grows past this, however many options there are. */
const MAX_MENU_HEIGHT = 420;
/** Breathing room kept between the menu and the viewport edge. */
const VIEWPORT_MARGIN = 8;
/** Gap between the trigger and the menu, matching the top-bar popovers. */
const MENU_OFFSET = 6;
/** How long consecutive keystrokes count as one type-ahead search. */
const TYPEAHEAD_MS = 700;

interface MenuPosition {
  left: number;
  top: number;
  minWidth: number;
  maxHeight: number;
}

// The app's one dropdown. A native <select> paints its list with the
// operating system's own widget — a white slab in a near-black app,
// unstyleable by design — so the list is rebuilt here as a listbox we
// own: same panel, border and violet tick as the theme and account
// popovers in the top bar.
//
// The menu renders through a portal into <body>. Two of the places
// this is used sit inside scroll containers (the columns table, the
// compare bar), and an absolutely positioned menu would be clipped by
// their overflow; a fixed-position portal escapes that, at the cost of
// having to re-measure on scroll and resize, which is what the layout
// effect below does.
export function Select<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
  className,
  menuClassName,
  placeholder,
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
  menuClassName?: string;
  /** Shown when the value matches no option. */
  placeholder?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPosition | null>(null);
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typeahead = useRef({ text: "", at: 0 });

  /** False for the frame between opening and the menu being measured. */
  const placed = pos !== null;
  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex === -1 ? undefined : options[selectedIndex];

  function openMenu() {
    if (disabled || options.length === 0) return;
    setActive(selectedIndex === -1 ? 0 : selectedIndex);
    setPos(null);
    setOpen(true);
  }

  function closeMenu(refocus = true) {
    setOpen(false);
    setPos(null);
    if (refocus) triggerRef.current?.focus();
  }

  function commit(index: number) {
    const option = options[index];
    if (option !== undefined && option.value !== value) onChange(option.value);
    closeMenu();
  }

  // Measure and place: below the trigger when it fits, above when it
  // doesn't, and nudged inside the viewport horizontally either way.
  useLayoutEffect(() => {
    if (!open) return;

    function place() {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;
      const rect = trigger.getBoundingClientRect();
      const wanted = Math.min(menu.scrollHeight, MAX_MENU_HEIGHT);
      const below = window.innerHeight - rect.bottom - MENU_OFFSET - VIEWPORT_MARGIN;
      const above = rect.top - MENU_OFFSET - VIEWPORT_MARGIN;
      const dropUp = wanted > below && above > below;
      const maxHeight = Math.max(Math.min(wanted, dropUp ? above : below), 96);
      const width = Math.max(menu.offsetWidth, rect.width);
      const left = Math.min(
        Math.max(rect.left, VIEWPORT_MARGIN),
        Math.max(window.innerWidth - width - VIEWPORT_MARGIN, VIEWPORT_MARGIN),
      );
      setPos({
        left,
        top: dropUp
          ? rect.top - MENU_OFFSET - maxHeight
          : rect.bottom + MENU_OFFSET,
        minWidth: rect.width,
        maxHeight,
      });
    }

    place();
    // Capture, because scroll doesn't bubble: this catches the page and
    // every scrolling ancestor the trigger might sit in.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, options.length]);

  // Focus lives on the list while it's open, so the arrow keys are ours.
  useEffect(() => {
    if (open && placed) listRef.current?.focus();
  }, [open, placed]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      closeMenu(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Keep the highlighted row in view when arrowing through a long list.
  useEffect(() => {
    if (!open || !placed) return;
    const row = document.getElementById(`${id}-option-${active}`);
    row?.scrollIntoView({ block: "nearest" });
  }, [open, placed, active, id]);

  function moveTo(index: number) {
    if (options.length === 0) return;
    setActive(Math.min(Math.max(index, 0), options.length - 1));
  }

  function searchFrom(key: string) {
    const now = Date.now();
    const text =
      now - typeahead.current.at < TYPEAHEAD_MS
        ? typeahead.current.text + key
        : key;
    typeahead.current = { text, at: now };
    const lower = text.toLowerCase();
    // Start the sweep after the current row, so pressing the same
    // letter twice walks through the options that share it.
    const start = text.length === 1 ? active + 1 : active;
    for (let i = 0; i < options.length; i += 1) {
      const index = (start + i) % options.length;
      if (options[index]?.label.toLowerCase().startsWith(lower)) return index;
    }
    return -1;
  }

  function onTriggerKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === " " || e.key === "Enter") {
      e.preventDefault();
      openMenu();
      return;
    }
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const hit = searchFrom(e.key);
      if (hit !== -1) {
        e.preventDefault();
        commit(hit);
      }
    }
  }

  function onListKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        moveTo(active + 1);
        return;
      case "ArrowUp":
        e.preventDefault();
        moveTo(active - 1);
        return;
      case "Home":
        e.preventDefault();
        moveTo(0);
        return;
      case "End":
        e.preventDefault();
        moveTo(options.length - 1);
        return;
      case "PageDown":
        e.preventDefault();
        moveTo(active + 8);
        return;
      case "PageUp":
        e.preventDefault();
        moveTo(active - 8);
        return;
      case "Enter":
      case " ":
        e.preventDefault();
        commit(active);
        return;
      case "Escape":
        e.preventDefault();
        // The dialogs listen for Escape on window. Without this, one
        // press would dismiss the menu and the dialog behind it.
        e.stopPropagation();
        closeMenu();
        return;
      case "Tab":
        closeMenu();
        return;
      default:
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          const hit = searchFrom(e.key);
          if (hit !== -1) {
            e.preventDefault();
            moveTo(hit);
          }
        }
    }
  }

  const triggerLabel = selected?.label ?? placeholder ?? "";

  return (
    <div className={className ? `uiselect ${className}` : "uiselect"}>
      <button
        type="button"
        ref={triggerRef}
        className="uiselect-trigger"
        disabled={disabled}
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={onTriggerKeyDown}
      >
        {selected?.icon && (
          <span className="uiselect-icon" aria-hidden="true">
            {selected.icon}
          </span>
        )}
        <span className={selected ? "uiselect-value" : "uiselect-value uiselect-value--empty"}>
          {triggerLabel}
        </span>
        <span className="uiselect-caret" aria-hidden="true" />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            className={menuClassName ? `uiselect-menu ${menuClassName}` : "uiselect-menu"}
            style={
              pos
                ? {
                    left: pos.left,
                    top: pos.top,
                    minWidth: pos.minWidth,
                    maxHeight: pos.maxHeight,
                  }
                : { left: 0, top: 0, visibility: "hidden" }
            }
          >
            <ul
              ref={listRef}
              id={`${id}-list`}
              className="uiselect-list"
              role="listbox"
              tabIndex={-1}
              aria-label={ariaLabel}
              aria-activedescendant={`${id}-option-${active}`}
              onKeyDown={onListKeyDown}
            >
              {options.map((option, index) => (
                <li
                  key={option.value}
                  id={`${id}-option-${index}`}
                  role="option"
                  aria-selected={index === selectedIndex}
                  className={
                    "uiselect-option" +
                    (index === active ? " uiselect-option--active" : "") +
                    (index === selectedIndex ? " uiselect-option--selected" : "")
                  }
                  style={
                    option.depth ? { paddingLeft: `${0.7 + option.depth * 0.9}rem` } : undefined
                  }
                  // pointermove, not pointerenter: a menu opening under a
                  // parked cursor would otherwise steal the highlight from
                  // the row the keyboard just landed on.
                  onPointerMove={() => setActive(index)}
                  onClick={() => commit(index)}
                >
                  {option.icon && (
                    <span className="uiselect-icon" aria-hidden="true">
                      {option.icon}
                    </span>
                  )}
                  <span className="uiselect-option-label">{option.label}</span>
                  <span className="uiselect-tick" aria-hidden="true">
                    {index === selectedIndex ? "✓" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}
