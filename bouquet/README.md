# Bloom Bouquet viewer

Phone-friendly Three.js viewer for the last 30 espresso-log flowers.

This folder is meant to be published, as-is, to GitHub Pages at:

`https://panglol.github.io/Data-Logging-Barista-OTA/bouquet/`

Copy the contents of this directory (not a parent folder) into the `bouquet/` path of the `Data-Logging-Barista-OTA` repo. Use only the relative paths already in `index.html` (`vendor/app.js`, `data/shots.json`, `textures/s00.png` …). Do not add a leading `/`.

Do **not** touch firmware files, the OTA manifest, or anything outside `bouquet/` when publishing.

## Local preview

Served from the coffee-cart-graphic folder:

`http://127.0.0.1:8765/bouquet-site/index.html`

Open on a phone over the same network, or use a tunnel. The page is locked to the visual viewport (no document scroll) so orbit-camera drags do not fight the browser.

## Controls

- **Logs** — how many of the latest shots to show (1–30, default 30)
- **Stem height** — how tall the heads sit above the mug (0.60–1.60×, default 1.00)
- **Stem softness** — how much stems curl / drape toward the ground (0.40–2.20, default 1.00)
- **Size** — exaggeration of dose-based head scale (0.50–2.20, default 1.00)

Values are kept in the URL hash, so a look can be shared. `?still=1` paints one frame and hides the panel (for screenshots).

`vendor/app.js` is a self-contained IIFE bundle of the app plus Three.js r170. Rebuild from `src/main.js` with esbuild if you change the source:

```
esbuild src/main.js --bundle --format=iife --outfile=vendor/app.js
```

Three.js must be resolvable (for example `node_modules/three` at 0.170).
