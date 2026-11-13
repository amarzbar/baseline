# Baseline: design brief for a redesign

## The product in one paragraph

Baseline is a self-control tool for one person's iPhone. It locks the phone, for 90 days or
more, to a chosen set of apps (banking, Wallet, Health, work, messaging) and filters the web
through DNS (NextDNS), so social media and endless scrolling are out of reach. The lock really
can't be undone early: the profile's removal password is encrypted with tlock to a future round
of drand's public randomness beacon, so nobody can read it before the date, not even the owner.
A calm status app on the phone shows the lock's progress and what the person did with the time
they got back. The point is to build better habits, not to punish.

## Who it's for and the feeling

- One person, using it on themselves. They're technical, but the design shouldn't feel technical.
- Feeling: calm, steady, quietly encouraging. "A quiet place you check once a day", not a game.
  More like a meditation or journaling app than a productivity dashboard.
- Anti-goals: no feed, no streak anxiety, no notifications that pull you back in, no gamified
  badges or confetti, nothing that rewards screen time. Never preachy or guilt-tripping.
- Faith-friendly: the owner is Muslim, and a "worship" tag sits naturally beside "read" and
  "outside". Keep that sensibility (modest, not flashy), without religious decoration.

## Two surfaces to design

1. **Status app (iPhone PWA)**: runs full screen from the home screen. iPhone 15 size,
   390 × 844 pt. **Always dark.**
2. **Baseline for Mac (desktop app)**: an Electron app used for setup and sealing. It should
   feel like a native macOS app (System Settings, Finder), not a web page. Follows the system's
   light or dark mode. Window about 920 × 860.

Same brand across both: near-black green, a green accent, a warm gold detail.

---

## 1. Status app (iPhone)

Bottom tab bar with three tabs: **Today**, **Journal**, **Lock**. A floating **+** button
(add a moment) appears on Today and Journal. A sign-in screen shows once per device.

### Today

States:

- **Sealed (the main one).** Small label "DAY 40 OF 90". Big title "Unlocks January 2". Subline
  "51 days to go · sealed Oct 4". Centrepiece: a ring showing progress through the term, with
  "52h / GIVEN BACK" in the middle (falls back to the day count before any screen time is
  logged). A row of three stats: daily screen time "1h 38m, a day · was 3h 20m", steps "365k",
  moments "4". A **Milestones** card: segments for 1 wk / 30 d / 60 d / 90 d, filled when
  reached. A **This week you** card with a sentence: "walked 67k steps, trained 3 times and wrote
  down 3 moments worth keeping." When there's nothing yet: "have a blank page. Go outside, call
  someone, make something, then tap + to keep it."
- **Sunday check-in** card, shown when the week's screen time hasn't been logged:
  "Log this week's screen time →". Otherwise a quiet "Log screen time" link.
- **Trial** (before sealing): "Trial · day 3 of 7", "Trying it on", "Seal by Thursday,
  November 19 to start your 90 days." Ring shows trial days. A card explaining that you should
  use the phone normally and fix anything that breaks before sealing.
- **Trial ended**, **Sealing…**, **No lock yet** ("Begin when you're ready").
- **Unlocked**: "Day 90 of 90", "You made it", pointing to the password in the Lock tab.

### Journal

A timeline of "moments", newest first, grouped by day: "TODAY · DAY 40", "MONDAY, NOV 9 ·
DAY 37". Each moment: title, time and a short note, tag chips (🌿 outside, 📖 read, 🤍 family,
🏃 moved, 🕌 worship, 🛠 made something), and an optional photo. A reached milestone appears in
the timeline as a small card ("30 days · a milestone"). Header shows "4 moments". Empty state:
"Nothing here yet. The time you take back goes somewhere. Tap + when it goes somewhere good."
Tapping a moment reveals "Delete this moment".

### Lock

- Status pill top right: Trial / Locked / Open / Finished.
- A details card: Length 90 days, Sealed, Unlocks (date and time), Phone, Profile seen, drand
  round "#36,449,129".
- **Removal password** card. While locked: "Sealed with tlock to drand round #…, along with the
  password for NextDNS. Nobody, not this server and not you, can read them before January 2."
  On unlock day: an "Open the time-lock" button, then the password(s) shown in a mono,
  select-all box, with how to remove the profile in Settings.
- **Kept apps · 12** (expandable list of app names).
- **Filtering**: "NextDNS, locked on · web filter off" (or the blocked/allowed sites as chips).
- **Steps & workouts from Health** (expandable): how to set up the iOS Shortcut, with the URL.
- **What this can't stop** (expandable): recovery-mode restore; the Mac's supervision identity;
  changing NextDNS from another device.

### Sheets (bottom sheets)

- **A moment worth keeping**: "What did you do?" field, optional note, tag chips, "Add a
  photo" drop area (or the chosen photo), "Keep it" button.
- **This week's screen time**: hint "Settings → Screen Time → See All Activity. Type in the
  daily average", This week / Last week toggle, hours and minutes fields, Save.

### Sign in

Shown once: "Baseline", "Welcome back", "Paste your Baseline token once. This phone stays signed
in.", a password field, Sign in.

### Hard constraints (iPhone)

- **The page must always scroll** with a normal swipe and iOS bounce. Don't design a fixed frame
  with an inner scroll area. The body is at least one pixel taller than the screen. Sheets cap
  at ~90% height and scroll inside.
- **No zoom**: text fields use at least 16px text so iOS doesn't zoom when one is tapped.
- Runs full screen with a translucent status bar: respect the top safe area (and Dynamic
  Island) and the bottom home indicator. The tab bar sits on the bottom safe area.
