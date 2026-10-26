# CENTRA

*Your life. In focus.* Dit personlige hverdags-hovedkvarter: noter, kalender, alle dine mailkonti, mål og en AI, der lærer, hvordan du arbejder. Én app på Mac, Windows, iPhone, Android og web. Alt synkroniseres og er end-to-end-krypteret.

## Status: trin 2 af 7 (synk-kernen)

| Del | Status |
|---|---|
| Designsystem (retning A · Mørkekammer) | Færdig: tokens, mørk/OLED/lys, ikoner, brand |
| Synk-kerne | Færdig: Yjs til notetekst, LWW pr. felt, HLC-ure, outbox, offline først, E2E-kryptering, enheder og log ud |
| App (React + Vite) | Kører: I dag, Noter, Kalender (uge), Indbakke, Mål, Assist, Indstillinger, ⌘K |
| Bevægelse | GSAP (Flip, timelines), Lenis i læsefladerne, React Bits (DecryptedText, CountUp, ClickSpark, LightRays) |
| Auto-opdatering | Opsat: Tauri-updater (Mac/Windows), OTA-bundles (iPhone/Android), GitHub Pages (web) |
| Backend | Relæ-server (kør selv eller host). Supabase-adapter og -skema er skrevet, men ikke slået til endnu |

Indbakke, kalender og Assist kører på eksempeldata, indtil de rigtige konti kobles på i trin 4–6. Eksempeldata kan fjernes under Indstillinger → Data.

## Kom i gang (din Mac)

```bash
npm install
npm run build -w @centra/design-system
npm run relay          # synk-serveren på ws://localhost:8787 (terminal 1)
npm run dev            # appen på http://localhost:5173 (terminal 2)
npm run desktop        # eller som Mac-app (Tauri; kræver Rust: https://rustup.rs)
```

Åbn appen i to vinduer, fx et almindeligt og et privat vindue, og log ind med samme e-mail og passphrase. Det, du skriver i det ene, står i det andet med det samme.

Tests: `npx vitest run`. Det dækker kryptering, ure, konflikter (fuzz med 5 enheder), genstart med fyldt outbox, at serveren kun ser ciphertext, log ud af en enhed og latens over rigtige websockets.
To-enheds-test med screenshots: `npm run e2e`. Den kræver, at relæ og dev-server kører.

## Auto-opdatering via GitHub

Det skal gøres én gang:

1. `brew install gh && gh auth login`
2. `bash scripts/setup-release.sh` laver signeringsnøglen til opdateringer, skriver den offentlige nøgle i `tauri.conf.json`, lægger den private nøgle som secret i repoet og slår GitHub Pages til.
3. Commit og push.

Hver gang du vil udgive:

```bash
npm run release            # 0.2.0 → 0.2.1   (eller: npm run release -- minor)
```

GitHub Actions bygger Mac (universal) og Windows, et web-bundle til mobil og web-versionen til Pages, og lægger det hele på release'en. Installerede apps tjekker ved start og hver halve time. Desktop installerer og genstarter, når du trykker "Genstart". Mobil skifter web-laget ud ved næste åbning.

Uden et Apple Developer-certifikat viser macOS en advarsel første gang appen åbnes. Højreklik → Åbn klarer det. Opdateringer virker uanset hvad. Secrets til notarisering er forberedt i `release.yml`.

## Synk-serveren skal kunne nås fra alle dine enheder

Relæet gemmer kun krypterede data. Du har to valg:

- **Host relæet**: `services/relay/Dockerfile` kører på Fly.io, Railway, Render eller en NAS. Sæt repo-variablen `CENTRA_RELAY_URL` (fx `wss://centra-relay.fly.dev`), så bliver den bygget ind i appen.
- **Supabase**: skemaet ligger i `services/supabase/migrations`, adapteren i `packages/sync/src/supabase.ts`. Det kræver et Supabase-projekt (gratis niveau), og så kobler jeg login (e-mail-link og passkey) på.

## Struktur

```
apps/app            React-appen (web, og indholdet i desktop- og mobilappen)
apps/desktop        Tauri 2-skal: updater, single instance
packages/design-system  tokens, ikoner, brand-assets, kontrast-tests
packages/crypto     libsodium: Argon2id, XChaCha20-Poly1305, nøgleindpakning
packages/sync       synk-motoren, relæ-klienter (WebSocket, Supabase), IndexedDB-lager
services/relay      relæ-server (kun ciphertext) + Dockerfile
services/supabase   produktionsskema med RLS
scripts             release, versionsnummer, opsætning af signering
docs                arkitektur, designsystem, roadmap
prototypes          de tre designretninger fra trin 1
```
