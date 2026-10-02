# Corpus sources

35 full-screen (576×288) 8-bit grey PNGs, 5 per content type. Built by `npm run corpus`
(`bench/corpus.ts`); per-image details in `manifest.json`.

| Type | Source | License |
|---|---|---|
| `ui/`, `chart/`, `text/`, `line-art/`, `game/` | Drawn by `bench/corpus.ts` (seeded, deterministic up to system fonts) | MIT, this repository. `text/reader-*` quote Lewis Carroll's *Alice's Adventures in Wonderland* (public domain) |
| `photo/` | Kodak Lossless True Color Image Suite: kodim01, 03, 05, 14, 23. Cover-scaled to 576×288, BT.601 grey | Released by Eastman Kodak for unrestricted use |
| `map/` | OpenStreetMap standard tiles, zoom 16, 3×2 tiles per city, centre-cropped, BT.601 grey, inverted | © OpenStreetMap contributors. Data ODbL, tiles CC BY-SA 2.0 ([copyright](https://www.openstreetmap.org/copyright)) |
