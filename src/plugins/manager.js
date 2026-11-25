/**
 * @fileoverview Plugin System - Core plugin manager
 * @module plugins/manager
 */

import fs from 'fs-extra';
import path from 'path';
import {
    logger,
    eventBus,
    Events,
    validatePluginManifest,
    PluginError,
    ValidationError
} from '../core/index.js';

/**
 * @typedef {Object} LoadedPlugin
 * @property {Object} manifest - Plugin manifest
 * @property {Object} instance - Plugin instance
 * @property {boolean} enabled - Whether plugin is enabled
 * @property {Object} config - Plugin configuration
 */

/**
 * Plugin Manager - Handles plugin lifecycle
 */
class PluginManager {
    constructor() {
        /** @type {Map<string, LoadedPlugin>} */
        this.plugins = new Map();

        /** @type {string} */
        this.pluginsDir = path.join(process.cwd(), 'plugins');

        /** @type {Map<string, Set<Function>>} */
        this.hooks = new Map();

        /** @type {Object} */
        this.api = null;

        /** @type {boolean} */
        this.initialized = false;
    }

    /**
     * Initialize plugin manager
     * @param {Object} api - API object to expose to plugins
     */
    async initialize(api) {
        if (this.initialized) return;

        this.api = api;
        await fs.ensureDir(this.pluginsDir);

        // Subscribe to global events
        this._setupEventBridge();

        this.initialized = true;
        logger.debug('Plugin manager initialized');
    }

    /**
     * Setup event bridge to route events to plugins
     */
    _setupEventBridge() {
        // Map internal events to plugin hooks
        const eventMap = {
            [Events.BEFORE_INJECT]: 'beforeInject',
            [Events.AFTER_INJECT]: 'afterInject',
            [Events.BEFORE_RESTORE]: 'beforeRestore',
            [Events.AFTER_RESTORE]: 'afterRestore',
            [Events.CSS_CHANGE]: 'onCssChange',
            [Events.THEME_CHANGE]: 'onThemeChange',
            [Events.DISCORD_START]: 'onDiscordStart',
            [Events.DISCORD_CLOSE]: 'onDiscordClose',
            [Events.ERROR]: 'onError'
        };

        for (const [event, hook] of Object.entries(eventMap)) {
            eventBus.on(event, async (...args) => {
                await this.triggerHook(hook, ...args);
            });
        }
    }

    /**
     * Discover plugins in plugins directory
     * @returns {Promise<string[]>} List of plugin names
     */
    async discover() {
        const discovered = [];

        try {
            const entries = await fs.readdir(this.pluginsDir, { withFileTypes: true });

            for (const entry of entries) {
                if (!entry.isDirectory()) continue;

                const manifestPath = path.join(this.pluginsDir, entry.name, 'manifest.json');

                if (await fs.pathExists(manifestPath)) {
                    discovered.push(entry.name);
                }
            }

            logger.debug(`Discovered ${discovered.length} plugins`);
            return discovered;

        } catch (err) {
            logger.error('Failed to discover plugins', { error: err.message });
            return [];
        }
    }

