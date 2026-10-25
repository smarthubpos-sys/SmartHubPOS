/**
 * The app shell (pages/layout/Applayout.tsx) scrolls inside <main data-app-scroll>, NOT inside the window,
 * so anything that wants "scroll to the top" must target that element (window.scrollTo does nothing there).
 */
export const APP_SCROLL_SELECTOR = "[data-app-scroll]";

export function scrollAppToTop(behavior: ScrollBehavior = "auto") {
  const el = document.querySelector<HTMLElement>(APP_SCROLL_SELECTOR);
  if (el) el.scrollTo({ top: 0, behavior });
  else window.scrollTo({ top: 0, behavior });
}
