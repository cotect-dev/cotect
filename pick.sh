#!/bin/bash
# Drop this in your project root. Run: ./pick.sh
cd "$(dirname "$0")"

FILE=$(find src -name '*.ts' -o -name '*.tsx' | grep -v 'node_modules' | shuf -n 1)

echo ""
echo "  ☕ Today's file:"
echo "  → $FILE"
echo ""

code . "$FILE" &
yarn dev &

sleep 3
echo "  IDE open. Dev server running. Timer starts now."
echo ""
