# Pinpoint Chrome extension

Pinpoint lets reviewers drop numbered feedback pins directly onto any normal `http` or `https` page. Comments are grouped by the page URL and synchronized through the Zero-hosted Pinpoint API. Public reviews work without an account; Zero Auth is used for identity and protected-review controls.

Authors can edit the text of comments created with their Zero identity. Comment text from other authors remains read-only, while resolving and reopening feedback stays collaborative.

Use **Share** in the in-page toolbar to create an immutable review revision and copy a Zero-hosted public link. Zero archives normal public pages as sanitized HTML, so the shared review has native scrolling, selectable text, and element-level pins instead of behaving like a screenshot. The extension only assembles an image fallback when a private, authenticated, or unusually large page cannot be archived by Zero. Anyone with a public review link can scroll through the complete revision and read, comment on, resolve, and reopen feedback without installing the extension or creating a Zero account.

Pins created in the extension and public DOM viewer are anchored to page elements using stable selectors and nearby text, with document coordinates as a fallback. This keeps feedback attached when content above it grows or moves. Each public link includes a revision ID, so sharing a newer revision never changes an older review link. Legacy image links remain available and are clearly labeled **IMAGE FALLBACK**.

Page owners can optionally restrict a page's feedback to the email domain on their Zero account. Protected review links require a matching Zero account; the API enforces that restriction for reads and writes, and the extension UI is only a control surface for the server-side policy.

## Install locally

1. Extract the extension folder if you downloaded the ZIP.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select this `extension` folder.
5. Pin Pinpoint to the toolbar, open it, and choose **Continue with Zero**.

## How authentication works

The extension starts Zero's device authorization flow and opens Zero's approval page in a new tab. Access and refresh tokens stay in `chrome.storage.local` inside the extension's background worker. Page scripts never receive the tokens; they request authenticated comment operations through the background worker.

## Local development

The Zero-hosted app URL and Zero API version are defined near the top of `background.js`; the public review root is near the top of `content.js`. Reload the extension from `chrome://extensions` after changing any file.
