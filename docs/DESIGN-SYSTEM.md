# CENTRA designsystem

Kilde: `packages/design-system/src/tokens.ts`. Byg med `npm run build` (giver `dist/tokens.css` og `dist/tokens.json`). Test med `npm test` (WCAG-kontrast i alle tre temaer).

## Idéen

Brandets prisme samler lys i ét punkt: *Your life. In focus.* I appen er **præcis én ting ad gangen "i lyset"**: den næste aftale, den mail der venter på dig, det mål der kræver handling. Den ting får `focus` (terracotta). Resten tegnes i charcoal, stone og sage. Farve bruges på data og status, ikke på chrome, og udgør under 3 % af skærmen.

Signaturelementet er **dagslinjen**: dagen fra 07 til 23 med nu-punktet og den næste aftale i lyset.

## Farver

| Rolle | Mørk | OLED | Lys | Bruges til |
|---|---|---|---|---|
| ground | #0B0F0E | #000000 | #F4F5F3 | vindue, sidebar |
| surface | #131816 | #0E1110 | #FFFFFF | paneler |
| raised | #1C2220 | #181C1A | #F7F8F6 | rækker, felter |
| active | #252C29 | #202523 | #E9ECE9 | valgt række/nav |
| text | #F2EEE6 | #F2EEE6 | #0B0F0E | brødtekst |
| muted / faint | #B4B8B2 / #959A94 | samme | #4A524E / #626B66 | sekundær / meta (alle ≥ 4,5:1) |
| primary | #E8DCC6 (stone) | samme | #1E3A34 (forest) | den ene primære knap |
| focus | #C9683A | #C9683A | #C9683A | "i lyset": nu, næste, venter |
| calm | #8FB3A4 | samme | #456A5C | Assist, links mellem ting |

Alle par er testet automatisk (108 tests). Stone bruges kun som knapfarve i mørke temaer, aldrig som baggrund sammen med terracotta.

## Typografi

**Manrope** i to vægte (400, 600), med ægte tabeltal (`tabular-nums`). Brandets wordmark er en SVG og bruges kun som logo.

| Rolle | Størrelse/linje |
|---|---|
| meta | 12/16 |
| body | 14/20 |
| reading (note, mail) | 16/26 |
| section | 16/24 |
| title | 24/32 |
| greeting (kun I dag) | 32/40 |

Retning B tilføjer Newsreader 500 til hilsenen, som eneste job for den skrifttype.

## Afstand, radius, skygger

- 4 px-grid: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
- Radius *tight* 12/8/6/4 (ark, kort, kontrol, chip) eller *soft* 20/16/rund. Retningen bestemmer, hvilken af dem der bruges.
- Skygger kun på det, der svæver (popover, dialog, kommandopalette). Flader i hvile adskilles med et toneskridt.

## Bevægelse

- Varighed: 100 (instant), 150 (quick), 200 (base), 250 (slow) ms.
- Kurver: standard `cubic-bezier(0.2,0,0,1)`, ind `(0.05,0.7,0.1,1)`, ud `(0.3,0,0.8,0.15)`. Spring på mobil: damping 24, stiffness 280.
- Tryk skalerer til 0,97. Kun transform og opacity animeres. `prefers-reduced-motion` sætter alle varigheder til 0.
- Haptics: selection (faner), impactLight (afkrydsning, pin), notificationSuccess (Godkend, sendt), notificationWarning (slet).

## Ikoner

Egen outline-serie på et 24-grid med 1,5 px streg, i `assets/icons/` (30 stk., inkl. `goals`). 16 px i navigation og rækker, 22 px i tab-baren. Altid grå, aldrig i farvede bokse.

## Navigation

Sidebaren på desktop og tab-baren på mobil har samme informationsarkitektur: **I dag · Noter · Kalender · Indbakke · Mål**, plus **Assist** (i sidebaren og bag ⌘K / træk-ned på mobil). ⌘K / ⌃K / træk-ned åbner én søgning på tværs af noter, mails, kalender, mål og Assist-kommandoer.

## Regler

- Ingen inline-styling i produktions-UI: alt går gennem tokens og `@centra/ui`-komponenter. Prototyperne bruger CSS-variabler til positionering af dagslinje og fremdriftsbjælker.
- Ingen gradienter, glows, glas, emoji eller ikoner i farvede bokse.
- Tal højrestillet med tabeltal. Rigtige nuller vises som "0", manglende værdier som "—".
- Ét primært kald til handling pr. skærm.
