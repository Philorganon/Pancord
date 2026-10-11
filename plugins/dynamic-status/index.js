/**
 * @fileoverview Dynamic Status Changer Plugin
 * @description Automatically updates Discord status every minute
 *   e.g. "sleeping for <1 minute", "sleeping for 1 minute",
 *        "sleeping for 2 minutes", "sleeping for 1 hour", etc.
 */

export default class DynamicStatus {
    constructor(api) {
        this.api = api;
        this.log = api.log;
        this.config = {};
        this.updateInterval = null;
        this.startTime = null;
        this.rpcReady = false;
    }

    // ─── Lifecycle ───────────────────────────────────────────────

    /**
     * Initialize plugin
     */
    async init(config) {
        this.config = config;
        this.log.info('Dynamic Status plugin initialized');

        if (config.enabled) {
            await this._start();
        }
    }

    /**
     * Destroy plugin – clean up timers and disconnect RPC
     */
    async destroy() {
        this._stop();
        this.log.info('Dynamic Status plugin destroyed');
    }

    /**
     * Hook: Called when Discord starts
     */
    async onDiscordStart() {
        if (!this.config.enabled) return;
        await this._start();
    }

    /**
     * Called when config changes at runtime
     */
    async onConfigChange(config) {
        this.config = config;

        if (config.enabled) {
            await this._start();
        } else {
            this._stop();
        }
    }

    // ─── Core logic ──────────────────────────────────────────────

    /**
     * Start the status rotation
     */
    async _start() {
        // Stop any existing interval first
        this._stop();

        this.startTime = Date.now();

        // Attempt RPC connection if type is 'rpc'
        if (this.config.type === 'rpc') {
            await this._connectRPC();
        }

        // Apply the first status immediately
        await this._tick();

        // Then update once every 60 seconds
        this.updateInterval = setInterval(() => {
            this._tick();
        }, 60_000);

        this.log.info('Dynamic Status started – updating every 1 minute');
    }

    /**
     * Stop the status rotation
     */
    _stop() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
        this.startTime = null;
    }

    /**
     * Single update tick – format the elapsed time and push it
     */
    async _tick() {
        if (!this.startTime) return;

        const elapsedMs = Date.now() - this.startTime;
        const totalMinutes = Math.floor(elapsedMs / 60_000);
        const prefix = this.config.prefix || 'sleeping for';
        const durationText = this._formatDuration(totalMinutes);
        const statusText = `${prefix} ${durationText}`;

        this.log.debug(`Status tick → ${statusText}`);

        try {
            if (this.config.type === 'rpc' && this.rpcReady) {
                await this._setRPCActivity(statusText);
            } else if (this.config.type === 'css' && this.api.applyStatus) {
                // CSS-based status (local only)
                await this.api.applyStatus('custom', statusText);
            } else if (this.config.type === 'rpc' && !this.rpcReady) {
                // Retry RPC connection
                await this._connectRPC();
                if (this.rpcReady) {
                    await this._setRPCActivity(statusText);
                }
            }
        } catch (err) {
            this.log.error(`Failed to update status: ${err.message}`);
        }
    }

    // ─── Duration formatting ─────────────────────────────────────

    /**
     * Format a number of minutes into a human-readable string.
     *
     *   0  → "<1 minute"
     *   1  → "1 minute"
     *   5  → "5 minutes"
     *  60  → "1 hour"
     *  61  → "1 hour 1 minute"
     * 120  → "2 hours"
     * 125  → "2 hours 5 minutes"
     *
     * @param {number} totalMinutes
     * @returns {string}
     */
    _formatDuration(totalMinutes) {
        if (totalMinutes < 1) {
            return '<1 minute';
        }

        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;

        const parts = [];

        if (hours > 0) {
            parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
        }

        if (minutes > 0) {
            parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
        }

        return parts.join(' ');
    }

    // ─── RPC helpers ─────────────────────────────────────────────

    /**
     * Connect to Discord RPC using the configured (or global) client ID
     */
    async _connectRPC() {
        try {
            // Check if already connected via the global API
            if (this.api.isConnectedRPC && this.api.isConnectedRPC()) {
                this.rpcReady = true;
                return;
            }

            // Determine the client ID to use
            let clientId = this.config.clientId;

            if (!clientId && this.api.getGlobalConfig) {
                const globalConfig = await this.api.getGlobalConfig();
                clientId = globalConfig?.rpcClientId;
            }

            if (!clientId) {
                this.log.warn(
                    'No RPC client ID configured. ' +
                    'Set it in plugins/dynamic-status/config.json → clientId, ' +
                    'or in the global config → rpcClientId.'
                );
                return;
            }

            if (this.api.initRPC) {
                const connected = await this.api.initRPC(clientId);
                this.rpcReady = !!connected;

                if (this.rpcReady) {
                    this.log.success('Connected to Discord RPC');
                } else {
                    this.log.warn('Could not connect to Discord RPC – is Discord running?');
                }
            }
        } catch (err) {
            this.log.error(`RPC connection error: ${err.message}`);
            this.rpcReady = false;
        }
    }

    /**
     * Push an activity update to Discord RPC
     */
    async _setRPCActivity(statusText) {
        if (this.api.setActivity) {
            await this.api.setActivity({
                details: statusText,
                state: '',
            });
        }
    }
}
