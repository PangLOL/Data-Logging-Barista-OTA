# Data-Logging-Barista OTA

Public firmware updates for the M5Dial barista logger.

This repository is the OTA host only. It does not contain firmware source. The source repo stays private.

The Dial polls:

```text
https://panglol.github.io/Data-Logging-Barista-OTA/manifest.json
```

`manifest.json` points at `firmware/<version>/firmware.bin`. The Publish firmware workflow on the private source repo updates both files.

`.nojekyll` keeps GitHub Pages from running Jekyll, so `firmware.bin` is served unchanged.
