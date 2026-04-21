#!/bin/bash
# lando-dns.sh — Wildcard *.lndo.site DNS resolution for Docker containers
#
# Configures dnsmasq to resolve all *.lndo.site domains to the Docker host
# (where Lando's traefik proxy listens). This runs inside the gateway container
# at startup. Since all Chrome containers share the gateway's network namespace
# (network_mode: "service:openclaw-gateway"), they all inherit this DNS config.
#
# Why dnsmasq?
#   - /etc/hosts doesn't support wildcard entries
#   - Docker Desktop's DNS proxy doesn't use macOS /etc/resolver/* files
#   - Lando sites resolve to 127.0.0.1 on the host, but inside Docker that's
#     the container's own loopback — we need host-gateway instead

set -e

# Resolve the Docker host gateway IPv4 address.
# host.docker.internal may resolve to IPv6 (fdc4:...) which Lando's traefik
# doesn't listen on, so we force IPv4 via getent ahostsv4.
HOST_IP=$(getent ahostsv4 host.docker.internal 2>/dev/null | awk 'NR==1{print $1}')
if [ -z "$HOST_IP" ]; then
  # Fallback: try IPv4 of host-gateway
  HOST_IP=$(getent ahostsv4 host-gateway 2>/dev/null | awk 'NR==1{print $1}')
fi
if [ -z "$HOST_IP" ]; then
  # Last resort: try any resolution and hope for the best
  HOST_IP=$(getent hosts host.docker.internal 2>/dev/null | awk '{print $1}')
fi
if [ -z "$HOST_IP" ]; then
  echo "[lando-dns] WARNING: Could not resolve Docker host IP. Skipping DNS setup."
  exit 0
fi

echo "[lando-dns] Host gateway IP: $HOST_IP"

# Capture upstream DNS servers before we override resolv.conf
UPSTREAM_DNS=$(grep '^nameserver' /etc/resolv.conf | head -3 | awk '{print $2}')
if [ -z "$UPSTREAM_DNS" ]; then
  UPSTREAM_DNS="8.8.8.8"
fi

# Write dnsmasq config
mkdir -p /etc/dnsmasq.d
cat > /etc/dnsmasq.d/lndo-site.conf << EOF
# Resolve all *.lndo.site to Docker host (Lando traefik proxy)
address=/lndo.site/${HOST_IP}

# Don't read /etc/hosts (we manage DNS ourselves)
no-hosts

# Don't read /etc/resolv.conf (we set upstream explicitly)
no-resolv

# Listen only on loopback
listen-address=127.0.0.1
bind-interfaces

# Forward everything else to upstream DNS
$(echo "$UPSTREAM_DNS" | while read -r ns; do echo "server=${ns}"; done)

# Cache DNS responses
cache-size=1000
EOF

# Start dnsmasq (daemonized)
dnsmasq --conf-dir=/etc/dnsmasq.d --keep-in-foreground &
DNSMASQ_PID=$!

# Brief pause for dnsmasq to start listening
sleep 0.5

# Verify dnsmasq is running
if kill -0 "$DNSMASQ_PID" 2>/dev/null; then
  # Point system resolver to local dnsmasq
  # (keep a backup for debugging)
  cp /etc/resolv.conf /etc/resolv.conf.original 2>/dev/null || true
  echo "nameserver 127.0.0.1" > /etc/resolv.conf

  echo "[lando-dns] dnsmasq running (PID $DNSMASQ_PID). All *.lndo.site → $HOST_IP"
else
  echo "[lando-dns] WARNING: dnsmasq failed to start. DNS unchanged."
fi
