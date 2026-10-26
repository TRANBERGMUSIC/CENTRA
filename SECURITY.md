# CENTRA sikkerhed

Kort fortalt: dit password forlader aldrig din enhed. Alt indhold krypteres, før det sendes, og serveren kan hverken læse dine data eller logge ind som dig, heller ikke hvis nogen stjæler dens database.

## Hvad der beskytter hvad

| Trussel | Beskyttelse |
|---|---|
| Nogen læser koden på GitHub | Ingen passwords, nøgler eller hemmeligheder i koden. Signeringsnøglen ligger uden for repoet (`Desktop/CENTRA/CENTRA-noegler`) og som GitHub-secret |
| Serveren bliver hacket | Den har kun ciphertext (XChaCha20-Poly1305) og SHA-256 af en Argon2id-afledt værdi. Den kan hverken dekryptere eller logge ind |
| Nogen gætter dit password | Argon2id (64 MiB, 4 gennemløb) gør hvert gæt dyrt. Serveren spærrer kontoen efter 5 forkerte forsøg (30 s, 60 s, 120 s … op til 1 time) |
| Nogen opretter en konto på din server | Kun brugernavnet `tranberg` kan oprettes, og kun én gang (`ALLOWED_USERS`) |
| Mistet eller stjålet enhed | Log den ud under Indstillinger → Enheder. Den kobles af med det samme, og nye data krypteres med en ny nøgle. Skift også dit password |
| Nogen bruger din ulåste Mac | Appen låser sig selv efter 15 min uden aktivitet eller 5 min i baggrunden, og så forsvinder nøglerne fra hukommelsen |
| Glemt password | Gendannelsesnøglen (125 bit tilfældig) sætter et nyt password. Uden den er data tabt, og det er prisen for ægte end-to-end |
| Ondsindet kode i appen (XSS) | Streng Content-Security-Policy: kun egne scripts, ingen eval (WebAssembly er tilladt til libsodium), ingen fremmede domæner |
| Manipuleret opdatering | Desktop-opdateringer er signeret (minisign) og verificeres mod den offentlige nøgle, der er bygget ind i appen |
| Data på disken | Lokal cache (IndexedDB) indeholder dekrypteret tilstand til offline brug. Beskyt enheden med disk-kryptering (FileVault er standard på Mac) og skærmlås |

## Nøglerne

```
password ─Argon2id─▶ enc  ─┐                     recovery code ─Argon2id─▶ enc'
                     auth ─┼─▶ server: SHA-256    (samme mønster)
                           ▼
                  account key (AK)  ◀── wrappes af enc og af enc'
                           │
                  indholdsnøgler k1, k2, … (én pr. rotation) ── krypterer hver ændring
```

- `enc` og `auth` udledes af samme Argon2id-kørsel, men er domæneadskilte (BLAKE2b), så den ene ikke kan regnes ud fra den anden.
- Et passwordskift wrapper kun AK om. Data skal ikke krypteres igen.
- Når en enhed logges ud, laves en ny indholdsnøgle. Gamle nøgler beholdes, så gamle data kan læses.

## Server (Cloudflare Worker + Durable Object)

- Ét Durable Object pr. konto med egen SQLite-lagring. Det betjener kun kontoen, det er navngivet efter.
- Kun `prelogin` virker uden login. Den returnerer de offentlige KDF-salte og den gendannelses-wrappede AK, som er låst med en 125-bit tilfældig nøgle plus Argon2id.
- Hver besked er størrelses- og formkontrolleret, og hver forbindelse er rate-limited (40/s).
- Passwordskift og gendannelse lukker alle andre sessioner (kode 4002). En udlogget enhed afvises (kode 4001).

## Kendte begrænsninger

- Uden et Apple Developer-certifikat er Mac-appen ikke notariseret. Første gang skal den åbnes med højreklik → Åbn.
- Web-versionen kan i princippet ændres af den, der kontrollerer GitHub Pages-kontoen. Brug Mac-appen eller den kommende iPhone-app til det mest følsomme.
- "Husk mig" via Keychain er endnu ikke bygget, så passwordet skal tastes ved hver start (og efter auto-lås).

## Test

`npx vitest run` kører 9 sikkerhedstests mod relæ-kernen, blandt andet: ingen adgang før login, kun tilladt bruger, kun hash gemt, lockout med stigende ventetid, passwordskift logger andre ud, gendannelse, udlogget enhed afvist, nøgler kan ikke erstattes, og flood og forkert input afvises. `npm run e2e` kører hele forløbet i en browser med CSP slået til.
