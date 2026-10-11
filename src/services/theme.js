/**
 * @fileoverview Theme Service - Manage CSS themes
 * @module services/theme
 */

import fs from 'fs-extra';
import path from 'path';
import {
    logger,
    eventBus,
    Events,
    validateThemeMetadata,
    validateCSS,
    ValidationError
} from '../core/index.js';

/**
 * Cached themes
 * @type {Map<string, {metadata: Object, css: string}>}
 */
const themeCache = new Map();

/**
 * Themes directory
 */
const THEMES_DIR = path.join(process.cwd(), 'src', 'css', 'themes');

/**
 * Parse theme file and extract metadata
 * @param {string} css - CSS content
 * @returns {{metadata: Object, css: string}}
 */
function parseThemeFile(css) {
    const metadata = {
        name: 'Untitled Theme',
        author: 'Unknown',
        version: '1.0.0',
        description: ''
    };

    // Parse metadata from CSS comments
    // Format: /** @name Theme Name \n @author Author \n @version 1.0.0 \n @description ... */
    const metaMatch = css.match(/\/\*\*\s*([\s\S]*?)\*\//);

    if (metaMatch) {
        const metaContent = metaMatch[1];

        const nameMatch = metaContent.match(/@name\s+(.+)/);
        const authorMatch = metaContent.match(/@author\s+(.+)/);
        const versionMatch = metaContent.match(/@version\s+(.+)/);
        const descMatch = metaContent.match(/@description\s+(.+)/);
        const tagsMatch = metaContent.match(/@tags\s+(.+)/);

        if (nameMatch) metadata.name = nameMatch[1].trim();
        if (authorMatch) metadata.author = authorMatch[1].trim();
        if (versionMatch) metadata.version = versionMatch[1].trim();
        if (descMatch) metadata.description = descMatch[1].trim();
        if (tagsMatch) metadata.tags = tagsMatch[1].split(',').map(t => t.trim());
    }

    // Remove metadata comment from CSS
    const cleanCSS = css.replace(/\/\*\*\s*[\s\S]*?\*\//, '').trim();

    return {
        metadata: validateThemeMetadata(metadata),
        css: cleanCSS
    };
}

/**
 * Load all themes from themes directory
 * @returns {Promise<Map<string, {metadata: Object, css: string}>>}
 */
export async function loadThemes() {
    themeCache.clear();

    try {
        await fs.ensureDir(THEMES_DIR);
        const files = await fs.readdir(THEMES_DIR);

        for (const file of files) {
            if (!file.endsWith('.css')) continue;

            try {
                const filePath = path.join(THEMES_DIR, file);
                const content = await fs.readFile(filePath, 'utf8');
                const { metadata, css } = parseThemeFile(content);

                // Use filename without extension as key
                const key = path.basename(file, '.css');
                themeCache.set(key, { metadata, css, path: filePath });

                logger.debug(`Loaded theme: ${metadata.name}`);

            } catch (err) {
                logger.warn(`Failed to load theme: ${file}`, { error: err.message });
            }
        }

        logger.info(`Loaded ${themeCache.size} themes`);
        return themeCache;

    } catch (err) {
        logger.error('Failed to load themes', { error: err.message });
        return themeCache;
    }
}

/**
 * Get theme by key
 * @param {string} key - Theme key (filename without extension)
 * @returns {{metadata: Object, css: string}|null}
 */
export function getTheme(key) {
    return themeCache.get(key) || null;
}

/**
 * Get all themes
 * @returns {Array<{key: string, metadata: Object}>}
 */
export function getAllThemes() {
    return Array.from(themeCache.entries()).map(([key, value]) => ({
        key,
        metadata: value.metadata
    }));
}

/**
 * Get theme CSS content
 * @param {string} key - Theme key
 * @returns {string|null}
 */
export function getThemeCSS(key) {
    const theme = themeCache.get(key);
    return theme?.css || null;
}

/**
 * Create a new theme
 * @param {string} key - Theme key (filename)
 * @param {Object} metadata - Theme metadata
 * @param {string} css - CSS content
 * @returns {Promise<{success: boolean, path?: string}>}
 */
export async function createTheme(key, metadata, css) {
    try {
        // Validate
        const validMetadata = validateThemeMetadata(metadata);
        const { css: validCSS, warnings } = validateCSS(css);

        if (warnings.length > 0) {
            logger.warn('Theme CSS warnings', { warnings });
        }

        // Format theme file
        const content = formatThemeFile(validMetadata, validCSS);

        const filePath = path.join(THEMES_DIR, `${key}.css`);
        await fs.writeFile(filePath, content);

        // Update cache
        themeCache.set(key, { metadata: validMetadata, css: validCSS, path: filePath });

        logger.success(`Created theme: ${validMetadata.name}`);
        eventBus.emit(Events.THEME_LOAD, { key, metadata: validMetadata });

        return { success: true, path: filePath };

    } catch (err) {
        logger.error('Failed to create theme', { error: err.message });
        return { success: false, error: err.message };
    }
}

/**
 * Update an existing theme
 * @param {string} key - Theme key
 * @param {Object} [metadata] - New metadata (optional)
 * @param {string} [css] - New CSS (optional)
 * @returns {Promise<{success: boolean}>}
 */
export async function updateTheme(key, metadata, css) {
    const existing = themeCache.get(key);

    if (!existing) {
        return { success: false, error: 'Theme not found' };
    }

    try {
        const newMetadata = metadata
            ? validateThemeMetadata({ ...existing.metadata, ...metadata })
            : existing.metadata;

        const newCSS = css
            ? validateCSS(css).css
            : existing.css;

        const content = formatThemeFile(newMetadata, newCSS);
        await fs.writeFile(existing.path, content);

        // Update cache
        themeCache.set(key, {
            metadata: newMetadata,
            css: newCSS,
            path: existing.path
        });

        logger.debug(`Updated theme: ${key}`);
        eventBus.emit(Events.THEME_CHANGE, { key, metadata: newMetadata });

        return { success: true };

    } catch (err) {
        logger.error('Failed to update theme', { error: err.message });
        return { success: false, error: err.message };
    }
}

/**
 * Delete a theme
 * @param {string} key - Theme key
 * @returns {Promise<{success: boolean}>}
 */
export async function deleteTheme(key) {
    const theme = themeCache.get(key);

    if (!theme) {
        return { success: false, error: 'Theme not found' };
    }

    try {
        await fs.remove(theme.path);
        themeCache.delete(key);

        logger.info(`Deleted theme: ${key}`);

        return { success: true };

    } catch (err) {
        logger.error('Failed to delete theme', { error: err.message });
        return { success: false, error: err.message };
    }
}

/**
 * Format theme file with metadata header
 * @param {Object} metadata - Theme metadata
 * @param {string} css - CSS content
 * @returns {string}
 */
function formatThemeFile(metadata, css) {
    const header = `/**
 * @name ${metadata.name}
 * @author ${metadata.author}
 * @version ${metadata.version}
 * @description ${metadata.description || ''}
 ${metadata.tags?.length ? `* @tags ${metadata.tags.join(', ')}` : ''}
 */

`;
    return header + css;
}

/**
 * Import BetterDiscord theme
 * @param {string} bdThemePath - Path to BD theme file
 * @returns {Promise<{success: boolean, key?: string, metadata?: Object}>}
 */
export async function importBDTheme(bdThemePath) {
    try {
        const content = await fs.readFile(bdThemePath, 'utf8');
        const { metadata, css } = parseThemeFile(content);

        // Convert BD-specific selectors
        const convertedCSS = convertBDSelectors(css);

        // Generate key from name
        const key = metadata.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');

        // Add BD import note
        metadata.description = `[Imported from BetterDiscord] ${metadata.description}`;

        const result = await createTheme(key, metadata, convertedCSS);

        if (result.success) {
            return { success: true, key, metadata };
        }

        return { success: false, error: result.error };

    } catch (err) {
        logger.error('Failed to import BD theme', { error: err.message });
        return { success: false, error: err.message };
    }
}

/**
 * Convert BetterDiscord specific selectors
 * @param {string} css - CSS content
 * @returns {string}
 */
function convertBDSelectors(css) {
    let converted = css;

    // BD uses .bd- prefixed classes
    converted = converted.replace(/\.bd-/g, '.discord-');

    // Add compatibility header
    const header = `/* Imported from BetterDiscord - Converted by Pancord */\n\n`;

    return header + converted;
}

/**
 * Theme service object
 */
export const themeService = {
    load: loadThemes,
    get: getTheme,
    getAll: getAllThemes,
    getCSS: getThemeCSS,
    create: createTheme,
    update: updateTheme,
    delete: deleteTheme,
    importBD: importBDTheme
};

// Auto-load themes on import
await loadThemes();
