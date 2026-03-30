#!/bin/bash
# Drop this in your project root. Run: ./pick.sh
FILE=$(find src -name '*.ts' -o -name '*.tsx' | grep -v 'node_modules' | shuf -n 1)
echo ""
echo "  ☕ Starting file:"
echo "  → $FILE"
echo ""
