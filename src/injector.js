import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import { createBackup } from './backup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function validateCSS(css, maxSize = 5 * 1024 * 1024) {
    const warnings = [];

    if (css === undefined || css === null) {
        return { valid: true, warnings: ['CSS content is undefined or null'] };
    }

    const trimmed = String(css).trim();

    if (trimmed.length === 0) {
        warnings.push('CSS file is empty');
        return { valid: true, warnings };
    }

    if (trimmed.length > maxSize) {
        warnings.push(`CSS exceeds recommended size of ${maxSize} bytes (${trimmed.length} bytes)`);
    }

    const openBraces = (trimmed.match(/{/g) || []).length;
    const closeBraces = (trimmed.match(/}/g) || []).length;

    if (openBraces !== closeBraces) {
        warnings.push(`Unbalanced braces: ${openBraces} opening, ${closeBraces} closing`);
    }

    const lines = trimmed.split('\n');
    let inBlockComment = false;
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        if (inBlockComment) {
            if (line.includes('*/')) {
                inBlockComment = false;
                line = line.slice(line.indexOf('*/') + 2).trim();
            } else {
                continue;
            }
        }
        if (line.startsWith('/*')) {
            inBlockComment = true;
            if (!line.includes('*/')) continue;
            line = line.slice(line.indexOf('*/') + 2).trim();
        }
        if (line.length === 0 || line.startsWith('//') || line.startsWith('/*') || line.startsWith('*') || line.endsWith('*/') || line.endsWith('{') || line.endsWith('}')) {
            continue;
        }
        if (!line.endsWith(';') && !line.includes(':') && !line.endsWith(',')) {
            warnings.push(`Possible missing semicolon at line ${i + 1}`);
            break;
        }
    }

    return { valid: true, warnings };
}

export async function injectDiscord(resourcePath, initialCSS) {
    const appFolder = path.join(resourcePath, 'app');
    const appAsarPath = path.join(resourcePath, 'app.asar');
    const originalAsarPath = path.join(resourcePath, 'original.asar');

    if (initialCSS !== undefined) {
        const validation = validateCSS(initialCSS);
        if (validation.warnings.length > 0) {
            validation.warnings.forEach(w => console.log(chalk.yellow(`[CSS Warning] ${w}`)));
        }
    }

    if (fs.existsSync(appAsarPath) && !fs.existsSync(originalAsarPath)) {
        await createBackup(appAsarPath);
        console.log('Renaming app.asar -> original.asar...');
        await fs.rename(appAsarPath, originalAsarPath);
    }

    await fs.ensureDir(appFolder);
    await fs.writeFile(path.join(appFolder, 'custom.css'), initialCSS);
    await fs.writeJson(path.join(appFolder, 'package.json'), { name: "pancord", main: "index.js" });

    const turboScriptPath = path.join(__dirname, 'turbo-index.cjs');
    const trimExeSrcPath = path.resolve(__dirname, '..', 'trim_memory.exe');

    if (fs.existsSync(turboScriptPath)) {
        await fs.copy(turboScriptPath, path.join(appFolder, 'index.js'));
    } else {
        throw new Error(`Missing runtime bootstrap file: ${turboScriptPath}`);
    }

    if (fs.existsSync(trimExeSrcPath)) {
        await fs.copy(trimExeSrcPath, path.join(appFolder, 'trim_memory.exe'));
    }

    const setPath = path.join(appFolder, 'settings.json');
    if (!fs.existsSync(setPath)) await fs.writeJson(setPath, {});

    console.log('Injection script and settings created');
    return true;
}

export async function reinjectDiscord(resourcePath, cssContent) {
    const appFolder = path.join(resourcePath, 'app');
    const cssTarget = path.join(appFolder, 'custom.css');

    if (cssContent !== undefined) {
        const validation = validateCSS(cssContent);
        if (validation.warnings.length > 0) {
            validation.warnings.forEach(w => console.log(chalk.yellow(`[CSS Warning] ${w}`)));
        }
    }

    try {
        await fs.writeFile(cssTarget, cssContent);
        return true;
    } catch (e) {
        console.log(chalk.red(`[Reinject Error] ${e.message}`));
        return false;
    }
}

export async function restoreDiscord(resourcePath) {
    const appFolder = path.join(resourcePath, 'app');
    const appAsarPath = path.join(resourcePath, 'app.asar');
    const originalAsarPath = path.join(resourcePath, 'original.asar');

    let restored = false;

    if (fs.existsSync(appFolder)) {
        console.log('Removing app folder...');
        await fs.remove(appFolder);
        restored = true;
    }

    if (fs.existsSync(originalAsarPath)) {
        console.log('Restoring original.asar -> app.asar...');

        if (fs.existsSync(appAsarPath)) {
            await fs.remove(appAsarPath);
        }

        await fs.rename(originalAsarPath, appAsarPath);
        console.log('app.asar restored');
        restored = true;
    }

    return restored;
}
