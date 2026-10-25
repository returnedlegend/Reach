# Publishing Reach on one host

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

## Back up and restore

Take a backup before each release and on a schedule appropriate to the data and
the operator's recovery needs. This procedure stops all database writers, then
uses SQLite VACUUM INTO to make a standalone consistent snapshot that includes
committed WAL data. Copying only community.sqlite can omit recent writes when a
WAL sidecar exists. Store backups encrypted and access-controlled outside the
deployment host, and periodically practice a restore using a separate test
volume.

Back up:

Restart after the copy:

```sh
docker compose --env-file deploy/production.env -f deploy/compose.yaml up -d app caddy
```

Restore only during a planned maintenance window. Set `BACKUP` to a verified
backup filename inside `backups/`. The one-shot maintenance container below
runs as root to read a mode-600 host backup and repair ownership in the volume;
the persistent app and worker continue to run as `node` (UID 1000).

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

## Configuration and release gates

All optional integrations are disabled in the template. Enable them only after
the operator has completed the relevant review and a production check:

For a release, back up the current database, build the candidate image, restart
app and Caddy, then check `/api/health`, key public pages, account and community
flows that are enabled, and any integrations deliberately selected above. If
the release fails, stop the worker and app, restore the pre-release database if
the schema or data changed incompatibly, and redeploy the last known-good image.
Keep the worker off until the app and restored database are healthy.
