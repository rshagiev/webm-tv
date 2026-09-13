#!/bin/sh
set -eu
# The index is atomically replaced by the app, so cp reads a complete snapshot.
install -d -m 700 /var/backups/webmtv
if [ -f /var/lib/webmtv/data/library.json ]; then
    cp /var/lib/webmtv/data/library.json /var/backups/webmtv/index.tmp
    gzip -f /var/backups/webmtv/index.tmp
    mv /var/backups/webmtv/index.tmp.gz "/var/backups/webmtv/index-$(date +%F).json.gz"
    find /var/backups/webmtv -name 'index-*.json.gz' -mtime +2 -delete
fi
