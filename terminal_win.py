#!/usr/bin/env python3
"""
Windows PTY wrapper for OpenCode terminal.
Uses pywinpty for ConPTY support.
"""

import sys
import os
import threading
import time

try:
    from winpty import PtyProcess
except ImportError:
    sys.stderr.write("Error: pywinpty is required. Install with: pip install pywinpty\n")
    sys.exit(1)


class WindowsPTY:
    def __init__(self, cols, rows, cmd):
        self.cols = cols
        self.rows = rows
        self.cmd = cmd
        self.proc = None
        self.running = True
    
    def start(self):
        """Start the PTY process."""
        # Join command for winpty
        if isinstance(self.cmd, list):
            cmd_str = ' '.join(self.cmd)
        else:
            cmd_str = self.cmd
        
        self.proc = PtyProcess.spawn(
            cmd_str,
            dimensions=(self.rows, self.cols)
        )
        
        # Start output reader thread
        reader_thread = threading.Thread(target=self.read_output, daemon=True)
        reader_thread.start()
        
        # Handle input in main thread
        self.handle_input()
    
    def read_output(self):
        """Read output from PTY and write to stdout."""
        try:
            while self.running and self.proc.isalive():
                try:
                    data = self.proc.read(4096)
                    if data:
                        # Filter out focus event sequences that get echoed
                        data = self.filter_focus_events(data)
                        if data:
                            sys.stdout.write(data)
                            sys.stdout.flush()
                except EOFError:
                    break
                except Exception:
                    time.sleep(0.01)
        except Exception:
            pass
        finally:
            self.running = False
    
    def filter_focus_events(self, data):
        """Filter out terminal focus event escape sequences."""
        # Remove focus in/out sequences
        import re
        data = re.sub(r'\x1b\[\?1004[hl]', '', data)
        data = re.sub(r'\x1b\[I', '', data)
        data = re.sub(r'\x1b\[O', '', data)
        return data
    
    def handle_input(self):
        """Handle input from stdin."""
        try:
            while self.running and self.proc.isalive():
                try:
                    # Read input (blocking)
                    data = sys.stdin.read(1)
                    if not data:
                        break
                    
                    # Check for resize escape sequence
                    if data == '\x1b':
                        # Buffer potential escape sequence
                        buffer = data
                        while True:
                            try:
                                c = sys.stdin.read(1)
                                if not c:
                                    break
                                buffer += c
                                if buffer.startswith('\x1b]RESIZE;'):
                                    if c == '\x07':
                                        # Parse resize
                                        self.handle_resize(buffer)
                                        buffer = ''
                                        break
                                elif len(buffer) > 50:
                                    # Too long, not a resize
                                    break
                                elif not '\x1b]RESIZE;'.startswith(buffer[:len('\x1b]RESIZE;')]):
                                    # Not a resize sequence
                                    break
                            except:
                                break
                        
                        if buffer:
                            self.proc.write(buffer)
                    else:
                        self.proc.write(data)
                        
                except EOFError:
                    break
                except Exception:
                    time.sleep(0.01)
        except Exception:
            pass
        finally:
            self.running = False
    
    def handle_resize(self, data):
        """Handle resize escape sequence."""
        try:
            # Format: \x1b]RESIZE;cols;rows\x07
            params = data[8:-1]  # Strip \x1b]RESIZE; and \x07
            cols, rows = params.split(';')
            self.proc.setwinsize(int(rows), int(cols))
        except Exception as e:
            sys.stderr.write(f"Resize error: {e}\n")


def main():
    if len(sys.argv) < 4:
        sys.stderr.write("Usage: terminal_win.py <cols> <rows> <command> [args...]\n")
        sys.exit(1)
    
    cols = int(sys.argv[1])
    rows = int(sys.argv[2])
    cmd = sys.argv[3:]
    
    pty = WindowsPTY(cols, rows, cmd)
    pty.start()


if __name__ == '__main__':
    main()
