import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { timeToCron } from './cron';
import { logger } from './logger';

const [configPath, workflowPath] = process.argv.slice(2);

if (!configPath || !workflowPath) {
  logger.error('Usage: sync-schedule <config.json> <workflow.yml>');
  process.exit(1);
}

const config = JSON.parse(readFileSync(resolve(process.cwd(), configPath), 'utf-8')) as {
  automation: { time: string; timezone: string; dayOfWeek: number };
};

/** Cron weekday numbering: 0 = Sunday … 6 = Saturday. */
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const { time, timezone, dayOfWeek } = config.automation;

if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
  logger.error(`automation.dayOfWeek must be an integer 0-6 (0 = Sunday), got: ${dayOfWeek}`);
  process.exit(1);
}

const cron = timeToCron(time, timezone, dayOfWeek);

// Spell out the UTC side whenever it lands on a different weekday, so the
// workflow does not read like a bug: «Every Friday» next to `* * 4`.
const [cronMin, cronHour, , , cronDay] = cron.split(' ');
const utcSuffix =
  Number(cronDay) === dayOfWeek
    ? ''
    : ` (${DAY_NAMES[Number(cronDay)].slice(0, 3)} ${cronHour.padStart(2, '0')}:${cronMin.padStart(2, '0')} UTC)`;
const comment = `# Every ${DAY_NAMES[dayOfWeek]} at ${time} ${timezone}${utcSuffix}`;

const workflowAbsPath = resolve(process.cwd(), workflowPath);
const workflow = readFileSync(workflowAbsPath, 'utf-8');
const updated = workflow.replace(/- cron: '[^']+' # .*/, `- cron: '${cron}' ${comment}`);

writeFileSync(workflowAbsPath, updated);
logger.log(`Schedule updated: ${cron}`);
