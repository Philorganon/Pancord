/**
 * @fileoverview Safe file operations with atomic writes and rollback
 * @module core/file-ops
 */

import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import { validatePath } from './validator.js';
import { PermissionError, BackupError, wrapError } from './errors.js';
import { logger } from './logger.js';

/**
 * Operation log for rollback
 * @type {Array<{type: string, path: string, backup?: string, timestamp: number}>}
 */
let operationLog = [];

/**
 * Temporary directory for atomic operations
 */
const TEMP_DIR = path.join(process.cwd(), '.tmp');

/**
 * Initialize file operations module
 */
export async function initFileOps() {
    await fs.ensureDir(TEMP_DIR);
}

/**
 * Generate checksum for file
 * @param {string} filePath - Path to file
 * @returns {Promise<string>} SHA256 checksum
 */
export async function getChecksum(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);

        stream.on('data', data => hash.update(data));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

/**
 * Verify file checksum
 * @param {string} filePath - Path to file
 * @param {string} expectedChecksum - Expected SHA256 checksum
 * @returns {Promise<boolean>}
 */
export async function verifyChecksum(filePath, expectedChecksum) {
    const actual = await getChecksum(filePath);
    return actual === expectedChecksum;
}

/**
 * Create a backup of a file
 * @param {string} filePath - File to backup
 * @param {Object} [options] - Backup options
 * @param {string} [options.backupDir] - Backup directory
 * @param {boolean} [options.timestamped] - Add timestamp to backup name
 * @returns {Promise<{path: string, checksum: string}>} Backup info
 */
export async function createBackup(filePath, options = {}) {
    const {
        backupDir = path.join(process.cwd(), 'backups'),
        timestamped = true
    } = options;

    try {
        // Validate source path
        const sourcePath = validatePath(filePath, { mustExist: true, isFile: true });

        // Ensure backup directory exists
        await fs.ensureDir(backupDir);

        // Generate backup filename
        const basename = path.basename(sourcePath);
        const timestamp = timestamped ? `.${Date.now()}` : '';
        const backupName = `${basename}${timestamp}.bak`;
        const backupPath = path.join(backupDir, backupName);

        // Copy file
        await fs.copy(sourcePath, backupPath);

        // Generate checksum
        const checksum = await getChecksum(backupPath);

        // Log operation
        operationLog.push({
            type: 'backup',
            path: backupPath,
            original: sourcePath,
            timestamp: Date.now()
        });

        logger.debug(`Backup created: ${backupPath}`, { checksum });

        return { path: backupPath, checksum };

    } catch (err) {
        throw new BackupError(`Failed to create backup of ${filePath}`, filePath, err);
    }
}

/**
 * Atomic write - writes to temp file then renames
 * @param {string} filePath - Target file path
 * @param {string|Buffer} content - Content to write
 * @param {Object} [options] - Write options
 * @param {boolean} [options.backup] - Create backup before overwriting
 * @param {string} [options.encoding] - File encoding
 * @returns {Promise<{success: boolean, checksum: string, backup?: string}>}
 */
