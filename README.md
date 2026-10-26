# CENTRA

*Your life. In focus.* Dit personlige hverdags-hovedkvarter: noter, kalender, alle dine mailkonti, mål og en AI, der lærer, hvordan du arbejder. Lige nu kører den på din Mac, krypteret med dit password. Sync til iPhone og andre enheder er bygget og slås til senere. Se [SECURITY.md](SECURITY.md).

## Installér (Mac)

Åbn **Terminal**, indsæt denne linje, og tryk Enter:

```
curl -fsSL https://raw.githubusercontent.com/TRANBERGMUSIC/CENTRA/main/installer/install.sh | bash
```

Den henter nyeste version, lægger CENTRA i Programmer og åbner den. Du skal ikke højreklikke eller godkende noget. Kør den igen når som helst for at geninstallere.

Første gang logger du ind med brugernavnet **Tranberg** og vælger selv dit password. Så får du en gendannelsesnøgle, som du skal gemme.

**Opdateringer** sker af sig selv, mens appen kører:
- Den kigger efter nyt ved start, hvert kvarter, og når vinduet får fokus igen.
- En ny version hentes i baggrunden. Du får en "Genstart nu"-knap, eller den installerer selv, når du har været væk et stykke tid.

**Sync er slået fra for nu.** Alt ligger krypteret på din Mac. Koden til sync, server (Cloudflare) og iPhone-app er bygget og ligger klar (`packages/sync`, `services/relay-cf`, `docs/IPHONE.md`). Den slås til med `VITE_SYNC=on`, når vi er klar.

## Sådan kommer nye versioner ud

Du pusher til `main`, og det er det. GitHub Actions tester, bygger Mac og Windows, opdaterer web-appen og serveren og laver en ny release. Installerede apps henter den selv.

## Engangsopsætning (ét minut)

Auto-opdatering kræver én hemmelig nøgle på GitHub. Følg `Desktop/CENTRA/CENTRA-noegler/LÆS-MIG.txt`, som er én secret, `TAURI_SIGNING_PRIVATE_KEY`. Uden den bliver appen stadig bygget og kan installeres, men den kan ikke opdatere sig selv.

Repoet skal være **public**, for at installer og opdateringer kan hente filerne uden login. Der ligger ingen hemmeligheder i koden. Gøres repoet privat, virker installeren stadig, hvis du er logget ind med `gh auth login`, men så skal appens auto-opdatering flyttes til Cloudflare (ikke bygget endnu).

## Udvikling

```bash
npm install
npm run build -w @centra/design-system
npm run relay      # lokal server, ws://localhost:8787
npm run dev        # appen på http://localhost:5173
npm run desktop    # som Mac-app (kræver Rust)
npx vitest run     # 138 tests: kryptering, synk, konflikter, sikkerhed, latens
npm run e2e        # hele login/synk/sikkerheds-forløbet i en browser (kræver `vite preview`)
```

## Struktur

```
apps/app            React-appen (web, og indholdet i desktop-appen)
apps/desktop        Tauri 2: Mac/Windows, auto-opdatering
packages/crypto     Argon2id, XChaCha20-Poly1305, nøgleindpakning, gendannelsesnøgle
packages/sync       synk-motor (Yjs + LWW), konto, relæ-klient
packages/relay-core serverprotokollen: login, lockout, lagring af ciphertext
services/relay-cf   serveren på Cloudflare (Worker + Durable Object)
services/relay      samme server til lokal udvikling
docs                arkitektur, designsystem, roadmap, iPhone
```
