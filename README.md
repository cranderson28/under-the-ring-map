# Under the Ring: Sigil map

Static site. `index.html` is the player map, `dm.html` is the DM control page.

- Pins and cards live in `data/pins.json`. Maps and wards live in `data/maps.json`.
- Which pins and maps players can see lives in Firebase Realtime Database under `state/pins/{id}` and `state/maps/{id}`.
- Firebase settings are in `config.js` (not secret). Set `firebase: null` there to run in local test mode (DM password: `demo`).
- `database.rules.json` must be pasted into Firebase (Realtime Database, Rules). Replace `REPLACE_WITH_DM_UID` with the DM account's User UID (Authentication, Users).
- Hosting: Cloudflare (Worker with static assets), connected to this repo. Every push to `main` redeploys in a minute or two. No build step, output directory is the repo root.

## Pins

- 84 pins in the `sigil` list of `data/pins.json`: 82 with a map position and two card-only pins (Funicular, Secret Door Safe House). Every pin has card text. Pins stay hidden until the DM switches them on from `dm.html`.
- Pin fields: `id` (unique slug), `name`, `ward` (`lady`, `lower`, `hive`, `clerk`, `market`, `under`, `any`), `x` and `y` (pixels from the top left of the 6876 x 1176 strip in `images/sigil.webp`; leave both out for a card-only pin), `text` (the card: one or two sentences about the building from outside), and optional `"nolabel": true` for printed landmarks that already have a label on the art.
- To add a pin: add an entry, push, then switch it on from the DM page. Use the DM page's Show coordinates button to read x and y.
- Ward colors are in `data/maps.json` (Lady's Ward is turquoise, `#2bb3a8`).
