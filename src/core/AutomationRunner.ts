import { chromium, Page, BrowserContext, Browser } from '@playwright/test';
import { logger } from '../utils';
import 'dotenv/config';

export interface AutomationOptions {
  headless?: boolean;
}

export type AutomationTask = (
  page: Page,
  context: BrowserContext,
  browser: Browser,
) => Promise<void>;

/**
 * Generic runner for Playwright automation projects.
 * Handles specialized browser setup, context initialization, and cleanup.
 * Automatically switches to headless mode in CI environments.
 */
export async function runAutomation(
  task: AutomationTask,
  options: AutomationOptions = {},
): Promise<void> {
  const isCi = !!process.env.CI;
  // If running in CI (GitHub Actions), always use headless mode.
  // Otherwise, use the user-provided option (defaulting to local browser if not specified).
  const headless = isCi ? true : (options.headless ?? false);

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await task(page, context, browser);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`--- AUTOMATION SCRIPTERROR: ${message}`);
    throw error;
  } finally {
    await browser.close();
  }
}
