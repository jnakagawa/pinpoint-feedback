# Pinpoint

Pinpoint is a free, collaborative website-feedback tool delivered as a Chrome extension. Reviewers can pin comments directly onto any public website and share a public review link that works without the extension or an account.

The production app, API, PostgreSQL data, and public review pages are hosted by Zero at `https://deploy-9po6nd1t-nlbndjpuja-uc.a.run.app`. Public pages are shared as sandboxed DOM archives with native scrolling and selectable text; browser images are used only as a fallback. Zero Auth remains optional for public collaboration and is required only to publish revisions or protect a review by the email domain on a Zero account.

Comment authors can edit their own feedback through the signed-in extension. Public visitors can still read, add, resolve, and reopen feedback without installing Pinpoint or creating an account.

## Install the Chrome extension

[Download Pinpoint v0.10.0](https://github.com/jnakagawa/pinpoint-feedback/releases/download/v0.10.0/pinpoint-chrome-extension-v0.10.0.zip), extract the ZIP, then open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the extracted folder.

The release ZIP has SHA-256 `1e19cab5dabc77e054d21bcc47cbda871bbc81c0a27e01da43301c4a394c68e6`.

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
