import { Locator, Page } from '@playwright/test';
import { logger } from '../utils';
import { SelectorCache } from './SelectorCache';
import { HealResult, SelectorHealer, SelectorSpec } from './SelectorHealer';

export type { SelectorSpec } from './SelectorHealer';

export interface ResolveOptions {
  /** How long to wait for each candidate selector (ms). */
  timeout?: number;
  /** Element state to wait for. Defaults to 'visible'. */
  state?: 'attached' | 'visible';
  /** Set false to skip the AI heal and only try known selectors. */
  heal?: boolean;
}

/** Thrown when no selector — known or healed — resolves the element. */
export class SelectorNotFoundError extends Error {
  /**
   *
   */
  constructor(spec: SelectorSpec) {
    super(
      `Could not resolve element «${spec.key}» (${spec.description}). All selectors failed and healing did not recover it.`,
    );
    this.name = 'SelectorNotFoundError';
  }
}

const DEFAULT_TIMEOUT = 5000;
const MIN_CONFIDENCE = Number(process.env.SELECTOR_HEAL_MIN_CONFIDENCE ?? 0.5);

/**
 * A self-healing resolver for Playwright locators.
 *
 * `resolve()` tries, in order: the primary selector, each fallback, the
 * cached healed selector from a previous run, and finally the AI healer. The
 * first one that matches wins; a fresh heal is written to the cache so later
 * runs skip the model call. Returns a normal Playwright `Locator`, so callers
 * click / fill / read exactly as they would with `page.locator(...)`.
 *
 * This is what makes a changed selector self-correct instead of crashing: when
 * the markup shifts, the resolver walks into the DOM, finds the element that
 * replaced the old one, and uses it — automatically, for every action.
 */
export class SelfHealingLocator {
  /**
   *
   */
  constructor(
    private readonly page: Page,
    private readonly cache: SelectorCache,
    private readonly healer: SelectorHealer,
  ) {}

  /** Resolve a spec to a working `Locator`, healing if necessary. */
  async resolve(spec: SelectorSpec, opts: ResolveOptions = {}): Promise<Locator> {
    const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
    const state = opts.state ?? 'visible';
    const heal = opts.heal ?? true;

    // 1. Primary selector — the happy path.
    const primary = await this.probe(spec.primary, state, timeout);
    if (primary) return primary;

    // 2. Ordered fallbacks.
    for (const fallback of spec.fallbacks ?? []) {
      const loc = await this.probe(fallback, state, timeout);
      if (loc) {
        logger.info(`--- [heal] «${spec.key}» primary failed — using fallback "${fallback}"`);

        return loc;
      }
    }

    // 3. A selector healed on a previous run.
    const cached = this.cache.get(spec.key);
    if (cached) {
      const loc = await this.probe(cached.selector, state, timeout);
      if (loc) {
        logger.info(`--- [heal] «${spec.key}» resolved from cache: "${cached.selector}"`);

        return loc;
      }
      logger.warn(
        `--- [heal] «${spec.key}» cached selector "${cached.selector}" is now stale — re-healing`,
      );
      this.cache.delete(spec.key);
    }

    // 4. Ask the model to find the replacement selector.
    if (heal && this.healer.enabled) {
      const result = await this.healer.heal(this.page, spec);
      const loc = await this.applyHeal(spec, result, state, timeout);
      if (loc) return loc;
    } else if (heal) {
      logger.warn(
        `--- [heal] «${spec.key}» unresolved and healing is disabled (no ANTHROPIC_API_KEY)`,
      );
    }

    await this.snapshotFailure(spec);
    throw new SelectorNotFoundError(spec);
  }

  /**
   * Count matches for a spec without healing or throwing — for "is this page
   * loaded?" style checks that must stay cheap and side-effect-free.
   */
  async count(spec: SelectorSpec): Promise<number> {
    for (const selector of this.candidates(spec)) {
      try {
        const n = await this.page.locator(selector).count();
        if (n > 0) return n;
      } catch {
        // ignore malformed/absent selector, try the next
      }
    }

    return 0;
  }

  /** All known selectors for a spec, best first (primary, fallbacks, cache). */
  private candidates(spec: SelectorSpec): string[] {
    const cached = this.cache.get(spec.key)?.selector;

    return [spec.primary, ...(spec.fallbacks ?? []), ...(cached ? [cached] : [])];
  }

  /** Validate a heal result, cache it, and return the locator — or null. */
  private async applyHeal(
    spec: SelectorSpec,
    result: HealResult | null,
    state: 'attached' | 'visible',
    timeout: number,
  ): Promise<Locator | null> {
    if (!result || !result.found || !result.selector) return null;
    if (result.confidence < MIN_CONFIDENCE) {
      logger.warn(
        `--- [heal] «${spec.key}» discarded: confidence ${result.confidence.toFixed(2)} < ${MIN_CONFIDENCE}`,
      );

      return null;
    }

    const loc = await this.probe(result.selector, state, timeout);
    if (!loc) {
      logger.warn(
        `--- [heal] «${spec.key}» healed selector "${result.selector}" did not match — discarding`,
      );

      return null;
    }

    this.cache.set(spec.key, {
      selector: result.selector,
      healedAt: new Date().toISOString(),
      sourceUrl: this.page.url(),
      replaced: [spec.primary, ...(spec.fallbacks ?? [])].join(' | '),
    });
    logger.info(`--- [heal] «${spec.key}» healed → "${result.selector}" (cached for next run)`);

    return loc;
  }

  /** Wait for a selector; return the locator if it appears, else null. */
  private async probe(
    selector: string,
    state: 'attached' | 'visible',
    timeout: number,
  ): Promise<Locator | null> {
    const loc = this.page.locator(selector).first();
    try {
      await loc.waitFor({ state, timeout });

      return loc;
    } catch {
      return null;
    }
  }

  /** Save a screenshot when everything fails, to aid manual debugging. */
  private async snapshotFailure(spec: SelectorSpec): Promise<void> {
    const dir = process.env.SELECTOR_SNAPSHOT_DIR ?? '.';
    const safe = spec.key.replace(/[^\w.-]/g, '_');
    const path = `${dir}/selector-fail-${safe}.png`;
    await this.page.screenshot({ path, fullPage: true }).catch(() => undefined);
    logger.error(`--- [heal] «${spec.key}» unresolved — screenshot saved to ${path}`);
  }
}
