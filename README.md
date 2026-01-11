# OpenCode Sidebar for Obsidian

Run [OpenCode](https://opencode.ai) directly in your Obsidian sidebar.

## Requirements

- Obsidian (desktop only)
- Python 3.x
- `opencode` binary installed and available in PATH
- On Windows: `pywinpty` (`pip install pywinpty`)

## Installation

### Quick Install

Run this command from your vault's root directory:

```bash
mkdir -p .obsidian/plugins/opencode-sidebar && curl -sL https://github.com/derekross/obsidian-opencode-sidebar/raw/main/{main.js,manifest.json,styles.css} -o ".obsidian/plugins/opencode-sidebar/#1"
```

Then enable the plugin in Obsidian Settings > Community Plugins.

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/derekross/obsidian-opencode-sidebar/releases)
2. Create a folder called `opencode-sidebar` in your vault's `.obsidian/plugins/` directory
3. Copy the downloaded files into that folder
4. Enable the plugin in Obsidian Settings > Community Plugins

### From Source

```bash
git clone https://github.com/derekross/obsidian-opencode-sidebar.git
cd obsidian-opencode-sidebar
npm install
npm run build
```

Then copy `main.js`, `manifest.json`, and `styles.css` to your vault's `.obsidian/plugins/opencode-sidebar/` folder.

## Usage

- Click the terminal icon in the left ribbon to open a new OpenCode tab
- Use the command palette (Ctrl/Cmd+P) and search for "OpenCode" to:
  - **Open OpenCode** - Opens or focuses an existing OpenCode panel
  - **New OpenCode Tab** - Creates a new OpenCode instance
  - **Close OpenCode Tab** - Closes the current OpenCode tab
  - **Toggle Focus: Editor <-> OpenCode** - Switch between editor and OpenCode

## Features

- Full terminal emulation with xterm.js
- Automatic theme integration with Obsidian
- Resize handling
- Image paste support (saves to temp file and inserts path)
- Multiple OpenCode instances
- Keyboard shortcut support

## Development

```bash
# Install dependencies
npm install

# Watch mode (for development)
npm run dev

# Production build
npm run build
```

## Author

Derek Ross ([@derekross](https://github.com/derekross))

## License

MIT
