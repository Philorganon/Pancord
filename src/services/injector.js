/**
 * @fileoverview Refactored Injection Service with clean architecture
 * @module services/injector
 */

import fs from 'fs-extra';
import path from 'path';
import {
    logger,
    eventBus,
    Events,
    success,
    failure,
    InjectionError,
    RestoreError,
    PermissionError,
    validatePath,
    validateCSS,
    atomicWrite,
    safeMove,
    safeDelete,
    createBackup,
    getChecksum,
    verifyChecksum,
    rollback,
    clearOperationLog
} from '../core/index.js';

/**
 * Injection file paths
 */
const FILE_NAMES = {
    APP_ASAR: 'app.asar',
    ORIGINAL_ASAR: 'original.asar',
    APP_FOLDER: 'app',
    PACKAGE_JSON: 'package.json',
    INDEX_JS: 'index.js',
    CUSTOM_CSS: 'custom.css',
    SETTINGS_JSON: 'settings.json',
    CHECKSUM_FILE: '.checksum'
};

/**
 * Injection state
 */
let injectionState = {
    resourcePath: null,
    injected: false,
    lastInjection: null,
    cssChecksum: null
};

/**
 * Get injection script content
 * @returns {string}
 */
function getInjectionScript() {
    return `
/**
 * Pancord - Loader Script
 * This file is auto-generated. Do not modify.
 */
const electron = require('electron');
const path = require('path');
const fs = require('fs');

// CSS file path
const cssPath = path.join(__dirname, 'custom.css');
const settingsPath = path.join(__dirname, 'settings.json');

// Track windows
const windows = new Set();

/**
 * Load settings
 */
function getSettings() {
    try {
        if (fs.existsSync(settingsPath)) {
            return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        }
    } catch (err) {
        console.error('[Pancord] Error reading settings:', err);
    }
    return {};
}

/**
 * Handle notification sound
 */
function applyNotificationSound(window, soundUrl) {
    if (!soundUrl) return;
    
    window.webContents.executeJavaScript(
        '(function () {' +
        '    if (window._soundHooked) return;' +
        '    window._soundHooked = true;' +
        '    const originalPlay = Audio.prototype.play;' +
        '    Audio.prototype.play = function () {' +
        '        if (this.src && (this.src.includes("notification") || this.src.includes("message"))) {' +
        '            this.src = "' + soundUrl + '";' +
        '        }' +
        '        return originalPlay.apply(this, arguments);' +
        '    };' +
        '})()'
    ).catch(err => {
        console.error('[Pancord] Error applying sound hook:', err);
    });
}

/**
 * Load CSS into a window
 */
function loadResources(window) {
    try {
        if (window.isDestroyed()) return;
        
        // Apply CSS
        if (fs.existsSync(cssPath)) {
            const css = fs.readFileSync(cssPath, 'utf8');
            window.webContents.insertCSS(css).then(key => {
                window._cssKey = key;
                console.log('[Pancord] CSS loaded successfully');
            }).catch(err => {
                console.error('[Pancord] CSS insert error:', err);
            });
        }
        
        // Load plugin scripts from plugin-scripts folder
        const pluginScriptsDir = path.join(__dirname, 'plugin-scripts');
        if (fs.existsSync(pluginScriptsDir)) {
            try {
                const files = fs.readdirSync(pluginScriptsDir);
                for (const file of files) {
                    if (file.endsWith('.js')) {
                        const filePath = path.join(pluginScriptsDir, file);
                        try {
                            const code = fs.readFileSync(filePath, 'utf8');
                            window.webContents.executeJavaScript(code).catch(err => {
                                console.error('[Pancord] Error executing plugin script ' + file + ':', err);
                            });
                        } catch (err) {
                            console.error('[Pancord] Error reading plugin script ' + file + ':', err);
                        }
                    }
                }
            } catch (err) {
                console.error('[Pancord] Error reading plugin-scripts directory:', err);
            }
        }
        
        // Apply Sound
        const settings = getSettings();
        if (settings.notificationSound) {
            applyNotificationSound(window, settings.notificationSound);
        }
    } catch (error) {
        console.error('[Pancord] Error loading resources:', error);
    }
}

/**
 * Reload resources in a window
 */
function reloadResources(window) {
    try {
        if (window.isDestroyed()) return;
        
        // Remove old CSS
        if (window._cssKey) {
            window.webContents.removeInsertedCSS(window._cssKey).catch(() => {});
        }
        
        // Load new resources
        loadResources(window);
    } catch (error) {
        console.error('[Pancord] Error reloading resources:', error);
    }
}

// Handle new browser windows
electron.app.on('browser-window-created', (_, window) => {
    windows.add(window);
    
    window.webContents.on('dom-ready', () => {
        loadResources(window);
    });
    window.webContents.on('did-finish-load', () => {
        loadResources(window);
    });
    window.webContents.on('did-navigate-in-page', () => {
        loadResources(window);
    });
    
    window.on('closed', () => {
        windows.delete(window);
    });
});

// Watch for file changes
fs.watchFile(cssPath, { interval: 500 }, () => {
    console.log('[Pancord] CSS changed, reloading...');
    for (const window of windows) reloadResources(window);
});

fs.watchFile(settingsPath, { interval: 500 }, () => {
    console.log('[Pancord] Settings changed, reloading...');
    for (const window of windows) reloadResources(window);
});

// Cleanup on exit
electron.app.on('will-quit', () => {
    fs.unwatchFile(cssPath);
    fs.unwatchFile(settingsPath);
    console.log('[Pancord] Cleanup complete');
});

// Load original Discord
const originalAsar = path.join(process.resourcesPath, '${FILE_NAMES.ORIGINAL_ASAR}');

if (fs.existsSync(originalAsar)) {
    require(originalAsar);
} else {
    console.error('[Pancord] FATAL: original.asar not found!');
    electron.dialog.showErrorBox('Pancord Error', 
        'original.asar not found! Please restore Discord and try again.');
}

`;
}

