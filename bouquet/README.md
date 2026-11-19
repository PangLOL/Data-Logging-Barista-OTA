# Bloom Bouquet viewer

Phone-friendly Three.js viewer for the latest espresso-log flowers. This November sheet is 60 brews, 1–19 Nov 2026 HKT.

This folder is meant to be published, as-is, to GitHub Pages at:

`https://panglol.github.io/Data-Logging-Barista-OTA/bouquet/`

Copy the contents of this directory (not a parent folder) into the `bouquet/` path of the `Data-Logging-Barista-OTA` repo. Use only the relative paths already in `index.html` (`vendor/app.js`, `data/shots.json`, `textures/s00.png` …). Do not add a leading `/`.

Do **not** touch firmware files, the OTA manifest, or anything outside `bouquet/` when publishing.

## Local preview

Served from the coffee-cart-graphic folder:

`http://127.0.0.1:8765/bouquet-site/index.html`

Open on a phone over the same network, or use a tunnel. The page is locked to the visual viewport (no document scroll) so orbit-camera drags do not fight the browser.

## Controls

- **Logs** — how many of the latest shots to show (1–60, default 60)
- **Stem height** — how tall the heads sit above the mug (0.60–1.60×, default 1.00)
- **Stem softness** — how much stems stay gathered then curve outward, and how far gravity lowers the heads (0.40–2.20, default 1.00). Stiff is a tight, straight bundle at packed height; soft is not a mid-stem bow.
- **Size** — exaggeration of dose-based head scale (0.50–2.20, default 1.00)

Values are kept in the URL hash, so a look can be shared. `?still=1` paints one frame and hides the panel (for screenshots).

## Modifier rim dye

A brew modifier dyes the flower's outer rim. The inner petal stays the bag's bean hue and the color diffuses outward to the modifier hue. One modifier covers the full rim. Several modifiers split the rim into equal wedges, with a soft polar blend across each shared edge. `none` or a blank modifier leaves the petal in its bean hue.

Hues are CSS HSL degrees:

- **HE BASKET** — purple, 300
- **FROZEN BALL** — cyan, 180. Sheet values `frozen_ss_ball` and `FROZEN SS BALL` are the same modifier; the label is FROZEN BALL.
- **SLOW FEED** — red, 0

`vendor/app.js` is a self-contained IIFE bundle of the app plus Three.js r170. Rebuild from `src/main.js` with esbuild if you change the source:

```
esbuild src/main.js --bundle --format=iife --outfile=vendor/app.js
```

Three.js must be resolvable (for example `node_modules/three` at 0.170).
