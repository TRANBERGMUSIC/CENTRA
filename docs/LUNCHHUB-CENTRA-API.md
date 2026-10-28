# LunchHub → CENTRA: app-API til indbakken

Indsæt denne fil i Claude-chatten, hvor LunchHub bygges ("LunchHub.dk"). Den beskriver præcis,
hvad CENTRA (Willads' Mac-app) kalder, så henvendelserne fra LunchHubs indbakke også lander i
CENTRAs indbakke, og så "besvaret"/"arkiveret" i CENTRA også bliver sat i LunchHub.

CENTRA-siden er bygget og testet mod netop dette. LunchHub skal have de tre endpoints nedenfor og
en side, hvor brugeren laver sin app-nøgle.

## 1. App-nøgler (personlige)

- Ny tabel, fx `app_keys`: `id`, `user_id`, `name` (fx "CENTRA på MacBook"), `token_hash` (sha256 af
  nøglen), `prefix` (de første 8 tegn, til visning), `created_at`, `last_used_at`, `revoked_at`.
- Nøglens format: `lh_app_` + 32 tilfældige bytes i base64url (`random_bytes(32)`). Den vises **kun én
  gang**, når den laves. Kun hashen gemmes.
- På brugerens **profil**: et punkt **Forbind CENTRA** med knappen **Lav app-nøgle**, en liste over
  nøgler (navn, prefix, oprettet, sidst brugt) og **Slet** pr. nøgle. Alle brugere med indbakke-adgang
  må lave nøgler til sig selv. Superadmin kan se og slette alles.
- En nøgle giver **præcis samme adgang til indbakken som brugeren selv**, og ikke mere: kun de
  virksomheder, brugeren har indbakke-adgang til. Den giver ikke adgang til andet i LunchHub.
- Deaktiveres eller slettes brugeren, holder nøglerne op med at virke.
- Log brug i LunchHubs log ("CENTRA hentede 3 henvendelser", "CENTRA markerede … som besvaret").
- Rate limit: fx 60 kald i minuttet pr. nøgle → `429`.

## 2. Godkendelse

Alle kald har headeren

```
Authorization: Bearer lh_app_…
Accept: application/json
X-LH: 1
```

Kaldene kommer fra CENTRAs Rust-del (server-til-server, ikke en browser), så **CORS er ikke nødvendig**.
Mangler nøglen eller er den ugyldig/slettet: `401 {"error":"…"}`. Brugeren har ingen indbakke-adgang:
`403`. Alle svar er JSON. Fejl er `{"error":"forklaring på dansk"}`.

## 3. Endpoints

### `GET /api/ext/me`

Til CENTRAs "Forbind"-knap: viser hvem nøglen tilhører.

```json
{ "name": "Willads Tranberg", "username": "WT",
  "sites": [ { "id": "frajorden", "name": "Fra Jorden", "domain": "frajorden.dk" },
             { "id": "smagssans", "name": "Smagssans", "domain": "smagssans.dk" } ] }
```

### `GET /api/ext/inbox?since=<ISO-tid>`

Henvendelser, der er **oprettet eller ændret** efter `since`, sorteret stigende efter `updatedAt`,
højst 500 pr. kald. Tom `since` betyder de seneste 90 dage. Kun virksomheder, brugeren har
indbakke-adgang til.

```json
{
  "now": "2026-10-28T20:15:00+01:00",
  "items": [
    {
      "id": 412,
      "site": "frajorden",
      "siteName": "Fra Jorden",
      "type": "smagning",
      "kind": "Smagning",
      "status": "ny",
      "name": "Mette Holm",
      "company": "Holm Rådgivning ApS",
      "email": "mette@holm.dk",
      "phone": "+45 20 30 40 50",
      "subject": "Daglig frokost",
      "employees": 40,
      "zip": "2500",
      "message": "Hej! Vi vil gerne høre om en smagning …",
      "source": "frajorden.dk/kontakt-os",
      "receivedAt": "2026-10-28T19:58:12+01:00",
      "updatedAt": "2026-10-28T19:58:12+01:00",
      "note": ""
    }
  ]
}
```

- `status` er LunchHubs egen: `"ny"` (ikke besvaret), `"besvaret"` eller `"arkiv"`.
- `updatedAt` **skal** opdateres, når status eller den interne note ændres (også når det sker inde i
  LunchHub), så CENTRA ser ændringen ved næste hentning.
- `now` er serverens tid. CENTRA bruger den som næste `since`.
- Felter, der ikke er udfyldt, må være `""` eller `null`.

### `POST /api/ext/inbox/<id>`

Body: `{"status":"besvaret"}` (eller `"ny"`, `"arkiv"`). Valgfrit `"note"`.

Svar: `{"ok":true,"item":{…samme form som ovenfor…}}`. Henvendelsen skal høre til en virksomhed,
brugeren har indbakke-adgang til, ellers `404`. Status og `updatedAt` opdateres, og ændringen logges
med "via CENTRA".

CENTRA kalder den, når Willads:
- svarer på henvendelsen fra CENTRA (svaret sendes fra hans egen mailkonto) → `besvaret`
- trykker Arkivér eller Slet i CENTRA → `arkiv`
- trykker Markér ubesvaret → `ny`

## 4. Test med curl

```bash
curl -s https://lunchhub.dk/api/ext/me -H "Authorization: Bearer $KEY"
curl -s "https://lunchhub.dk/api/ext/inbox?since=" -H "Authorization: Bearer $KEY"
curl -s -X POST https://lunchhub.dk/api/ext/inbox/412 -H "Authorization: Bearer $KEY" \
     -H "Content-Type: application/json" -H "X-LH: 1" -d '{"status":"besvaret"}'
curl -s -o /dev/null -w "%{http_code}\n" https://lunchhub.dk/api/ext/me -H "Authorization: Bearer forkert"   # 401
```

## 5. I CENTRA

**Forbindelser → LunchHub → Forbind LunchHub**: adresse (`https://lunchhub.dk`) og app-nøglen.
Nøglen gemmes krypteret i CENTRA. Henvendelserne hentes automatisk hvert minut (og når CENTRA-vinduet kommer frem) og vises i
indbakken som "LunchHub · Fra Jorden". De svares fra en af Willads' mailkonti.
