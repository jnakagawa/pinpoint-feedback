# Pinpoint Chrome extension

Pinpoint lets reviewers drop numbered feedback pins directly onto any normal `http` or `https` page. Comments are grouped by the page URL and synchronized through the Pinpoint API after the reviewer signs in with Zero Auth.

## Install locally

1. Extract the extension folder if you downloaded the ZIP.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select this `extension` folder.
5. Pin Pinpoint to the toolbar, open it, and choose **Continue with Zero**.

## How authentication works

The extension starts Zero's device authorization flow and opens Zero's approval page in a new tab. Access and refresh tokens stay in `chrome.storage.local` inside the extension's background worker. Page scripts never receive the tokens; they request authenticated comment operations through the background worker.

## Local development

The hosted API URL and Zero API version are defined near the top of `background.js`. Reload the extension from `chrome://extensions` after changing any file.
