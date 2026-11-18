# DMC Schedule: the iPhone app and its widgets

The app **is the website**. This folder is a thin native frame around it ([Capacitor](https://capacitorjs.com)), plus the two things a website can't do on an iPhone: home-screen and lock-screen **widgets**, and **alerts** through Apple's own service. Publishing the website updates everyone's app at once; only a change in this folder needs a new App Store build.

## How it fits together

| Piece | Where | What it does |
|---|---|---|
| The app | `ios/App/App` | A web view on `https://dmcschedule.netlify.app`, with an offline page (`www/offline.html`). |
| Bridge | `ios/App/App/WidgetBridgePlugin.swift`, `public/js/native.js` | The web app hands the widgets their feed, and opens the day a tapped widget was showing. |
| Widgets | `ios/App/ScheduleWidget`, `ios/ScheduleWidgets/Sources/Core` | Fetch one resident's feed and draw it. Small: the day in focus. Medium: plus room details or who's on, and the day after. Large: plus the week and what's ahead. Lock screen: rectangle, line and circle. |
| Feed | `lib/widget-feed.js` (server) | Writes every word the widgets show, and when a one-day widget should move on to tomorrow. The widgets hold no schedule logic, so wording and rules change without an app update. |
| Alerts | `lib/apns.js` (server) | Sends the same alerts the web app gets, through Apple. |
| Screen | `ios/App/App/ScreenPlugin.swift`, `public/core/screen.js` | Tells the page which parts of the screen the phone keeps (a folding iPhone's camera and clock). The tabs float in the outer screen's side strip, and on the inner screen the header moves up beside the clock. In a browser the same strip is found from the safe margins. |

The Xcode project is generated from `ios/App/project.yml`. After editing that file run `npm run project`.

## Everyday commands (run in `native/`)

```bash
npm install          # once
npm run snapshots    # draw every widget size to ios/ScheduleWidgets/.snapshots (no Xcode needed)
npm run local        # point the app at the dev server on this Mac (start it with `npm run dev` in the repo root)
npx cap sync ios     # point it back at the live site
```

Build and run in a simulator:

```bash
cd ios/App
xcodebuild -project App.xcodeproj -scheme App -destination 'platform=iOS Simulator,name=iPhone Duo' -derivedDataPath ../build build
xcrun simctl install booted "../build/Build/Products/Debug-iphonesimulator/DMC Schedule.app"
xcrun simctl launch booted app.netlify.dmcschedule
```

Or open `ios/App/App.xcodeproj` in Xcode and press Run.

## Getting it onto other people's phones

| Route | Cost | Widgets | Alerts | Who can install |
|---|---|---|---|---|
| The web app (Add to Home Screen) | Free | No | Yes | Anyone with the link and passcode, iPhone or Android |
| Apple Developer Program, unlisted App Store link | $99 a year | Yes | Yes | Anyone you send the link to |
| Same, under the university's account | Free if Wayne State/DMC has a fee waiver (accredited schools, nonprofits and government bodies can apply) | Yes | Yes | The same; the app is published by the institution |
| Free Apple ID in Xcode | Free | Yes | Not expected to work (Apple doesn't list what a free team can't do, so this is unconfirmed) | Only phones plugged into this Mac; the app stops opening after 7 days until it is reinstalled |
| Google Play | $25 once | (Android widgets not built) | Needs Firebase | Anyone with the link |
| Android free "limited distribution" account | Free | (not built) | Needs Firebase | Up to 20 named phones (Google's new program; check it is open before relying on it) |

## Before the first App Store build

These need the Apple Developer account, so they are the account owner's steps.

1. **Join the Apple Developer Program** ($99 a year).
2. **In Xcode**, open the project, select the **App** target and then the **ScheduleWidget** target, and choose your Team under Signing & Capabilities. Xcode registers the app, the widget and the shared group (`group.app.netlify.dmcschedule`) by itself. The bundle id is `app.netlify.dmcschedule`; change it in `project.yml` and `capacitor.config.json` first if you want another, because it can't change after the first upload.
3. **Alerts key**: in the developer site under Keys, make a key with Apple Push Notifications service enabled and download the `.p8` file (it downloads once). In Netlify add `APNS_KEY` (the file's whole text), `APNS_KEY_ID` (shown beside the key) and `APNS_TEAM_ID` (your team id). Until these are set, the app says alerts aren't set up yet; everything else works.
4. **Reviewer sign-in**: in Netlify add `DEMO_PASSCODE` (any phrase that isn't the real passcode). Signing in with it shows an invented program (`lib/demo.js`), never the real schedule. Put that passcode in App Store Connect under App Review Information.
5. **Archive and upload**: in Xcode choose Any iOS Device, then Product › Archive, then Distribute App › App Store Connect. Raise `CURRENT_PROJECT_VERSION` in `project.yml` for each upload.
6. **In App Store Connect**: this app is for one residency program, so ask for **unlisted distribution** (a link only people you send it to can use) rather than a public listing. Privacy answers: the app collects no data for tracking; sign-in is a shared passcode.

Worth deciding before submitting: the name uses "DMC". Apple can ask for proof that you may use an organization's name, so either have the program's written OK ready or pick a neutral name.

## Android

Not built yet. The same frame works on Android (`npx cap add android`), but this Mac has no Android tools, and alerts there need a Firebase project. Until then, Android phones can keep using the web app from Chrome, where alerts already work.

## What has been tried, and what hasn't

Tried in the iPhone Duo simulator against the local server: signing in hands the widgets their feed; every home-screen and lock-screen size shows the real schedule with nothing cut off; tapping a widget opens its day; the outer screen upright and both ways sideways; the inner screen upright and sideways.

Not tried: anything on a real phone, alerts through Apple, and folding or unfolding with the app open (the simulator offers no way to fold; powering a screen off with `simctl io … screenConfig` crashes the simulated phone's home screen, so don't).
