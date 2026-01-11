#!/bin/bash
# Build script for OpenCode Sidebar plugin
# Embeds Python PTY scripts as base64 into main.js

set -e

JS_FILE="main.js"

if [ ! -f "$JS_FILE" ]; then
    echo "Error: $JS_FILE not found. Run 'npm run build' first."
    exit 1
fi

# Embed Unix PTY script
if [ -f "terminal_pty.py" ]; then
    echo "Embedding terminal_pty.py..."
    B64=$(base64 -w 0 "terminal_pty.py" 2>/dev/null || base64 "terminal_pty.py" | tr -d '\n')
    sed -i "s|__PTY_SCRIPT_B64__|$B64|g" "$JS_FILE"
    echo "Done."
else
    echo "Warning: terminal_pty.py not found"
fi

# Embed Windows PTY script
if [ -f "terminal_win.py" ]; then
    echo "Embedding terminal_win.py..."
    WIN_B64=$(base64 -w 0 "terminal_win.py" 2>/dev/null || base64 "terminal_win.py" | tr -d '\n')
    sed -i "s|__WIN_PTY_SCRIPT_B64__|$WIN_B64|g" "$JS_FILE"
    echo "Done."
else
    echo "Warning: terminal_win.py not found"
fi

echo "Build complete!"
