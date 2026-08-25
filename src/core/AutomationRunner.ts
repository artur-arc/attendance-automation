import { chromium, Page, BrowserContext, Browser } from '@playwright/test';
import { logger } from '../utils';
import 'dotenv/config';

interface AutomationOptions {
  headless?: boolean;
}

type AutomationTask<T> = (page: Page, context: BrowserContext, browser: Browser) => Promise<T>;

/**
 * Generic runner for Playwright automation projects.
 * Handles specialized browser setup, context initialization, and cleanup.
 * Automatically switches to headless mode in CI environments.
 *
 * Whatever the task returns comes back out, so a caller can act on the run's
 * outcome — reporting it, say — after the browser is already closed.
 */
export async function runAutomation<T>(
  task: AutomationTask<T>,
  options: AutomationOptions = {},
): Promise<T> {
  const isCi = !!process.env.CI;
  // If running in CI (GitHub Actions), always use headless mode.
  // Otherwise, use the user-provided option (defaulting to local browser if not specified).
  const headless = isCi ? true : (options.headless ?? false);

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    return await task(page, context, browser);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`--- AUTOMATION SCRIPTERROR: ${message}`);
    throw error;
  } finally {
    await browser.close();
  }
}
