import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import fs from 'fs-extra';
import path from 'path';
import open from 'open';
import chalk from 'chalk';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function findFreePort(startPort = 8765) {
    const net = await import('net');
    for (let p = startPort; p < startPort + 100; p++) {
        const port = await new Promise((resolve) => {
            const server = net.createServer();
            server.listen(p, () => {
                server.close(() => resolve(p));
            });
            server.on('error', () => resolve(null));
        });
        if (port) return port;
    }
    return startPort;
}

export async function startServer(resourcePath, options = {}) {
    const app = express();
    const server = http.createServer(app);
    const wss = new WebSocketServer({ server });

    let port = parseInt(options.port, 10);
    if (!port || port < 1 || port > 65535) {
        port = 8765;
    }

    const actualPort = await findFreePort(port);

    const cssTarget = path.join(resourcePath, 'app', 'custom.css');
    const localRepoCss = path.resolve(__dirname, '..', 'custom.css');
    let fileWatcher = null;
    let lastCssContent = '';
    const clients = new Set();

    try {
        if (await fs.pathExists(cssTarget)) {
            lastCssContent = await fs.readFile(cssTarget, 'utf8');
        }
    } catch (_) {}

    async function persistCss(cssText) {
        const content = typeof cssText === 'string' ? cssText : '';
        lastCssContent = content;
        await fs.writeFile(cssTarget, content, 'utf8');
        if (await fs.pathExists(localRepoCss)) {
            await fs.writeFile(localRepoCss, content, 'utf8').catch(() => {});
        }
    }

    app.use(express.json({ limit: '5mb' }));

    // Allow file:// index.html or external local tabs to talk to the Pancord API
    app.use('/api', (req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') {
            return res.status(204).end();
        }
        next();
    });

    app.use(express.static(path.join(__dirname, 'editor')));

    app.get(['/plugins', '/plugins.html', '/dashboard'], (req, res) => {
        res.sendFile(path.join(__dirname, 'editor', 'plugins.html'));
    });

    let pluginInitPromise = null;
    const ensurePluginManager = async () => {
        const { pluginManager } = await import('./plugins/manager.js');
        if (pluginManager.initialized && pluginManager.api?.findDiscordPath) {
            return pluginManager;
        }
        if (!pluginInitPromise) {
            pluginInitPromise = (async () => {
                const [{ default: fsExtra }, { loadConfig }, finder, { themes }, rpc, statusMgr] = await Promise.all([
                    import('fs-extra'),
                    import('./config.js'),
                    import('./finder.js'),
                    import('./css/themes/index.js'),
                    import('./rpc-manager.js'),
                    import('./status-manager.js')
                ]);

                const resolvePath = async () => resourcePath || await finder.findDiscordPath();

                await pluginManager.initialize({
                    findDiscordPath: resolvePath,
                    getCurrentCSS: async () => {
                        const dp = await resolvePath();
                        if (!dp) return null;
                        const cp = path.join(dp, 'app', 'custom.css');
                        return await fsExtra.pathExists(cp) ? await fsExtra.readFile(cp, 'utf8') : null;
                    },
                    applyTheme: async (themeName) => {
                        const css = themes[themeName];
                        if (!css) return false;
                        const dp = await resolvePath();
                        if (!dp) return false;
                        await fsExtra.writeFile(path.join(dp, 'app', 'custom.css'), css);
                        return true;
                    },
                    getGlobalConfig: loadConfig,
                    initRPC: rpc.initRPC,
                    setActivity: rpc.setActivity,
                    clearActivity: rpc.clearActivity,
                    disconnectRPC: rpc.disconnectRPC,
                    isConnectedRPC: rpc.isConnected,
                    applyStatus: async (presetName, customText) => {
                        const dp = await resolvePath();
                        return dp ? await statusMgr.applyStatus(dp, presetName, customText) : false;
                    }
                });

                const cfg = await loadConfig();
                if (Array.isArray(cfg.plugins?.enabled)) {
                    for (const name of cfg.plugins.enabled) {
                        if (!pluginManager.plugins.has(name)) {
                            await pluginManager.load(name);
                        }
                    }
                }
                return pluginManager;
            })().catch((err) => {
                pluginInitPromise = null;
                throw err;
            });
        }
        return pluginInitPromise;
    };

    app.get('/api/health', (req, res) => {
        res.json({
            ok: true,
            service: 'pancord',
            port: actualPort,
            timestamp: Date.now()
        });
    });

    app.get('/api/plugins', async (req, res) => {
        try {
            const pm = await ensurePluginManager();
            const catalog = await pm.getCatalog();
            const enabledCount = catalog.plugins.filter((p) => p.enabled).length;
            res.json({
                ok: true,
                discordPath: catalog.discordPath,
                total: catalog.plugins.length,
                enabledCount,
                plugins: catalog.plugins
            });
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    app.post('/api/plugins/:name/toggle', async (req, res) => {
        try {
            const name = req.params.name;
            if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
                return res.status(400).json({ ok: false, error: 'Nama plugin tidak valid' });
            }

            const pm = await ensurePluginManager();
            const before = await pm.getCatalog();
            const existing = before.plugins.find((p) => p.name === name);
            if (!existing) {
                return res.status(404).json({ ok: false, error: `Plugin "${name}" tidak ditemukan` });
            }

            const targetEnabled = typeof req.body?.enabled === 'boolean'
                ? req.body.enabled
                : !existing.enabled;

            const ok = targetEnabled
                ? await pm.enable(name)
                : await pm.disable(name);

            if (!ok) {
                return res.status(500).json({ ok: false, error: `Gagal mengubah status plugin "${name}"` });
            }

            const after = await pm.getCatalog();
            const updated = after.plugins.find((p) => p.name === name);
            res.json({
                ok: true,
                enabledCount: after.plugins.filter((p) => p.enabled).length,
                plugin: updated
            });
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    app.get('/api/css', async (req, res) => {
        try {
            const css = await fs.readFile(cssTarget, 'utf8');
            lastCssContent = css;
            res.json({ css });
        } catch (e) {
            res.status(500).json({ error: 'File not found' });
        }
    });

    app.post('/api/css', async (req, res) => {
        try {
            const css = req.body && typeof req.body.css === 'string' ? req.body.css : null;
            if (css === null) {
                return res.status(400).json({ error: 'Invalid CSS payload' });
            }
            await persistCss(css);
            console.log(chalk.green(`[Saved HTTP] ${new Date().toLocaleTimeString()}`));
            return res.json({ ok: true });
        } catch (e) {
            return res.status(500).json({ error: e.message || 'Save failed' });
        }
    });

    wss.on('connection', (ws) => {
        clients.add(ws);
        ws.on('message', async (message) => {
            try {
                const data = JSON.parse(message);
                if (data.type === 'SAVE' && typeof data.css === 'string') {
                    await persistCss(data.css);
                    if (!data.silent) {
                        console.log(chalk.green(`[Saved] ${new Date().toLocaleTimeString()}`));
                        if (ws.readyState === 1) {
                            ws.send(JSON.stringify({ type: 'SAVED' }));
                        }
                    }
                }
            } catch (e) {
                if (ws.readyState === 1) {
                    ws.send(JSON.stringify({ type: 'ERROR', message: e.message || 'Save failed' }));
                }
            }
        });
        ws.on('close', () => clients.delete(ws));
    });

    if (options.watchMode !== false) {
        try {
            const chokidar = await import('chokidar');
            fileWatcher = chokidar.watch(cssTarget, { persistent: true });
            fileWatcher.on('change', async () => {
                try {
                    const css = await fs.readFile(cssTarget, 'utf8');
                    if (css === lastCssContent) return;
                    lastCssContent = css;
                    const payload = JSON.stringify({ type: 'UPDATE', css });
                    clients.forEach(ws => {
                        if (ws.readyState === 1) ws.send(payload);
                    });
                } catch (e) {
                    // ignore
                }
            });
        } catch (e) {
            console.log(chalk.gray('Chokidar not available, watch mode disabled'));
        }
    }

    server.listen(actualPort, () => {
        console.log(chalk.cyan(`\nEditor ready at: http://localhost:${actualPort}`));
        console.log(chalk.cyan(`Plugin Manager ready at: http://localhost:${actualPort}/plugins`));
        console.log(chalk.gray('Press Ctrl+C to stop server'));
        if (!options?.noOpen) {
            open(`http://localhost:${actualPort}`);
        }
    });

    return { server, port: actualPort, wss };
}
