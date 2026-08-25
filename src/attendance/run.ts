import { writeFileSync } from 'node:fs';
import 'dotenv/config';
import { runAutomation } from '../core/AutomationRunner';
import { logger, requireCredentials, sendTelegramMessage } from '../utils';
import config from './attendance.json';
import { AttendanceService } from './AttendanceService';
import { buildFailureReport, buildRunReport } from './report';

const startedAt = Date.now();

/**
 * Left behind once a report has gone out, so the workflow's `if: failure()`
 * fallback knows not to send a second one. Its only job is to cover failures
 * this script never sees at all — a container that will not start, a cancelled
 * job — and those are exactly the runs where this file does not exist.
 */
const REPORTED_MARKER = '.telegram-notified';

/** Sends a report and records that it went out. Never throws. */
async function report(html: string): Promise<void> {
  const delivered = await sendTelegramMessage(html);

  if (!delivered) return;

  try {
    writeFileSync(REPORTED_MARKER, '');
  } catch (e: unknown) {
    logger.warn(`--- [telegram] could not write ${REPORTED_MARKER}: ${String(e)}`);
  }
}

void (async (): Promise<void> => {
  const { username, password } = requireCredentials();

  logger.log('--- Starting Attendance Automation Project ---');

  const result = await runAutomation(async page => {
    logger.log('--- Navigating to portal...');
    await page.goto(config.baseUrl);

    const service = new AttendanceService(page);

    return service.run(username, password);
  });

  logger.log('----------------------------------------------------');
  logger.log(`--- FINISHED OK: ${result.successCount} --- Skipped: ${result.skippedCount}`);
  if (result.errors.length > 0) {
    logger.warn(`--- ERRORS:\n  ${result.errors.join('\n  ')}`);
  }
  logger.log('----------------------------------------------------');

  // Reported after the browser is gone: a slow Telegram call should not hold a
  // browser session open, and by this point the outcome cannot change.
  await report(buildRunReport(result, { durationMs: Date.now() - startedAt }));
})().catch(async (e: unknown) => {
  const message = e instanceof Error ? e.message : String(e);

  logger.error(`[runAutomation]: Critical script error: ${message}`);
  await report(buildFailureReport(message, { durationMs: Date.now() - startedAt }));

  process.exit(1);
});
