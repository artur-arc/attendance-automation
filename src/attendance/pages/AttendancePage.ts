import { Page, Locator } from '@playwright/test';
import { BasePage } from '../../core/BasePage';
import { SelectorSpec } from '../../core/SelfHealingLocator';
import { logger } from '../../utils';
import { AttendanceRecord, CalendarMonth, monthAliases } from '../types';

/** How long to keep polling for a month grid to finish rendering. */
const SETTLE_TIMEOUT_MS = 20000;
/** Give up waiting for status circles after this — a month may have none. */
const STATUS_GRACE_MS = 8000;
const SETTLE_POLL_MS = 250;
/** How long to wait for the day modal to become writable (~1s in practice). */
const MODAL_READY_POLLS = 30;
const MODAL_READY_POLL_MS = 250;

/**
 * Read «2026 אוגוסט» / «June 2026» into a month number. Returns null when the
 * portal renders a language we have no aliases for — callers then fall back to
 * "the label changed" instead of an exact check.
 */
export function parseMonthLabel(label: string): CalendarMonth | null {
  const year = /(19|20)\d{2}/.exec(label)?.[0];
  if (!year) return null;

  const text = label.toLowerCase();
  const index = monthAliases.findIndex(aliases =>
    aliases.some(alias => text.includes(alias.toLowerCase())),
  );

  return index === -1 ? null : { year: Number(year), month: index + 1 };
}

/** The month `offset` steps away, rolling the year over as needed. */
function shiftMonth({ year, month }: CalendarMonth, offset: number): CalendarMonth {
  const zeroBased = month - 1 + offset;

  return { year: year + Math.floor(zeroBased / 12), month: (((zeroBased % 12) + 12) % 12) + 1 };
}

/**
 *
 */
export class AttendancePage extends BasePage {
  private readonly daySelector = '.weeks .day:not(.off-day)';
  private readonly allDaysSelector = '.weeks .day';
  private readonly statusSelector = 'svg.circle-status';
  private readonly pinkStatusSelector = 'svg.circle-status.pink-status';
  private readonly greenStatusSelector = 'svg.circle-status.green-status';
  private readonly attendanceButtonSelector = '.action-button .add-attendace-bnt';
  private readonly modalSelector = 'aside.aside-menu.open';
  private readonly inTimeSelector = 'input[name="inTime"]';
  private readonly outTimeSelector = 'input[name="outTime"]';
  private readonly remarksSelector = 'section.notes-field textarea';
  private readonly saveButtonSelector = 'button.btn-save.save';
  private readonly closeButtonSelector = '.close-aside';

  /**
   * The «‹ 2026 אוגוסט ›» header. Its arrows are the only way into another
   * month: the grid does render the neighbouring month's spill-over days, but
   * greyed out and not reportable, so a day left unfilled when the month rolls
   * over can only be reached by stepping the calendar back.
   *
   * The class names describe the visual side, and the portal lays out RTL, so
   * `right-arrow` is the one that walks backwards — verified live: clicking it
   * on אוגוסט lands on יולי. The forward arrow carries `disable` while the
   * calendar is on the current month.
   */
  private readonly prevMonthButton: SelectorSpec = {
    key: 'attendance.calendar.prevMonth',
    description:
      'The chevron that steps the attendance calendar one month back — the `i.right-arrow` icon inside the «‹ 2026 אוגוסט ›» date header',
    primary: '.display-date .right-arrow',
    fallbacks: ['.display-date i.chevron.right', '[class*="display-date"] i[class*="right"]'],
  };
  private readonly nextMonthButton: SelectorSpec = {
    key: 'attendance.calendar.nextMonth',
    description:
      'The chevron that steps the attendance calendar one month forward — the `i.left-arrow` icon inside the «‹ 2026 אוגוסט ›» date header; carries `disable` on the current month',
    primary: '.display-date .left-arrow',
    fallbacks: ['.display-date i.chevron.left', '[class*="display-date"] i[class*="left"]'],
  };
  private readonly monthLabel: SelectorSpec = {
    key: 'attendance.calendar.monthLabel',
    description:
      'The month-and-year text between the two chevrons in the attendance calendar header, e.g. «2026 אוגוסט» or «June 2026»',
    primary: '.display-date.text',
    fallbacks: ['.display-date .pointer', '[class*="display-date"][class*="text"]'],
  };

  /**
   *
   */
  constructor(page: Page) {
    super(page);
  }

  /** Header text («June 2026»), or `''` when the label can't be resolved. */
  async getMonthLabel(): Promise<string> {
    try {
      return await this.getText(this.monthLabel);
    } catch {
      return '';
    }
  }

