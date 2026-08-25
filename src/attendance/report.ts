/**
 * The run report, as Telegram sees it.
 *
 * Formatting lives apart from delivery so the wording can change without
 * touching the HTTP call, and so the shape of a report is readable in one
 * place — it is the only thing most people will ever see of a run.
 */
import { escapeHtml } from '../utils';
import { AutomationResult } from './types';

/** Past this many, a failure list stops informing and starts burying. */
const MAX_LISTED_ERRORS = 10;

/** Playwright errors carry a multi-line call log; the first line is the fact. */
const MAX_ERROR_CHARS = 180;

interface RunMeta {
  /** Wall-clock time of the whole run, for the footer. */
  durationMs: number;
}

/** `1 day` / `4 days` — a count is read too often to render it as `day(s)`. */
function days(count: number): string {
  return `${count} ${count === 1 ? 'day' : 'days'}`;
}

/** `5m 27s`, or `47s` for anything under a minute. */
function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);

  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

/**
 * A link back to the GitHub Actions run, or `null` when running locally.
 *
 * The point of the link is that a report about a failure is one tap away from
 * the log that explains it.
 */
function runLink(): string | null {
  const server = process.env.GITHUB_SERVER_URL;
  const repository = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;

  if (!server || !repository || !runId) return null;

  const url = `${server}/${repository}/actions/runs/${runId}`;
  const label = process.env.GITHUB_RUN_NUMBER ?? runId;

  return `<a href="${escapeHtml(url)}">run #${escapeHtml(label)}</a>`;
}

function footer(meta: RunMeta): string {
  const link = runLink();

  return `\n<i>${formatDuration(meta.durationMs)}${link ? ` · ${link}` : ' · local run'}</i>`;
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
export function buildRunReport(result: AutomationResult, meta: RunMeta): string {
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
    const filled = result.filled.map(day => escapeHtml(day)).join(', ');
    lines.push(`\nFilled ${days(result.successCount)}: ${filled}`);
  }

  if (failed) {
    lines.push(`\nSkipped ${days(result.skippedCount)}:`, ...errorLines(result.errors));
  }

  lines.push(footer(meta));

  return lines.join('\n');
}

/** The report for a run that died before it could finish the sweep. */
export function buildFailureReport(message: string, meta: RunMeta): string {
  const [firstLine = ''] = message.split('\n');

  return [
    '❌ <b>Attendance run failed</b>',
    `\n<code>${escapeHtml(firstLine.slice(0, MAX_ERROR_CHARS * 2))}</code>`,
    footer(meta),
  ].join('\n');
}
