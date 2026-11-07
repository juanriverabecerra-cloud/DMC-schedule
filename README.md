# DMC Anesthesia Schedule

A phone-first web app for DMC anesthesia residents that combines the three schedules we get:

1. **Annual rotations** (`.xlsx`, one sheet per class): what rotation everyone is on each month.
2. **Monthly call schedule** (`.xlsx`): daily codes and colors (H1, H2, NF, 10-7, late, cardiac call, vacation).
3. **Daily OR sheet** (photo from WhatsApp): room, surgeon, start time, MDA, JA and breaks.
4. **Didactics** (monthly conference-schedule PDF): Wednesday conference, Monday board review, Friday mock orals.

What it shows:

- **Today**: your assignment, OR details, who you're working with, the week, upcoming call, and estimated duty hours.
- **Tonight**: late resident, CA-3 10a–7p, the CA-1 on 11 to 9 (OB until 9p), night float, 24/12-hour call, cardiac call, JAs, OB and today's attendings, with call/text buttons.
- **Board**: who's where today, grouped by site and OR, with search and class filters.
- **Hours**: estimated weekly hours for everyone against ACGME limits (80 h/4-week average, 1 day off in 7, 24+4, rest between shifts).
- **Gaps**: missing late/NF/24-hr/12-hr/cardiac coverage, the call sheet's own "coverage needed" rows, and conflicts with the daily sheet.
- **Swap finder**: for any call shift, same-class residents who are free and would stay under the hour limits.
- **Fairness (Admin only)**: weighted burden points per shift (a Saturday 24 counts more than a Friday 24, a breaks day counts less than a regular day; every value is editable), each resident's share of the work against their class, a grade for how evenly it's shared, year-by-year comparison, a "Someone's out" tool, suggested swaps, service coverage against minimums typed in by an admin, and the year's rotation mix. Balances start over every July. It advises; people decide, and the call sheet stays the source of truth.
- **Someone's out**: the jeopardy resident always comes first. After that, coverage stays within the class, ranked by fewest warnings and then by who is furthest under their fair share. Anyone who would break an ACGME limit is left out, with the reason shown.
- **ACGME limits**: every resident checked against the anesthesiology requirements (sections 6.20 to 6.28): 80 hours averaged over 4 weeks, 14 hours off after 24-hour call, 1 day in 7 off, 24 + 4 continuous hours, and call at most every third night. These are estimates from the schedule, not logged hours.
- **Rate the shifts**: residents rate how heavy each shift feels (More › Rate the shifts). Ratings are stored apart from the schedule and only shown combined, to admins, once at least 3 people have rated a shift. An admin decides whether to use them as the points.
- **Calendar feed**: subscribe once in Apple or Google Calendar and every shift arrives with its OR details, room phone, MDA's number and who's on.
- **Didactics**: the month's conferences as an agenda, with "Next up", one-tap **Join Zoom** and **Dial in** (it dials, then enters the meeting ID and passcode), filters (Wednesday, Monday, mock orals, mine), objectives and the original PDF. On days with didactics, Today shows them right under "Who's on": the time block and room, each session with presenters and topics, mock-oral slots, the faculty member's call button, "Live now" / "In 20 min", what it's about, and Join Zoom, Dial in and the meeting ID and passcode to copy. Residents see their own presentations and mock-oral slots on their profile, with a heads-up when they're on vacation, post-call, coming off nights or at another site that day. Sessions go into the calendar feed with the Zoom link (mock orals only for the residents examined); each resident can leave didactics out of their feed.
- **Your real hours**: under More › Duty hours, choose the file from your New Innovations View Hours page, or paste the page. On an iPhone: sign in in Safari, tap Full Site, go to Work Hours › View Hours, tap Export To Excel, then Download, and pick the GridExport file in the app. The app compares your logged hours with the schedule by type of day, shows your real 4-week average and hours by rotation, and predicts the weeks ahead from your own averages. No password is involved, and the hours stay in your browser: they never reach the server, because everyone shares one passcode.
- **Call**: one-tap calling for residents, attendings (mobile and Cisco), OR rooms, units and service lines. Open it from the phone button at the top of every screen, or from More. Anesthesia techs change rooms daily, so every OR card has a Tech button that opens the whole list, with the tech you called that day on top. "Right now" lists who you're likely to need today (your room, your MDA, your JA, the board runners). Every OR card in the app has call chips for the room and its MDA. Pagers and hospital-only extensions copy to the clipboard.

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
   | `ANTHROPIC_API_KEY` | Optional. Turns on reading the daily photo and the monthly didactics PDF with Claude (`claude-opus-5-5`), roughly 5–15¢ each. Get it at console.anthropic.com and set a monthly spend limit. |
   | `CAL_SECRET` | Optional. Signs calendar links (defaults to `ADMIN_KEY`). Changing it breaks everyone's existing calendar links. |