    /**
     * Load a plugin
     * @param {string} name - Plugin name (folder name)
     * @returns {Promise<boolean>} Success status
     */
    async load(name) {
        if (this.plugins.has(name)) {
            logger.warn(`Plugin already loaded: ${name}`);
            return true;
        }

        try {
            const pluginPath = path.join(this.pluginsDir, name);
            const manifestPath = path.join(pluginPath, 'manifest.json');
            const mainPath = path.join(pluginPath, 'index.js');

            // Validate paths exist
            if (!await fs.pathExists(manifestPath)) {
                throw new PluginError(`Manifest not found for plugin: ${name}`, name);
            }

            // Load and validate manifest
            const rawManifest = await fs.readJson(manifestPath);
            const manifest = validatePluginManifest(rawManifest);

            // Check dependencies
            await this._checkDependencies(manifest.dependencies);

            // Load plugin module
            let instance = null;
            if (await fs.pathExists(mainPath)) {
                const module = await import(`file://${mainPath}`);

                // Plugins can export default class or object
                if (module.default) {
                    if (typeof module.default === 'function') {
                        // It's a class
                        instance = new module.default(this._createPluginAPI(name));
                    } else {
                        // It's an object
                        instance = module.default;
                    }
                } else {
                    instance = module;
                }
            }

            // Load plugin config
            const configPath = path.join(pluginPath, 'config.json');
            let config = manifest.config || {};

            if (await fs.pathExists(configPath)) {
                const userConfig = await fs.readJson(configPath);
                config = { ...config, ...userConfig };
            }

            // Store plugin
            this.plugins.set(name, {
                manifest,
                instance,
                enabled: true,
                config,
                path: pluginPath
            });

            // Register hooks
            this._registerHooks(name, manifest.hooks, instance);

            // Call plugin init if exists
            if (instance?.init) {
                await instance.init(config);
            }

            logger.success(`Plugin loaded: ${manifest.displayName} v${manifest.version}`);
            eventBus.emit(Events.PLUGIN_LOAD, { name, manifest });

            return true;

        } catch (err) {
            const error = err instanceof PluginError ? err : new PluginError(err.message, name, err);
            logger.error(`Failed to load plugin: ${name}`, { error: error.message });
            eventBus.emit(Events.PLUGIN_ERROR, { name, error });
            return false;
        }
    }

    /**
     * Unload a plugin
     * @param {string} name - Plugin name
     * @returns {Promise<boolean>} Success status
     */
    async unload(name) {
        const plugin = this.plugins.get(name);

        if (!plugin) {
            logger.warn(`Plugin not loaded: ${name}`);
            return false;
        }

        try {
            // Call plugin destroy if exists
            if (plugin.instance?.destroy) {
                await plugin.instance.destroy();
            }

            // Unregister hooks
            this._unregisterHooks(name);

            // Remove from map
            this.plugins.delete(name);

            logger.info(`Plugin unloaded: ${name}`);
            eventBus.emit(Events.PLUGIN_UNLOAD, { name });

            return true;

        } catch (err) {
            logger.error(`Failed to unload plugin: ${name}`, { error: err.message });
            return false;
        }
    }

    /**
     * Enable a plugin (auto-loads if needed, deploys scripts, and persists config)
     * @param {string} name - Plugin name
     * @param {Object} [options] - Options
     * @param {boolean} [options.persistGlobal=true] - Persist into root config.json
     * @returns {Promise<boolean>}
     */
    async enable(name, { persistGlobal = true } = {}) {
        let plugin = this.plugins.get(name);
        if (!plugin) {
            const loaded = await this.load(name);
            if (!loaded) return false;
            plugin = this.plugins.get(name);
        }
        if (!plugin) return false;

        plugin.enabled = true;
        plugin.config = { ...(plugin.config || {}), enabled: true };
        if (plugin.instance?.config && typeof plugin.instance.config === 'object') {
            plugin.instance.config.enabled = true;
        }

        const pluginConfigPath = path.join(plugin.path, 'config.json');
        if (await fs.pathExists(pluginConfigPath)) {
            try {
                const diskCfg = await fs.readJson(pluginConfigPath);
                await fs.writeJson(pluginConfigPath, { ...diskCfg, enabled: true }, { spaces: 2 });
            } catch (_) {}
        }

        if (plugin.instance?.onEnable) {
            await plugin.instance.onEnable();
        } else if (plugin.instance?.onConfigChange) {
            await plugin.instance.onConfigChange(plugin.config);
        } else if (plugin.instance?.deployer?.deploy) {
            await plugin.instance.deployer.deploy();
        } else if (typeof plugin.instance?.deploy === 'function') {
            await plugin.instance.deploy();
        }

        if (persistGlobal) {
            const { loadConfig, saveConfig } = await import('../config.js');
            const cfg = await loadConfig();
            if (!cfg.plugins || typeof cfg.plugins !== 'object') cfg.plugins = { enabled: [], autoLoad: true };
            if (!Array.isArray(cfg.plugins.enabled)) cfg.plugins.enabled = [];
            if (!cfg.plugins.enabled.includes(name)) {
                cfg.plugins.enabled.push(name);
                await saveConfig(cfg);
            }
        }

        eventBus.emit('plugin:enable', { name });
        logger.info(`Plugin enabled: ${name}`);
        return true;
    }

