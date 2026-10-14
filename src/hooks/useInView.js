import { useEffect, useRef, useState } from "react";

/**
 * Whether an element has come near the viewport — the gate for lazy-loading its
 * content.
 *
 * Reports `true` on the first intersection and then stops watching, so revealed
 * content is never unmounted or re-fetched by scrolling away and back. A single
 * observer per element, with no dependency on the message scroller, so it works
 * anywhere in the tree.
 *
 * @param {object} [options]
 * @param {string} [options.rootMargin] - how far past the viewport to count as
 *   "near"; keep it small to defer more, e.g. "200px"
 * @returns {[import("react").RefObject<HTMLElement>, boolean]}
 */
export function useInView({ rootMargin = "200px" } = {}) {
  const ref = useRef(null);
  // jsdom/tests and ancient browsers have no IntersectionObserver: reveal
  // immediately rather than hiding content forever.
  const [inView, setInView] = useState(
    () => typeof IntersectionObserver !== "function"
  );

  useEffect(() => {
    if (inView) return undefined;
    const node = ref.current;
    if (!node) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setInView(true);
      },
      { rootMargin }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [inView, rootMargin]);

  return [ref, inView];
}

export default useInView;
