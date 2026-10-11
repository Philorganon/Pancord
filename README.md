# Pancord
<p align="center">
  <img src="./photos/discord.svg" width="64" height="64" alt="Discord">
</p>

**Client customization kit for Discord Desktop** — themes, colors, and plugins without Nitro and without forking the client.

[![Version](https://img.shields.io/badge/version-2.0.0-blue?style=for-the-badge&logo=github)](https://github.com/Philorganon/Discord-Injector/releases)
[![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-green?style=for-the-badge&logo=node.js)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-purple?style=for-the-badge)](LICENSE)

[Features](#features) • [Installation](#installation) • [Usage](#usage) • [Themes](#themes) • [Contact](#contact)
</div>

---

## Features

| Feature | Description |
|---------|-------------|
| <img src="./svg/injection.svg" width="16" height="16" style="vertical-align:middle;"> **Custom CSS Injection** | Apply any CSS to Discord |
| <img src="./svg/editor.svg" width="16" height="16" style="vertical-align:middle;"> **Live CSS Editor** | Monaco-based editor with syntax highlighting |
| <img src="./svg/theme.svg" width="16" height="16" style="vertical-align:middle;"> **Theme System** | 12 built-in themes plus custom themes |
| <img src="./svg/plugin.svg" width="16" height="16" style="vertical-align:middle;"> **Plugin System** | Extend functionality via plugins |
| <img src="./svg/backup.svg" width="16" height="16" style="vertical-align:middle;"> **Auto Backup** | Automatic backups before modifications |
| <img src="./svg/restore.svg" width="16" height="16" style="vertical-align:middle;"> **Safe Restore** | One-command restoration to original state |
| <img src="./svg/hot-reload.svg" width="16" height="16" style="vertical-align:middle;"> **Hot Reload** | Changes apply instantly without restart |

### Security & Reliability

- **Input Validation** - All inputs are sanitized
- **Atomic Operations** - All-or-nothing file operations
- **Rollback Support** - Automatic rollback on failures
- **Checksum Verification** - File integrity checks
- **Comprehensive Logging** - Full activity logging

### Multi-Platform Support

- Windows 10/11
- macOS (Intel & Apple Silicon)
- Linux (Debian, Ubuntu, Arch, etc.)

---

## Installation

### Prerequisites

- [Node.js](https://nodejs.org/) v18.0.0 or higher
- Discord Desktop App

### Quick Start

```bash
git clone https://github.com/Philorganon/Pancord.git
cd Discord-Injector
npm install
npm start install
```

---

## Usage

### Commands

```bash
npm start install     # Install/inject with theme selection
npm start editor      # Open live CSS editor
npm start status      # Check injection status
npm start themes      # List available themes
npm start plugins     # Manage plugins
npm start config      # View/edit configuration
npm start test        # Run diagnostic tests
npm start restore     # Restore original Discord
```

### Command Options

```bash
npm start install -- -t dark-purple    # Install with specific theme
npm start editor -- -p 9000             # Open editor on custom port
npm start restore -- -f                # Force restore without confirmation
```

---

## Themes

| Theme | Description | Style |
|-------|-----------|-------|
| `midnight` | Pure black theme | Utility |
| `cyan` | Cyberpunk cyan | Modern |
| `dark-purple` | Dark with purple gradient | Professional |
| `ocean-blue` | Deep ocean tones | Calming |
| `forest-green` | Nature-inspired green | Organic |
| `sunset-orange` | Warm orange pink | Warm |
| `rose-pink` | Soft elegant pink | Elegant |
| `monochrome` | Black and white | Minimal |
| `cyberpunk-neon` | Futuristic neon | Futuristic |
| `nord` | Arctic Nordic palette | Arctic |
| `dracula` | Classic dark purple | Iconic |
| `gruvbox` | Retro warm orange | Retro |
| `nsn` | Custom variant | Unique |
| `hutao` | Special themed | Themed |

### Create Custom Theme

Create `src/css/themes/my-theme.css`:

```css
/**
 * @name My Custom Theme
 * @author Your Name
 * @version 1.0.0
 */

:root {
    --background-primary: #1a1a2e;
    --text-normal: #eaeaea;
}
```

Register in `src/css/themes/index.js`:

```javascript
'my-theme': loadTheme('my-theme'),
```

## License

This project is licensed under the MIT License - see [LICENSE](LICENSE) for details.