  /** Step the calendar one month back. False if it didn't move. */
  previousMonth(): Promise<boolean> {
    return this.stepMonth(this.prevMonthButton, -1);
  }

  /** Step the calendar one month forward. False if it didn't move. */
  nextMonth(): Promise<boolean> {
    return this.stepMonth(this.nextMonthButton, 1);
  }

  /**
   * Click a month arrow and confirm the calendar landed exactly one month
   * away. Returns false — never throws — when the arrow is missing, disabled
   * or the header did not move, so the caller keeps working on the month it
   * already has instead of reporting attendance into the wrong one.
   */
  private async stepMonth(spec: SelectorSpec, offset: number): Promise<boolean> {
    const beforeLabel = await this.getMonthLabel();
    const beforeGrid = await this.gridSignature();

    let arrow: Locator;
    try {
      arrow = await this.locate(spec);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      logger.warn(`--- [calendar] «${spec.key}» not found: ${message}`);

      return false;
    }

    // The portal greys out the forward arrow on the current month.
    if (((await arrow.getAttribute('class')) ?? '').includes('disable')) {
      logger.log(`--- [calendar] «${spec.key}» is disabled — staying on «${beforeLabel}»`);

      return false;
    }

    await arrow.click();
    await this.waitForCalendarData(beforeGrid);

    const afterLabel = await this.getMonthLabel();
    const before = parseMonthLabel(beforeLabel);
    const after = parseMonthLabel(afterLabel);

    if (before && after) {
      const expected = shiftMonth(before, offset);
      if (after.year !== expected.year || after.month !== expected.month) {
        logger.warn(
          `--- [calendar] expected ${expected.year}-${expected.month}, landed on «${afterLabel}»`,
        );

        return false;
      }
      logger.log(`--- [calendar] now on «${afterLabel}»`);

      return true;
    }

    // Unknown language, or the label could not be read: settle for proof that
    // something changed. A wrong guess costs a re-scan, not a bad write —
    // already-reported days are not pink, so re-scanning a month is a no-op.
    if (afterLabel && afterLabel !== beforeLabel) {
      logger.warn(`--- [calendar] unparsed label «${afterLabel}» — accepting the move`);

      return true;
    }

    logger.warn(`--- [calendar] still on «${beforeLabel}» after clicking «${spec.key}»`);

    return false;
  }

  /**
   * How many cells carry each status class, e.g. `green-status x21`. Reveals
   * statuses the code does not know about — a retroactive report, for one, may
   * land in a state that is neither pink nor green.
   */
  async statusCensus(): Promise<string[]> {
    const classes = await this.page
      .locator(`${this.allDaysSelector} ${this.statusSelector}`)
      .evaluateAll(els =>
        els.map(el => (el.getAttribute('class') ?? '').replace('circle-status', '').trim()),
      );

    const counts = new Map<string, number>();
    for (const name of classes) counts.set(name, (counts.get(name) ?? 0) + 1);

    return [...counts.entries()].map(([name, n]) => `${name || '(no class)'} x${n}`);
  }

  /**
   * Dates plus status classes of every rendered cell — a fingerprint used to
   * tell a finished grid from one that is still being painted.
   */
  private gridSignature(): Promise<string> {
    return this.page.locator(this.allDaysSelector).evaluateAll(els =>
      els
        .map(el => {
          const date = el.querySelector('.dateNumber')?.textContent?.trim() ?? '';
          const status = el.querySelector('svg.circle-status')?.getAttribute('class') ?? '';

          return `${date}:${status}`;
        })
        .join('|'),
    );
  }

  /**
   * Wait until the grid on screen is the finished one.
   *
   * The portal paints the date cells first and only then fills in the status
   * circles from `/wcf/service.v3`, so a grid whose dates already look right
   * can still report every single day as blank — which is exactly how an
   * unreported day gets silently skipped. Waits for three things: cells
   * present, the fingerprint different from `changedFrom` (when stepping
   * months) and stable, and at least one status circle painted.
   *
   * A month can legitimately have no statuses at all (an untouched future
   * month), so the status wait gives up after {@link STATUS_GRACE_MS} instead
   * of blocking the whole run.
   */
  async waitForCalendarData(changedFrom?: string): Promise<void> {
    await this.page.waitForSelector(this.daySelector, { state: 'visible' });

    const startedAt = Date.now();
    let previous = '';
    let sawStatuses = false;

    for (;;) {
      const signature = await this.gridSignature();
      if (!sawStatuses) {
        sawStatuses =
          (await this.page.locator(`${this.allDaysSelector} ${this.statusSelector}`).count()) > 0;
      }

      const elapsed = Date.now() - startedAt;
      const painted = !!signature && signature !== changedFrom;

      if (painted && signature === previous && (sawStatuses || elapsed >= STATUS_GRACE_MS)) return;

      if (elapsed >= SETTLE_TIMEOUT_MS) {
        logger.warn('--- [calendar] grid never settled — scanning whatever is on screen');

        return;
      }

      previous = signature;
      await this.page.waitForTimeout(SETTLE_POLL_MS);
    }
  }

