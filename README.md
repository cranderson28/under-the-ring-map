# Under the Ring: Sigil map

Static site. `index.html` is the player map, `dm.html` is the DM control page.

- Pins and cards live in `data/pins.json`. Maps and wards live in `data/maps.json`.
- Which pins and maps players can see lives in Firebase Realtime Database under `state/pins/{id}` and `state/maps/{id}`.
- Firebase settings are in `config.js` (not secret). Set `firebase: null` there to run in local test mode (DM password: `demo`).
- `database.rules.json` must be pasted into Firebase (Realtime Database, Rules). Replace `REPLACE_WITH_DM_UID` with the DM account's User UID (Authentication, Users).
- Hosting: Cloudflare Pages, no build step, output directory `/`.
