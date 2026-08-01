import { Page } from '@playwright/test';
import { BasePage } from '../../core/BasePage';
import { logger } from '../../utils';

/**
 *
 */
export class LoginPage extends BasePage {
  private readonly usernameInput = 'input.user-name';
  private readonly passwordInput = 'input.password';
  private readonly loginButton = 'button:has-text("כניסה")';

  /**
   *
   */
  constructor(page: Page) {
    super(page);
  }

  /**
   *
   */
  async login(username: string, password: string): Promise<void> {
    await this.page.fill(this.usernameInput, username);
    await this.page.fill(this.passwordInput, password);
    await this.page.click(this.loginButton);

    // Wait for the login to complete (it usually goes to #/portal first)
    await this.page.waitForURL(/attendance\/portal\/PP001#\/portal/);

    // Force redirect to #/attendance where the calendar is
    logger.log('--- Redirecting to attendance calendar...');
    await this.page.goto('https://p.priority-connect.online/attendance/portal/PP001#/attendance');
    await this.page.waitForURL(/attendance\/portal\/PP001#\/attendance/);
  }
}
