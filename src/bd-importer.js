import fs from 'fs-extra';
import path from 'path';
import { logger } from './logger.js';

/**
 * Parse BetterDiscord theme format
 * BD themes punya format META di awal file
 */
export async function parseBDTheme(filePath) {
    try {
        const content = await fs.readFile(filePath, 'utf8');
        
        // Extract META info
        const metaRegex = /\/\*\*\s*\n([\s\S]*?)\*\//;
        const metaMatch = content.match(metaRegex);
        
        let metadata = {
            name: 'Unknown Theme',
            author: 'Unknown',
            version: '1.0.0',
            description: ''
        };
        
        if (metaMatch) {
            const metaContent = metaMatch[1];
            
            // Parse @name, @author, etc
            const nameMatch = metaContent.match(/@name\s+(.+)/);
            const authorMatch = metaContent.match(/@author\s+(.+)/);
            const versionMatch = metaContent.match(/@version\s+(.+)/);
            const descMatch = metaContent.match(/@description\s+(.+)/);
            
            if (nameMatch) metadata.name = nameMatch[1].trim();
            if (authorMatch) metadata.author = authorMatch[1].trim();
            if (versionMatch) metadata.version = versionMatch[1].trim();
            if (descMatch) metadata.description = descMatch[1].trim();
        }
        
        // Get CSS content (everything after META block)
        const cssContent = content.replace(metaRegex, '').trim();
        
        return {
            metadata,
            css: cssContent
        };
        
    } catch (err) {
        logger.error(`Failed to parse BD theme: ${err.message}`);
        throw err;
    }
}

/**
 * Import BetterDiscord theme file
 */
export async function importBDTheme(bdThemePath, targetPath) {
    try {
        logger.info(`Importing BD theme from: ${bdThemePath}`);
        
        // Parse BD theme
        const { metadata, css } = await parseBDTheme(bdThemePath);
        
        logger.info(`Theme: ${metadata.name} by ${metadata.author}`);
        
        // Convert BD-specific selectors to work with injector
        const convertedCSS = convertBDSelectors(css);
        
        // Save to custom.css
        await fs.writeFile(targetPath, convertedCSS);
        
        logger.success(`BD theme imported: ${metadata.name}`);
        
        return metadata;
        
    } catch (err) {
        logger.error(`Failed to import BD theme: ${err.message}`);
        throw err;
    }
}

/**
 * Convert BetterDiscord specific selectors
 */
function convertBDSelectors(css) {
    let converted = css;
    
    // BD uses :root for variables, keep them
    // But some BD themes use .theme-dark, .theme-light
    // These should work fine in Discord already
    
    // Fix common BD-specific classes if needed
    converted = converted.replace(/\.bd-/g, '.discord-');
    
    // Add compatibility note
    const header = `
/* Imported from BetterDiscord */
/* Converted by Pancord */

`;
    
    return header + converted;
}

/**
 * Scan folder for BD themes
 */
export async function scanBDThemes(folderPath) {
    try {
        if (!await fs.pathExists(folderPath)) {
            return [];
        }
        
        const files = await fs.readdir(folderPath);
        const themes = [];
        
        for (const file of files) {
            if (file.endsWith('.theme.css')) {
                const filePath = path.join(folderPath, file);
                const { metadata } = await parseBDTheme(filePath);
                
                themes.push({
                    file,
                    path: filePath,
                    ...metadata
                });
            }
        }
        
        return themes;
        
    } catch (err) {
        logger.error(`Failed to scan BD themes: ${err.message}`);
        return [];
    }
}