3. **Deploys → Trigger deploy** so the functions pick up the variables.
4. Open the site, enter the passcode, then **More → Admin sign-in** with the admin key. Upload the annual rotations file and the monthly call file.

## Every day / every month

- **Daily**: the sheet is posted the evening before. Save the WhatsApp photo, then **Admin → Daily OR sheet → Read a photo**. You don't pick a date: the app files the sheet under the date printed on it, or tomorrow if no date can be read, and you can change it in the review screen. Check what Claude read and **Save**. Without an API key, use **Enter by hand**.
  - Resident names are always saved in the reference-list (roster) spelling: misspellings and initials are fixed on save, and the app tells you what it changed.
  - A role written in a name cell, such as "PAT" in the Breaks column, becomes that day's PAT resident: the name in the sheet's PAT box, or else whoever the call sheet has on PAT (including someone covering PAT). "AP" becomes the most senior resident on Acute Pain who isn't on a call shift that day.
  - Once tomorrow's sheet is in, everyone's Today screen shows a "Tomorrow" card with their room, start time and MDA.
- **Monthly**: upload the call schedule `.xlsx` when it's emailed. Re-uploading a month replaces it.
- **Monthly didactics**: **Admin → Didactics → Read a PDF** with the conference schedule. Claude reads the sessions, presenters, mock-oral slots and Zoom details (with `ANTHROPIC_API_KEY`); review and **Save**. Resident names are saved in roster spelling. Without the key the PDF is still attached and you can enter sessions by hand. In the editor, people are one per line: `Name | role | topic | 06:00-06:30` (roles: presenter, examinee, moderator, faculty, examiner).
- **Phone directory**: **Admin → Directory → Import .txt**, review, **Save**. Keep the file private; it is never part of this repository. Format:

  ```
  ## Dialing
  Ext 5xxxx = 313-745-xxxx
  ## Residents
  Last, First | Cisco 313-555-0100 | Pager 1234
  ## Resident mobiles
  Last, First | 248-555-0103
  ## Anesthesiologists — Harper
  Last, First | Cisco 313-555-0101 | Mobile 248-555-0102
  ## Harper OR rooms
  OR 15 | Ext 51234
  ```

  Label each number with what it is: **Cisco** (hospital Cisco phone), **Mobile** (personal cell; "Cell" also works), **Pager**, **Ext** or **Vocera**. In a section whose title says "mobile" or "Cisco", unlabeled numbers take that label, and listing someone again adds the numbers to what they already have. The app calls the mobile by default, then Cisco, and mobiles also get a text button. Calendar feeds show the work phone where there is one, so personal numbers stay off outside calendar services.

  "Residents" match the roster (a new name with "| PGY-1" is added), "Anesthesiologists …" sections are matched to the MDAs on the daily sheet (the site in the title breaks ties, e.g. Harper vs. Sinai-Grace), "Harper OR rooms" and "OPSC rooms" power the room buttons, and "Dialing" rules turn 5-digit extensions into numbers a cell phone can call.
- **Someone leaves the program**: **Admin → People → ✕** removes them (roster, call-sheet rows, rotations, phone numbers). Saving the directory also drops anyone who is no longer listed and has no schedule anywhere.
- **Past months**: upload older call sheets any time to fill in the fairness history, plus that year's rotations file, which says who was in each class that year (so visiting rotators aren't scored). Anyone on an older sheet but not the newest one stays in the history and off the roster.
- **Yearly**: upload the new rotations file in June.

## How the call sheet is read

| On the sheet | In the app |
|---|---|
| `H1` / blue weekday fill | 24-hour call, 6a–6a |
| `H2` | 12-hour call, 6a–6p |
| Green fill | Late resident: finish at your site, then Harper until 6p |
| `NF` | Night float, 6p–6a |
| `10-7` (Excel shows it as a date) | CA-3 senior 10a–7p |
| `11-9`, or a CA-1 on Obstetrics / `OB` | The "11 to 9" rotation: CA-1 OB at Hutzel, Monday to Friday 11a–9p |
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
- `netlify/functions/`: `api.mjs` (all API routes and `/cal/*.ics` feeds), `parse-photo-background.mjs` and `parse-didactics-background.mjs` (photo and PDF reading, up to 15 minutes each).