    /**
     * Disable a plugin (removes deployed scripts for instant hot-unload and persists config)
     * @param {string} name - Plugin name
     * @param {Object} [options] - Options
     * @param {boolean} [options.persistGlobal=true] - Persist into root config.json
     * @returns {Promise<boolean>}
     */
    async disable(name, { persistGlobal = true } = {}) {
        const plugin = this.plugins.get(name);
        const pluginDir = plugin?.path || path.join(this.pluginsDir, name);
        if (!await fs.pathExists(pluginDir)) return false;

        if (plugin) {
            plugin.enabled = false;
            plugin.config = { ...(plugin.config || {}), enabled: false };
            if (plugin.instance?.config && typeof plugin.instance.config === 'object') {
                plugin.instance.config.enabled = false;
            }

            if (plugin.instance?.onDisable) {
                await plugin.instance.onDisable();
            } else if (plugin.instance?.onConfigChange) {
                await plugin.instance.onConfigChange(plugin.config);
            } else if (plugin.instance?.deployer?.remove) {
                await plugin.instance.deployer.remove();
            } else if (typeof plugin.instance?.removeInjectScript === 'function') {
                await plugin.instance.removeInjectScript();
            } else if (typeof plugin.instance?.remove === 'function') {
                await plugin.instance.remove();
            }
        }

        const pluginConfigPath = path.join(pluginDir, 'config.json');
        if (await fs.pathExists(pluginConfigPath)) {
            try {
                const diskCfg = await fs.readJson(pluginConfigPath);
                await fs.writeJson(pluginConfigPath, { ...diskCfg, enabled: false }, { spaces: 2 });
            } catch (_) {}
        }

        // Ensure deployed renderer script is always removed from plugin-scripts/
        try {
            const { findDiscordResourcePath } = await import('./deploy-utils.js');
            const resourcePath = await findDiscordResourcePath(this.api);
            if (resourcePath) {
                const targetScript = path.join(resourcePath, 'app', 'plugin-scripts', `${name}.js`);
                if (await fs.pathExists(targetScript)) {
                    await fs.remove(targetScript);
                    logger.info(`Removed deployed script: ${targetScript}`);
                }
            }
        } catch (_) {}

        if (persistGlobal) {
            const { loadConfig, saveConfig } = await import('../config.js');
            const cfg = await loadConfig();
            if (cfg.plugins?.enabled && Array.isArray(cfg.plugins.enabled)) {
                cfg.plugins.enabled = cfg.plugins.enabled.filter((p) => p !== name);
                await saveConfig(cfg);
            }
        }

        eventBus.emit('plugin:disable', { name });
        logger.info(`Plugin disabled: ${name}`);
        return true;
    }

    /**
     * Load all discovered plugins
     * @returns {Promise<{loaded: string[], failed: string[]}>}
     */
    async loadAll() {
        const discovered = await this.discover();
        const loaded = [];
        const failed = [];

        for (const name of discovered) {
            const success = await this.load(name);
            if (success) {
                loaded.push(name);
            } else {
                failed.push(name);
            }
        }

        return { loaded, failed };
    }

    /**
     * Unload all plugins
     */
    async unloadAll() {
        const names = Array.from(this.plugins.keys());

        for (const name of names) {
            await this.unload(name);
        }
    }

    /**
     * Get plugin info
     * @param {string} name - Plugin name
     * @returns {Object|null}
     */
    getPlugin(name) {
        const plugin = this.plugins.get(name);
        if (!plugin) return null;

        return {
            name: plugin.manifest.name,
            displayName: plugin.manifest.displayName,
            version: plugin.manifest.version,
            author: plugin.manifest.author,
            description: plugin.manifest.description,
            enabled: plugin.enabled,
            config: plugin.config
        };
    }

    /**
     * Get all plugins
     * @returns {Array<Object>}
     */
    getAllPlugins() {
        return Array.from(this.plugins.keys()).map(name => this.getPlugin(name));
    }

