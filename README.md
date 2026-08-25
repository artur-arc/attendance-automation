# Attendance automation

Fills your unreported days on the
[Priority Connect portal](https://p.priority-connect.online/attendance/portal/PP001#/login) — every
Friday night, by itself, for free.

You do not need to be a programmer. Fork the project, paste in your portal login, press one button.
Twenty minutes once, and then you can forget about it. Rather keep it off GitHub and press the button
yourself? [On your own computer](#on-your-own-computer) is the same thing on your own machine.

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

The same file holds three more settings you can leave exactly as they are: `baseUrl` is the portal's
address, `sweepMonthsBack` is how many finished months to go back over (`1` also sweeps last month, which
is what catches days lost when the month rolled over), and `automation` is when the weekly run happens.

Friday is deliberate, by the way: the portal rejects an end-time that has not happened yet, so a Thursday
run would leave Thursday itself unreported.

### Moving the weekly run

This is the one change that is not a single pencil edit, because GitHub's scheduler reads UTC and knows
nothing about `attendance.json`. Two places have to agree:

1. `automation` in `src/attendance/attendance.json` — `time`, `timezone`, and `dayOfWeek` counting from
   Sunday, so `5` is Friday.
2. the `cron:` line at the top of `.github/workflows/attendance.yml`, which is what actually starts the
   run: `'30 21 * * 4'` reads as minute, hour, any day, any month, weekday — all in UTC. Israel is three
   hours ahead of UTC in summer and two in winter, which is why Friday 00:30 local is written as Thursday
   21:30.

With the project on your computer, `npm run sync-schedule` writes the second one from the first and you
push the result. Getting the time wrong cannot fill anything wrong — the worst case is a run too early in
the week, leaving the last day or two unreported until the next one. The `cron:` line is fixed UTC and does
not know about summer time either, so twice a year the run drifts by an hour. At half past midnight on a
Friday night, nobody notices.

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

Look for `"chat":{"id":-100…` next to your channel's title, and copy that number, minus sign and all. If
the channel is not there at all, the bot is not an admin of it yet — redo step 2, post another message, and
reload the page.

**4. Add them as secrets**, exactly like the login in step 2 of the setup:

| Name               | Value                                 |
| :----------------- | :------------------------------------ |
| `BOT_TOKEN`        | the token BotFather gave you          |
| `TELEGRAM_CHAT_ID` | the `-100…` number from the last step |

Both must be there. With one missing, the run just stays quiet.

From then on each run posts one message:

```text
⚠️ Attendance partly filled

Filled 11 days:
• July 2026: 29
• August 2026: 2, 3, 4, 5, 6, 9, 19, 20, 23, 24

Skipped 2 days:
• 30 July 2026: stayed unreported — the portal accepted the entry and dropped it (month closed for reporting?)
• 25 August 2026: locator.click: Timeout 30000ms exceeded.
links:
· attendance-portal
· your-name/attendance-automation #42
```

`attendance-portal` opens the portal, so you can check the filled days yourself. The line under it opens
the full log, and names the copy of the project that sent the report — one channel can collect reports
from several forks. A run that dies before it can report anything — a broken portal, a GitHub hiccup —
sends a short "run failed" message instead, with the log link and nothing else.

## When something goes wrong

Open the failed run under **Actions** — the link in the Telegram report goes straight there — and read
the last lines of the log.

| What you see                  | What it means                                                                                                               |
| :---------------------------- | :-------------------------------------------------------------------------------------------------------------------------- |
| It fails at login             | Wrong password, or the portal password changed and the secret did not. Overwrite the secret with the same name.             |
| `month closed for reporting?` | Payroll has closed that month, and the portal silently drops anything sent to it. Ask whoever can reopen the period.        |
| Nothing filled, no error      | Nothing was pink. Every day was already reported.                                                                           |
| Anything about a selector     | The portal redesigned something and the tool no longer recognises it. Send the run's link to a developer.                   |
| No Telegram message at all    | One of the two secrets is missing or misspelled, or the bot is not an admin of the channel. The log's last lines say which. |

## On your own computer

Everything above needs nothing installed. This is the other way: the same code on your own machine, run
when you press it. Useful for filling days right now instead of waiting for Friday, or for trying a
schedule change before it runs for real.

**1. Install [Node.js](https://nodejs.org)** — the big LTS button on that page. Version 20 or newer.

**2. Get the code.** On the project page: **Code** → **Download ZIP**, then unpack it. (With git
installed, `git clone https://github.com/artur-arc/attendance-automation` instead.)

**3. Open a terminal in that folder** and run these three, once:

```bash
npm install                      # everything the project needs
npx playwright install chromium  # the browser it drives
cp .env.example .env             # your own copy of the settings file
```

On Windows the last one is `copy .env.example .env`.

**4. Put your details in `.env`.** Any text editor will do. The two logins are required; the two Telegram
lines are optional and mean exactly what the secrets above mean — leave them empty and nothing is sent.

```text
ATTENDANCE_LOGIN_USERNAME=your.name
ATTENDANCE_LOGIN_PASSWORD=your-password
BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

That file stays on your machine. Git is told to ignore it, so it cannot be pushed anywhere by accident.

**5. Run it.**

```bash
npm run attendance:dry    # prints what it would fill, saves nothing
npm run attendance        # the real thing
npm run telegram:chat-id  # prints the channel ids your bot can see
```

A browser window opens and drives itself — that is normal, and closing it stops the run. Start with the dry
run: it walks the exact same path as the real one and writes nothing, which makes it the safe way to check
a schedule change.

## Under the hood

The portal has some genuinely strange behaviour, and the code carries a fair amount of scar tissue because
of it. If you are curious or need to fix something: [docs/how-it-works.md](docs/how-it-works.md).
