# SickLeave Pro

React + Vite application for matching employee project lists with ZUS
sick-leave certificates.

## Stack

- React and Vite
- Material UI
- Firebase Email/Password Authentication
- Cloud Firestore
- React Router
- SheetJS for local XLS processing

## Local development

```bash
npm install
npm run dev
```

## Firebase setup

1. Open Firebase Console → **Authentication** → **Sign-in method**.
2. Enable **Email/Password**.
3. Create at least one user in **Authentication → Users**.
4. Create a Firestore database.
5. Deploy the included `firestore.rules` file in Firebase Console or with
   `firebase deploy --only firestore:rules`.
6. Add the GitHub Pages domain and the future custom domain to
   **Authentication → Settings → Authorized domains**.

The Firebase web configuration is stored in `src/config/firebase.js`. Firebase
web API keys are public identifiers; access is protected by Authentication and
Firestore Security Rules.

## Cloud data model

- `projects` — project metadata and active import-version pointers
- `employees` — parsed active employees
- `employeeArchives` — parsed archived employees
- `sickLeaves/{version}/chunks` — the current parsed ZUS dataset in compact chunks
- `appState/current` — pointer to the active sick-leave dataset
- `imports` — import history, timestamps, user and record counts

Only parsed data is stored. Original XLS/XLSX files are never uploaded.

Project imports are versioned: replacing one project's active list or archive
does not touch any other project. Sick-leave imports switch to the new dataset
only after every chunk has been written successfully.

## GitHub Pages

The workflow in `.github/workflows/deploy-pages.yml` builds and publishes the
application after every push to `main`.

In the repository open **Settings → Pages** and select **GitHub Actions** as the
source. A custom domain can be configured on the same page.

The application uses `HashRouter`, so direct links and page refreshes work on
GitHub Pages without server-side redirects.
