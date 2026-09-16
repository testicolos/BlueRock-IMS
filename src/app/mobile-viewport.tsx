'use client';

import { useEffect } from 'react';

// Safari resizes only the visible viewport when its keyboard opens. Keep
// dialogs within that space while leaving normal page scrolling to the browser.
export default function MobileViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    let frame = 0;
    const root = document.documentElement;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Preserve deliberate pinch zoom instead of resizing the interface.
        if (Math.abs(viewport.scale - 1) > 0.05) return;
        root.style.setProperty('--visible-viewport-height', `${viewport.height}px`);
        root.style.setProperty('--visible-viewport-top', `${viewport.offsetTop}px`);
      });
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      root.style.removeProperty('--visible-viewport-height');
      root.style.removeProperty('--visible-viewport-top');
    };
  }, []);
  return null;
}
