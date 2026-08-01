/**
 * Minimal structural DOM shapes for code that runs inside `page.evaluate()`.
 *
 * The Node tsconfig has no DOM lib (and adding it would leak browser globals
 * into Node code), so we declare only the handful of members we actually touch.
 * These are compile-time only — `evaluate()` serializes the callback and runs
 * it in the browser, where the real DOM exists.
 *
 * Shared here so `evaluate` blocks across the codebase don't each redeclare them.
 */
export interface DomElement {
  tagName: string;
  textContent: string | null;
  children: { length: number };
  getAttribute(name: string): string | null;
  querySelectorAll(selector: string): DomNodeList;
}

export type DomNodeList = ArrayLike<DomElement> & { forEach(cb: (el: DomElement) => void): void };

export interface DomDocument {
  querySelectorAll(selector: string): DomNodeList;
}

/** The subset of CSSStyleDeclaration our evaluate blocks read. */
export type GetComputedStyle = (el: DomElement) => {
  color: string;
  display: string;
  visibility: string;
};
