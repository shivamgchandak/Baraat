# Baraat — Video Script

A spoken script in four sections: intro, then the three parts (setup, demonstration, architecture & decisions). Lines are written to be read aloud naturally — adjust wording to sound like you.

---

## 0. Intro (short)

Hi, I'm Shivam.

For this assignment I built **Baraat** — an automated ride-dispatch system for a private event, like a wedding. You register a fleet of drivers and a list of guests, and the system automatically decides which driver picks up which guest, based on where everyone is, when they need to move, how many seats and bags each car has, and live traffic. It's a bit like Uber — except nobody picks a driver, the system matches everyone for you across one scheduled, multi-stop event.

This video is in **three parts**: first the **setup** — how to run it; then a live **demonstration**; and finally the **architecture** — the tech I used across the backend, portal, and app, and the decisions and trade-offs behind them.

---

## 1. Setup

*(You're driving this part — the two things worth explaining out loud are why pnpm, and why the app runs as separate commands.)*

**Why pnpm instead of npm.**
Baraat is a **monorepo** — the backend, the matching engine, the web portal, the mobile app, and a few shared packages all live in one repository. pnpm has first-class support for that through workspaces, so my shared packages — like the shared types, the database layer, and the maps helper — are linked across the apps automatically, without me having to publish anything. On top of that, pnpm is faster and much more disk-efficient than npm: it keeps one content-addressable store and hard-links packages instead of copying a full `node_modules` into every project. And it's stricter about dependencies, so you can't accidentally rely on a package you didn't declare. For a monorepo like this, that combination is exactly what you want.

**Why I run separate commands — `pnpm api`, `pnpm dispatch`, `pnpm portal`.**
This isn't one server — the backend is deliberately **two separate processes**. `pnpm api` starts the API: that's the normal request-and-response server handling logins, creating events, guests, and drivers. `pnpm dispatch` starts the matching engine — an always-on loop that runs every few seconds, looks at who's waiting and who's free, and actually assigns the rides. I keep those separate on purpose: the API is a request/response app, but the engine is a continuous loop, so they're different shapes of program. And separating them is also about reliability — if the engine ever crashes, the API and the admin's manual controls keep working, and in-progress trips are safe because their state lives in the database. `pnpm portal` starts the web portal — that's the admin and driver website, a separate Next.js app.

**Why `pnpm start` for the app.**
The guest app is a React Native app built with Expo, so `pnpm start` launches Expo's dev server — it bundles the app and serves it to a phone or simulator over the same Wi-Fi.

*(Then continue with your live setup: install, env, database, and starting each process.)*

---

## 2. Demonstration

*(You're driving this part. A suggested flow if it helps — feel free to ignore.)*

- Log into the **admin portal**, create an event with its date window and saved places (venue, airport, hotel).
- Add a **driver** and a **guest**.
- Bring the driver **online**, and show the guest getting **automatically assigned** — no one picked anyone.
- Open the **guest app**: show the live match card, the driver on the map, and the ETA.
- Walk the **driver** through the trip: Accept → Arrived → enter the boarding code → complete.
- Optionally show the **date-window rule** (no rides outside the window) and the **past-events archive**.

---

## 3. Architecture & my decisions

Let me walk through how it's built and why.

**The overall shape.**
At its core, Baraat is **one backend and one database**, plus an always-on matching worker, serving three front-ends: an admin portal, a driver portal, and a guest app. The single most important decision was keeping **one backend and one database**. The core action in this system is "give this guest to this driver, only if the seats and luggage fit and the deadline still works, then mark the driver busy" — and that has to happen as one all-or-nothing step over both the guest's and the driver's data. If those lived in separate microservices with separate databases, every single assignment would become a fragile distributed transaction. So I kept it as one backend that owns all the writes, over one Postgres database.

**The backend.**
The backend is **Node, Express, and TypeScript**. I chose one language across the whole stack — backend, engine, web, and mobile — so I could share types everywhere and never context-switch. Express is small and predictable, which made it easy to layer in the role checks and transaction logic this needs. For the database I used **Prisma**, because it gives type-safe queries that match the TypeScript everywhere else, plus clean migrations. One detail I'm proud of: I run Prisma in an **engine-less mode** — a pure TypeScript client with a Postgres driver — so there are no heavy binary files to download or ship, which made it deploy small and behave identically on my machine and in the cloud. The database itself is **Postgres on Supabase** — managed, free to start, and because it's plain Postgres I could lean on real transactions and row-level security.

**Security — two layers.**
For access control I used **two layers**. First, every API route checks the user's role — admin, driver, or guest — using JWTs with short-lived access tokens and rotating refresh tokens. Second, and this is the part I care about, Postgres **row-level security** enforces the same rules *inside the database*, so even a bug in my code physically can't let one driver read another driver's trips. Belt and suspenders — because here, privacy is really guest safety. There's also a small boarding OTP: when the driver arrives, the guest shows a four-digit code the driver types in — a simple human check that the right person is in the right car.

**The matching engine.**
The engine is the heart of the project, and it runs as its own always-on process. For guests whose arrival times are known ahead, it groups people going to the same hotel and solves the assignment optimally using the **Hungarian algorithm**. For on-the-spot requests, it uses a fast **greedy** match — it filters to drivers who can actually fit and reach the guest in time, scores them, and picks the best in milliseconds. To make it fair, there's an **aging queue** so the longer someone waits, the higher they rise — nobody gets starved by newer requests. It can also **splice a nearby waiting guest** into a driver's existing trip if it barely adds time, split an oversized group across multiple cars, and it re-checks ETAs as traffic changes — but it never yanks a passenger who's already in a car. And all of this only runs inside the event's time window.

**The portal.**
The web portal is **Next.js with Tailwind**, and I deliberately kept its server layer thin — it holds the session in a secure cookie and just forwards requests to the API, with no business logic and no database access of its own. That's what keeps the "one backend" rule honest. Browsers can't store tokens safely, which is exactly why the portal goes through that server layer. Admin and driver are two role-gated views inside the same app. For maps on the portal I used **Leaflet with OpenStreetMap**, so it needs no map API key at all, and I added a light and dark theme since drivers use it at night.

**The guest app.**
The guest app is **React Native with Expo**, which gave me one codebase for both iOS and Android and easy access to the native things I needed — GPS location, secure token storage in the device keychain, maps, and push notifications — without native build headaches. Unlike the browser, a native app can store tokens securely, so the app talks to the backend directly.

**Hosting.**
For hosting: the database stays on **Supabase**; the API and the matching worker run on a single **AWS EC2** instance kept alive by **pm2**, so it never sleeps like a free hobby tier would; the portal is on **Vercel**; I put **Caddy** in front of the API for automatic HTTPS; and I built the Android **APK with Expo's EAS** cloud builder.

**Trade-offs.**
A few honest trade-offs. For the batch matching, a true multi-stop vehicle-routing solver like OR-Tools would squeeze out slightly better car-sharing, but it needs a separate Python service and is much slower — my grouping-plus-Hungarian approach gets very close, stays in one language, and runs in milliseconds up to about a hundred drivers; past that, adding OR-Tools is the planned next step. The detour search checks every busy-driver-to-waiting-guest pair, which is fine at this scale but would need a spatial index beyond it. Without a Google Maps key, the backend falls back to an offline distance estimator — good enough to run and test everything, but not real street routing. And the in-memory queue assumes a single engine process; running several would need Redis as the shared queue, which the code already targets. Finally, it runs one active event at a time by design — serving many at once would need an extra scoping layer, which I deliberately left out to keep this focused.

**What I learned.**
The biggest lesson was designing around **atomic decisions** — realizing early that the assignment had to be one transaction over driver and guest state shaped the whole architecture and kept me away from premature microservices. I learned a lot about **resilience by separation** — splitting the always-on engine from the API so one can't take down the other. Fitting Prisma into a constrained environment with the **engine-less client** taught me how the tooling actually works under the hood. And on the deployment side, I got hands-on with running a **multi-process backend on a single box** with pm2 and Caddy, and shipping a real, installable **APK** — which turned this from "code that runs on my laptop" into something actually live.

That's Baraat — thanks for watching.
