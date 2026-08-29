# MAPS 2.1 — verifica tablet e touch

Data verifica: 29 agosto 2026

Branch: `feature/maps-2-1`

## Viewport verificati

Il test browser `e2e/maps-operational.spec.ts` è stato eseguito senza accesso
Internet, intercettando le tile con risposte PNG e HTTP 500 deterministiche, sui
seguenti viewport:

- 390×844 mobile touch;
- 768×1024 tablet portrait;
- 1024×768 tablet landscape;
- 820×1180 tablet portrait;
- 1440×900 desktop.

Per ogni viewport sono stati verificati: assenza di overflow orizzontale,
larghezza della mappa entro il viewport, filtri Da/A, pulsante Aggiorna, toggle,
target interattivi di almeno 44×44 px, marker, lista, apertura e chiusura del
Detail Sheet, selezione dalla lista senza salto dello scroll, errore tile e
recupero tramite `Riprova cartografia`.

Le classi Leaflet `leaflet-touch-drag` e `leaflet-touch-zoom` sono presenti con
`hasTouch` attivo nei progetti tablet; il componente abilita inoltre
esplicitamente `dragging` e `touchZoom`. Non sono richieste interazioni hover.

## Verifica visiva manuale

È stato ispezionato manualmente il trace Playwright locale sul viewport
1024×768. La verifica ha rilevato e portato alla correzione di due problemi:

1. i controlli zoom Leaflet erano ancora 30×30 px per precedenza del CSS della
   libreria; ora sono 44×44 px;
2. i pane Leaflet comparivano sopra il Detail Sheet; la mappa usa ora uno
   stacking context isolato e lo Sheet MAPS ha livello superiore all'overlay.

Dopo le correzioni, il pannello dettaglio copre interamente la mappa, il pulsante
di chiusura resta raggiungibile, marker e lista rimangono disponibili quando le
tile falliscono e il retry ripristina la cartografia senza ricreare la mappa.

Trace e screenshot di collaudo sono artefatti locali esclusi dal commit.
