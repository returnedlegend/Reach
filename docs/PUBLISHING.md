# Publishing Reach on one host

This kit runs Reach as one Node.js 24 application container behind Caddy. Caddy
terminates HTTPS and is the only service with published ports. The app and its
optional email worker share one private Docker network and one persistent
SQLite volume. Keep this single-host arrangement: the database is local SQLite,
and running more app instances against it is outside this deployment design.

The deployment files are [Dockerfile](../Dockerfile), [.dockerignore](../.dockerignore),
[Compose](../deploy/compose.yaml), [Caddyfile](../deploy/Caddyfile), and the
[environment template](../deploy/production.env.example). The production env
file contains private operator settings and is not included in the image.

## Before first launch

Select a host that can run Docker Compose and has persistent local disk. Confirm
that its costs, backup retention, access controls, maintenance plan and incident
response fit the intended use; this repository does not promise hosting prices,
availability or support levels. Choose a domain you control, point its DNS to
the host, and allow inbound TCP ports 80 and 443 (and UDP 443 if HTTP/3 is
wanted). Caddy obtains and renews certificates automatically. These DNS and
firewall changes are operator actions.

Create the private runtime file and edit it on the host:

```sh
cp deploy/production.env.example deploy/production.env
chmod 600 deploy/production.env
```

Set `REACH_DOMAIN` and `REACH_APP_ORIGIN` to the same public host, for example
`reach.example.org` and `https://reach.example.org`. The origin must have no
trailing slash. The template selects `REACH_RELEASE_PROFILE=core`, which keeps
accounts, Google sign-in, email, community submissions, volunteering and AI
disabled. Choose `extended` only when you intend to configure and operate those
features. The individual `REACH_RELEASE_ACCOUNTS`, `REACH_RELEASE_GOOGLE`,
`REACH_RELEASE_EMAIL`, `REACH_RELEASE_COMMUNITY`,
`REACH_RELEASE_VOLUNTEERING` and `REACH_RELEASE_AI` values are operator
attestations: set each to `true` only after its release checks pass. The app
still checks the selected feature's credentials and provider settings. Do not
put credentials in Git, build arguments, image layers, or browser-visible
`NEXT_PUBLIC_*` variables.

Every Compose command below uses `--env-file deploy/production.env` so Compose
can interpolate the domain and public map build arguments. The app and optional
worker receive the private env file at runtime; Caddy receives only
`REACH_DOMAIN` for its site address.

The app currently uses a built-in hosted map style when no `NEXT_PUBLIC_MAP_*`
value is supplied. Review that provider's terms and suitability for the intended
audience, or configure a suitable style or raster service in the env file. Map
configuration is public and compiled into the app image at build time. Changes
to those values require rebuilding the image. Browser map requests go directly
to the configured style/tile provider.

## Build and start

Run these commands from the repository root, on the deployment host:

```sh
docker compose --env-file deploy/production.env -f deploy/compose.yaml build app
docker compose --env-file deploy/production.env -f deploy/compose.yaml up -d app caddy
docker compose --env-file deploy/production.env -f deploy/compose.yaml ps
```

The build performs `npm ci` with development dependencies for `next build`, then
installs production dependencies separately. The runtime image uses Node 24 on
Debian slim and runs as the unprivileged `node` user. It contains the standalone
Next server, its static assets, application sources and the production
dependencies needed by worker scripts. It does not contain the host's
`deploy/production.env` or the SQLite volume.

The first app start creates `/var/lib/reach/community.sqlite` in the named
`reach-data` volume. The database includes private account and community data.
Keep the volume on persistent storage, restrict host administrator access, and
never publish its path through Caddy or another web server.
Before the app serves traffic, its built image runs `scripts/release-preflight.ts`.
The preflight verifies that the HTTPS app origin matches `REACH_DOMAIN`, the
database path is exactly `/var/lib/reach/community.sqlite` on the mounted,
writable `/var/lib/reach` volume, and the selected release profile and router
configuration are valid. It writes and syncs a small temporary volume probe to
fail fast if the database volume is already full; this does not reserve space
for future growth. The optional email worker runs the same preflight before
starting. A missing mount or a production demo router stops startup.
`docker compose --env-file deploy/production.env -f deploy/compose.yaml down -v`
deletes the database and Caddy's stored certificate data; do not use `-v` for
routine releases or shutdowns.

