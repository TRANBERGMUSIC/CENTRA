# Roadmap

| Trin | Indhold | Status |
|---|---|---|
| 1 | Arkitektur, designsystem, tre designretninger | Færdig: retning A valgt |
| 2 | Synk-kernen, app-skelet, bevægelseslag, auto-opdatering via GitHub | **Færdig** (backend skal hostes, se nedenfor) |
| 3 | Noter (næste): blok-editor, /-kommandoer, [[links]], tags, mapper, historik, hurtignote, søgning | |
| 4 | Kalender: Google, Graph, CalDAV, visninger, naturligt sprog, fokusblokke, find tid | |
| 5 | Indbakke: Gmail, Graph, IMAP/SMTP, samlet indbakke, kategorier, søgning, kontakter | |
| 5b | Mål: tal-mål, milepæle, vaner, opdateringslog, kobling til aftaler og noter | Planlagt sammen med trin 3, fordi det deler entitets- og editor-kode |
| 6 | Assist: router (Claude + Ollama), hukommelse, forslag, briefing, RAG, friktionslog | |
| 7 | Polish: animationer, haptics, onboarding < 2 min, eksport/backup, ydelsesbudget | |

## Kendte afvejninger, der skal afklares senere

- Planlagt afsendelse og "send senere" på IMAP-konti kræver en enhed, der er online på tidspunktet, fordi serveren ikke må have mailindholdet.
- Web-versionen kan ikke tale IMAP direkte og bruger et relæ, der kun ser krypterede bytes.
- Lokal model kræver Ollama på en Mac/PC. Mobil sender følsomme opgaver dertil over dit eget netværk eller venter.
- Push-notifikationer om vigtige mails beregnes på enheden. Serveren sender kun et stille "kig efter ny mail"-signal.

## Fra trin 2, mangler

- **Hostet backend**: enten relæet (Dockerfile findes) eller Supabase (skema og adapter findes). Login med e-mail-link og passkey kommer sammen med Supabase.
- **"Husk mig på denne enhed"** via Keychain/Keystore, så passphrasen ikke skal tastes ved hver start.
- **SQLite i stedet for IndexedDB** i Tauri og Capacitor, nødvendigt for FTS5 og vektorsøgning i trin 3.
- **Push-notifikationer** (APNs, FCM, Web Push) kommer med indbakken i trin 5.
- **Notarisering på Mac** kræver et Apple Developer-certifikat. Secrets er forberedt.
- **Bundle-størrelse**: libsodium-sumo fylder ca. 1 MB. Den kan indlæses dovent bag låseskærmen.