/**
 * Get package.json content for injected app
 * @returns {Object}
 */
function getPackageJson() {
    return {
        name: 'pancord',
        main: 'index.js',
        version: '1.0.0'
    };
}

/**
 * Check if Discord is injected
 * @param {string} resourcePath - Path to Discord resources
 * @returns {Promise<{injected: boolean, healthy: boolean, details: Object}>}
 */
export async function checkInjectionStatus(resourcePath) {
    try {
        const validPath = validatePath(resourcePath, { mustExist: true, isDirectory: true });

        const appFolder = path.join(validPath, FILE_NAMES.APP_FOLDER);
        const appAsar = path.join(validPath, FILE_NAMES.APP_ASAR);
        const originalAsar = path.join(validPath, FILE_NAMES.ORIGINAL_ASAR);
        const customCss = path.join(appFolder, FILE_NAMES.CUSTOM_CSS);
        const checksumFile = path.join(appFolder, FILE_NAMES.CHECKSUM_FILE);

        const hasAppFolder = await fs.pathExists(appFolder);
        const hasAppAsar = await fs.pathExists(appAsar);
        const hasOriginalAsar = await fs.pathExists(originalAsar);
        const hasCustomCss = await fs.pathExists(customCss);

        // Determine state
        let status = 'not_injected';
        let healthy = true;
        let details = { hasAppFolder, hasAppAsar, hasOriginalAsar, hasCustomCss };

        if (hasAppFolder && hasOriginalAsar) {
            status = 'injected';

            // Check health
            if (!hasCustomCss) {
                healthy = false;
                details.issue = 'Missing custom.css';
            }

            // Verify checksum if available
            if (await fs.pathExists(checksumFile)) {
                const savedChecksum = (await fs.readFile(checksumFile, 'utf8')).trim();
                const currentChecksum = await getChecksum(path.join(appFolder, FILE_NAMES.INDEX_JS));

                if (savedChecksum !== currentChecksum) {
                    healthy = false;
                    details.issue = 'Injection script modified';
                }
            }
        } else if (hasAppFolder && hasAppAsar) {
            status = 'corrupted';
            healthy = false;
            details.issue = 'Inconsistent state: app folder exists but original.asar is missing';
        }

        return { status, healthy, details };

    } catch (err) {
        return {
            status: 'unknown',
            healthy: false,
            details: { error: err.message }
        };
    }
}

