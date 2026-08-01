import { Locator, Page } from '@playwright/test';
import { SelectorCache } from './SelectorCache';
import { SelectorHealer } from './SelectorHealer';
import { ResolveOptions, SelfHealingLocator, SelectorSpec } from './SelfHealingLocator';

/** Process-wide singletons so every page shares one cache + one healer. */
const selectorCache = new SelectorCache(process.env.SELECTOR_CACHE_PATH ?? '.selector-cache.json');
const selectorHealer = new SelectorHealer();

/**
 * A page-object target: either a raw selector string (simple, static pages)
 * or a self-healing {@link SelectorSpec} (recovers when the markup shifts).
 * Every shared action below accepts both, so simple sites stay terse and
 * fragile ones opt into healing without a different API.
 */
export type Target = string | SelectorSpec;

/**
 * The single base class every site's page objects extend. It owns the
 * primitives that would otherwise be duplicated across each site folder:
 * the self-healing resolver plus the common Playwright actions
 * (fill / type / click / selectOption / check / hover / getText / waits).
 *
 * Site-specific pages should contain only what is unique to that site —
 * selectors and flow — never re-implement fill/click/wait here.
 */
export abstract class BasePage {
  protected readonly locator: SelfHealingLocator;

  protected constructor(protected readonly page: Page) {
    this.locator = new SelfHealingLocator(page, selectorCache, selectorHealer);
  }

  // --- Resolution -----------------------------------------------------------

  /** Resolve a self-healing spec to a working locator. */
  protected locate(spec: SelectorSpec, opts?: ResolveOptions): Promise<Locator> {
    return this.locator.resolve(spec, opts);
  }

  /** Count matches for a spec without healing — for presence checks. */
  protected countOf(spec: SelectorSpec): Promise<number> {
    return this.locator.count(spec);
  }

  /** Turn any {@link Target} into a Locator (strings skip healing). */
  protected async el(target: Target, opts?: ResolveOptions): Promise<Locator> {
    return typeof target === 'string'
      ? this.page.locator(target).first()
      : this.locate(target, opts);
  }

  // --- Shared actions (accept a string OR a self-healing spec) ---------------

  /**
   *
   */
  async fill(target: Target, value: string, opts?: ResolveOptions): Promise<void> {
    await (await this.el(target, opts)).fill(value);
  }

  /**
   * Type character-by-character so framework (e.g. Angular) input/change/blur
   * handlers fire — required where `.fill()` leaves validators/buttons inert.
   */
  async type(
    target: Target,
    text: string,
    opts: { delay?: number; blur?: boolean } = {},
  ): Promise<void> {
    const el = await this.el(target);
    await el.click();
    await el.pressSequentially(text, { delay: opts.delay ?? 30 });
    if (opts.blur) await el.blur();
  }

  /**
   *
   */
  async click(target: Target, opts?: ResolveOptions): Promise<void> {
    await (await this.el(target, opts)).click();
  }

  /**
   * Click and wait for the full-page navigation (e.g. an ASP.NET postback)
   * that the click triggers. Tolerates clicks that don't navigate.
   */
  async clickAndWaitForLoad(target: Target, timeout = 60000): Promise<void> {
    const el = await this.el(target);
    await Promise.all([
      this.page.waitForNavigation({ waitUntil: 'load', timeout }).catch(() => undefined),
      el.click(),
    ]);
  }

  /**
   *
   */
  async selectOption(target: Target, values: string | string[]): Promise<void> {
    await (await this.el(target)).selectOption(values);
  }

  /** Tick a checkbox/radio; falls back to a forced check if intercepted. */
  async check(target: Target): Promise<void> {
    const el = await this.el(target);
    await el.check().catch(() => el.check({ force: true }));
  }

  /** Set a checkbox to an explicit state (checked/unchecked). */
  async setChecked(target: Target, checked: boolean): Promise<void> {
    const el = await this.el(target);
    await el.setChecked(checked).catch(() => el.setChecked(checked, { force: true }));
  }

  /**
   * Set a checkbox only if a value was provided; `undefined` leaves the current
   * state untouched, and a missing element is skipped (not an error).
   */
  async setFlag(target: Target, value?: boolean): Promise<void> {
    if (value === undefined) return;
    if (!(await this.exists(target))) return;
    await this.setChecked(target, value);
  }

  /**
   *
   */
  async hover(target: Target): Promise<void> {
    await (await this.el(target)).hover();
  }

  /**
   *
   */
  async getText(target: Target): Promise<string> {
    const el = await this.el(target, { state: 'attached' });

    return (await el.textContent())?.trim() || '';
  }

  /** True if at least one element matches (no healing, no throw). */
  async exists(target: Target): Promise<boolean> {
    return typeof target === 'string'
      ? (await this.page.locator(target).count()) > 0
      : (await this.countOf(target)) > 0;
  }

  /**
   *
   */
  async sleep(ms: number): Promise<void> {
    await this.page.waitForTimeout(ms);
  }

  /** Wait for a target to appear (visible). Accepts a string or a spec. */
  async waitForSelector(target: Target, timeout = 12000): Promise<void> {
    if (typeof target === 'string') {
      await this.page.waitForSelector(target, { timeout });

      return;
    }
    await this.locate(target, { timeout, state: 'visible' });
  }
}
