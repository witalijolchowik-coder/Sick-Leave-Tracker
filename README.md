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
pnpm install
pnpm dev
```

## Firebase setup

1. Open Firebase Console → **Authentication** → **Sign-in method**.
2. Enable **Email/Password**.
3. Create at least one user in **Authentication → Users**.
4. Create a Firestore database.
5. Configure Firestore Security Rules for the collections used by the app.
6. Add the GitHub Pages domain and the future custom domain to
   **Authentication → Settings → Authorized domains**.

The Firebase web configuration is stored in `src/config/firebase.js`. Firebase
web API keys are public identifiers; access is protected by Authentication and
Firestore Security Rules.

## GitHub Pages

The workflow in `.github/workflows/deploy-pages.yml` builds and publishes the
application after every push to `main`.

In the repository open **Settings → Pages** and select **GitHub Actions** as the
source. A custom domain can be configured on the same page.

The application uses `HashRouter`, so direct links and page refreshes work on
GitHub Pages without server-side redirects.
