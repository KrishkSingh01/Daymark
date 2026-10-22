# Daymark — local-first To-do website

A responsive, installable website/PWA made with plain HTML, CSS, and JavaScript. No Tailwind, framework, account, database service, or custom server is required.

## Features
- Custom lists with name, description, colour, and cover image
- Tasks with notes, due dates, completion checkboxes, and multiple image attachments
- All / Today / Upcoming / Completed views
- Search, progress bar, edit and delete actions
- Automatic local saving with IndexedDB
- Export and import a JSON backup (includes images)
- Installable PWA manifest with 192px/512px icons and offline app-shell caching
- Responsive desktop and mobile layouts; reduced-motion accessibility support

## Run locally
Because browsers restrict some features when opening files directly with `file://`, use a local static server for testing:
1. Extract the ZIP.
2. Open the folder in VS Code.
3. Install the free "Live Server" extension, if needed.
4. Right-click `index.html` and choose **Open with Live Server**.

Alternatively, if Python is already installed, open a terminal in this folder and run:
`python -m http.server 8000`
Then visit `http://localhost:8000`.

## Deploy to Cloudflare Pages (free static hosting)
1. Extract the ZIP.
2. Create a GitHub repository and upload the files inside this folder (not the ZIP itself).
3. In Cloudflare, go to **Workers & Pages** → **Create** → **Pages** → connect to your Git repository.
4. Framework preset: **None**.
5. Build command: leave empty.
6. Build output directory: `/` (the repository root).
7. Deploy. Cloudflare gives you a `*.pages.dev` address.

You can also use Cloudflare Pages direct upload if the dashboard offers it for your project. Upload the extracted site files, not the ZIP as a website file.

## Install on a phone
### iPhone / iPad
1. Deploy the site to HTTPS first. A local `file://` page cannot be installed as an app.
2. Open your `https://your-site.pages.dev` URL in Safari.
3. Tap **Share** → **Add to Home Screen**.
4. If offered, enable **Open as Web App**, then tap **Add**.
5. Launch Daymark from the new Home Screen icon.

### Android
1. Deploy the site to HTTPS.
2. Open the URL in Chrome.
3. Open the three-dot menu → **Install app** or **Add to Home screen**.
4. Follow the prompts.

This is a Progressive Web App (PWA): it opens in an app-like window, but it is not a native App Store / Play Store app.

## Important storage notes
- Data is stored in the current browser profile on the current device. It does **not** sync to other devices or automatically follow you when you install the app.
- Export a backup regularly using **Export / backup**. Keep the downloaded JSON somewhere safe.
- Importing a backup replaces the current data. Export current data first if you need to keep it.
- Browser storage can be cleared by device cleanup or browser settings. Do not treat it as your only copy of important information.
- Images are resized and compressed before saving. Each selected image must be 5 MB or smaller before compression. Large numbers of photos may eventually fill browser storage.
- For privacy, this version has no account or cloud sync. Data stays in local browser storage, but anyone with access to your unlocked browser profile may be able to use the site.

## Customize
- `index.html`: page structure
- `styles.css`: colours, spacing, typography, responsive styles
- `app.js`: task/list behavior and local database logic
- `manifest.webmanifest`: installable-app name and appearance
- `icon.svg`: home screen / tab icon

The Google Fonts import is optional; the site falls back to system fonts if the network is unavailable.
