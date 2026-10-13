# Client Greetings — birthday & festival emails

Sends birthday and festival wishes to your clients automatically from your own Gmail, using a Google Sheet as the client list. Free, no server needed: it runs on Google's computers every morning.

**See what clients receive:** open [`email-preview.html`](email-preview.html).

## What it does

- Every day at the hour you choose (default 9 AM India time) it checks the sheet.
- **Birthdays:** any client whose birthday is today gets a personal birthday email.
- **Festivals:** on Diwali, Holi, Christmas, New Year etc., every client gets that festival's email.
- Each email is personal ("Dear Mr. Sharma, …"), with a coloured header, your company name and signature.
- Everything is written to a **Log** sheet. If it runs twice on the same day, nobody gets a duplicate.
- **Safe start:** it begins in `DRAFT` mode, which only creates Gmail drafts for you to check. Switch to `SEND` once you're happy.

## Setup (about 10 minutes, one time)

1. Go to **sheets.google.com** while signed in to the Gmail account you want to send from, and create a blank sheet. Name it e.g. *Client Greetings*.
2. Check the time zone: **File → Settings → Time zone** should be *(GMT+05:30) India Standard Time*.
3. Open **Extensions → Apps Script**.
4. Delete everything in the editor, paste the entire contents of [`Code.gs`](Code.gs), and click **💾 Save**.
5. Go back to the sheet and **reload the page**. A new menu **🎉 Greetings** appears at the top (it can take ~10 seconds).
6. Click **🎉 Greetings → 1. Set up sheets (first time only)**.
   - Google asks for permission the first time: click **Continue → choose your account → Advanced → Go to (project name) → Allow**. This is your own script asking to use your own Gmail and sheet; the "unverified app" warning is normal for personal scripts.
7. Four tabs are created: **Clients, Occasions, Settings, Log**. Fill them in (see below).
8. Click **🎉 Greetings → Send test email to me**. You'll get one sample email per occasion in your inbox. Check how they look.
9. Click **🎉 Greetings → Turn ON daily automatic sending**. Done.

## The sheets

### Clients
| Column | Example | Notes |
|---|---|---|
| Name | Rajesh Sharma | Full name |
| Greet As | Mr. Sharma | How the email starts: "Dear Mr. Sharma". Blank = first name ("Dear Rajesh") |
| Email | rajesh@sharma.com | Several addresses allowed, separated by commas |
| Company | Sharma Industries | Optional |
| Birthday | 15/08/1980 | **dd/mm/yyyy**. Year optional (15/08 works). Also accepts 15 Aug 1980 |
| Birthday Wishes | Yes | `No` to skip this client's birthday. Blank = Yes |
| Festival Wishes | Yes | `No` to skip festival emails for this client. Blank = Yes |
| Notes | | For you only |

### Occasions
One row per occasion. The **Birthday** row is the birthday message (its Date stays blank).

| Column | Notes |
|---|---|
| Occasion | Birthday, Diwali, Holi, Eid, Christmas, New Year … add any you like (Independence Day, Pongal, Onam, Ganesh Chaturthi …) |
| Date | dd/mm/yyyy |
| Every Year | `Yes` for fixed-date days (Christmas 25/12, New Year 01/01) so they repeat every year. `No` for festivals whose date changes (Diwali, Holi, Eid): **update the date each year** |
| Subject / Message | Email subject and text. You can use the placeholders below |
| Image URL | Optional link to a greeting-card image (e.g. a Canva design shared as a public image link). It's shown under the header |
| Active | `No` to switch an occasion off |

**Placeholders** you can use in Subject and Message:
`{GreetAs}` (Mr. Sharma), `{Name}` (Rajesh Sharma), `{FirstName}` (Rajesh), `{Company}` (client's company), `{YourCompany}` (Desire Chemicals), `{Occasion}`, `{Year}`.

> ⚠️ Festival dates that move every year come pre-filled for the next occurrence: **Diwali 08/11/2026** and **Holi 22/03/2027**. Please double-check them against your calendar. **Eid** is included but switched off (Active = No) because its date depends on the moon. Fill in the date when it's announced and set Active to Yes.

### Settings
| Setting | Meaning |
|---|---|
| Mode | `DRAFT` (default): creates Gmail drafts for you to review and send. `SEND`: emails clients automatically. `TEST`: sends every greeting to *Test Email* instead of clients |
| Your Company Name | Used for `{YourCompany}` |
| Sender Name | Name shown in the client's inbox "From" |
| Signature | Added to the end of every email |
| Test Email | Where test emails go. Blank = your own Gmail |
| Daily Summary To | Optional: get a short "who was wished today" email |
| Send Hour | 0–23. After changing it, click *Turn ON daily automatic sending* again |
| Reply To | Optional reply-to address |

### Log
Every greeting, with status `SENT`, `DRAFTED`, `TEST`, `SKIPPED` (already sent today), `NO QUOTA` or `ERROR`.

## Menu

| Menu item | What it does |
|---|---|
| Preview today's greetings | Lists who would be wished today. Sends nothing |
| Preview another date… | Same for any date, e.g. type 08/11/2026 to see the Diwali list |
| Send test email to me | One sample per occasion to your Test Email |
| Send today's greetings now | Runs today's job immediately (asks first) |
| Turn ON / OFF daily automatic sending | Starts/stops the daily schedule |

## Limits

Gmail lets scripts email about **100 recipients/day on a free @gmail.com** account and **1,500/day on Google Workspace** (business email). Birthdays are a few a day, so no problem. On a festival day, if you have more clients than the limit, the extra ones are logged as `NO QUOTA`. In that case either use a Workspace account or send that festival in DRAFT mode.