export async function atomicWrite(filePath, content, options = {}) {
    const {
        backup = false,
        encoding = 'utf8'
    } = options;

    const targetPath = validatePath(filePath);
    const targetDir = path.dirname(targetPath);
    const tempPath = path.join(targetDir, `.${crypto.randomUUID()}.tmp`);
    let backupInfo = null;

    try {
        await fs.ensureDir(targetDir);

        // Create backup if requested and file exists
        if (backup && await fs.pathExists(targetPath)) {
            backupInfo = await createBackup(targetPath);
        }

        // Write to temp file
        await fs.writeFile(tempPath, content, encoding);

        // Verify temp file was written
        const tempChecksum = await getChecksum(tempPath);

        // Ensure target directory exists
        await fs.ensureDir(targetDir);

        // Atomic move/rename (supports cross-device fallback)
        try {
            await fs.rename(tempPath, targetPath);
        } catch (renameErr) {
            if (renameErr.code === 'EXDEV') {
                await fs.move(tempPath, targetPath, { overwrite: true });
            } else {
                throw renameErr;
            }
        }

        // Verify final file
        const finalChecksum = await getChecksum(targetPath);

        if (tempChecksum !== finalChecksum) {
            throw new Error('Checksum mismatch after atomic write');
        }

        // Log operation
        operationLog.push({
            type: 'write',
            path: targetPath,
            backup: backupInfo?.path,
            timestamp: Date.now()
        });

        logger.debug(`Atomic write successful: ${targetPath}`, { checksum: finalChecksum });

        return {
            success: true,
            checksum: finalChecksum,
            backup: backupInfo?.path
        };

    } catch (err) {
        // Cleanup temp file
        await fs.remove(tempPath).catch(() => { });

        // Check for permission error
        if (err.code === 'EACCES' || err.code === 'EPERM') {
            throw new PermissionError(targetPath, 'write', err);
        }

        throw wrapError(err, `Failed to write ${targetPath}`);
    }
}

/**
 * Safe delete with backup option
 * @param {string} filePath - File to delete
 * @param {Object} [options] - Delete options
 * @param {boolean} [options.backup] - Create backup before deleting
 * @returns {Promise<{success: boolean, backup?: string}>}
 */
export async function safeDelete(filePath, options = {}) {
    const { backup = true } = options;

    const targetPath = validatePath(filePath);
    let backupInfo = null;

    try {
        if (!await fs.pathExists(targetPath)) {
            return { success: true, existed: false };
        }

        // Create backup if requested
        if (backup) {
            backupInfo = await createBackup(targetPath);
        }

        // Delete file/folder
        await fs.remove(targetPath);

        // Log operation
        operationLog.push({
            type: 'delete',
            path: targetPath,
            backup: backupInfo?.path,
            timestamp: Date.now()
        });

        logger.debug(`Deleted: ${targetPath}`, { backup: backupInfo?.path });

        return { success: true, existed: true, backup: backupInfo?.path };

    } catch (err) {
        if (err.code === 'EACCES' || err.code === 'EPERM') {
            throw new PermissionError(targetPath, 'delete', err);
        }
        throw wrapError(err, `Failed to delete ${targetPath}`);
    }
}

/**
 * Safe rename/move operation
 * @param {string} sourcePath - Source path
 * @param {string} destPath - Destination path
 * @param {Object} [options] - Move options
 * @param {boolean} [options.backup] - Backup destination if exists
 * @param {boolean} [options.overwrite] - Overwrite destination
 * @returns {Promise<{success: boolean, backup?: string}>}
 */
export async function safeMove(sourcePath, destPath, options = {}) {
    const { backup = true, overwrite = false } = options;

    const source = validatePath(sourcePath, { mustExist: true });
    const dest = validatePath(destPath);
    let backupInfo = null;

    try {
        // Check if destination exists
        if (await fs.pathExists(dest)) {
            if (!overwrite) {
                throw new Error(`Destination already exists: ${dest}`);
            }
            if (backup) {
                backupInfo = await createBackup(dest);
            }
        }

        // Ensure destination directory exists
        await fs.ensureDir(path.dirname(dest));

        // Move file
        await fs.rename(source, dest);

        // Log operation
        operationLog.push({
            type: 'move',
            path: dest,
            original: source,
            backup: backupInfo?.path,
            timestamp: Date.now()
        });

        logger.debug(`Moved: ${source} → ${dest}`);

        return { success: true, backup: backupInfo?.path };

    } catch (err) {
        if (err.code === 'EACCES' || err.code === 'EPERM') {
            throw new PermissionError(source, 'move', err);
        }
        throw wrapError(err, `Failed to move ${source} to ${dest}`);
    }
}

/**
 * Safe copy operation
 * @param {string} sourcePath - Source path
 * @param {string} destPath - Destination path
 * @param {Object} [options] - Copy options
 * @param {boolean} [options.backup] - Backup destination if exists
 * @param {boolean} [options.overwrite] - Overwrite destination
 * @returns {Promise<{success: boolean, checksum: string, backup?: string}>}
 */
