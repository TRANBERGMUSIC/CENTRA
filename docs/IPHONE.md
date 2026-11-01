# CENTRA på iPhone, synkroniseret med Mac'en

iPhone-appen er den samme app som på Mac'en (Tauri), bare uden den indbyggede browser: links åbner i Safari. Mac og iPhone synkroniserer gennem din egen sync-server på Cloudflare. Serveren ser kun krypterede data. Nøglen kommer fra dit password og forlader aldrig dine enheder.

## Det skal sættes op én gang

**Cloudflare (sync-serveren)**
1. dash.cloudflare.com → Workers & Pages. Vælg et *workers.dev subdomain*, hvis du bliver spurgt.
2. My Profile → API Tokens → Create Token → skabelonen **Edit Cloudflare Workers** → Create. Kopiér nøglen.
3. Kopiér dit **Account ID**. Det står på forsiden af Workers & Pages.

**Apple**
1. developer.apple.com/account → Membership details: skriv dit **Team ID** ned.
2. Identifiers → + → App IDs → App → Bundle ID (Explicit): `dk.tranberg.centra`.
3. appstoreconnect.apple.com → Apps → + → New App:
   - Platform: iOS
   - Navn: CENTRA (eller CENTRA Tranberg)
   - Bundle ID: `dk.tranberg.centra`
   - SKU: `centra`
4. Users and Access → Integrations → App Store Connect API → Team Keys → +:
   - Navn: GitHub
   - Adgang: **Admin**. Det kræves, for at bygget selv kan lave signeringscertifikatet.
   - Download .p8-filen (kan kun hentes én gang). Gem den i `CENTRA-noegler`.
   - Skriv **Key ID** og **Issuer ID** ned.

**GitHub** → repo → Settings → Secrets and variables → Actions → New repository secret:

| Secret | Værdi |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare-nøglen |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID |
| `APPLE_TEAM_ID` | Team ID |
| `APPLE_API_KEY_ID` | Key ID |
| `APPLE_API_ISSUER` | Issuer ID |
| `APPLE_API_KEY_P8` | hele indholdet af .p8-filen, også BEGIN- og END-linjerne |

## Hvad der sker, når du pusher

- **relay** lægger sync-serveren op på Cloudflare (`centra-relay.<subdomæne>.workers.dev`). Når den findes, bygges alle apps med sync slået til.
- **desktop** bygger Mac-appen.
- **ios** bygger iPhone-appen og sender den til TestFlight. Første gang tager det 20–40 minutter, og derefter 10–30 minutter, før den dukker op i TestFlight. Fejler bygget, ligger slutningen af loggen som `iphone-build-fejl.txt` på udgivelsen.
- Ændringer i grænsefladen når både Mac og iPhone på et minut (web.yml), uden et nyt TestFlight-byg.

## Første gang

1. **Mac'en først:** opdatér og log ind. Din konto og alle data lægges krypteret op. Du får en ny gendannelsesnøgle, fordi serveren skal kende den. Gem den. Den gamle virker ikke længere.
2. **iPhonen:** installér TestFlight fra App Store. I App Store Connect → TestFlight → Internal Testing laver du en gruppe og tilføjer dig selv. Installér CENTRA fra TestFlight, og log ind som Tranberg med dit password.

Logger iPhonen ind, før Mac'en har lagt kontoen op, siger den det og opretter ikke en ny, tom konto.

## Det virker kun på Mac'en

- Den indbyggede browser med VPN
- Import fra Kontakter-appen
- Touch ID

Mail, kalender-feeds, LunchHub, Assist, noter, mål, udlæg og billeder virker begge steder.

## Huskelisten og Siri

- Et punkt med tidspunkt planlægges hos iPhonen, så notifikationen kommer til tiden, også når CENTRA er lukket. iPhonen spørger én gang, om CENTRA må sende notifikationer.
- Mac'en viser notifikationen, når CENTRA kører.
- Laves et punkt på Mac'en, kommer det på iPhonens plan, næste gang CENTRA har været åben på iPhonen.
- **Siri:** sig "Hey Siri, husk i CENTRA". Siri spørger "Hvad skal jeg huske?", og du siger fx "levere udstyr tilbage til Sigge kl. 12". CENTRA åbner, og Assist sætter det på listen med tidspunktet. Virker Siri-sætningen ikke, så find "Husk i CENTRA" i Genveje-appen; der kan du også give den dit eget navn.
