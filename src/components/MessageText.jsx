import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Message text that collapses behind a "See more" toggle once it runs past
 * twelve lines (`line-clamp-12`).
 *
 * Whether the toggle is needed is decided by *measuring* the rendered
 * paragraph — `scrollHeight` against the clamped `clientHeight` — not by a
 * character count, so a short message never gets a dead "See more".
 *
 * The measurement waits for real layout: chat rows are `content-visibility:
 * auto`, so an off-screen paragraph has no height to compare against until it
 * is actually rendered. The ResizeObserver re-measures the moment it is (and
 * afterwards, so widening the window can reveal a toggle that didn't fit
 * before). Once found, the answer is locked in so expanding the text doesn't
 * make the toggle vanish.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children - the text, plus any trailing inline
 *   markers like "(edited)"
 * @param {string} [props.className]
 */
export default function MessageText({ children, className }) {
  const ref = useRef(null);
  const locked = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    const measure = () => {
      if (locked.current) return;
      if (el.scrollHeight > el.clientHeight + 1) {
        locked.current = true;
        setOverflowing(true);
      }
    };

    measure();
    if (typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <p
        ref={ref}
        className={cn(
          "whitespace-pre-wrap",
          !expanded && "line-clamp-12",
          className
        )}
      >
        {children}
      </p>
      {overflowing ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="mt-1 text-xs font-medium underline underline-offset-2 opacity-80 transition-opacity hover:opacity-100"
        >
          {expanded ? "See less" : "See more"}
        </button>
      ) : null}
    </>
  );
}