  /**
   *
   */
  async findPinkDays(): Promise<Locator[]> {
    // Not just `waitForSelector`: the cells exist several seconds before their
    // statuses do, and scanning too early finds nothing to report.
    await this.waitForCalendarData();
    const days = await this.page.locator(this.daySelector).all();
    const result: Locator[] = [];

    for (const day of days) {
      const hasPink = (await day.locator(this.pinkStatusSelector).count()) > 0;
      const hasGreen = (await day.locator(this.greenStatusSelector).count()) > 0;

      if (hasPink && !hasGreen) {
        result.push(day);
      }
    }

    return result;
  }

  /**
   *
   */
  async openAttendanceForDay(day: Locator): Promise<void> {
    await day.hover();
    await this.page.waitForTimeout(500); // Wait for button to be interactive
    await day.locator(this.attendanceButtonSelector).click();
    await this.page.waitForSelector(this.modalSelector, { state: 'visible' });
  }

  /**
   *
   */
  async fillAttendance(record: AttendanceRecord): Promise<void> {
    const modal = this.page.locator(this.modalSelector);
    await this.waitForModalReady(modal);

    // Typed, not `fill()`ed: this is a React form, and typing is what a human
    // does — the key handlers run, the attendance-type dropdown initialises and
    // the value survives. Verified live to land as «09:00», so the masked input
    // takes a plain string.
    await this.typeTime(modal.locator(this.inTimeSelector), record.inTime);
    await this.typeTime(modal.locator(this.outTimeSelector), record.outTime);

    if (record.remarks) {
      await modal.locator(this.remarksSelector).fill(record.remarks);
    }

    // `click()` waits for the button to stop being `disabled` on its own.
    const saveBtn = modal.locator(this.saveButtonSelector);
    await saveBtn.waitFor({ state: 'visible' });
    await saveBtn.click();
    await this.page.waitForSelector(this.modalSelector, { state: 'hidden' });
  }

  /** Type into a time input the way a person would, then commit with a blur. */
  private async typeTime(input: Locator, value: string): Promise<void> {
    await input.click();
    await input.pressSequentially(value, { delay: 40 });
    await input.blur();
  }

  /**
   * The modal is visible about a second before the portal sends its per-day
   * config: the notes field opens as `maxlength="0"` and only then becomes
   * writable. Filling inside that window is accepted by the UI and thrown
   * away — remarks silently truncated to nothing, times never registered.
   */
  private async waitForModalReady(modal: Locator): Promise<void> {
    const notes = modal.locator(this.remarksSelector);

    for (let i = 0; i < MODAL_READY_POLLS; i++) {
      if (((await notes.getAttribute('maxlength')) ?? '0') !== '0') return;
      await this.page.waitForTimeout(MODAL_READY_POLL_MS);
    }

    logger.warn('--- [attendance] modal never became writable — filling anyway');
  }

  /**
   *
   */
  async waitForGreenStatus(day: Locator): Promise<boolean> {
    try {
      await day.locator(this.greenStatusSelector).waitFor({ state: 'attached', timeout: 15000 });

      return true;
    } catch {
      return false;
    }
  }

  /**
   *
   */
  async cancelAttendance(): Promise<void> {
    if (await this.page.locator(this.modalSelector).isVisible()) {
      await this.page.click(this.closeButtonSelector);
    }
  }

  /**
   *
   */
  /**
   * The `DayN` weekday class of a cell (`Day0` = Sunday … `Day6` = Saturday).
   * Every weekday is read, not just two of them — anything unrecognised used
   * to silently fall through to the `home` default.
   */
  async getDayType(day: Locator): Promise<string> {
    const className = (await day.getAttribute('class')) || '';

    return /\bDay[0-6]\b/.exec(className)?.[0] ?? 'Other';
  }

  /**
   *
   */
  async getDayDate(day: Locator): Promise<string> {
    return (await day.locator('.dateNumber').textContent())?.trim() || '?';
  }
}
