# Running FlaRC in a container or Kubernetes

The image runs the prebuilt Nitro workerd bundle in Miniflare on Node, with a TCP-to-WebSocket IRC bridge. It is built for **linux/amd64**. No source build, code watcher, or demo bot starts in production. Both Durable Object SQLite and R2 data must use persistent storage; the launcher stores them in `/data/do` and `/data/r2` respectively.

The example uses one replica and a `ReadWriteOnce` PVC. The deployment uses `Recreate` so two pods do not write the same SQLite files concurrently. This is a single-instance deployment, not a high-availability topology. Back up the whole `/data` volume consistently while the instance is stopped.

## Local container

Build from a stable checkout and select the desired image tag:

```sh
docker build --platform linux/amd64 -t flarc:local .
docker volume create flarc-data
docker run --rm --name flarc -p 8788:8788 -p 6667:6667 \
  -v flarc-data:/data \
  -e ADMIN_USERS=flarcadmin -e ADMIN_TOKEN="$(openssl rand -hex 32)" \
  flarc:local
```

For an actual installation, generate and save the bootstrap token securely before starting, then supply that same value to the container and the one-time administrator registration request. The inline token above is only a disposable local example. The container has no default administrator password or token. Provision an account matching `ADMIN_USERS` with `POST /api/v1/auth/register` and the token in `X-Bootstrap-Token`; use a unique strong account password. Bootstrap is consumed after the initial administrator is created. See [API documentation](../docs/api/README.md) for authentication and administrative routes.

HTTP and the raw IRC bridge are plain TCP in this example. Place them behind appropriate TLS termination and network controls for your environment. HTTP health is available at `/health`; ports 8788 and 6667 serve HTTP/WebSocket and IRC respectively.

The launcher derives client addresses from the immediate socket peer and strips supplied forwarding and internal gateway headers. When a reverse proxy or Kubernetes networking sits in front of FlaRC, that proxy or network hop is the immediate peer; forwarded addresses and pod CIDRs are not trusted automatically. Account bans do not depend on hostmask attribution. The internal workerd listener is loopback-only and requires a per-process ingress secret, which is also used to authenticate the in-process TCP bridge.

## Kubernetes

1. Set a real published image tag in `kubernetes/deployment.yaml`; `v0.0.0` is an unpublished placeholder tag. Select a storage class and volume size appropriate for the cluster in `kubernetes/pvc.yaml`.
2. Create a secret in the target namespace with a generated bootstrap token, without committing it to Git:

   ```sh
   kubectl create secret generic flarc-secrets --from-literal=ADMIN_TOKEN="$(openssl rand -hex 32)"
   ```

   Set `ADMIN_USERS` in `kubernetes/configmap.yaml` to the chosen bootstrap administrator username. Add other secrets only when their features are configured; do not put passwords or tokens in the ConfigMap.
3. Review and apply `allowlist-configmap.example.yaml` as the `flarc-allowlist` ConfigMap, then apply the manifests under `kubernetes/`. The directory mount at `/etc/flarc` is intentional: Kubernetes can replace the mounted ConfigMap symlink and the launcher reloads it. Do not use a `subPath` mount for this file.
4. Provision the initial administrator using the stored token and a strong password. Set ingress, external addresses, TLS, network policies, backup, and secret rotation according to the environment; no ingress host or automatic cluster rollout is supplied here.

The ConfigMap defaults signup to closed; change `SIGNUP_POLICY` only when public registration is intended. The ConfigMap sets `AUDIT_LOG_ENABLED=false` by default. Change it to `true` only when audit retention and access are configured. The allowlist is a purpose-separated operator grant; it does not itself establish DNS or resolved-address safety. The local/Kubernetes launcher additionally resolves all addresses, rejects special-use or mixed results and pins an allowed public address for TLS using the original hostname. This local adapter is not a substitute for provider-side network policy or verification of Cloudflare deployment behavior.

R2 uploads reserve account quota for a 15-minute lease. Cancellation or expiry removes the reservation and releases that quota; unpublished files remain inaccessible. Each account database persists a random application-owned R2 prefix, and an alarm scans at most 100 objects per page with a durable cursor to remove unreferenced keys. A write that completes after cancellation is discovered on a later pass, provided provider operations and alarms recover. The scan never deletes unrelated bucket prefixes or unknown legacy bare keys; specifically tracked legacy pending keys are retried separately. This is eventual reconciliation, not an absolute deletion deadline or a provider-wide physical byte ceiling while operations are delayed.

## Launcher configuration

`HOST` and `TCP_HOST` select HTTP and IRC bind addresses. `PORT` and `TCP_PORT` select their ports, and `STATE_DIR` contains the `do` and `r2` persistence directories. Local development defaults to loopback ports 8788/6667 and `.wrangler/state/v3`; `NODE_ENV=production` disables builds, source watchers and optional demo bots. In development, `FLARC_SKIP_BUILD=1` and `FLARC_NO_WATCH=1` independently disable the initial build and code watching. The allowlist watcher remains active when `ALLOWLIST_FILE` is configured. SIGTERM/SIGINT closes the TCP bridge and disposes Miniflare.

For a read-only SQLite schema diagnostic, run `node .output/tools/verify-schema.mjs /data/do` in the image against a consistent database snapshot. It compares schema metadata with Drizzle declarations and does not inspect user or message values. Startup migration version 1000 repairs legacy nullable primary keys transactionally, preserving dependent records; default work bounds are 32 MiB/database and 100,000 affected rows. Operators can explicitly raise SQLITE_MIGRATION_MAX_BYTES and SQLITE_MIGRATION_MAX_ROWS for a planned maintenance window. The diagnostic verifies current model constraints and exact FTS layouts, lists provider metadata separately, and fails on unexplained differences. For read-only mounts, copy the complete stopped SQLite directory including WAL/SHM siblings into a private writable temporary directory first. See [schema verification](../docs/security/schema-verification.md).

## CI release gates

Pull requests run installation and static lint/type checks only. Branch pushes trigger neither workflow. A pushed version tag `vMAJOR.MINOR.PATCH` or prerelease tag such as `v1.2.3-rc.1` runs the complete application test selection, the pinned unchanged irctest selection, and an amd64 image build with real REST login, secret-channel isolation, TCP IRC and event delivery, stopped-volume schema verification, and restart-persistence smoke checks. The disposable smoke instance explicitly enables signup and is removed afterward; production signup remains closed by default. Only a successful run of all jobs can publish the same saved image to `ghcr.io/ircord/flarc` and create a GitHub release. Stable tags also move `latest`; prereleases do not. The workflow verifies the tag exists and does not create another Git tag or deploy to Kubernetes.
