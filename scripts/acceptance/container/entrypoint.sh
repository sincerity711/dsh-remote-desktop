#!/usr/bin/env bash
set -euo pipefail

install -d -m 700 -o dsh -g dsh /home/dsh/.ssh
if [ -n "${DSH_AUTHORIZED_KEYS:-}" ]; then
  printf '%s\n' "$DSH_AUTHORIZED_KEYS" > /home/dsh/.ssh/authorized_keys
elif [ -s /acceptance/authorized_keys ]; then
  cp /acceptance/authorized_keys /home/dsh/.ssh/authorized_keys
else
  echo "missing SSH authorized key; set DSH_AUTHORIZED_KEYS" >&2
  exit 64
fi
chown dsh:dsh /home/dsh/.ssh/authorized_keys
chmod 600 /home/dsh/.ssh/authorized_keys
ssh-keygen -A >/dev/null
exec /usr/sbin/sshd -D -e
