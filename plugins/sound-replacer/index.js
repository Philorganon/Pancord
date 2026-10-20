/**
 * @fileoverview Sound Replacer — sisi Node (host injector).
 * @description Membaca file suara dari folder `sounds/` proyek, meng-embed-nya sebagai
 *   base64 ke dalam script renderer, lalu mendeploy ke plugin-scripts/.
 *
 * Kenapa base64 → blob (bukan URL biasa):
 *   - `data:` ditolak media element Discord ("Media load rejected by URL safety check")
 *   - `blob:` terbukti jalan, dan tidak butuh server maupun port
 *   - suara bawaan Discord diambil dari `/assets/<hash16>.mp3`, jadi bisa dikenali
 *     tanpa perlu tahu hash-nya lebih dulu
 */

import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { createScriptDeployer } from '../../src/plugins/deploy-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..', '..');

const MIME_BY_EXT = {
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.opus': 'audio/ogg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.flac': 'audio/flac'
};

export default class SoundReplacer {
    constructor(api) {
        this.api = api;
        this.log = api.log;

        this.config = {
            enabled: true,
            file: 'messages.mp3',
            hashes: [],
            learn: false,
            verbose: true
        };

        this.deployer = createScriptDeployer({
            api,
            log: this.log,
            pluginDir: __dirname,
            scriptName: 'sound-replacer.js',
            configGlobalName: '__SOUND_REPLACER_CONFIG__',
            buildConfig: () => this._buildRendererConfig()
        });
    }

    // ─── Lifecycle ───────────────────────────────────────────────

    async init(config) {
        this.config = { ...this.config, ...(config || {}) };
        this.log.info('Sound Replacer plugin initialized');

        // Deploy saat init juga: `onDiscordStart` tidak pernah dipanggil oleh CLI,
        // jadi tanpa ini script hanya ter-deploy kalau alur install/inject dijalankan.
        if (this.config.enabled) {
            await this.deployer.deploy();
        }
    }

    async destroy() {
        this.log.info('Sound Replacer plugin destroyed');
    }

    async afterInject(data) {
        if (!this.config.enabled) return;
        await this.deployer.deploy(data?.resourcePath);
    }

    async onDiscordStart() {
        if (!this.config.enabled) return;
        await this.deployer.deploy();
    }

    async onConfigChange(config) {
        this.config = { ...this.config, ...(config || {}) };

        if (this.config.enabled) {
            await this.deployer.deploy();
        } else {
            await this.deployer.remove();
        }
    }

    // ─── Config untuk renderer ───────────────────────────────────

    /**
     * Baca file suara lalu siapkan config yang dikirim ke renderer.
     * @returns {Object}
     */
    _buildRendererConfig() {
        const base = {
            enabled: this.config.enabled !== false,
            file: this.config.file || 'messages.mp3',
            hashes: Array.isArray(this.config.hashes)
                ? this.config.hashes.map((h) => String(h).toLowerCase()).filter(Boolean)
                : [],
            learn: this.config.learn === true,
            verbose: this.config.verbose !== false,
            audioBase64: null,
            mimeType: null
        };

        if (!base.enabled) return base;

        const fileName = path.basename(base.file);
        const filePath = path.join(projectRoot, 'sounds', fileName);

        try {
            if (!fs.existsSync(filePath)) {
                const available = this._listSounds();
                this.log.warn(`File suara tidak ditemukan: ${filePath}`);
                if (available.length > 0) {
                    this.log.info(`Tersedia di sounds/: ${available.join(', ')}`);
                } else {
                    this.log.warn('Folder sounds/ kosong — taruh file .mp3 di sana');
                }
                return { ...base, enabled: false };
            }

            const ext = path.extname(fileName).toLowerCase();
            const buffer = fs.readFileSync(filePath);

            base.audioBase64 = buffer.toString('base64');
            base.mimeType = MIME_BY_EXT[ext] || 'audio/mpeg';
            base.fileBytes = buffer.length;

            this.log.info(`Suara: ${fileName} (${(buffer.length / 1024).toFixed(1)} KB) → ${base.mimeType}`);
            if (base.hashes.length === 0) {
                this.log.info('Scope: semua suara bawaan Discord akan diganti');
            } else {
                this.log.info(`Scope: hanya hash ${base.hashes.join(', ')}`);
            }

            return base;
        } catch (err) {
            this.log.error(`Gagal membaca file suara: ${err.message}`);
            return { ...base, enabled: false };
        }
    }

    _listSounds() {
        try {
            const dir = path.join(projectRoot, 'sounds');
            if (!fs.existsSync(dir)) return [];
            return fs.readdirSync(dir).filter((f) => MIME_BY_EXT[path.extname(f).toLowerCase()]);
        } catch {
            return [];
        }
    }
}
