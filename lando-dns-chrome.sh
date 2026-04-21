#!/bin/bash
# lando-dns-chrome.sh — Point Chrome container DNS at the gateway's dnsmasq
#
# Chrome containers share the gateway's network namespace (network_mode:
# "service:openclaw-gateway"), so dnsmasq at 127.0.0.1:53 in the gateway is
# reachable from Chrome. This init script just updates resolv.conf to use it.
#
# Runs as root via /custom-cont-init.d/ in linuxserver/chromium.

set -e

# Wait briefly for dnsmasq to be ready (gateway starts it before Chrome boots)
RETRIES=10
for i in $(seq 1 $RETRIES); do
  if nslookup test.lndo.site 127.0.0.1 >/dev/null 2>&1 || \
     dig @127.0.0.1 test.lndo.site +short +timeout=1 >/dev/null 2>&1 || \
     nc -z 127.0.0.1 53 2>/dev/null; then
    echo "[lando-dns-chrome] dnsmasq reachable on 127.0.0.1:53"
    cp /etc/resolv.conf /etc/resolv.conf.original 2>/dev/null || true
    echo "nameserver 127.0.0.1" > /etc/resolv.conf
    echo "[lando-dns-chrome] DNS updated to use gateway dnsmasq"
    exit 0
  fi
  sleep 1
done

echo "[lando-dns-chrome] WARNING: dnsmasq not reachable after ${RETRIES}s. DNS unchanged."