- Blocked sites aren't reachable, so no external fonts other than the current Google Font, and
  no outside links that matter.
- Data is small: one lock at a time, a few dozen moments.

---

## 2. Baseline for Mac

Layout: a translucent **sidebar** (macOS vibrancy) on the left, a content pane on the right, a
title bar you can drag with the traffic lights inset, and a **footer bar** with Back / Continue
during setup.

Sidebar, top to bottom:
- "Your lock" item (when a lock exists).
- "Set up" / "Trial settings" / "Settings (sealed)" section with the five steps, always visible:
  **Phone, Apps, Blocking, Time, Review**. Each has a number that becomes a ✓ when done. You can
  click back to earlier steps; while sealed they're greyed out.
- Bottom: phone status with a dot ("● iPhone", green when connected and supervised, orange if
  not supervised, grey "Looking for your iPhone…") and the server address.

Content per step (each has a title and a one-line explanation):

1. **Connect your iPhone**: "Plug it into this Mac with a cable, unlock it, and tap Trust if it
   asks." A card showing the phone name, iOS version and a "Supervised ✓" badge (or "Not
   supervised" warning). It notices the phone being plugged in by itself.
2. **Which apps stay?**: "Ticked apps keep working and updating. Everything else won't open
   until the lock ends." The phone's apps in two columns: checkbox, icon, name, "suggested" hint,
   with a Filter field and a count ("6 of 11 kept"). Folded sections: **Apple's apps · 25 of 29
   kept** and **Add an app you haven't installed yet** (App Store search with results).
3. **How is the internet filtered?**: a field for the NextDNS profile ID or any DNS-over-HTTPS
   address, a **Test it** button and result chips ("instagram.com blocked", "whatsapp.net
   loads"). Then **Web filter**, a radio group: Off (recommended) / Block these sites / Only allow
   these sites, with a site-chip editor for the last two.
4. **How long?**: lock for N days (90 minimum), trial for 1–7 days, current screen time per
   day (h / m).
5. **Ready to try it?**: a summary list with Edit links (Apps that stay, DNS filter, Web filter,
   Lock, Trial, Screen time now), then **Start the trial** (or **Update the trial**).

**Your lock** (status page), by state:
- Trial: "Trying it until November 19, 2026 at 9:17 p.m.", whether the profile is on the phone,
  buttons **Seal for 90 days…**, **Change the trial**, **End the trial**.
- Locked: "Until January 2, 2027", the drand round, "nothing to change until then".
- Open: "The lock has opened", **Remove the profile**.

**Progress line**: during slow phone actions (they take 5–60 seconds): spinner, a sentence like
"Putting the profile on your phone. Keep it unlocked and plugged in; this can take a minute.",
and a seconds counter. A macOS notification when it finishes or fails.

**Seal dialog** (modal, two parts):
1. "Lock the accounts that could undo this": explanation, a list of accounts (e.g. "NextDNS",
   "NextDNS email") each with "Copy again" / "It's changed" or "Locked ✓", a name field and a
   **Make & copy password** button. Passwords are never shown, only copied to the clipboard.
   Buttons: Not yet / Continue (or Skip, no accounts).
2. "Seal for 90 days?": the unlock date, "No exceptions and no early unlock.", what's
   time-locked, a field to type **SEAL**, then **Seal it**.
   If backing out after changing passwords: "Not sealed", with the passwords shown so you aren't
   locked out.

### Constraints (Mac)

- Native feel: the system font at 13px base, small push buttons, inset grouped boxes like System
  Settings, a vibrancy sidebar, light and dark modes.
- One primary action per screen; never overwhelm. This was a specific request.
- The SEAL confirmation is deliberately weighty: it's irreversible for 90 days.

---

## Current design system (free to change)

- **Type:** Outfit (Google Font) on the phone, light weights (200–300 for big numbers and
  titles); small tracked uppercase labels ("DAY 40 OF 90"). Mac uses the system font.
- **Phone colours (dark):** background #0E1411 with a radial wash from #17241D at the top;
  text #F2EDE8; muted text #8C877F; primary green #26A870 (lighter #3FC58C for tints); gold
  accent #C49A3A; cards as translucent white (5%) with blur; border #26302A; red #EF4444.
- **Mac:** accent #1C7A52 light / #30B07A dark; window #F5F5F7 / #1E1E1E; groups #FFF / #2A2A2A.
- **Shapes:** cards 22px radius on the phone, 10px on the Mac; pills for tags; a thin 3px
  progress ring.
- **Icon:** a green half-sun resting on a gold horizontal line ("the baseline") inside a thin
  dark-green circle, with three fading reflection lines below, on near-black green. Geometric,
  dark. Keep the idea; refine freely.
- **Inspiration:** the owner's other app, Salik (an Islamic daily-practice tracker): warm, airy,
  uppercase labels, rings, bottom tabs. Baseline is its darker, calmer sibling.

## Copy voice

Plain, warm, short. Second person. Says what happened and what to do next. Examples in use:
"Keep it", "A moment worth keeping", "Given back", "Begin when you're ready", "See you on the
other side". Avoid jargon ("drand", "tlock") except in the one place that explains the lock.

## What to design

1. iPhone: Today (sealed, trial, unlocked, empty), Journal (with photos, empty), Lock (locked,
   unlock day with passwords shown), both sheets, Sign in.
2. Mac: the five setup steps, Your lock (trial, locked, open), the progress line, the two-part
   Seal dialog.
3. The app icon, refined.

Screenshots of the current version are in `docs/screenshots/` (made-up data).
