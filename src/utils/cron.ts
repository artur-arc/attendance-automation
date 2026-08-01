/**
 * Convert a local wall-clock time into a UTC cron expression.
 *
 * Cron in GitHub Actions is UTC for the weekday as well as the hour, so a time
 * that crosses midnight on conversion has to move the day too: 00:30 on Friday
 * in Asia/Jerusalem is 21:30 on *Thursday* in UTC, i.e. `30 21 * * 4`. Getting
 * only the hour right would schedule the run a full day late.
 *
 * The offset is read for today's date, so a schedule generated in summer keeps
 * DST's offset — re-run `npm run sync-schedule` after a DST change to correct it.
 */
export function timeToCron(time: string, timezone: string, dayOfWeek: number): string {
  const [hours, minutes] = time.split(':').map(Number);
  const now = new Date();
  const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
  const local = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  const offsetMinutes = (local.getTime() - utc.getTime()) / 60000;

  const rawUtcMinutes = hours * 60 + minutes - offsetMinutes;
  const dayShift = Math.floor(rawUtcMinutes / 1440);
  const totalUtcMinutes = ((rawUtcMinutes % 1440) + 1440) % 1440;
  const utcDay = (((dayOfWeek + dayShift) % 7) + 7) % 7;

  return `${Math.round(totalUtcMinutes % 60)} ${Math.floor(totalUtcMinutes / 60)} * * ${utcDay}`;
}
