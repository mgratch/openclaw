#!/bin/bash
# Install CA trust tools if missing (linuxserver/chromium doesn't include them)
if ! command -v update-ca-certificates &>/dev/null || ! command -v certutil &>/dev/null; then
  apt-get update -qq && apt-get install -yqq ca-certificates libnss3-tools >/dev/null 2>&1
fi

# System trust store
update-ca-certificates 2>/dev/null || true

# Chrome NSS trust store (wipe stale db)
rm -rf /config/.pki/nssdb
mkdir -p /config/.pki/nssdb
certutil -d sql:/config/.pki/nssdb -N --empty-password
certutil -d sql:/config/.pki/nssdb -A -t "C,," -n "LandoCA" -i /usr/local/share/ca-certificates/lndo-ca.crt
