"use client";

import { useEffect, useState, type RefObject } from "react";

const MIN_TILE_WIDTH = 150;

interface Fit {
  cols: number;
  width: number;
  height: number;
}

function bestFit(width: number, height: number, count: number, aspect: number, gap: number): Fit {
  let best: Fit = { cols: 1, width: 0, height: 0 };
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    let tileWidth = (width - gap * (cols - 1)) / cols;
    let tileHeight = (height - gap * (rows - 1)) / rows;
    if (tileWidth / aspect > tileHeight) tileWidth = tileHeight * aspect;
    else tileHeight = tileWidth / aspect;
    if (tileWidth > best.width) {
      best = { cols, width: Math.floor(tileWidth), height: Math.floor(tileHeight) };
    }
  }
  return best;
}

/**
 * Finds the column count that gives the largest tiles for the space available,
 * and how many tiles fit before they get too small to read.
 */
export function useGridLayout(ref: RefObject<HTMLElement | null>, count: number, gap: number) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  // Portrait spaces such as phones look better with squarer tiles.
  const aspect = size.width < size.height ? 1 : 16 / 9;

  let visible = Math.max(count, 1);
  let fit = bestFit(size.width, size.height, visible, aspect, gap);
  while (visible > 2 && fit.width < MIN_TILE_WIDTH && size.width > 0) {
    visible--;
    fit = bestFit(size.width, size.height, visible, aspect, gap);
  }

  return { ...fit, visible, ready: size.width > 0 };
}