    /**
     * Get full catalog of all discovered plugins including metadata, README, and live state
     * @returns {Promise<{discordPath: string|null, plugins: Array<Object>}>}
     */
    async getCatalog() {
        const { loadConfig } = await import('../config.js');
        const { findDiscordResourcePath } = await import('./deploy-utils.js');

        const discovered = await this.discover();
        const globalCfg = await loadConfig();
        const enabledList = Array.isArray(globalCfg?.plugins?.enabled) ? globalCfg.plugins.enabled : [];
        const discordPath = await findDiscordResourcePath(this.api);
        const scriptsDir = discordPath ? path.join(discordPath, 'app', 'plugin-scripts') : null;

        const catalog = [];
        for (const name of discovered) {
            const pluginDir = path.join(this.pluginsDir, name);
            const manifestPath = path.join(pluginDir, 'manifest.json');
            let manifest = { name };
            try {
                manifest = await fs.readJson(manifestPath);
            } catch (_) {}

            const perPluginCfgPath = path.join(pluginDir, 'config.json');
            let pluginConfig = { ...(manifest.config || {}) };
            if (await fs.pathExists(perPluginCfgPath)) {
                try {
                    const userCfg = await fs.readJson(perPluginCfgPath);
                    pluginConfig = { ...pluginConfig, ...userCfg };
                } catch (_) {}
            }

            let readme = '';
            for (const readmeFile of ['README.md', 'readme.md']) {
                const p = path.join(pluginDir, readmeFile);
                if (await fs.pathExists(p)) {
                    try {
                        readme = await fs.readFile(p, 'utf8');
                    } catch (_) {}
                    break;
                }
            }

            const hasInjectFile = await fs.pathExists(path.join(pluginDir, 'inject.js'));
            const deployedScriptPath = scriptsDir ? path.join(scriptsDir, `${name}.js`) : null;
            const deployed = deployedScriptPath ? await fs.pathExists(deployedScriptPath) : false;
            const loaded = this.plugins.get(name);
            const isEnabled = loaded ? !!loaded.enabled : (enabledList.includes(name) || deployed);

            catalog.push({
                name,
                displayName: manifest.displayName || name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
                version: manifest.version || '1.0.0',
                author: manifest.author || 'Unknown',
                description: manifest.description || '',
                enabled: isEnabled,
                loaded: !!loaded,
                deployed,
                hasInject: hasInjectFile || name === 'quick-send',
                hotReloadable: hasInjectFile || name === 'quick-send',
                hooks: Array.isArray(manifest.hooks) ? manifest.hooks : [],
                tags: Array.isArray(manifest.tags) ? manifest.tags : [],
                config: loaded?.config || pluginConfig,
                readme
            });
        }

        catalog.sort((a, b) => a.displayName.localeCompare(b.displayName));
        return { discordPath, plugins: catalog };
    }

    /**
     * Update plugin configuration
     * @param {string} name - Plugin name
     * @param {Object} config - New configuration
     * @returns {Promise<boolean>}
     */
    async updateConfig(name, config) {
        const plugin = this.plugins.get(name);
        if (!plugin) return false;

        try {
            const newConfig = { ...plugin.config, ...config };
            plugin.config = newConfig;

            // Save to file
            const configPath = path.join(plugin.path, 'config.json');
            await fs.writeJson(configPath, newConfig, { spaces: 2 });

            // Notify plugin
            if (plugin.instance?.onConfigChange) {
                await plugin.instance.onConfigChange(newConfig);
            }

            eventBus.emit(Events.PLUGIN_CONFIG_CHANGE, { name, config: newConfig });
            logger.debug(`Plugin config updated: ${name}`);

            return true;

        } catch (err) {
            logger.error(`Failed to update plugin config: ${name}`, { error: err.message });
            return false;
        }
    }

    /**
     * Trigger a hook on all plugins
     * @param {string} hookName - Hook name
     * @param {...*} args - Hook arguments
     * @returns {Promise<Array>}
     */
    async triggerHook(hookName, ...args) {
        const handlers = this.hooks.get(hookName) || new Set();
        const results = [];

        for (const { name, handler } of handlers) {
            const plugin = this.plugins.get(name);

            // Skip disabled plugins
            if (!plugin?.enabled) continue;

            try {
                const result = await handler(...args);
                results.push({ name, success: true, result });
            } catch (err) {
                logger.error(`Plugin hook error: ${name}.${hookName}`, { error: err.message });
                results.push({ name, success: false, error: err });
            }
        }

        return results;
    }