/**
 * Inject CSS loader into Discord
 * @param {string} resourcePath - Path to Discord resources folder
 * @param {string} initialCSS - Initial CSS content
 * @param {Object} [options] - Injection options
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function inject(resourcePath, initialCSS, options = {}) {
    const startTime = Date.now();

    try {
        // Validate inputs
        const validPath = validatePath(resourcePath, { mustExist: true, isDirectory: true });
        const { css: validCSS, warnings } = validateCSS(initialCSS);

        if (warnings.length > 0) {
            logger.warn('CSS validation warnings', { warnings });
        }

        // Emit before event
        const shouldContinue = await eventBus.shouldEmit(Events.BEFORE_INJECT, {
            resourcePath: validPath,
            css: validCSS
        });

        if (!shouldContinue) {
            return failure(new Error('Injection cancelled by plugin'));
        }

        await eventBus.emitAsync(Events.BEFORE_INJECT, { resourcePath: validPath, css: validCSS });

        // Paths
        const appFolder = path.join(validPath, FILE_NAMES.APP_FOLDER);
        const appAsar = path.join(validPath, FILE_NAMES.APP_ASAR);
        const originalAsar = path.join(validPath, FILE_NAMES.ORIGINAL_ASAR);

        logger.info('Starting injection', { resourcePath: validPath });

        // Step 1: Backup app.asar → original.asar
        if (await fs.pathExists(appAsar) && !await fs.pathExists(originalAsar)) {
            logger.debug('Backing up app.asar');

            // Create additional backup
            await createBackup(appAsar);

            // Rename to original.asar
            await safeMove(appAsar, originalAsar, { backup: false });
            logger.debug('app.asar → original.asar');
        }

        // Verify original.asar exists
        if (!await fs.pathExists(originalAsar)) {
            throw new InjectionError(
                'original.asar not found. Please restore Discord installation.',
                'backup'
            );
        }

        // Step 2: Create app folder structure
        await fs.ensureDir(appFolder);

        // Step 3: Write package.json
        const pkgPath = path.join(appFolder, FILE_NAMES.PACKAGE_JSON);
        await atomicWrite(pkgPath, JSON.stringify(getPackageJson(), null, 2));
        logger.debug('package.json created');

        // Step 4: Write injection script
        const scriptPath = path.join(appFolder, FILE_NAMES.INDEX_JS);
        const scriptContent = getInjectionScript();
        await atomicWrite(scriptPath, scriptContent);

        // Save checksum for verification
        const scriptChecksum = await getChecksum(scriptPath);
        await atomicWrite(path.join(appFolder, FILE_NAMES.CHECKSUM_FILE), scriptChecksum);
        logger.debug('index.js created');

        // Step 5: Write CSS file
        const cssPath = path.join(appFolder, FILE_NAMES.CUSTOM_CSS);
        await atomicWrite(cssPath, validCSS);
        const cssChecksum = await getChecksum(cssPath);
        logger.debug('custom.css created');

        // Step 6: Write Settings file
        const settingsPath = path.join(appFolder, FILE_NAMES.SETTINGS_JSON);
        const initialSettings = options.settings || {};
        await atomicWrite(settingsPath, JSON.stringify(initialSettings, null, 2));
        logger.debug('settings.json created');

        // Update state
        injectionState = {
            resourcePath: validPath,
            injected: true,
            lastInjection: new Date().toISOString(),
            cssChecksum
        };

        // Clear operation log on success
        clearOperationLog();

        const duration = Date.now() - startTime;
        logger.success(`Injection successful in ${duration}ms`);

        // Emit after event
        await eventBus.emitAsync(Events.AFTER_INJECT, {
            resourcePath: validPath,
            css: validCSS,
            duration
        });

        return success({
            resourcePath: validPath,
            cssPath,
            duration
        }, 'Injection successful');

    } catch (err) {
        logger.error('Injection failed', { error: err.message });

        // Attempt rollback
        try {
            logger.info('Attempting rollback...');
            await rollback();
            logger.info('Rollback completed');
        } catch (rollbackErr) {
            logger.error('Rollback failed', { error: rollbackErr.message });
        }

        // Emit error event
        await eventBus.emitAsync(Events.INJECT_ERROR, { error: err });

        if (err instanceof InjectionError || err instanceof PermissionError) {
            return failure(err);
        }

        return failure(new InjectionError(err.message, 'unknown', err));
    }
}

/**
 * Restore Discord to original state
 * @param {string} resourcePath - Path to Discord resources folder
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function restore(resourcePath) {
    const startTime = Date.now();

    try {
        const validPath = validatePath(resourcePath, { mustExist: true, isDirectory: true });

        // Emit before event
        await eventBus.emitAsync(Events.BEFORE_RESTORE, { resourcePath: validPath });

        const appFolder = path.join(validPath, FILE_NAMES.APP_FOLDER);
        const appAsar = path.join(validPath, FILE_NAMES.APP_ASAR);
        const originalAsar = path.join(validPath, FILE_NAMES.ORIGINAL_ASAR);

        let restored = false;

        // Step 1: Remove app folder
        if (await fs.pathExists(appFolder)) {
            logger.debug('Removing app folder');

            // Backup CSS before removing
            const cssPath = path.join(appFolder, FILE_NAMES.CUSTOM_CSS);
            if (await fs.pathExists(cssPath)) {
                await createBackup(cssPath);
            }

            await safeDelete(appFolder, { backup: false });
            restored = true;
        }

        // Step 2: Restore original.asar → app.asar
        if (await fs.pathExists(originalAsar)) {
            logger.debug('Restoring original.asar → app.asar');

            // Remove app.asar if exists
            if (await fs.pathExists(appAsar)) {
                await safeDelete(appAsar, { backup: false });
            }

            await safeMove(originalAsar, appAsar, { backup: false });
            restored = true;
        }

        if (!restored) {
            return failure(new RestoreError('No injection found to restore'));
        }

        // Update state
        injectionState = {
            resourcePath: null,
            injected: false,
            lastInjection: null,
            cssChecksum: null
        };

        clearOperationLog();

        const duration = Date.now() - startTime;
        logger.success(`Restore successful in ${duration}ms`);

        // Emit after event
        await eventBus.emitAsync(Events.AFTER_RESTORE, { resourcePath: validPath, duration });

        return success({ resourcePath: validPath, duration }, 'Discord restored successfully');

    } catch (err) {
        logger.error('Restore failed', { error: err.message });

        await eventBus.emitAsync(Events.RESTORE_ERROR, { error: err });

        return failure(new RestoreError(err.message, err));
    }
}

/**
 * Update CSS content
 * @param {string} resourcePath - Path to Discord resources
 * @param {string} css - New CSS content
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function updateCSS(resourcePath, css) {
    try {
        const validPath = validatePath(resourcePath, { mustExist: true, isDirectory: true });
        const { css: validCSS, warnings } = validateCSS(css);

        if (warnings.length > 0) {
            logger.warn('CSS validation warnings', { warnings });
        }

        const cssPath = path.join(validPath, FILE_NAMES.APP_FOLDER, FILE_NAMES.CUSTOM_CSS);

        if (!await fs.pathExists(cssPath)) {
            return failure(new Error('Discord is not injected. Run install first.'));
        }

        await atomicWrite(cssPath, validCSS, { backup: true });
        const checksum = await getChecksum(cssPath);

        injectionState.cssChecksum = checksum;

        // Emit CSS change event
        await eventBus.emitAsync(Events.CSS_CHANGE, { css: validCSS, checksum });

        logger.debug('CSS updated', { checksum });

        return success({ checksum }, 'CSS updated successfully');

    } catch (err) {
        logger.error('CSS update failed', { error: err.message });

        await eventBus.emitAsync(Events.CSS_ERROR, { error: err });

        return failure(err);
    }
}

/**
 * Get current CSS content
 * @param {string} resourcePath - Path to Discord resources
 * @returns {Promise<{success: boolean, css?: string, message: string}>}
 */
