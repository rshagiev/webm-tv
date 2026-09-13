#!/bin/sh
set -eu
state=/run/webmtv-monitor
mkdir -p "$state"
if curl -fsS --max-time 8 http://127.0.0.1:4173/api/health | /usr/bin/python3 -c 'import sys,json; assert json.load(sys.stdin)["ok"]'; then
    echo 0 > "$state/failures"
else
    failures=$(cat "$state/failures" 2>/dev/null || echo 0)
    failures=$((failures + 1))
    echo "$failures" > "$state/failures"
    logger -t webmtv-monitor "Health check failed ($failures)"
    if [ "$failures" -ge 3 ]; then
        systemctl restart webmtv.service
        echo 0 > "$state/failures"
    fi
fi
