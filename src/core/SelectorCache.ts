import { readFileSync, writeFileSync, existsSync } from 'fs';
import { logger } from '../utils';

/** One healed selector, remembered across runs. */
interface CachedSelector {
  /** The Playwright selector that was found to work. */
  selector: string;
  /** ISO timestamp of when it was healed. */
  healedAt: string;
  /** The page URL where it was healed (for debugging). */
  sourceUrl: string;
  /** The selector(s) it replaced. */
  replaced: string;
}

/**
 * A tiny file-backed map of `spec.key` → healed selector.
 *
 * When the AI heals a broken selector we write the result here so the next
 * run reuses it instead of paying for another model call. The file is plain
 * JSON — safe to inspect, hand-edit, or delete to force a re-heal.
 */
export class SelectorCache {
  private data: Record<string, CachedSelector> = {};

  /**
   *
   */
  constructor(private readonly path: string) {
    this.load();
  }

  private load(): void {
    if (!existsSync(this.path)) return;
    try {
      this.data = JSON.parse(readFileSync(this.path, 'utf-8')) as Record<string, CachedSelector>;
      logger.debug(
        `--- [selector-cache] loaded ${Object.keys(this.data).length} entries from ${this.path}`,
      );
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      logger.warn(`--- [selector-cache] could not read ${this.path} (${message}) — starting empty`);
      this.data = {};
    }
  }

  /**
   *
   */
  get(key: string): CachedSelector | undefined {
    return this.data[key];
  }

  /**
   *
   */
  set(key: string, entry: CachedSelector): void {
    this.data[key] = entry;
    this.persist();
  }

  /** Drop a cached selector that turned out to be stale. */
  delete(key: string): void {
    if (!(key in this.data)) return;
    delete this.data[key];
    this.persist();
  }

  private persist(): void {
    try {
      writeFileSync(this.path, `${JSON.stringify(this.data, null, 2)}\n`, 'utf-8');
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      logger.warn(`--- [selector-cache] could not write ${this.path} (${message})`);
    }
  }
}
