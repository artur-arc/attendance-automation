import { logger } from './logger';

interface Credentials {
  username: string;
  password: string;
}

/**
 * Portal credentials from the environment.
 *
 * Exits instead of returning half-filled values: a run missing either half is a
 * configuration mistake, and saying so here beats failing at the login form
 * several seconds into a browser session.
 */
export function requireCredentials(): Credentials {
  const username = process.env.ATTENDANCE_LOGIN_USERNAME;
  const password = process.env.ATTENDANCE_LOGIN_PASSWORD;

  if (!username || !password) {
    logger.error('Missing ATTENDANCE_LOGIN_USERNAME or ATTENDANCE_LOGIN_PASSWORD in .env');
    process.exit(1);
  }

  return { username, password };
}