    /**
     * Check if dependencies are loaded
     * @param {string[]} dependencies - Required plugins
     */
    async _checkDependencies(dependencies) {
        for (const dep of dependencies) {
            if (!this.plugins.has(dep)) {
                throw new PluginError(
                    `Missing dependency: ${dep}`,
                    dep
                );
            }
        }
    }

    /**
     * Register plugin hooks
     * @param {string} name - Plugin name
     * @param {string[]} hookNames - Hook names to register
     * @param {Object} instance - Plugin instance
     */
    _registerHooks(name, hookNames, instance) {
        if (!hookNames || !instance) return;

        for (const hookName of hookNames) {
            if (typeof instance[hookName] !== 'function') continue;

            if (!this.hooks.has(hookName)) {
                this.hooks.set(hookName, new Set());
            }

            this.hooks.get(hookName).add({
                name,
                handler: instance[hookName].bind(instance)
            });
        }
    }

    /**
     * Unregister plugin hooks
     * @param {string} name - Plugin name
     */
    _unregisterHooks(name) {
        for (const [hookName, handlers] of this.hooks) {
            for (const handler of handlers) {
                if (handler.name === name) {
                    handlers.delete(handler);
                }
            }
        }
    }

    /**
     * Create plugin-specific API
     * @param {string} pluginName - Plugin name
     * @returns {Object}
     */
    _createPluginAPI(pluginName) {
        return {
            // Logging
            log: logger.child({ plugin: pluginName }),

            // Events
            on: (event, handler) => eventBus.on(event, handler),
            emit: (event, data) => eventBus.emit(event, { ...data, source: pluginName }),

            // Storage
            storage: {
                get: async (key) => this._getPluginStorage(pluginName, key),
                set: async (key, value) => this._setPluginStorage(pluginName, key, value),
                delete: async (key) => this._deletePluginStorage(pluginName, key)
            },

            // Config
            getConfig: () => this.plugins.get(pluginName)?.config || {},

            // File access (sandboxed)
            fs: this._createSandboxedFS(pluginName),

            // Core API (from injector)
            ...this.api
        };
    }

    /**
     * Get plugin storage value
     */
    async _getPluginStorage(pluginName, key) {
        const storagePath = path.join(this.pluginsDir, pluginName, 'storage.json');

        try {
            if (!await fs.pathExists(storagePath)) return undefined;
            const storage = await fs.readJson(storagePath);
            return storage[key];
        } catch {
            return undefined;
        }
    }

    /**
     * Set plugin storage value
     */
    async _setPluginStorage(pluginName, key, value) {
        const storagePath = path.join(this.pluginsDir, pluginName, 'storage.json');

        let storage = {};
        if (await fs.pathExists(storagePath)) {
            storage = await fs.readJson(storagePath);
        }

        storage[key] = value;
        await fs.writeJson(storagePath, storage, { spaces: 2 });
    }

    /**
     * Delete plugin storage value
     */
    async _deletePluginStorage(pluginName, key) {
        const storagePath = path.join(this.pluginsDir, pluginName, 'storage.json');

        if (!await fs.pathExists(storagePath)) return;

        const storage = await fs.readJson(storagePath);
        delete storage[key];
        await fs.writeJson(storagePath, storage, { spaces: 2 });
    }

    /**
     * Create sandboxed file system for plugin
     */
    _createSandboxedFS(pluginName) {
        const pluginPath = path.join(this.pluginsDir, pluginName);

        return {
            readFile: async (filePath) => {
                const fullPath = path.join(pluginPath, filePath);
                if (!fullPath.startsWith(pluginPath)) {
                    throw new Error('Access denied: path outside plugin directory');
                }
                return fs.readFile(fullPath, 'utf8');
            },

            writeFile: async (filePath, content) => {
                const fullPath = path.join(pluginPath, filePath);
                if (!fullPath.startsWith(pluginPath)) {
                    throw new Error('Access denied: path outside plugin directory');
                }
                await fs.writeFile(fullPath, content);
            },

            exists: async (filePath) => {
                const fullPath = path.join(pluginPath, filePath);
                return fs.pathExists(fullPath);
            }
        };
    }
}

// Export singleton
export const pluginManager = new PluginManager();

// Export class for testing
export { PluginManager };