export async function safeCopy(sourcePath, destPath, options = {}) {
    const { backup = true, overwrite = false } = options;

    const source = validatePath(sourcePath, { mustExist: true });
    const dest = validatePath(destPath);
    let backupInfo = null;

    try {
        // Check if destination exists
        if (await fs.pathExists(dest)) {
            if (!overwrite) {
                throw new Error(`Destination already exists: ${dest}`);
            }
            if (backup) {
                backupInfo = await createBackup(dest);
            }
        }

        // Ensure destination directory exists
        await fs.ensureDir(path.dirname(dest));

        // Copy file
        await fs.copy(source, dest, { overwrite });

        // Verify copy
        const sourceChecksum = await getChecksum(source);
        const destChecksum = await getChecksum(dest);

        if (sourceChecksum !== destChecksum) {
            throw new Error('Checksum mismatch after copy');
        }

        // Log operation
        operationLog.push({
            type: 'copy',
            path: dest,
            original: source,
            backup: backupInfo?.path,
            timestamp: Date.now()
        });

        logger.debug(`Copied: ${source} → ${dest}`, { checksum: destChecksum });

        return { success: true, checksum: destChecksum, backup: backupInfo?.path };

    } catch (err) {
        if (err.code === 'EACCES' || err.code === 'EPERM') {
            throw new PermissionError(source, 'copy', err);
        }
        throw wrapError(err, `Failed to copy ${source} to ${dest}`);
    }
}

/**
 * Read file safely
 * @param {string} filePath - File to read
 * @param {Object} [options] - Read options
 * @param {string} [options.encoding] - File encoding
 * @returns {Promise<{content: string|Buffer, checksum: string}>}
 */
export async function safeRead(filePath, options = {}) {
    const { encoding = 'utf8' } = options;

    const targetPath = validatePath(filePath, { mustExist: true, isFile: true });

    try {
        const content = await fs.readFile(targetPath, encoding);
        const checksum = await getChecksum(targetPath);

        return { content, checksum };

    } catch (err) {
        if (err.code === 'EACCES' || err.code === 'EPERM') {
            throw new PermissionError(targetPath, 'read', err);
        }
        throw wrapError(err, `Failed to read ${targetPath}`);
    }
}

/**
 * Rollback last N operations
 * @param {number} [count=1] - Number of operations to rollback
 * @returns {Promise<Array<{type: string, success: boolean}>>}
 */
export async function rollback(count = 1) {
    const results = [];

    for (let i = 0; i < count && operationLog.length > 0; i++) {
        const op = operationLog.pop();

        try {
            switch (op.type) {
                case 'write':
                case 'copy':
                    if (op.backup) {
                        await fs.copy(op.backup, op.path, { overwrite: true });
                    } else {
                        await fs.remove(op.path);
                    }
                    break;

                case 'delete':
                    if (op.backup) {
                        await fs.copy(op.backup, op.path);
                    }
                    break;

                case 'move':
                    await fs.rename(op.path, op.original);
                    if (op.backup) {
                        await fs.copy(op.backup, op.path);
                    }
                    break;
            }

            results.push({ type: op.type, success: true });
            logger.info(`Rolled back ${op.type} operation on ${op.path}`);

        } catch (err) {
            results.push({ type: op.type, success: false, error: err.message });
            logger.error(`Failed to rollback ${op.type}: ${err.message}`);
        }
    }

    return results;
}

/**
 * Clear operation log (call after successful complete operation)
 */
export function clearOperationLog() {
    operationLog = [];
}

/**
 * Get current operation log
 * @returns {Array}
 */
export function getOperationLog() {
    return [...operationLog];
}

/**
 * Cleanup temporary files
 */
export async function cleanupTemp() {
    try {
        await fs.emptyDir(TEMP_DIR);
        logger.debug('Cleaned up temporary files');
    } catch (err) {
        logger.warn('Failed to cleanup temp files', { error: err.message });
    }
}

// Initialize on import
await initFileOps();
