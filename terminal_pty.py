#!/usr/bin/env python3
"""
Unix PTY wrapper for OpenCode terminal.
Handles pseudo-terminal creation and resize events.
"""

import sys
import os
import pty
import select
import signal
import struct
import fcntl
import termios

# Global for child PID
child_pid = None
master_fd = None


def set_size(fd, cols, rows):
    """Set terminal size."""
    size = struct.pack('HHHH', rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, size)


def handle_resize_escape(data, fd):
    """
    Check for and handle resize escape sequences.
    Format: \x1b]RESIZE;cols;rows\x07
    Returns data with resize sequences stripped.
    """
    result = b''
    i = 0
    while i < len(data):
        # Check for escape sequence start
        if data[i:i+8] == b'\x1b]RESIZE;':
            # Find the end of the sequence
            end = data.find(b'\x07', i)
            if end != -1:
                # Parse cols and rows
                try:
                    params = data[i+8:end].decode('utf-8')
                    cols, rows = params.split(';')
                    set_size(fd, int(cols), int(rows))
                    # Send SIGWINCH to child
                    if child_pid:
                        os.kill(child_pid, signal.SIGWINCH)
                except (ValueError, OSError) as e:
                    sys.stderr.write(f"Resize error: {e}\n")
                i = end + 1
                continue
        result += data[i:i+1]
        i += 1
    return result


def main():
    global child_pid, master_fd
    
    if len(sys.argv) < 4:
        sys.stderr.write("Usage: terminal_pty.py <cols> <rows> <command> [args...]\n")
        sys.exit(1)
    
    cols = int(sys.argv[1])
    rows = int(sys.argv[2])
    cmd = sys.argv[3:]
    
    # Fork with PTY
    pid, fd = pty.fork()
    
    if pid == 0:
        # Child process
        # Set initial terminal size
        try:
            set_size(sys.stdout.fileno(), cols, rows)
        except:
            pass
        
        # Execute the command
        os.execvp(cmd[0], cmd)
    else:
        # Parent process
        child_pid = pid
        master_fd = fd
        
        # Set initial size
        set_size(fd, cols, rows)
        
        # Set stdin to non-blocking
        old_flags = fcntl.fcntl(sys.stdin.fileno(), fcntl.F_GETFL)
        fcntl.fcntl(sys.stdin.fileno(), fcntl.F_SETFL, old_flags | os.O_NONBLOCK)
        
        # Set stdout to binary mode for proper output
        sys.stdout = os.fdopen(sys.stdout.fileno(), 'wb', buffering=0)
        sys.stdin = os.fdopen(sys.stdin.fileno(), 'rb', buffering=0)
        
        try:
            while True:
                try:
                    rlist, _, _ = select.select([fd, sys.stdin], [], [], 0.1)
                except select.error:
                    continue
                
                if fd in rlist:
                    try:
                        data = os.read(fd, 4096)
                        if not data:
                            break
                        sys.stdout.write(data)
                        sys.stdout.flush()
                    except OSError:
                        break
                
                if sys.stdin in rlist:
                    try:
                        data = sys.stdin.read(4096)
                        if data:
                            # Handle resize escape sequences
                            data = handle_resize_escape(data, fd)
                            if data:
                                os.write(fd, data)
                    except (OSError, IOError):
                        pass
                
                # Check if child is still alive
                result = os.waitpid(pid, os.WNOHANG)
                if result[0] != 0:
                    break
                    
        except KeyboardInterrupt:
            pass
        finally:
            try:
                os.close(fd)
            except:
                pass
            try:
                os.kill(pid, signal.SIGTERM)
            except:
                pass


if __name__ == '__main__':
    main()
