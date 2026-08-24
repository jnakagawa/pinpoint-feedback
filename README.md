# Pinpoint

Pinpoint is a free, collaborative website-feedback tool delivered as a Chrome extension. Reviewers can pin comments directly onto any public website and share a public review link that works without the extension or an account.

The production app, API, PostgreSQL data, and public review pages are hosted by Zero at `https://deploy-9po6nd1t-nlbndjpuja-uc.a.run.app`. Zero Auth remains optional for public collaboration and is required only to upload review snapshots or protect a review by the email domain on a Zero account.

## Project layout

- `extension/`: unpacked Chrome extension source
- `zero-app/`: production Node/PostgreSQL service deployed on Zero
- `zero-site/`: static public-review client bundled into the Zero app
- `app/`: retained local vinext UI

## Verify locally

```bash
npm install
npm run lint
npm run test:extension
npm run build
```

Run `npm run dev` for the retained local UI. The deployable Zero service starts with `cd zero-app && npm start` and expects Zero to inject `DATABASE_URL` and `PORT`.

See `extension/README.md` for Chrome installation and the Zero Auth flow.
