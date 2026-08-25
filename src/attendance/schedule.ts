/**
 * The single place that turns a portal day-cell class into a scheduled place.
 *
 * Both the real run and the dry run resolve days through here, so what the dry
 * run prints can never drift from what the real run would write — which is the
 * only reason the dry run is worth trusting before a schedule change.
 */
import config from './attendance.json';
import { Day, Place, place, week } from './types';

/** The weekday behind a portal `DayN` class, or `null` if it is not one of them. */
export function dayNameFor(dayType: string): Day | null {
  const entry = (Object.entries(week) as [Day, string][]).find(([, code]) => code === dayType);

  return entry?.[0] ?? null;
}

/**
 * The place scheduled for a portal `DayN` class. An unrecognised class falls
 * back to `home`, which fills the day rather than silently skipping it.
 */
export function placeFor(dayType: string): Place {
  const dayName = dayNameFor(dayType);

  return dayName ? (config.schedule[dayName] as Place) : place.home;
}