## Check health

The Compose health check calls `/api/health` from inside the app container. It
is a database readiness check and must return a successful status before Caddy
starts. Check the container state and the public HTTPS endpoint:

```sh
docker compose --env-file deploy/production.env -f deploy/compose.yaml ps
curl --fail --silent --show-error https://reach.example.org/api/health
```

Replace the example host with the configured domain. The health response should
report readiness only; it must not expose database content, credentials, or
configuration. Caddy has no request access-log directive, and its global JSON log filter removes the structured `request` field from operational errors. This avoids retaining request URIs, OAuth query strings, cookies and client-address metadata in that field even when the upstream fails. Keep the filter and do not add an unredacted proxy or app access log. Treat operational error logs as private host data; provider and hosting logs have their own policies.

## Optional email worker

The worker is off by default. Enable it only after the email release gate passes
and `REACH_EMAIL_PROVIDER` plus the selected provider's private settings have
been configured. It runs with the same UID and database volume as the app:

```sh
docker compose --env-file deploy/production.env -f deploy/compose.yaml --profile email up -d email-worker
docker compose --env-file deploy/production.env -f deploy/compose.yaml ps
```

The worker dispatches queued notifications and outreach and polls every five
seconds. Its startup preflight requires the extended profile, the explicit email
release attestation and a selected provider; it will not enter a restart loop
when the profile or provider remains disabled. Stop only that worker with:

```sh
docker compose --env-file deploy/production.env -f deploy/compose.yaml stop email-worker
```

It is safe to leave this profile disabled. Do not run a second copy of the
worker against the same SQLite database.

## Back up and restore

Take a backup before each release and on a schedule appropriate to the data and
the operator's recovery needs. This procedure stops all database writers, then
uses SQLite VACUUM INTO to make a standalone consistent snapshot that includes
committed WAL data. Copying only community.sqlite can omit recent writes when a
WAL sidecar exists. Store backups encrypted and access-controlled outside the
deployment host, and periodically practice a restore using a separate test
volume.

Back up:

```sh
mkdir -p backups
chmod 700 backups
docker compose --env-file deploy/production.env -f deploy/compose.yaml stop caddy
docker compose --env-file deploy/production.env -f deploy/compose.yaml stop email-worker
docker compose --env-file deploy/production.env -f deploy/compose.yaml stop app
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_NAME="reach-$STAMP.sqlite"
BACKUP_UID=$(id -u)
BACKUP_GID=$(id -g)
docker compose --env-file deploy/production.env -f deploy/compose.yaml run --rm --no-deps --user 0:0 \
  -e BACKUP_NAME="$BACKUP_NAME" -e BACKUP_UID="$BACKUP_UID" -e BACKUP_GID="$BACKUP_GID" \
  -v "$PWD/backups:/backup" app sh -ec 'node --input-type=module --eval "import { DatabaseSync } from \"node:sqlite\"; const name = process.env.BACKUP_NAME; const destination = \"/backup/\" + name; const quote = String.fromCharCode(39); const db = new DatabaseSync(\"/var/lib/reach/community.sqlite\", { readOnly: true }); db.exec(\"VACUUM INTO \" + quote + destination.replaceAll(quote, quote + quote) + quote); db.close(); const snapshot = new DatabaseSync(destination, { readOnly: true }); const integrity = snapshot.prepare(\"PRAGMA integrity_check\").get().integrity_check; snapshot.close(); if (integrity !== \"ok\") process.exit(1)" && chown "$BACKUP_UID:$BACKUP_GID" "/backup/$BACKUP_NAME" && chmod 600 "/backup/$BACKUP_NAME"'
```

Stopping Caddy first closes inbound traffic before stopping the worker and app.
If the email worker was active before maintenance, start it again only after the
app is healthy. The one-shot backup helper runs as root only to access the
private volume and set the snapshot owner to the invoking host user; the app and
worker continue to run as UID 1000.

Restart after the copy:

```sh
docker compose --env-file deploy/production.env -f deploy/compose.yaml up -d app caddy
```

