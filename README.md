# Attendance automation

Fills your unreported days on the
[Priority Connect portal](https://p.priority-connect.online/attendance/portal/PP001#/login) — every
Friday night, by itself, for free.

You do not need to be a programmer. Fork the project, paste in your portal login, press one button.
Twenty minutes once, and then you can forget about it.

## Set it up

All you need is a free [GitHub account](https://github.com) and your portal username and password.

**1. Make your own copy.** Open
[the project](https://github.com/artur-arc/attendance-automation) and click **Fork** → **Create fork**.
You now have it at `github.com/YOUR-NAME/attendance-automation`, and everything below happens there.

**2. Add your login.** In your copy: **Settings** → **Secrets and variables** → **Actions** →
**New repository secret**. Add these two, with the names spelled exactly like this:

| Name                        | Value                |
| :-------------------------- | :------------------- |
| `ATTENDANCE_LOGIN_USERNAME` | your portal username |
| `ATTENDANCE_LOGIN_PASSWORD` | your portal password |

Secrets are encrypted. They never land in a file or a log, and nobody can read them back afterwards —
not even whoever wrote this. Delete them and they are gone.

**3. Switch it on.** Open the **Actions** tab and click
**I understand my workflows, go ahead and enable them**. GitHub asks this of every fork.

**4. Try it.** Still in **Actions**: **Attendance Automation** → **Run workflow** → **Run workflow**.
Refresh after a minute. A green tick means your days are filled in; a red cross is covered in
[When something goes wrong](#when-something-goes-wrong).

That is the whole setup. It now runs every Friday at 00:30 Israel time and fills the week that just ended.

> If nobody touches your copy for 60 days, GitHub pauses the schedule and emails you about it. One
> **Run workflow** click brings it back.

## Your schedule

`src/attendance/attendance.json` is the only file worth editing, and the pencil icon on GitHub is enough
to do it.

```json
{
  "defaults": { "inTime": "09:00", "outTime": "18:00" },
  "schedule": {
    "sun": "home",
    "mon": "home",
    "tue": "home",
    "wed": "home",
    "thu": "home",
    "fri": "off",
    "sat": "off"
  }
}
```

Put your own hours in `inTime` and `outTime`, then give every weekday one of three words: **`home`** fills
the day, **`office`** fills it and adds an "office" remark, **`off`** leaves it alone. Mind the commas and
quotes — broken JSON stops the run instead of filling something wrong.

To move the weekly run, `dayOfWeek` in the same file counts from Sunday, so `5` is Friday. The new time
only reaches GitHub once someone runs `npm run sync-schedule` and pushes the result.

Friday is deliberate, by the way: the portal rejects an end-time that has not happened yet, so a Thursday
run would leave Thursday itself unreported.

## Reports in Telegram

Optional, and worth the five minutes: every run can post what it did to a Telegram channel — the days it
filled, the ones it could not, and a link to the log. Without it you check the **Actions** tab yourself;
with it, a run that fails at 00:30 on a Friday tells you so.

**1. Make a bot.** Write to [@BotFather](https://t.me/BotFather), send `/newbot`, answer his two
questions. He replies with a long token that looks like `123456789:AAE…`.

**2. Let the bot into your channel.** Channel → **Manage** → **Administrators** →
**Add Administrator** → search for the bot by the username BotFather gave it. Posting messages is the
only permission it needs.

**3. Find the channel's id.** Post any message in the channel, then open this in a browser, with your
own token in place of `<TOKEN>`:

```text
https://api.telegram.org/bot<TOKEN>/getUpdates
```

Look for `"chat":{"id":-100…` and copy that number, minus sign and all.

**4. Add them as secrets**, exactly like the login in step 2 of the setup:

| Name               | Value                                 |
| :----------------- | :------------------------------------ |
| `BOT_TOKEN`        | the token BotFather gave you          |
| `TELEGRAM_CHAT_ID` | the `-100…` number from the last step |

Both must be there. With one missing, the run just stays quiet.

From then on each run posts one message:

```text
⚠️ Attendance partly filled

Filled 10 days: 2, 3, 4, 5, 6, 9, 19, 20, 23, 24

Skipped 2 days:
• 30: stayed unreported — the portal accepted the entry and dropped it (month closed for reporting?)
• 25: locator.click: Timeout 30000ms exceeded.

5m 27s · run #42
```

`run #42` links to the full log. A run that dies before it can report anything — a broken portal, a
GitHub hiccup — sends a short "run failed" message instead, with the same link.

## When something goes wrong

Open the failed run under **Actions** — the link in the Telegram report goes straight there — and read
the last lines of the log.

| What you see                  | What it means                                                                                                        |
| :---------------------------- | :------------------------------------------------------------------------------------------------------------------- |
| It fails at login             | Wrong password, or the portal password changed and the secret did not. Overwrite the secret with the same name.      |
| `month closed for reporting?` | Payroll has closed that month, and the portal silently drops anything sent to it. Ask whoever can reopen the period. |
| Nothing filled, no error      | Nothing was pink. Every day was already reported.                                                                    |
| Anything about a selector     | The portal redesigned something and the tool no longer recognises it. Send the run's link to a developer.            |

## Running it yourself

Only if you want to press the button by hand. Needs [Node.js](https://nodejs.org) 20 or newer:

```bash
git clone https://github.com/artur-arc/attendance-automation
cd attendance-automation
npm install
npx playwright install chromium
cp env_example .env      # then put your login in .env
```

```bash
npm run attendance:dry   # prints what it would fill, saves nothing
npm run attendance       # the real thing
```

## Under the hood

The portal has some genuinely strange behaviour, and the code carries a fair amount of scar tissue because
of it. If you are curious or need to fix something: [docs/how-it-works.md](docs/how-it-works.md).
