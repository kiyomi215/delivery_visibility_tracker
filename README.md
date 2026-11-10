# Delivery Visibility Release Tracker

The tracker is a small web app with release tabs, editable work items, and archive and restore. It uses a Cloudflare Worker with a D1 database. The build has no package dependencies.

## Build

Run `node build.mjs` from the repository root with Node.js 22 or later. The deployable Worker is written to `dist/server/index.js`.

- `web/` contains the page, browser behavior, and initial release data.
- `worker/index.mjs` handles password access and stores work items.
- `drizzle/` contains the D1 schema migrations.

## Deploy a fork

Create a separate Site for the fork and configure its project ID in `.openai/hosting.json`. The manifest requests the `DB` binding. Apply the checked-in migrations through the Sites publishing workflow. Set `TRACKER_PASSWORD` and `TRACKER_SESSION_KEY` as deployment secrets. Use a fresh, random signing key for each deployment.

The source includes the original release seed. Edits and additions on the live tracker are stored in its hosted database and are separate from this repository.
