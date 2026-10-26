# CENTRA

*Your life. In focus.* Dit personlige hverdags-hovedkvarter: noter, kalender, alle dine mailkonti, mål og en AI, der lærer, hvordan du arbejder. Det kører på Mac, Windows, mobil og web. Alt synkroniseres og er end-to-end-krypteret. Se [SECURITY.md](SECURITY.md).

## Installér

**Mac / Windows**
1. Gå til **Releases** på github.com/TRANBERGMUSIC/CENTRA.
2. Hent `CENTRA_…_universal.dmg` (Mac) eller `CENTRA_…_x64-setup.exe` (Windows), og installér.
3. Mac, første gang: højreklik på CENTRA i Programmer → **Åbn**.
4. Log ind med brugernavnet **Tranberg**. Første gang vælger du selv dit password, og du får en gendannelsesnøgle. Gem den.

Herefter opdaterer appen sig selv.

**Mobil**
1. Åbn web-adressen (`https://tranbergmusic.github.io/CENTRA/`) i Safari eller Chrome.
2. Vælg Del → **Føj til hjemmeskærm**.

Så kører den som en app i fuld skærm, virker offline og opdaterer sig selv. Når du får en Apple Developer-konto, bygges iPhone-appen automatisk til TestFlight (se [docs/IPHONE.md](docs/IPHONE.md)).

## Sådan kommer nye versioner ud

Du pusher til `main`, og det er det. GitHub Actions tester, bygger Mac og Windows, opdaterer web-appen og serveren og laver en ny release. Installerede apps henter den selv.

## Engangsopsætning (ca. 5 minutter, kun én gang)

| Hvad | Hvorfor | Hvordan |
|---|---|---|
| Opdateringsnøgle | Så Mac/Windows-appen kan opdatere sig selv sikkert | Følg `Desktop/CENTRA/CENTRA-noegler/LÆS-MIG.txt`: én secret, `TAURI_SIGNING_PRIVATE_KEY` |
| Server (Cloudflare, gratis) | Så telefon og computer synker over nettet | 1) Opret gratis konto på dash.cloudflare.com. 2) Profil → API Tokens → *Create Token* → skabelonen **Edit Cloudflare Workers**. 3) Læg den som secret `CLOUDFLARE_API_TOKEN` (og `CLOUDFLARE_ACCOUNT_ID`, som står på din Workers-side) |
| Web-appen | Til telefonen | Repo → Settings → Pages → Source: **GitHub Actions** |

Secrets ligger under repo → Settings → Secrets and variables → Actions → *New repository secret*.

Repoet skal være **public**, for at opdateringer og web-appen virker uden login. Det er sikkert: der ligger ingen hemmeligheder i koden.

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