Restore only during a planned maintenance window. Set `BACKUP` to a verified
backup filename inside `backups/`. The one-shot maintenance container below
runs as root to read a mode-600 host backup and repair ownership in the volume;
the persistent app and worker continue to run as `node` (UID 1000).

```sh
BACKUP=backups/reach-YYYYMMDDTHHMMSSZ.sqlite
test -r "$BACKUP"
BACKUP_NAME=$(basename "$BACKUP")
docker compose --env-file deploy/production.env -f deploy/compose.yaml stop caddy
docker compose --env-file deploy/production.env -f deploy/compose.yaml stop email-worker
docker compose --env-file deploy/production.env -f deploy/compose.yaml stop app
docker compose --env-file deploy/production.env -f deploy/compose.yaml run --rm --no-deps --user 0:0 -e BACKUP_NAME="$BACKUP_NAME" -v "$PWD/backups:/backup:ro" app sh -ec 'cp "/backup/$BACKUP_NAME" /var/lib/reach/community.restore.sqlite && node --input-type=module --eval "import { DatabaseSync } from \"node:sqlite\"; const db = new DatabaseSync(\"/var/lib/reach/community.restore.sqlite\", { readOnly: true }); const integrity = db.prepare(\"PRAGMA integrity_check\").get().integrity_check; db.close(); if (integrity !== \"ok\") process.exit(1)" && chown 1000:1000 /var/lib/reach/community.restore.sqlite && chmod 600 /var/lib/reach/community.restore.sqlite && mv /var/lib/reach/community.restore.sqlite /var/lib/reach/community.sqlite && rm -f /var/lib/reach/community.sqlite-wal /var/lib/reach/community.sqlite-shm'
docker compose --env-file deploy/production.env -f deploy/compose.yaml up -d app caddy
```

Re-enable the worker profile after health checks if queued email delivery is
part of the deployment:

```sh
docker compose --env-file deploy/production.env -f deploy/compose.yaml --profile email up -d email-worker
```

The restore replaces the live database. Do not start the app or worker until
the restore command has completed successfully. Keep the pre-restore backup
until the service has been checked.

## Verification

The local readiness image built successfully from the lockfile using Node 24
on Debian slim. Both npm dependency installs completed with strict TLS and the
optional BuildKit CA secret mount. The host-side lock-only refresh had earlier
been blocked by `EALLOWREMOTE`; `npm ci` in the image succeeded against the
existing lockfile without changing package versions or integrity hashes.
The first Docker invocation could not create Buildx metadata under the
read-only Docker config directory; the successful retry used task-scoped
`BUILDX_CONFIG` storage under `/tmp` without changing Docker credentials or
proxy settings. npm warned that the `esbuild` postinstall was not covered by
`allowScripts`; the production build and tsx worker execution both succeeded.

The first image build exposed that the builder typechecks
`scripts/evaluate-access.ts`, which imports a fixture under `tests/`; including
`tests/` in the build context fixed that build. The first worker smoke check
then exposed a runtime import under repository-root `data/`; copying `data/`
into the runner image fixed it. The final image build passed Next compilation,
typechecking, static generation and standalone output generation.

The app ran on a newly created named volume as UID 1000, bound only to
`127.0.0.1` on an ephemeral high host port. `/api/health`, `/`, `/api/pantries`
and `/api/account/status` returned HTTP 200. Health returned
`{"status":"ok"}` with `Cache-Control: no-store`; the account status was
disabled. The SQLite file was mode `0600`, owned by UID/GID 1000. Next listed
`/api/health` as dynamic, and no `.env*` filenames were found in `/app`.

A separate disposable Compose project with network_mode none verified database
persistence and recovery using synthetic markers only. A marker survived
replacing the app container while retaining its named volume. The backup/restore
test stopped the app before snapshotting; the snapshot passed SQLite integrity
checking. After adding a second synthetic marker, restoring the snapshot
returned the original marker, removed the later marker, and the restarted app
returned healthy. An earlier copy of only the main SQLite file omitted a
committed WAL marker, so the backup instructions now use VACUUM INTO after
stopping writers. The disposable test container, volume, and backup were removed.

The one-shot email worker ran with email disabled and container networking
disabled. It processed and accepted zero messages, reported unavailable, and
exited with status 1 as the script specifies when delivery is disabled. No
message was sent. Caddy's Caddyfile validation passed in a network-isolated
container without starting a listener.

