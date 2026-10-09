# Connect environment synchronization

## Outcome

Settings Connect prepares the remote environment over SSH before connecting. The active local DSH runtime and plugin profile are authoritative: remote DSH matches the exact runtime version, and remote user plugins match local installed versions and enabled states. SSH Workspace maps to its companion. Sessions, settings, plugin configuration and credentials remain remote-local.

## Scope and triggers

Explicit Connect performs inspection, reconciliation, managed restart when needed, verification and connection. Automatic startup continues to connect/start already prepared profiles without installing or reconciling dependencies. Each explicit Connect takes a fresh local snapshot. Concurrent setup for the same source is serialized; disconnect cancels remaining work and reports any completed changes.

## Local snapshot

Read the runtime version from the running host, rather than another CLI on PATH or the repository manifest. Read the active profile's installed plugin manifests and activation metadata. Capture exact installed versions, not dependency ranges. Do not copy the entire profile, configuration files, settings, credentials or built-in runtime bundles.

Map dsh-ssh-workspace to dsh-ssh-workspace-companion at the installed local plugin's exact version. Companion remains enabled because the connection requires it. The local controller must not run remotely. Other user plugins retain their local enabled state. Explicitly unsupported remote-Web plugins produce an actionable compatibility error rather than being silently skipped. Local/file/private packages must have a reproducible transferable artifact or accessible package source; failure to obtain it prevents successful synchronization. Never substitute latest.

## Remote preparation

Use the configured SSH alias and the intended remote DSH_HOME consistently for inspection, installation and startup. Resolve the noninteractive SSH environment before treating commands as missing. Verify Node/npm and the target DSH engine requirements. Missing or incompatible Node/npm produces a specific prerequisite error in this iteration; installing system runtimes and assuming sudo access are outside scope.

Install exact-version DSH into a dedicated user-owned runtime location when the remote runtime is absent or differs. Launch the managed service using the resolved exact executable. Do not change the local installation, system Node or global npm prefix. Reject missing/unavailable exact package versions with the package and stage identified.

Reconcile remote Web user plugins from the local snapshot. Install or update differing packages, reproduce enabled/disabled states, and disable remote-only user plugins while retaining their files. Preserve unrelated profile metadata, built-in Web bundles and all sessions/settings. Remove legacy controller/companion activation in favor of the mapped current companion, retaining package files where possible. Back up affected dependency and activation metadata before mutation.

## Restart and verification

Only stop a verified service owned by this integration for this home and port. PID files alone are insufficient proof of ownership. An unrelated port owner produces an actionable error. Restart after runtime or active plugin changes; skip installation and restart when the actual service and profile already match.

Verify the actual running DSH version, installed plugin versions, activation state and companion health before marking connected. A healthy companion alone must not short-circuit reconciliation. Preserve existing SSH tunnel, origin, token validation and iframe isolation behavior.

## Components and status

Keep local snapshot discovery, synchronization-plan generation, remote preparation and connection orchestration separate. The snapshot and plan are structured data with validated package names/versions and safely quoted transport; no generated shell command may interpolate untrusted metadata without escaping.

Settings reports checking environment, installing DSH, synchronizing plugins, starting/verifying and connecting. On failure, report the stage and actionable package/prerequisite error with secrets redacted. Never report connected after partial setup. Keep backup metadata and explain a partial mutation; a retry re-inspects actual state and resumes idempotently.

## Acceptance

Use isolated local and Apple container remote homes only. Meaningful unit coverage verifies runtime/profile snapshot selection, exact-version planning, companion mapping, activation reconciliation, remote-only disabling, quoting, idempotence and failure/cancellation handling.

Container coverage starts with missing DSH, mismatched DSH, mismatched/missing plugins and an extra remote plugin. Explicit Connect must converge versions/activation, preserve sentinel sessions/configuration, and make a second Connect a no-op setup. Unavailable exact versions, missing Node/npm and an unrelated listener must fail clearly without marking connected or stopping unrelated processes.

Run npm run check and the required acceptance:container:p0 user path; run acceptance:container:p1 for Settings/reconnect/multi-remote behavior. Follow the manual UI checklist for Settings status changes. Retain reports, logs and screenshots under .acceptance/artifacts. Update remote setup documentation to describe exact synchronization and remove the unpinned-companion caveat.

## Release boundary

This iteration synchronizes package inventory, versions and activation only. Plugin configuration and credentials, automatic Node installation and background installation on auto-connect are excluded. Unsupported plugin artifacts or remote-Web compatibility must be surfaced explicitly.
