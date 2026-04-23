#!/bin/sh
# openclaw-mount — Dynamic host directory mounting via sshfs
#
# Usage:
#   openclaw-mount mount <host-path> <mount-name> [ro|rw]
#   openclaw-mount unmount <mount-name>
#   openclaw-mount list
#   openclaw-mount status <mount-name>
#
# Mounts appear at /mnt/host-projects/<mount-name>
# SSH key expected at /home/node/.openclaw/sshfs/id_ed25519

set -e

MOUNT_BASE="/mnt/host-projects"
SSH_KEY="/home/node/.openclaw/sshfs/id_ed25519"
SSH_USER="${OPENCLAW_HOST_USER:-marcgratch}"
SSH_HOST="host.docker.internal"
SSH_PORT="${OPENCLAW_HOST_SSH_PORT:-22}"

# Common sshfs options
SSHFS_OPTS="StrictHostKeyChecking=no,UserKnownHostsFile=/dev/null,IdentityFile=${SSH_KEY},port=${SSH_PORT},reconnect,ServerAliveInterval=15,ServerAliveCountMax=3,allow_other"

cmd_mount() {
    host_path="$1"
    mount_name="$2"
    access="${3:-ro}"

    if [ -z "$host_path" ] || [ -z "$mount_name" ]; then
        echo '{"ok":false,"error":"Usage: openclaw-mount mount <host-path> <mount-name> [ro|rw]"}'
        exit 1
    fi

    mount_point="${MOUNT_BASE}/${mount_name}"

    # Check if already mounted
    if mountpoint -q "$mount_point" 2>/dev/null; then
        echo "{\"ok\":true,\"already_mounted\":true,\"mount_point\":\"${mount_point}\"}"
        exit 0
    fi

    # Check SSH key exists
    if [ ! -f "$SSH_KEY" ]; then
        echo '{"ok":false,"error":"SSH key not found. Run setup-sshfs-key.sh on your Mac first."}'
        exit 1
    fi

    # Create mount point
    mkdir -p "$mount_point"

    # Build options string
    opts="$SSHFS_OPTS"
    if [ "$access" = "ro" ]; then
        opts="${opts},ro"
    fi

    # Mount via sshfs
    if sshfs -o "$opts" "${SSH_USER}@${SSH_HOST}:${host_path}" "$mount_point" 2>/tmp/sshfs_err; then
        echo "{\"ok\":true,\"mount_point\":\"${mount_point}\",\"host_path\":\"${host_path}\",\"access\":\"${access}\"}"
    else
        err=$(cat /tmp/sshfs_err 2>/dev/null | tr '"' "'" | tr '\n' ' ')
        rmdir "$mount_point" 2>/dev/null || true
        echo "{\"ok\":false,\"error\":\"sshfs failed: ${err}\"}"
        exit 1
    fi
}

cmd_unmount() {
    mount_name="$1"

    if [ -z "$mount_name" ]; then
        echo '{"ok":false,"error":"Usage: openclaw-mount unmount <mount-name>"}'
        exit 1
    fi

    mount_point="${MOUNT_BASE}/${mount_name}"

    if ! mountpoint -q "$mount_point" 2>/dev/null; then
        rmdir "$mount_point" 2>/dev/null || true
        echo "{\"ok\":true,\"already_unmounted\":true}"
        exit 0
    fi

    if fusermount -u "$mount_point" 2>/tmp/fuse_err; then
        rmdir "$mount_point" 2>/dev/null || true
        echo "{\"ok\":true,\"unmounted\":\"${mount_name}\"}"
    else
        err=$(cat /tmp/fuse_err 2>/dev/null | tr '"' "'" | tr '\n' ' ')
        echo "{\"ok\":false,\"error\":\"unmount failed: ${err}\"}"
        exit 1
    fi
}

cmd_list() {
    printf '{"mounts":['
    first=true
    for dir in "$MOUNT_BASE"/*/; do
        [ -d "$dir" ] || continue
        name=$(basename "$dir")
        dir_nos="${dir%/}"
        active=false
        remote=""
        access=""
        if mountpoint -q "$dir" 2>/dev/null; then
            active=true
            # Parse /proc/mounts in one awk pass. Fields: $1=source $2=target $3=fstype $4=options
            # Match the target exactly (after unescaping /proc/mounts' octal sequences),
            # strip SSH user@host: prefix, detect ro/rw via options field.
            # /proc/mounts escapes spaces/tabs/newlines/backslashes as \040 \011 \012 \134 —
            # these are invalid JSON escapes, so we unescape to the real character
            # before emitting, otherwise JSON.parse on the consumer side blows up.
            line=$(awk -v t="$dir_nos" -v u="${SSH_USER}@${SSH_HOST}:" '
                # POSIX-awk-safe octal unescape for /proc/mounts style \NNN sequences.
                # strtonum() is a gawk extension — busybox/mawk lack it and throw,
                # which combined with set -e kills the script silently mid-output.
                function unescape(s,   out, c, i, oct, d1, d2, d3, n) {
                    out = ""
                    i = 1
                    while (i <= length(s)) {
                        c = substr(s, i, 1)
                        if (c == "\\" && i + 3 <= length(s)) {
                            oct = substr(s, i + 1, 3)
                            if (oct ~ /^[0-3][0-7][0-7]$/) {
                                d1 = substr(oct, 1, 1) + 0
                                d2 = substr(oct, 2, 1) + 0
                                d3 = substr(oct, 3, 1) + 0
                                n = d1 * 64 + d2 * 8 + d3
                                out = out sprintf("%c", n)
                                i += 4
                                continue
                            }
                        }
                        out = out c
                        i += 1
                    }
                    return out
                }
                $2 == t {
                    src = unescape($1)
                    sub("^" u, "", src)
                    opts = $4
                    mode = "rw"
                    n = split(opts, parts, ",")
                    for (i = 1; i <= n; i++) if (parts[i] == "ro") { mode = "ro"; break }
                    printf "%s\t%s", src, mode
                    exit
                }
            ' /proc/mounts 2>/dev/null)
            if [ -n "$line" ]; then
                remote=$(printf '%s' "$line" | cut -f1)
                access=$(printf '%s' "$line" | cut -f2)
            else
                remote="unknown"
                access="rw"
            fi
        fi
        if [ "$first" = true ]; then first=false; else printf ','; fi
        if [ "$active" = true ]; then
            printf '{"name":"%s","host_path":"%s","access":"%s","active":true}' "$name" "$remote" "$access"
        else
            printf '{"name":"%s","host_path":"","access":"","active":false}' "$name"
        fi
    done
    printf ']}\n'
}

cmd_status() {
    mount_name="$1"
    mount_point="${MOUNT_BASE}/${mount_name}"

    if [ ! -d "$mount_point" ]; then
        echo '{"exists":false,"mounted":false}'
        exit 0
    fi

    if mountpoint -q "$mount_point" 2>/dev/null; then
        echo '{"exists":true,"mounted":true}'
    else
        echo '{"exists":true,"mounted":false}'
    fi
}

case "${1:-}" in
    mount)   shift; cmd_mount "$@" ;;
    unmount) shift; cmd_unmount "$@" ;;
    list)    cmd_list ;;
    status)  shift; cmd_status "$@" ;;
    *)
        echo '{"ok":false,"error":"Usage: openclaw-mount mount|unmount|list|status"}'
        exit 1
        ;;
esac
