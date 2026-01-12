import { Plugin, ItemView, WorkspaceLeaf, Scope, addIcon, FileSystemAdapter } from 'obsidian';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const VIEW_TYPE = 'opencode-terminal';
const ICON_NAME = 'opencode';

// Custom OpenCode icon - based on official favicon
const OPENCODE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="currentColor">
  <path fill-rule="evenodd" clip-rule="evenodd" d="M384 416H128V96H384V416ZM320 160H192V352H320V160Z"/>
</svg>`;

// These will be replaced by the build script with base64-encoded Python scripts
const PTY_SCRIPT_B64 = "__PTY_SCRIPT_B64__";
const WIN_PTY_SCRIPT_B64 = "__WIN_PTY_SCRIPT_B64__";

class OpenCodeTerminalView extends ItemView {
    private term: Terminal | null = null;
    private fitAddon: FitAddon | null = null;
    private proc: ChildProcess | null = null;
    private resizeObserver: ResizeObserver | null = null;
    private termHost: HTMLElement | null = null;
    private pendingFit: boolean = false;
    private escapeScope: Scope | null = null;
    private plugin: OpenCodePlugin;

    constructor(leaf: WorkspaceLeaf, plugin: OpenCodePlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE;
    }

    getDisplayText(): string {
        return 'Opencode';
    }

    getIcon(): string {
        return ICON_NAME;
    }

    onOpen(): void {
        this.buildUI();
        this.initTerminal();
        this.startShell();
        this.setupEscapeHandler();
    }

    onClose(): void {
        this.dispose();
    }

    private buildUI(): void {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('vault-terminal');

        this.termHost = container.createDiv({ cls: 'vault-terminal-host' });
    }

    private getThemeColors(): { background: string; foreground: string; cursor: string } {
        const styles = getComputedStyle(document.body);
        return {
            background: styles.getPropertyValue('--background-secondary').trim() || '#1e1e1e',
            foreground: styles.getPropertyValue('--text-normal').trim() || '#d4d4d4',
            cursor: styles.getPropertyValue('--text-accent').trim() || '#007acc'
        };
    }

    private initTerminal(): void {
        if (!this.termHost) return;

        const colors = this.getThemeColors();

        this.term = new Terminal({
            cursorBlink: true,
            fontSize: 14,
            fontFamily: 'Menlo, Monaco, "Courier New", monospace',
            theme: {
                background: colors.background,
                foreground: colors.foreground,
                cursor: colors.cursor
            },
            allowProposedApi: true
        });

        this.fitAddon = new FitAddon();
        this.term.loadAddon(this.fitAddon);
        this.term.open(this.termHost);
        this.fitAddon.fit();

        // Handle paste events with images
        this.termHost.addEventListener('paste', (e: ClipboardEvent) => {
            const items = e.clipboardData?.items;
            if (!items) return;

            for (const item of Array.from(items)) {
                if (item.type.startsWith('image/')) {
                    e.preventDefault();
                    const blob = item.getAsFile();
                    if (!blob) continue;

                    void blob.arrayBuffer().then((buffer) => {
                        const ext = item.type.split('/')[1] || 'png';
                        const tmpPath = path.join(os.tmpdir(), `opencode-paste-${Date.now()}.${ext}`);
                        fs.writeFileSync(tmpPath, Buffer.from(buffer));

                        if (this.proc?.stdin?.writable) {
                            this.proc.stdin.write(`"${tmpPath}"`);
                        }
                    });
                    return;
                }
            }
        });

        // Custom key handling
        this.term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
            // Let Shift+Enter through for multi-line input
            if (e.key === 'Enter' && e.shiftKey) {
                return true;
            }
            return true;
        });

        // Setup resize observer
        this.resizeObserver = new ResizeObserver(() => {
            if (this.pendingFit) return;
            this.pendingFit = true;
            requestAnimationFrame(() => {
                this.pendingFit = false;
                this.performFit();
            });
        });
        this.resizeObserver.observe(this.termHost);

        // Handle scroll to prevent Obsidian interference
        this.termHost.addEventListener('wheel', (e: WheelEvent) => {
            e.stopPropagation();
        }, { passive: true });
    }

    private performFit(): void {
        if (!this.fitAddon || !this.term || !this.proc?.stdin?.writable) return;

        try {
            this.fitAddon.fit();
            const dims = this.fitAddon.proposeDimensions();
            // Only send resize if we have valid dimensions
            if (dims && !isNaN(dims.cols) && !isNaN(dims.rows) && dims.cols > 0 && dims.rows > 0) {
                // Send resize command to PTY via escape sequence
                const resizeCmd = `\x1b]RESIZE;${Math.floor(dims.cols)};${Math.floor(dims.rows)}\x07`;
                this.proc.stdin.write(resizeCmd);
            }
        } catch (e) {
            console.error('OpenCode: fit error', e);
        }
    }

    private findOpenCodeBinary(): string | null {
        const isWindows = process.platform === 'win32';
        const homeDir = os.homedir();
        
        // Common locations for opencode binary
        const candidates = isWindows ? [
            path.join(homeDir, '.opencode', 'bin', 'opencode.exe'),
            path.join(homeDir, 'AppData', 'Local', 'opencode', 'bin', 'opencode.exe'),
            'opencode.exe', // In PATH
        ] : [
            path.join(homeDir, '.opencode', 'bin', 'opencode'),
            '/usr/local/bin/opencode',
            '/usr/bin/opencode',
            path.join(homeDir, '.local', 'bin', 'opencode'),
            'opencode', // In PATH
        ];

        for (const candidate of candidates) {
            try {
                // Check if it's an absolute path that exists
                if (path.isAbsolute(candidate) && fs.existsSync(candidate)) {
                    return candidate;
                }
            } catch {
                // Continue to next candidate
            }
        }

        // Return 'opencode' and hope it's in PATH
        return 'opencode';
    }

    private startShell(): void {
        const isWindows = process.platform === 'win32';
        const scriptB64 = isWindows ? WIN_PTY_SCRIPT_B64 : PTY_SCRIPT_B64;
        
        // Check if base64 scripts are embedded
        if (scriptB64.startsWith('__')) {
            this.term?.write('\r\n\x1b[31mError: PTY scripts not embedded. Run build.sh first.\x1b[0m\r\n');
            return;
        }

        const script = Buffer.from(scriptB64, 'base64').toString('utf-8');
        const scriptName = isWindows ? 'opencode_terminal_win.py' : 'opencode_terminal_pty.py';
        const scriptPath = path.join(os.tmpdir(), scriptName);

        try {
            fs.writeFileSync(scriptPath, script, { mode: 0o755 });
        } catch (e) {
            console.error('OpenCode: failed to write PTY script', e);
            this.term?.write(`\r\n\x1b[31mError writing PTY script: ${e}\x1b[0m\r\n`);
            return;
        }

        // Find the opencode binary
        const opencodePath = this.findOpenCodeBinary();
        if (!opencodePath) {
            this.term?.write('\r\n\x1b[31mError: Could not find opencode binary.\x1b[0m\r\n');
            this.term?.write('\x1b[33mPlease ensure opencode is installed and in your PATH.\x1b[0m\r\n');
            return;
        }

        // Get vault path as working directory
        const adapter = this.app.vault.adapter;
        const vaultPath = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : '.';
        
        // Get initial terminal dimensions (with fallback for NaN values)
        const proposedDims = this.fitAddon?.proposeDimensions();
        const cols = (proposedDims?.cols && !isNaN(proposedDims.cols)) ? proposedDims.cols : 80;
        const rows = (proposedDims?.rows && !isNaN(proposedDims.rows)) ? proposedDims.rows : 24;
        const dims = { cols, rows };

        // Find python executable
        const pythonCmd = isWindows ? 'python' : 'python3';

        // Build enhanced PATH that includes common binary locations
        const homeDir = os.homedir();
        const extraPaths = isWindows ? [
            path.join(homeDir, '.opencode', 'bin'),
            path.join(homeDir, 'AppData', 'Local', 'opencode', 'bin'),
        ] : [
            path.join(homeDir, '.opencode', 'bin'),
            path.join(homeDir, '.local', 'bin'),
            '/usr/local/bin',
        ];
        const enhancedPath = [...extraPaths, process.env.PATH].join(isWindows ? ';' : ':');

        // Spawn the PTY wrapper with opencode as the command
        this.proc = spawn(pythonCmd, [
            scriptPath,
            String(dims.cols),
            String(dims.rows),
            opencodePath
        ], {
            cwd: vaultPath,
            env: {
                ...process.env,
                PATH: enhancedPath,
                TERM: 'xterm-256color'
            }
        });

        // Wire up I/O
        this.proc.stdout?.on('data', (data: Buffer) => {
            this.term?.write(data);
        });

        this.proc.stderr?.on('data', (data: Buffer) => {
            this.term?.write(data);
        });

        this.term?.onData((data: string) => {
            if (this.proc?.stdin?.writable) {
                this.proc.stdin.write(data);
            }
        });

        this.proc.on('exit', (code: number | null) => {
            this.term?.write(`\r\n\x1b[90m[OpenCode exited with code ${code}]\x1b[0m\r\n`);
        });

        this.proc.on('error', (err: Error) => {
            this.term?.write(`\r\n\x1b[31mError: ${err.message}\x1b[0m\r\n`);
            console.error('OpenCode: process error', err);
        });
    }

    private setupEscapeHandler(): void {
        this.escapeScope = new Scope(this.app.scope);
        this.escapeScope.register([], 'Escape', () => {
            if (this.containerEl.contains(document.activeElement)) {
                if (this.proc?.stdin?.writable) {
                    this.proc.stdin.write('\x1b');
                }
                return false; // Block Obsidian from handling
            }
            return true;
        });
        this.app.keymap.pushScope(this.escapeScope);
    }

    private dispose(): void {
        if (this.escapeScope) {
            this.app.keymap.popScope(this.escapeScope);
            this.escapeScope = null;
        }

        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }

        if (this.proc) {
            this.proc.kill();
            this.proc = null;
        }

        if (this.term) {
            this.term.dispose();
            this.term = null;
        }

        this.fitAddon = null;
        this.termHost = null;
    }

    focus(): void {
        this.term?.focus();
    }
}

export default class OpenCodePlugin extends Plugin {
    onload(): void {
        // Register custom icon
        addIcon(ICON_NAME, OPENCODE_ICON);

        // Register the custom view
        this.registerView(VIEW_TYPE, (leaf) => new OpenCodeTerminalView(leaf, this));

        // Add ribbon icon
        this.addRibbonIcon(ICON_NAME, 'New opencode tab', () => {
            void this.openNewTab();
        });

        // Register commands
        this.addCommand({
            id: 'open-opencode',
            name: 'Open opencode',
            callback: () => {
                void this.openOrFocus();
            }
        });

        this.addCommand({
            id: 'new-opencode-tab',
            name: 'New opencode tab',
            callback: () => {
                void this.openNewTab();
            }
        });

        this.addCommand({
            id: 'close-opencode-tab',
            name: 'Close opencode tab',
            checkCallback: (checking: boolean) => {
                const view = this.app.workspace.getActiveViewOfType(OpenCodeTerminalView);
                if (view) {
                    if (!checking) {
                        view.leaf.detach();
                    }
                    return true;
                }
                return false;
            }
        });

        this.addCommand({
            id: 'toggle-focus-editor-opencode',
            name: 'Toggle focus: editor <-> opencode',
            callback: () => {
                void this.toggleFocus();
            }
        });
    }

    onunload(): void {
        // Views are automatically cleaned up by Obsidian
    }

    private async openOrFocus(): Promise<void> {
        const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE);
        
        if (existing.length > 0) {
            // Focus existing
            await this.app.workspace.revealLeaf(existing[0]);
            const view = existing[0].view as OpenCodeTerminalView;
            view.focus();
        } else {
            // Create new
            await this.openNewTab();
        }
    }

    private async openNewTab(): Promise<void> {
        const leaf = this.app.workspace.getRightLeaf(false);
        if (leaf) {
            await leaf.setViewState({
                type: VIEW_TYPE,
                active: true
            });
            await this.app.workspace.revealLeaf(leaf);
            const view = leaf.view as OpenCodeTerminalView;
            view.focus();
        }
    }

    private toggleFocus(): void {
        const activeView = this.app.workspace.getActiveViewOfType(OpenCodeTerminalView);

        if (activeView) {
            // Currently in OpenCode, switch to editor
            const editorLeaves = this.app.workspace.getLeavesOfType('markdown');
            if (editorLeaves.length > 0) {
                this.app.workspace.setActiveLeaf(editorLeaves[0], { focus: true });
            }
        } else {
            // Currently in editor, switch to OpenCode
            const openCodeLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
            if (openCodeLeaves.length > 0) {
                this.app.workspace.setActiveLeaf(openCodeLeaves[0], { focus: true });
                const view = openCodeLeaves[0].view as OpenCodeTerminalView;
                view.focus();
            }
        }
    }
}
