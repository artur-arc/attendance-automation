/**
 * READ-ONLY dry run of the attendance sweep — `npm run attendance:dry`.
 *
 * Walks the exact path {@link AttendanceService} takes — log in, step back
 * through `sweepMonthsBack` months, scan each, return to the current month —
 * and prints what it *would* report for every unfilled day. It never opens the
 * attendance modal and never saves anything, so it is the safe way to check a
 * schedule or selector change before letting the real run write to the portal.
 */
import 'dotenv/config';
import { runAutomation } from '../core/AutomationRunner';
import { logger, requireCredentials } from '../utils';
import config from './attendance.json';
import { AttendancePage, LoginPage } from './pages';
import { dayNameFor, placeFor } from './schedule';
import { place } from './types';

void (async (): Promise<void> => {
  const { username, password } = requireCredentials();

  await runAutomation(async page => {
    await page.goto(config.baseUrl);

    const loginPage = new LoginPage(page);
    const attendancePage = new AttendancePage(page);

    await loginPage.login(username, password);

    const report = async (): Promise<void> => {
      const label = await attendancePage.getMonthLabel();
      const days = await attendancePage.findPinkDays();
      logger.log(`\n===== «${label}» — ${days.length} unreported =====`);
      logger.log(`  statuses: ${(await attendancePage.statusCensus()).join(', ') || 'none'}`);

      for (const day of days) {
        const date = await attendancePage.getDayDate(day);
        const dayType = await attendancePage.getDayType(day);
        const dayName = dayNameFor(dayType);
        const dayPlace = placeFor(dayType);
        const action =
          dayPlace === place.off
            ? 'SKIP (off)'
            : `WOULD FILL ${config.defaults.inTime}-${config.defaults.outTime}` +
              `${dayPlace === place.office ? ' remarks=office' : ''}`;
        logger.log(`  ${date.padStart(2)} ${dayType} (${dayName ?? '??'}) -> ${action}`);
      }
    };

    let stepsBack = 0;
    while (stepsBack < config.sweepMonthsBack) {
      if (!(await attendancePage.previousMonth())) break;
      stepsBack++;
      await report();
    }

    for (let i = 0; i < stepsBack; i++) {
      if (!(await attendancePage.nextMonth())) logger.warn('could not step forward again');
    }

    logger.log('\n--- back on the current month ---');
    await report();

    logger.log('\nNothing was written. Browser closes in 5s.');
    await page.waitForTimeout(5000);
  });
})().catch((e: unknown) => {
  logger.error(`[probe]: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
