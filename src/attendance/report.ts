/**
 * The run report, as Telegram sees it.
 *
 * Formatting lives apart from delivery so the wording can change without
 * touching the HTTP call, and so the shape of a report is readable in one
 * place — it is the only thing most people will ever see of a run.
 */
import { escapeHtml } from '../utils';
import config from './attendance.json';
import { AutomationResult, FilledMonth, formatMonth } from './types';

/** Past this many, a failure list stops informing and starts burying. */
const MAX_LISTED_ERRORS = 10;

/** Playwright errors carry a multi-line call log; the first line is the fact. */
const MAX_ERROR_CHARS = 180;

/** `1 day` / `4 days` — a count is read too often to render it as `day(s)`. */
function days(count: number): string {
  return `${count} ${count === 1 ? 'day' : 'days'}`;
}

/**
 * A link back to the workflow run, or `null` when running locally.
 *
 * Every part comes from the runner's own environment, so a fork reports its
 * own runs and a self-hosted GitHub reports its own host — nothing here is
 * pinned to the repository this code was written in. The link text carries the
 * repository too: one channel can collect reports from several forks, and
 * "which copy sent this" is the first thing you need to know.
 */
function runLink(): string | null {
  const server = process.env.GITHUB_SERVER_URL;
  const repository = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;

  if (!server || !repository || !runId) return null;

  const url = `${server}/${repository}/actions/runs/${runId}`;
  const run = process.env.GITHUB_RUN_NUMBER ?? runId;

  return `<a href="${escapeHtml(url)}">${escapeHtml(repository)} #${escapeHtml(run)}</a>`;
}

/**
 * The portal itself, under a short label — the raw URL is long enough to bury
 * everything around it. Taken from `attendance.json` so there is one address in
 * the project, the same one the run drives.
 */
const portalLink = `<a href="${escapeHtml(config.baseUrl)}">attendance-portal</a>`;

/**
 * The block that closes a report:
 *
 * ```text
 * links:
 * · attendance-portal
 * · owner/repo #87
 * ```
 *
 * One link per line rather than one crowded line — these are the two places a
 * reader goes next, and they should be two obvious taps. The portal is offered
 * only when the run got far enough to change something there; on a crash there
 * is nothing to look at, and the log is the only link worth following. A local
 * run has no log to link, so the block can end up holding one entry, or none at
 * all — and an empty block is left out rather than printed empty.
 */
function links(withPortal: boolean): string[] {
  const run = runLink();
  const entries = [...(withPortal ? [portalLink] : []), ...(run ? [run] : [])];

  return entries.length > 0 ? ['links:', ...entries.map(entry => `· ${entry}`)] : [];
}

/** One line per month, so a sweep across two months reads as two lines. */
function filledLines(filled: FilledMonth[]): string[] {
  return filled.map(group => {
    const days = group.days.map(day => escapeHtml(day)).join(', ');
    const name = formatMonth(group.month);

    return name ? `• <b>${escapeHtml(name)}</b>: ${days}` : `• ${days}`;
  });
}

/** One failure per line, trimmed to the part that says what went wrong. */
function errorLines(errors: string[]): string[] {
  const shown = errors.slice(0, MAX_LISTED_ERRORS).map(error => {
    const [firstLine = ''] = error.split('\n');
    const text =
      firstLine.length > MAX_ERROR_CHARS ? `${firstLine.slice(0, MAX_ERROR_CHARS)}…` : firstLine;

    return `• ${escapeHtml(text)}`;
  });

  const hidden = errors.length - shown.length;

  return hidden > 0 ? [...shown, `• …and ${hidden} more`] : shown;
}

/**
 * The report for a run that reached the end of the sweep.
 *
 * Three outcomes get three headlines, because the difference between "filled
 * everything", "filled most of it" and "there was nothing to fill" is the
 * whole reason to read the message.
 */
export function buildRunReport(result: AutomationResult): string {
  const failed = result.errors.length > 0;
  const lines: string[] = [];

  if (failed && result.successCount === 0) {
    lines.push('❌ <b>Attendance not filled</b>');
  } else if (failed) {
    lines.push('⚠️ <b>Attendance partly filled</b>');
  } else if (result.successCount > 0) {
    lines.push('✅ <b>Attendance filled</b>');
  } else {
    lines.push('✅ <b>Nothing to fill</b> — every day was already reported');
  }

  if (result.successCount > 0) {
    lines.push(`\nFilled ${days(result.successCount)}:`, ...filledLines(result.filled));
  }

  if (failed) {
    lines.push(`\nSkipped ${days(result.skippedCount)}:`, ...errorLines(result.errors));
  }

  lines.push(...links(true));

  return lines.join('\n');
}

/** The report for a run that died before it could finish the sweep. */
export function buildFailureReport(message: string): string {
  const [firstLine = ''] = message.split('\n');

  return [
    '❌ <b>Attendance run failed</b>',
    `\n<code>${escapeHtml(firstLine.slice(0, MAX_ERROR_CHARS * 2))}</code>\n`,
    ...links(false),
  ].join('\n');
}
