# Implementation plan

1. Read runtime/profile facts from profileContext and the installation-owned app-boot API; snapshot user bundle versions and activation without credentials.
2. Add a standalone SSH preparation worker with a home-scoped lock, user-owned exact runtime installation, plugin reconciliation, backups, verified service ownership and health checks.
3. Transport structured snapshot/artifacts over SSH stdin, publish setup stages to Settings, serialize duplicate Connect requests and leave automatic startup installation-free.
4. Add behavioral tests using isolated fake package/runtime executables for successful reconciliation, repeated Connect, missing prerequisites, unavailable packages and unrelated listeners. Run the static gate and container P0/P1 acceptance, recording any environment blockers.
5. Update remote setup documentation and review the diff.
