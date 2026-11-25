import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadTheme(themeName) {
    const themePath = path.join(__dirname, `${themeName}.css`);
    try {
        return fs.readFileSync(themePath, 'utf8');
    } catch (err) {
        console.error(`Failed to load theme ${themeName}:`, err);
        return '/* Theme not found */';
    }
}

export const themes = {
    'midnight': loadTheme('midnight'),
    'cyan': loadTheme('cyan'),
    'dark-purple': loadTheme('dark-purple'),
    'ocean-blue': loadTheme('ocean-blue'),
    'forest-green': loadTheme('forest-green'),
    'sunset-orange': loadTheme('sunset-orange'),
    'rose-pink': loadTheme('rose-pink'),
    'monochrome': loadTheme('monochrome'),
    'cyberpunk-neon': loadTheme('cyberpunk-neon'),
    'nord': loadTheme('nord'),
    'dracula': loadTheme('dracula'),
    'gruvbox': loadTheme('gruvbox'),
    'nsn': loadTheme('nsn'),
    'hutao': loadTheme('hutao'),
    'oguri-cap': loadTheme('oguri-cap'),
    'punk-zine': loadTheme('punk-zine'),
    'obsidian-minimal': loadTheme('obsidian-minimal'),
    'ryo-yamada': loadTheme('ryo-yamada'),
};

export function getThemeNames() {
    return Object.keys(themes);
}

export function getTheme(themeName) {
    return themes[themeName] || themes.midnight;
}
