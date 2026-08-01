export interface AttendanceRecord {
  inTime: string;
  outTime: string;
  remarks?: string;
}

export interface DayInfo {
  date: string;
  dayType: string; // e.g., "Day0", "Day3", etc.
  status: 'pink' | 'green' | 'other';
  isToday: boolean;
}

export interface AutomationResult {
  successCount: number;
  skippedCount: number;
  errors: string[];
}

/** A month the calendar can be on. `month` is 1-based, like a human reads it. */
export interface CalendarMonth {
  year: number;
  month: number;
}

/**
 * The weekday class the portal puts on every day cell. Verified against the
 * live grid: July 1st 2026 (a Wednesday) renders as `Day3`, and `Day5`/`Day6`
 * always carry `off-day` — so the run is Day0 = Sunday … Day6 = Saturday.
 */
export const week = {
  sun: 'Day0',
  mon: 'Day1',
  tue: 'Day2',
  wed: 'Day3',
  thu: 'Day4',
  fri: 'Day5',
  sat: 'Day6',
} as const;

/**
 * Month names as they appear in the «‹ 2026 אוגוסט ›» header, indexed 0 = January.
 *
 * The portal follows the profile language: a signed-in profile set to English
 * shows «June 2026», a fresh browser (what CI always gets) shows Hebrew with
 * the year first. Matching on either spelling keeps month detection working in
 * both, and March carries both accepted Hebrew spellings.
 */
export const monthAliases: readonly (readonly string[])[] = [
  ['January', 'ינואר'],
  ['February', 'פברואר'],
  ['March', 'מרץ', 'מרס'],
  ['April', 'אפריל'],
  ['May', 'מאי'],
  ['June', 'יוני'],
  ['July', 'יולי'],
  ['August', 'אוגוסט'],
  ['September', 'ספטמבר'],
  ['October', 'אוקטובר'],
  ['November', 'נובמבר'],
  ['December', 'דצמבר'],
];

export const place = {
  office: 'office',
  home: 'home',
  off: 'off',
} as const;

export type Day = keyof typeof week;
export type Place = (typeof place)[keyof typeof place];
