/**
 * @fileoverview Auto Backup to GitHub Gist Plugin
 * @description Automatically backs up CSS to a private GitHub Gist
 */

export default class AutoBackupGist {
    constructor(api) {
        this.api = api;
        this.log = api.log;
        this.config = {};
        this.backupTimer = null;
    }

    /**
     * Called when plugin is initialized
     * @param {Object} config - Plugin configuration
     */
    async init(config) {
        this.config = config;
        this.log.info('Auto Backup Gist plugin initialized');

        if (config.enabled && config.token && config.autoBackupOnChange) {
            this._startBackupTimer();
        }
    }

    /**
     * Called when plugin is destroyed
     */
    destroy() {
        this._stopBackupTimer();
        this.log.info('Auto Backup Gist plugin destroyed');
    }

    /**
     * Hook: Called after CSS injection
     * @param {Object} data - Injection data
     */
    async afterInject(data) {
        if (!this.config.enabled) return;

        try {
            await this.backupToGist(data.css);
            this.log.success('CSS backed up to Gist after injection');
        } catch (err) {
            this.log.error('Failed to backup to Gist', { error: err.message });
        }
    }

    /**
     * Hook: Called when CSS changes
     * @param {Object} data - CSS change data
     */
    async onCssChange(data) {
        if (!this.config.enabled || !this.config.autoBackupOnChange) return;

        // Debounce - don't backup on every keystroke
        this._scheduleBackup(data.css);
    }

    /**
     * Called when configuration changes
     * @param {Object} config - New configuration
     */
    onConfigChange(config) {
        this.config = config;

        if (config.enabled && config.autoBackupOnChange) {
            this._startBackupTimer();
        } else {
            this._stopBackupTimer();
        }
    }

    /**
     * Backup CSS to GitHub Gist
     * @param {string} css - CSS content
     */
    async backupToGist(css) {
        const { token, gistId } = this.config;

        if (!token) {
            throw new Error('GitHub token not configured');
        }

        const gistData = {
            description: `Discord Theme Backup - ${new Date().toISOString()}`,
            files: {
                'discord-theme.css': {
                    content: css
                },
                'metadata.json': {
                    content: JSON.stringify({
                        lastBackup: new Date().toISOString(),
                        version: '1.0.0',
                        source: 'Pancord'
                    }, null, 2)
                }
            }
        };

        let url = 'https://api.github.com/gists';
        let method = 'POST';

        // Update existing gist if ID is provided
        if (gistId) {
            url = `https://api.github.com/gists/${gistId}`;
            method = 'PATCH';
        }

        const response = await fetch(url, {
            method,
            headers: {
                'Authorization': `token ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/vnd.github.v3+json'
            },
            body: JSON.stringify(gistData)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to backup to Gist');
        }

        const result = await response.json();

        // Save gist ID for future updates
        if (!gistId && result.id) {
            await this.api.storage.set('gistId', result.id);
            this.config.gistId = result.id;
        }

        return result;
    }

    /**
     * Restore CSS from Gist
     * @returns {Promise<string>} CSS content
     */
    async restoreFromGist() {
        const { token, gistId } = this.config;

        if (!token || !gistId) {
            throw new Error('GitHub token and Gist ID required');
        }

        const response = await fetch(`https://api.github.com/gists/${gistId}`, {
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch Gist');
        }

        const gist = await response.json();
        const cssFile = gist.files['discord-theme.css'];

        if (!cssFile) {
            throw new Error('CSS file not found in Gist');
        }

        return cssFile.content;
    }

    /**
     * Schedule a debounced backup
     */
    _scheduleBackup(css) {
        if (this.pendingBackup) {
            clearTimeout(this.pendingBackup);
        }

        this.pendingBackup = setTimeout(async () => {
            try {
                await this.backupToGist(css);
                this.log.debug('Debounced backup completed');
            } catch (err) {
                this.log.error('Debounced backup failed', { error: err.message });
            }
        }, 5000); // 5 second debounce
    }

    /**
     * Start periodic backup timer
     */
    _startBackupTimer() {
        this._stopBackupTimer();

        const interval = this.config.backupInterval || 300000; // 5 minutes
        this.backupTimer = setInterval(async () => {
            try {
                const css = await this.api.getCurrentCSS?.();
                if (css) {
                    await this.backupToGist(css);
                    this.log.debug('Periodic backup completed');
                }
            } catch (err) {
                this.log.error('Periodic backup failed', { error: err.message });
            }
        }, interval);
    }

    /**
     * Stop periodic backup timer
     */
    _stopBackupTimer() {
        if (this.backupTimer) {
            clearInterval(this.backupTimer);
            this.backupTimer = null;
        }
    }
}
