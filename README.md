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
2. Enable **Email/Password** and disable client-side account creation.
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
- `newsEvents` — derived sick-leave changes shown in the Aktualności feed
- `appState/current` — pointer to the active sick-leave dataset
- `imports` — import history, timestamps, user and record counts
- `userSettings/{uid}` — private project membership and dashboard card preferences

Only parsed data is stored. Original XLS/XLSX files are never uploaded.

Project imports are versioned: replacing one project's active list or archive
does not touch any other project. Sick-leave imports switch to the new dataset
only after every chunk has been written successfully.

Each coordinator can add shared projects from **Dostępne projekty** in Settings.
Employee imports also add the imported project to the uploader's workspace.
Hiding a card affects only the dashboard. Search, news, and reports use all
projects in the workspace, including projects with hidden cards.

The ZUS indicator uses the server timestamp of the last successful publication
and the Warsaw calendar. New users start with an empty workspace. When upgrading
an existing installation, back up the old preferences and seed the primary
coordinator's `userSettings/{uid}` with the current project IDs and their
previous `hiddenProjects` map before deploying.

## GitHub Pages

The workflow in `.github/workflows/deploy-pages.yml` builds and publishes the
application after every push to `main`.

In the repository open **Settings → Pages** and select **GitHub Actions** as the
source. A custom domain can be configured on the same page.

The application uses `HashRouter`, so direct links and page refreshes work on
GitHub Pages without server-side redirects.
