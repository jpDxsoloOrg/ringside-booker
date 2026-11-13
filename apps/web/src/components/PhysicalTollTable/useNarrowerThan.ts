import { useCallback, useEffect, useState } from 'react';

/**
 * Whether the element the returned ref is attached to is narrower than `minWidth`, kept current as
 * it resizes. False where the browser has no ResizeObserver.
 */
export function useNarrowerThan(
  minWidth: number,
): readonly [(node: HTMLElement | null) => void, boolean] {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (node === null || typeof ResizeObserver === 'undefined') return undefined;
    const measure = (): void => {
      setNarrow(node.getBoundingClientRect().width < minWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [minWidth, node]);
  const ref = useCallback((element: HTMLElement | null) => {
    setNode(element);
  }, []);
  return [ref, narrow];
}