export async function getCSS(resourcePath) {
    try {
        const validPath = validatePath(resourcePath, { mustExist: true, isDirectory: true });
        const cssPath = path.join(validPath, FILE_NAMES.APP_FOLDER, FILE_NAMES.CUSTOM_CSS);

        if (!await fs.pathExists(cssPath)) {
            return failure(new Error('Discord is not injected'));
        }

        const css = await fs.readFile(cssPath, 'utf8');
        const checksum = await getChecksum(cssPath);

        return success({ css, checksum });

    } catch (err) {
        return failure(err);
    }
}

/**
 * Get current injection state
 * @returns {Object}
 */
export function getState() {
    return { ...injectionState };
}

/**
 * Update injection settings
 * @param {string} resourcePath - Path to Discord resources
 * @param {Object} settings - New settings
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function updateSettings(resourcePath, settings) {
    try {
        const validPath = validatePath(resourcePath, { mustExist: true, isDirectory: true });
        const settingsPath = path.join(validPath, FILE_NAMES.APP_FOLDER, FILE_NAMES.SETTINGS_JSON);

        if (!await fs.pathExists(settingsPath)) {
            // If it doesn't exist but Discord is injected, create it
            const appFolder = path.join(validPath, FILE_NAMES.APP_FOLDER);
            if (!await fs.pathExists(appFolder)) {
                return failure(new Error('Discord is not injected'));
            }
        }

        let currentSettings = {};
        if (await fs.pathExists(settingsPath)) {
            currentSettings = await fs.readJson(settingsPath);
        }

        const newSettings = { ...currentSettings, ...settings };
        await atomicWrite(settingsPath, JSON.stringify(newSettings, null, 2));

        logger.debug('Settings updated', { settings: newSettings });
        return success({ settings: newSettings }, 'Settings updated successfully');

    } catch (err) {
        logger.error('Settings update failed', { error: err.message });
        return failure(err);
    }
}

/**
 * Get current injection settings
 * @param {string} resourcePath - Path to Discord resources
 * @returns {Promise<{success: boolean, settings?: Object, message: string}>}
 */
export async function getSettings(resourcePath) {
    try {
        const validPath = validatePath(resourcePath, { mustExist: true, isDirectory: true });
        const settingsPath = path.join(validPath, FILE_NAMES.APP_FOLDER, FILE_NAMES.SETTINGS_JSON);

        if (!await fs.pathExists(settingsPath)) {
            return success({ settings: {} });
        }

        const settings = await fs.readJson(settingsPath);
        return success({ settings });

    } catch (err) {
        return failure(err);
    }
}

/**
 * Injector service object
 */
export const injectorService = {
    inject,
    restore,
    updateCSS,
    getCSS,
    updateSettings,
    getSettings,
    getState,
    checkStatus: checkInjectionStatus
};
