# Bloom Bouquet viewer

Phone-friendly Three.js viewer. The published page is one flower: the 19 Nov 2026, 11:55 AM HKT Guatemala Antigua La Flor brew (bag 8, hue 143, dose 20 g, grind 9.2, yield 41.5 g, 4 stars). Modifier is HE BASKET, so the center stays Antigua green-cyan and the outer rim diffuses to purple.

This folder is meant to be published, as-is, to GitHub Pages at:

`https://panglol.github.io/Data-Logging-Barista-OTA/bouquet/`

Copy the contents of this directory (not a parent folder) into the `bouquet/` path of the `Data-Logging-Barista-OTA` repo. Use only the relative paths already in `index.html` (`vendor/app.js`, `data/shots.json`, `textures/s00.png` …). Do not add a leading `/`.

Do **not** touch firmware files, the OTA manifest, or anything outside `bouquet/` when publishing.

## Local preview

Served from the coffee-cart-graphic folder:

`http://127.0.0.1:8765/bouquet-site/index.html`

Open on a phone over the same network, or use a tunnel. The page is locked to the visual viewport (no document scroll) so orbit-camera drags do not fight the browser.

## Controls

The scene is this one stem in the mug. There is no logs slider.

- **Stem height** — how tall the head sits above the mug (0.60–1.60×, default 1.00)
- **Stem softness** — how much the stem stays gathered then curves outward, and how far gravity lowers the head (0.40–2.20, default 1.00). Stiff is a tight, straight stalk at packed height; soft is not a mid-stem bow.
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
