import { Page } from '@playwright/test';
import { logger } from '../utils';
import config from './attendance.json';
import { AttendancePage, LoginPage } from './pages';
import { placeFor } from './schedule';
import { AutomationResult, formatMonth, place } from './types';

/**
 *
 */
export class AttendanceService {
  private readonly loginPage: LoginPage;
  private readonly attendancePage: AttendancePage;

  /**
   *
   */
  constructor(private readonly page: Page) {
    this.loginPage = new LoginPage(page);
    this.attendancePage = new AttendancePage(page);
  }

  /**
   *
   */
  async run(username: string, password: string): Promise<AutomationResult> {
    const result: AutomationResult = {
      successCount: 0,
      skippedCount: 0,
      errors: [],
      filled: [],
    };

    try {
      logger.log('--- Logging in...');
      await this.loginPage.login(username, password);
      logger.log('--- Login successful.');

      await this.sweepPastMonths(result);
      await this.fillVisibleMonth(result);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error(`--- CRITICAL ERROR: ${message}`);
      result.errors.push(`Critical: ${message}`);
    }

    return result;
  }

  /**
   * The portal always opens on the current month, so a day still unreported
   * when the month rolls over (Thu the 30th, next run on Fri the 1st) would
   * never be seen again — the spill-over cells the grid draws for the
   * neighbouring month are greyed out and cannot be reported into. That is how
   * 29 and 30 June 2026 stayed red for over a month.
   *
   * One step back closes the rollover gap; `sweepMonthsBack` exists because
   * days already lost that way sit further back than a single month. Every
   * month on the way is filled, including ones that look clean — stopping at
   * the first clean month would never reach the older debt behind it.
   */
  private async sweepPastMonths(result: AutomationResult): Promise<void> {
    let stepsBack = 0;

    while (stepsBack < config.sweepMonthsBack) {
      if (!(await this.attendancePage.previousMonth())) break;
      stepsBack++;
      logger.log(`--- Sweeping ${await this.attendancePage.getMonthLabel()}...`);
      await this.fillVisibleMonth(result);
    }

    if (stepsBack === 0) {
      logger.warn('--- No earlier month reachable — filling the current month only.');

      return;
    }

    // Walk back to where we started. Anything less and the current month's
    // schedule would be reported into an old one.
    for (let i = 0; i < stepsBack; i++) {
      if (await this.attendancePage.nextMonth()) continue;

      logger.warn('--- Could not step forward — reloading the portal.');
      await this.page.goto(config.baseUrl);

      return;
    }
  }

  /** Fill every unreported (pink) day of the month currently on screen. */
  private async fillVisibleMonth(result: AutomationResult): Promise<void> {
    const pinkDays = await this.attendancePage.findPinkDays();
    logger.log(`--- Found ${pinkDays.length} pink days.`);

    // Read once, up front: every day filled below belongs to this month, and
    // the report is unreadable without it — "filled 2, 3, 30" says nothing.
    const month = await this.attendancePage.getMonth();
    const monthName = formatMonth(month);
    const filled: string[] = [];

    for (const day of pinkDays) {
      const dateStr = await this.attendancePage.getDayDate(day);
      const dayType = await this.attendancePage.getDayType(day);

      const dayPlace = placeFor(dayType);

      if (dayPlace === place.off) {
        logger.log(`--- SKIP: Day ${dateStr} is off.`);
        continue;
      }

      logger.log(`--- Processing day ${dateStr} (${dayPlace})...`);

      try {
        await this.attendancePage.openAttendanceForDay(day);

        const record = {
          inTime: config.defaults.inTime,
          outTime: config.defaults.outTime,
          remarks: dayPlace === place.office ? 'office' : undefined,
        };

        await this.attendancePage.fillAttendance(record);

        const success = await this.attendancePage.waitForGreenStatus(day);
        if (success) {
          logger.log(`--- OK: Day ${dateStr} saved.`);
          result.successCount++;
          filled.push(dateStr);
        } else {
          // The portal takes the form, closes the modal and reports nothing
          // when the month is closed for reporting — verified on 29 June 2026
          // with a fully initialised modal and a typed-in, accepted entry.
          throw new Error(
            'stayed unreported — the portal accepted the entry and dropped it (month closed for reporting?)',
          );
        }
        await this.page.waitForTimeout(500);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        logger.warn(`--- SKIP: Day ${dateStr} failed: ${message}`);
        result.skippedCount++;
        result.errors.push(`${monthName ? `${dateStr} ${monthName}` : dateStr}: ${message}`);
        await this.attendancePage.cancelAttendance();
        await this.page.waitForTimeout(500);
      }
    }

    if (filled.length > 0) result.filled.push({ month, days: filled });
  }
}