These checks used local containers only. No public deployment, DNS change,
public HTTP request, live HTTPS certificate, ACME request, or live email send
was performed. See [sanitized machine-readable evidence](evidence/publication-verification.json).

## Configuration and release gates

All optional integrations are disabled in the template. Enable them only after
the operator has completed the relevant review and a production check:

- **Accounts and community submissions:** configure the exact HTTPS app origin.
  Before setting `REACH_ACCOUNT_ENABLED=true` or
  `REACH_COMMUNITY_ENABLED=true`, publish accurate privacy and terms information,
  assign moderation and abuse-report handling, decide retention/deletion
  procedures, create a moderator account through the documented admin command,
  and rehearse restore from backup. Do not enable public submissions without a
  staffed moderation plan.
- **Google sign-in:** keep accounts disabled until the OAuth client is privately
  configured with the exact `${REACH_APP_ORIGIN}/api/auth/google/callback`
  redirect URI, credentials are installed in the private env file, and a
  controlled authorized-account sign-in test succeeds over HTTPS.
- **Email:** leave `REACH_EMAIL_PROVIDER=disabled` until provider terms, sending
  identity, reply handling, rate limits, unsubscribe behavior and delivery
  failures have been reviewed. Send a controlled test only after explicit
  operator authorization. Then enable the email worker profile if queued
  notifications are required.
- **AI:** leave `REACH_AI_PROVIDER=disabled`. Review provider terms, data
  handling, user disclosure and applicable consent before deliberately
  selecting a provider and setting `REACH_AI_DATA_POLICY_ACCEPTED=true`. Keep
  `REACH_AI_FREE_ONLY=true` and `REACH_AI_ALLOW_PAID=false` unless an operator
  separately authorizes paid use.
- **Geocoding and routing:** leave `OSM_GEOCODER_URL` empty and
  `OSM_ROUTER_MODE=disabled` until an operator selects a compliant host and
  verifies its terms, rate limits, attribution, privacy behavior, capacity and
  contact requirements. Disabled routing returns an explicit unavailable state
  and may hand off to the published timetable; the release makes no claim of
  calculated walking or driving route reliability in that configuration.
  Routing is an external production dependency when the release needs computed
  directions. For those directions, select a compatible hosted or self-hosted
  Valhalla service with `OSM_ROUTER_MODE=valhalla` and set `OSM_ROUTER_URL` to
  its HTTPS origin. The preflight rejects non-HTTPS, path-based, loopback and
  credential-bearing production router URLs. HTTP localhost is limited to an
  opted-in preview. The public `valhalla-demo` endpoint is preview-only; a
  preview must explicitly set `REACH_ENVIRONMENT=preview` and
  `REACH_ROUTER_DEMO_ACKNOWLEDGED=true`. The production Compose deployment pins
  the environment to `production`, so the preflight rejects demo routing even
  when the acknowledgement is present. Address geocoding is submitted only
  after a user submits the address form; the UI does not autocomplete. Public
  Nominatim requires the exact `https://nominatim.openstreetmap.org` origin and
  `OSM_NOMINATIM_SINGLE_INSTANCE=true`. Any enabled geocoder or router also
  requires an `OSM_USER_AGENT` that identifies Reach and supplies a real project
  URL or contact email. Replace every sample value before enabling a provider.
- **Maps:** review the selected browser-facing map style/tile host, attribution,
  privacy implications, terms and expected capacity. Set only public map URLs
  in `NEXT_PUBLIC_MAP_*`; rebuild after a change.
- **Operations:** verify the public health check, HTTPS renewal, disk capacity,
  backup access controls, alert ownership, restore rehearsal and the release
  rollback procedure. Confirm that the host's contract and capacity match the
  intended audience; this kit does not set an SLA or hosting price.

For a release, back up the current database, build the candidate image, restart
app and Caddy, then check `/api/health`, key public pages, account and community
flows that are enabled, and any integrations deliberately selected above. If
the release fails, stop the worker and app, restore the pre-release database if
the schema or data changed incompatibly, and redeploy the last known-good image.
Keep the worker off until the app and restored database are healthy.
