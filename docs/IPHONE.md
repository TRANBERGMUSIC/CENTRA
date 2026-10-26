# iPhone-app (når du har en Apple Developer-konto)

Indtil da: åbn web-versionen i Safari → Del → **Føj til hjemmeskærm**. Så kører den i fuld skærm med eget ikon.

Når du har en betalt Apple Developer-konto (99 $ om året), bygger GitHub selv iPhone-appen og lægger den på TestFlight ved hvert push:

1. **App Store Connect** → Brugere og adgang → Integrationer → App Store Connect API → opret en nøgle med rollen *App Manager*. Download `.p8`-filen.
2. Opret appen i App Store Connect med bundle-id **dk.tranberg.centra**.
3. Tilføj på github.com/TRANBERGMUSIC/CENTRA → Settings → Secrets → Actions:
   - `APP_STORE_CONNECT_API_KEY`: hele indholdet af `.p8`-filen
   - `APP_STORE_CONNECT_KEY_ID`: nøglens id
   - `APP_STORE_CONNECT_ISSUER_ID`: issuer-id (står øverst på siden)
   - `APPLE_TEAM_ID`: dit team-id (developer.apple.com → Membership)
4. Push. Jobbet `ios` slår selv til, og appen dukker op i TestFlight på din iPhone.

Det er ikke testet endnu, fordi det kræver kontoen.
