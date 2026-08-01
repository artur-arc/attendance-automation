import { Page } from '@playwright/test';
import { logger } from '../utils';
import { DomDocument } from './dom-types';

/** A logical description of an element, independent of any one selector. */
export interface SelectorSpec {
  /** Stable logical id used as the cache key, e.g. `login.idInput`. */
  key: string;
  /** What the element IS — read by the AI when the selectors break. */
  description: string;
  /** The preferred selector. Tried first. */
  primary: string;
  /** Ordered fallback selectors, tried before the AI is consulted. */
  fallbacks?: string[];
}

/** The healer's verdict for one broken spec. */
export interface HealResult {
  found: boolean;
  selector: string;
  confidence: number;
  reasoning: string;
}

/**
 * One candidate element scraped from the live DOM. Kept compact on purpose —
 * this is what we send to the model, so every field costs tokens.
 */
interface DomCandidate {
  tag: string;
  id?: string;
  name?: string;
  type?: string;
  role?: string;
  placeholder?: string;
  ariaLabel?: string;
  text?: string;
  className?: string;
}

const SELECTOR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    found: {
      type: 'boolean',
      description: 'True only if a single element clearly matches the description.',
    },
    selector: {
      type: 'string',
      description:
        'A Playwright-compatible selector for the element (CSS, or a Playwright text/role engine selector). Empty string if found is false.',
    },
    confidence: {
      type: 'number',
      description: 'Confidence from 0 to 1 that this selector matches the intended element.',
    },
    reasoning: {
      type: 'string',
      description: 'One sentence explaining the choice (or why nothing matched).',
    },
  },
  required: ['found', 'selector', 'confidence', 'reasoning'],
} as const;

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
/** The skill mandates Opus 4.8 as the default; override for a cheaper model. */
const DEFAULT_MODEL = 'claude-opus-4-8';

/**
 * Asks Claude to find the selector that replaced a broken one.
 *
 * Given the element's description, the selectors that just failed, and a
 * compact snapshot of the current DOM, the model returns the Playwright
 * selector that now points at the intended element. Uses structured outputs
 * so the response is schema-validated JSON, not free text.
 */
export class SelectorHealer {
  private readonly apiKey: string | undefined;
  private readonly model: string;

  /**
   *
   */
  constructor(opts: { apiKey?: string; model?: string } = {}) {
    this.apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    this.model = opts.model ?? process.env.SELECTOR_HEAL_MODEL ?? DEFAULT_MODEL;
  }

  /** Whether healing can run at all (needs an API key). */
  get enabled(): boolean {
    return !!this.apiKey;
  }

  /**
   *
   */
  async heal(page: Page, spec: SelectorSpec): Promise<HealResult | null> {
    if (!this.apiKey) {
      logger.warn('--- [heal] ANTHROPIC_API_KEY not set — cannot heal selector');

      return null;
    }

    const candidates = await this.snapshot(page);
    logger.info(
      `--- [heal] «${spec.key}» broke — asking ${this.model} (${candidates.length} DOM candidates)`,
    );

    const failed = [spec.primary, ...(spec.fallbacks ?? [])].join('\n  ');
    const prompt =
      'A Playwright browser-automation script can no longer find an element because the page markup changed.\n\n' +
      `Element description:\n  ${spec.description}\n\n` +
      `Selectors that USED to work but now match nothing:\n  ${failed}\n\n` +
      'Here are the interactive/candidate elements currently on the page (JSON):\n' +
      `${JSON.stringify(candidates)}\n\n` +
      'Find the ONE element that matches the description and return a Playwright-compatible selector ' +
      'that uniquely identifies it. Prefer stable attributes (id, name, role, label, placeholder) over ' +
      'positional or auto-generated classes. If nothing clearly matches, set found=false.';

    try {
      const result = await this.callModel(prompt);
      if (!result) return null;
      logger.info(
        `--- [heal] «${spec.key}» → ${result.found ? `"${result.selector}"` : 'no match'} ` +
          `(confidence ${result.confidence.toFixed(2)}): ${result.reasoning}`,
      );

      return result;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error(`--- [heal] model call failed: ${message}`);

      return null;
    }
  }

  /** POST to the Messages API with a schema-constrained response. */
  private async callModel(prompt: string): Promise<HealResult | null> {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey as string,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        system:
          'You repair broken CSS/Playwright selectors for a web-automation script. ' +
          'You reply only with the structured result.',
        output_config: { effort: 'low', format: { type: 'json_schema', schema: SELECTOR_SCHEMA } },
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      }),
    });

    if (!res.ok) {
      logger.error(`--- [heal] API ${res.status}: ${(await res.text()).slice(0, 300)}`);

      return null;
    }

    const body = (await res.json()) as {
      stop_reason?: string;
      content?: { type: string; text?: string }[];
    };

    if (body.stop_reason === 'refusal') {
      logger.warn('--- [heal] model refused the request');

      return null;
    }

    const text = (body.content ?? [])
      .filter(b => b.type === 'text' && typeof b.text === 'string')
      .map(b => b.text)
      .join('');
    if (!text) return null;

    const parsed = JSON.parse(text) as HealResult;
    // Clamp confidence into [0,1] — structured outputs can't enforce numeric bounds.
    parsed.confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));

    return parsed;
  }

  /**
   * Scrape a compact list of interactive/candidate elements from the page.
   * Runs in the browser; DOM globals are reached via globalThis so the Node
   * tsconfig (no DOM lib) still typechecks this file.
   */
  private async snapshot(page: Page): Promise<DomCandidate[]> {
    return page.evaluate(() => {
      const doc = (globalThis as { document?: DomDocument }).document;
      if (!doc) return [];

      const clip = (s: string | null, max: number): string | undefined => {
        const t = (s ?? '').replace(/\s+/g, ' ').trim();

        return t ? t.slice(0, max) : undefined;
      };

      const els = doc.querySelectorAll(
        'input, button, select, textarea, a, [role], [onclick], [contenteditable]',
      );
      const out: DomCandidate[] = [];
      const limit = 400;
      for (let i = 0; i < els.length && out.length < limit; i++) {
        const el = els[i];
        const candidate: DomCandidate = { tag: el.tagName.toLowerCase() };
        candidate.id = clip(el.getAttribute('id'), 80);
        candidate.name = clip(el.getAttribute('name'), 80);
        candidate.type = clip(el.getAttribute('type'), 40);
        candidate.role = clip(el.getAttribute('role'), 40);
        candidate.placeholder = clip(el.getAttribute('placeholder'), 80);
        candidate.ariaLabel = clip(el.getAttribute('aria-label'), 80);
        // NB: intentionally NOT scraping `value` — on these forms it can hold
        // PII / tax figures, and this snapshot is sent to the model on a heal.
        candidate.text = clip(el.textContent, 60);
        candidate.className = clip(el.getAttribute('class'), 80);
        // Drop empty keys to save tokens.
        for (const k of Object.keys(candidate) as (keyof DomCandidate)[]) {
          if (candidate[k] === undefined) delete candidate[k];
        }
        out.push(candidate);
      }

      return out;
    });
  }
}
