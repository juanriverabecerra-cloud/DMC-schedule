# DMC Anesthesia Schedule

A phone-first web app for DMC anesthesia residents that combines the three schedules we get:

1. **Annual rotations** (`.xlsx`, one sheet per class): what rotation everyone is on each month.
2. **Monthly call schedule** (`.xlsx`): daily codes and colors (H1, H2, NF, 10-7, late, cardiac call, vacation).
3. **Daily OR sheet** (photo from WhatsApp): room, surgeon, start time, MDA, JA and breaks.

What it shows:

- **Today**: your assignment, OR details, who you're working with, the week, upcoming call, and estimated duty hours.
- **Tonight**: late resident, CA-3 10a–7p, night float, 24/12-hour call, cardiac call, JAs, OB and today's attendings, with call/text buttons.
- **Board**: who's where today, grouped by site and OR, with search and class filters.
- **Hours**: estimated weekly hours for everyone against ACGME limits (80 h/4-week average, 1 day off in 7, 24+4, rest between shifts).
- **Gaps**: missing late/NF/24-hr/12-hr/cardiac coverage, the call sheet's own "coverage needed" rows, and conflicts with the daily sheet.
- **Swap finder**: for any call shift, same-class residents who are free and would stay under the hour limits.
- **Calendar feed**: subscribe once in Apple or Google Calendar and every shift arrives with its OR details and who's on.

It installs to the home screen ("Add to Home Screen") and works offline with the last-loaded schedule.

## Privacy

No schedule data lives in this repository. Uploads are stored in Netlify Blobs and served only to people with the passcode. Calendar feeds use a per-resident secret link. Spreadsheets, photos and backups are git-ignored.

## Deploy on Netlify (one time)

1. In Netlify: **Add new site → Import an existing project → GitHub →** pick this repository. The settings come from `netlify.toml` (no build command, publish `public`). Deploy.
2. **Site configuration → Environment variables**, add:

   | Variable | What it's for |
   |---|---|
   | `APP_PASSCODE` | Shared passcode residents type once on their phone. |
   | `ADMIN_KEY` | Long random string for uploads and edits; keep it to yourself. Generate one with `openssl rand -base64 24`. |
   | `ANTHROPIC_API_KEY` | Optional. Turns on reading the daily photo with Claude (`claude-opus-5-5`), roughly 5–15¢ per photo. Get it at console.anthropic.com and set a monthly spend limit. |
   | `CAL_SECRET` | Optional. Signs calendar links (defaults to `ADMIN_KEY`). Changing it breaks everyone's existing calendar links. |

3. **Deploys → Trigger deploy** so the functions pick up the variables.
4. Open the site, enter the passcode, then **More → Admin sign-in** with the admin key. Upload the annual rotations file and the monthly call file.

## Every day / every month

- **Daily**: the sheet is posted the evening before. Save the WhatsApp photo, then **Admin → Daily OR sheet → Read a photo**. You don't pick a date: the app files the sheet under the date printed on it, or tomorrow if no date can be read, and you can change it in the review screen. Check what Claude read and **Save**. Without an API key, use **Enter by hand**.
  - Resident names are always saved in the reference-list (roster) spelling: misspellings and initials are fixed on save, and the app tells you what it changed.
  - A role written in a name cell, such as "PAT" in the Breaks column, becomes that day's PAT resident: the name in the sheet's PAT box, or else whoever the call sheet has on PAT (including someone covering PAT).
  - Once tomorrow's sheet is in, everyone's Today screen shows a "Tomorrow" card with their room, start time and MDA.
- **Monthly**: upload the call schedule `.xlsx` when it's emailed. Re-uploading a month replaces it.
- **Yearly**: upload the new rotations file in June.

## How the call sheet is read

| On the sheet | In the app |
|---|---|
| `H1` / blue weekday fill | 24-hour call, 6a–6a |
| `H2` | 12-hour call, 6a–6p |
| Green fill | Late resident: finish at your site, then Harper until 6p |
| `NF` | Night float, 6p–6a |
| `10-7` (Excel shows it as a date) | CA-3 senior 10a–7p |
| Magenta week | Cardiac call (home call, not counted in hours) |
| `Vac` / peach block | Vacation; a peach day for everyone is a holiday (CRNA coverage) |
| `PC` | Post-call day off |
| Bold / red text | Shown as "Covering" / "Changed" |
| `X` in an OR | CRNA room |

Regular-day hours (default 6a–5p) and the staffing rules behind the gap checks are editable in **Admin → Settings**.

## Local development

```bash
npm install
npm run dev     # http://localhost:8888 with passcode "dev" and admin key "devadmin"
npm test
npm run icons   # regenerate the app icons
```

`npm run dev` serves `public/` and runs the same functions as Netlify, storing data in `.localdata/`.

## Layout

- `public/`: the app (no build step). `public/core/` holds the schedule logic shared with the server: day resolution, hours, gaps, swaps and the iCalendar feed.
- `lib/`: server-only code: the `.xlsx` reader, parsers, storage, auth and the photo reader.
- `netlify/functions/`: `api.mjs` (all API routes and `/cal/*.ics` feeds) and `parse-photo-background.mjs` (photo reading, up to 15 minutes).
