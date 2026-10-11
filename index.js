#!/usr/bin/env node
/**
 * @fileoverview Pancord - CLI Entry Point
 * @version 2.0.0
 * @author NsnDev
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import { exec } from 'child_process';
import fs from 'fs-extra';

// Finder - Discord detection
import {
    findDiscordPath,
    findAllDiscordInstances,
    getInjectionStatus,
    getDiscordInfo,
    DiscordVariants,
    isDiscordRunning
} from './src/finder.js';

// Process management
import { killDiscord } from './src/process.js';

// Injector
import { injectDiscord, restoreDiscord } from './src/injector.js';

// WebSocket server for live editor
import { startServer } from './src/websocket.js';

// Themes
import { themes } from './src/css/themes/index.js';

// Logger
import { logger, cleanOldLogs } from './src/logger.js';

// Config
import { loadConfig, saveConfig } from './src/config.js';

// BetterDiscord importer
import { importBDTheme, scanBDThemes } from './src/bd-importer.js';

// Status & Loader customizers
import { applyStatus, statusPresets } from './src/status-manager.js';
import { applyLoader, loaderThemes } from './src/loader-manager.js';

// Rich Presence
import { initRPC, setActivity, clearActivity, disconnectRPC, rpcPresets, isConnected } from './src/rpc-manager.js';

// Plugin system
import { pluginManager } from './src/plugins/index.js';

// Sounds
import { soundPresets } from './src/sounds.js';
import { createBackup, listBackups, restoreBackup, cleanOldBackups, getBackupInfo } from './src/backup.js';

// Initialize
const program = new Command();
const spinner = ora();

/**
 * Display beautiful banner
 */
function showBanner() {
    console.log(chalk.cyan(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   ${chalk.bold.white('Pancord')} ${chalk.gray('v2.0.0')}                    
║   ${chalk.gray('Themes, colors, and plugins — no Nitro, no fork')}                     
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
`));
}

/**
 * Get Discord context with nice output
 * @returns {Promise<{path: string, status: Object}>}
 */
async function getContext() {
    spinner.start('Searching for Discord installation...');

    const discordPath = await findDiscordPath();

    if (!discordPath) {
        spinner.fail('Discord not found!');
        console.log(chalk.yellow('\nMake sure Discord is installed in the default location.'));
        console.log(chalk.gray('Searching in:'));
        console.log(chalk.gray('  Windows: %LOCALAPPDATA%\\Discord'));
        console.log(chalk.gray('  macOS: /Applications/Discord.app'));
        console.log(chalk.gray('  Linux: ~/.config/discord'));
        process.exit(1);
    }

    spinner.succeed(`Discord found: ${chalk.gray(discordPath)}`);

    // Get injection status
    const status = await getInjectionStatus(discordPath);

    // Show status
    if (status.injected) {
        console.log(chalk.green(`   Status: INJECTED (${status.cssLines} lines)`));
    } else {
        console.log(chalk.yellow(`   Status: NOT INJECTED`));
    }
    console.log('');

    await logger.info(`Discord found at: ${discordPath}`);
    return { path: discordPath, status };
}

/**
 * Handle errors gracefully
 */
function handleError(err) {
    console.log(chalk.red(`\n✖ ${err.message}`));

    if (err.suggestions?.length > 0) {
        console.log(chalk.yellow('\nTroubleshooting:'));
        err.suggestions.forEach((s, i) => {
            console.log(chalk.gray(`  ${i + 1}. ${s}`));
        });
    }

    logger.error(err.message, { stack: err.stack });
}

/**
 * Show interactive main menu
 */
async function showMainMenu() {
    showBanner();

    // Get Discord status for display
    const discordPath = await findDiscordPath();
    let statusText = chalk.red('Discord Not Found');

    if (discordPath) {
        const status = await getInjectionStatus(discordPath);
        if (status.injected) {
            statusText = chalk.green(`[+] Injected (${status.cssLines} CSS lines)`);
        } else {
            statusText = chalk.yellow('[-] Not Injected');
        }
    }

    // Menu box
    console.log(chalk.cyan('┌─────────────────────────────────────────┐'));
    console.log(chalk.cyan('│') + chalk.bold.white('           Pancord - Main Menu           ') + chalk.cyan(''));
    console.log(chalk.cyan('├─────────────────────────────────────────┤'));
    console.log(chalk.cyan('│') + `  Status: ${statusText}`.padEnd(49) + chalk.cyan(''));
    console.log(chalk.cyan('├─────────────────────────────────────────┤'));
    console.log(chalk.cyan('│') + chalk.white('  1.  Install Theme                    ') + chalk.cyan(''));
    console.log(chalk.cyan('│') + chalk.white('  2.  Live CSS Editor                  ') + chalk.cyan(''));
    console.log(chalk.cyan('│') + chalk.white('  3.  Restore Discord                  ') + chalk.cyan(''));
    console.log(chalk.cyan('│') + chalk.white('  4.  Rich Presence (visible)          ') + chalk.cyan(''));
    console.log(chalk.cyan('│') + chalk.white('  5.  Browse Themes                    ') + chalk.cyan(''));
    console.log(chalk.cyan('│') + chalk.white('  6.  Manage Plugins                   ') + chalk.cyan(''));
    console.log(chalk.cyan('│') + chalk.white('  7.  Settings                         ') + chalk.cyan(''));
    console.log(chalk.cyan('│') + chalk.white('  8.  Custom Loader                    ') + chalk.cyan(''));
    console.log(chalk.cyan('│') + chalk.white('  9.  Import BD Theme                  ') + chalk.cyan(''));
    console.log(chalk.cyan('│') + chalk.white('  10. Notification Sound               ') + chalk.cyan(''));
    console.log(chalk.cyan('│') + chalk.white('  0.  Exit                             ') + chalk.cyan(''));
    console.log(chalk.cyan('└─────────────────────────────────────────┘'));
    console.log('');

    const { choice } = await inquirer.prompt([{
        type: 'input',
        name: 'choice',
        message: 'Select option (0-10):',
        validate: (input) => {
            const num = parseInt(input);
            if (isNaN(num) || num < 0 || num > 10) {
                return 'Please enter a number between 0-10';
            }
            return true;
        }
    }]);

    const option = parseInt(choice);

    switch (option) {
        case 1:
            await runInstall();
            break;
        case 2:
            await runEditor();
            break;
        case 3:
            await runRestore();
            break;
        case 4:
            await runFakeStatus();
            break;
        case 5:
            await runThemes();
            break;
        case 6:
            await runPlugins();
            break;
        case 7:
            await runConfig();
            break;
        case 8:
            await runLoader();
            break;
        case 9:
            await runImportBD();
            break;
        case 10:
            await runSounds();
            break;
        case 11:
            await runBackupManagement();
            break;
        case 0:
            console.log(chalk.cyan('\nGoodbye! Happy theming!\n'));
            process.exit(0);
    }

    // After action, show menu again
    console.log('');
    const { again } = await inquirer.prompt([{
        type: 'confirm',
        name: 'again',
        message: 'Return to main menu?',
        default: true
    }]);

    if (again) {
        console.clear();
        await showMainMenu();
    } else {
        console.log(chalk.cyan('\nGoodbye!\n'));
    }
}

/**
 * Menu action: Install
 */
async function runInstall() {
    const { path: resourcePath, status } = await getContext();
    const config = await loadConfig();

    if (status.injected) {
        const { overwrite } = await inquirer.prompt([{
            type: 'confirm',
            name: 'overwrite',
            message: 'Discord is already injected. Overwrite?',
            default: false
        }]);
        if (!overwrite) return;
    }

    const themeNames = Object.keys(themes);
    const choices = [
        ...themeNames.map(name => ({
            name: name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            value: name
        })),
        new inquirer.Separator(),
        { name: 'Custom (Blank)', value: '__blank__' }
    ];

    const { theme } = await inquirer.prompt([{
        type: 'list',
        name: 'theme',
        message: 'Choose a theme:',
        choices,
        pageSize: 15
    }]);

    const cssContent = theme === '__blank__' ? '/* Write your custom CSS here */\n' : themes[theme];

    spinner.start('Stopping Discord...');
    await killDiscord();
    spinner.succeed('Discord stopped');

    spinner.start('Injecting CSS loader...');
    await injectDiscord(resourcePath, cssContent);
    spinner.succeed(chalk.green('Injection successful!'));

    // Deploy enabled plugins
    try {
        await pluginManager.triggerHook('afterInject', { resourcePath, css: cssContent });
    } catch (e) {
        logger.error('Failed to trigger plugin afterInject hook', { error: e.message });
    }

    await saveConfig({ ...config, lastInjection: new Date().toISOString(), activeTheme: theme });

    console.log(chalk.cyan('\n✓ Theme applied! Open Discord to see changes.'));

    const { openNow } = await inquirer.prompt([{
        type: 'confirm',
        name: 'openNow',
        message: 'Open Discord now?',
        default: true
    }]);

    if (openNow) {
        exec('start discord://');
        console.log(chalk.green('Discord is starting...'));
    }
}

/**
 * Menu action: Editor
 */
async function runEditor() {
    const { path: resourcePath, status } = await getContext();

    if (!status.injected) {
        console.log(chalk.yellow('Discord is not injected. Install a theme first.'));
        return;
    }

    console.log(chalk.cyan('\nTips:'));
    console.log(chalk.gray('  • Changes auto-save and apply to Discord'));
    console.log(chalk.gray('  • Use Ctrl+S to manually save'));
    console.log(chalk.gray('  • Press Ctrl+C to stop the server\n'));

    startServer(resourcePath);
}

/**
 * Menu action: Restore
 */
async function runRestore() {
    const { path: resourcePath, status } = await getContext();

    if (!status.injected && !status.backupExists) {
        console.log(chalk.yellow('Discord is not injected. Nothing to restore.'));
        return;
    }

    const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: 'This will remove all custom CSS. Continue?',
        default: false
    }]);

    if (!confirm) return;

    spinner.start('Stopping Discord...');
    await killDiscord();
    spinner.succeed('Discord stopped');

    spinner.start('Restoring...');
    const success = await restoreDiscord(resourcePath);

    if (success) {
        spinner.succeed(chalk.green('Discord restored successfully!'));
    } else {
        spinner.fail('No injection found to restore.');
    }
}

/**
 * Menu action: Rich Presence (visible to others)
 */
async function runFakeStatus() {
    console.log(chalk.cyan('\nDiscord Rich Presence\n'));
    console.log(chalk.green('This status will be VISIBLE to all Discord users!\n'));

    // Check if already connected
    if (isConnected()) {
        const { action } = await inquirer.prompt([{
            type: 'list',
            name: 'action',
            message: 'Rich Presence is active. What do you want to do?',
            choices: [
                { name: 'Change activity', value: 'change' },
                { name: 'Clear activity', value: 'clear' },
                { name: 'Disconnect', value: 'disconnect' },
                { name: 'Cancel', value: 'cancel' }
            ]
        }]);

        if (action === 'clear') {
            await clearActivity();
            console.log(chalk.green('Activity cleared!'));
            return;
        } else if (action === 'disconnect') {
            await disconnectRPC();
            console.log(chalk.green('Disconnected from Rich Presence!'));
            return;
        } else if (action === 'cancel') {
            return;
        }
    }

    // Get Application ID
    const config = await loadConfig();
    let clientId = config.rpcClientId;

    if (!clientId) {
        console.log(chalk.yellow('You need a Discord Application ID.'));
        console.log(chalk.gray('Create one at: https://discord.com/developers/applications\n'));

        const { id } = await inquirer.prompt([{
            type: 'input',
            name: 'id',
            message: 'Enter your Discord Application ID:',
            validate: (input) => {
                if (!input || input.length < 15) {
                    return 'Please enter a valid Application ID (found in Discord Developer Portal)';
                }
                return true;
            }
        }]);

        clientId = id;

        // Save for future use
        const { save } = await inquirer.prompt([{
            type: 'confirm',
            name: 'save',
            message: 'Save this ID for future use?',
            default: true
        }]);

        if (save) {
            await saveConfig({ ...config, rpcClientId: clientId });
        }
    }

    // Connect to RPC
    if (!isConnected()) {
        spinner.start('Connecting to Discord RPC...');
        const connected = await initRPC(clientId);

        if (!connected) {
            spinner.fail('Failed to connect to Discord RPC');
            console.log(chalk.yellow('\nMake sure Discord is running!'));
            return;
        }
        spinner.succeed('Connected to Discord RPC!');
    }

    // Choose activity preset
    const presetNames = Object.keys(rpcPresets);
    const presetChoices = presetNames.map(key => ({
        name: rpcPresets[key].name,
        value: key
    }));

    const { preset } = await inquirer.prompt([{
        type: 'list',
        name: 'preset',
        message: 'Choose activity category:',
        choices: presetChoices
    }]);

    let activity;

    if (preset === 'custom') {
        const { details, state } = await inquirer.prompt([
            {
                type: 'input',
                name: 'details',
                message: 'Activity title (line 1):',
                default: 'Playing something cool'
            },
            {
                type: 'input',
                name: 'state',
                message: 'Activity description (line 2):',
                default: ''
            }
        ]);
        activity = { details, state };
    } else {
        const activities = rpcPresets[preset].activities;
        const activityChoices = activities.map((a, i) => ({
            name: `${a.details} - ${a.state}`,
            value: i
        }));

        const { activityIndex } = await inquirer.prompt([{
            type: 'list',
            name: 'activityIndex',
            message: 'Choose activity:',
            choices: activityChoices
        }]);

        activity = activities[activityIndex];
    }

    // Set the activity
    spinner.start('Setting activity...');

    try {
        await setActivity(activity);
        spinner.succeed('Rich Presence active!');
        console.log(chalk.green(`\nYour status: ${activity.details}`));
        console.log(chalk.gray('This is now visible to everyone on Discord!'));
        console.log(chalk.gray('\nNote: Keep this program running to maintain the status.'));
    } catch (err) {
        spinner.fail('Failed: ' + err.message);
    }
}

/**
 * Menu action: Check Status (Discord installations)
 */
async function runStatus() {
    console.log(chalk.cyan('\nChecking Discord installations...\n'));

    const installations = await findAllDiscordInstances();

    if (installations.length === 0) {
        console.log(chalk.yellow('No Discord installations found.'));
        return;
    }

    for (const inst of installations) {
        const status = await getInjectionStatus(inst.path);
        const icon = status.injected ? '[+]' : '[ ]';

        console.log(`${icon} ${chalk.bold(inst.variant)}`);
        console.log(chalk.gray(`   Path: ${inst.path}`));
        console.log(chalk.gray(`   Version: ${inst.version}`));
        console.log(status.injected
            ? chalk.green(`   Status: Injected (${status.cssLines} lines)`)
            : chalk.yellow(`   Status: Not injected`));
        console.log('');
    }
}

/**
 * Menu action: Themes
 */
async function runThemes() {
    const themeNames = Object.keys(themes);

    console.log(chalk.cyan('\nAvailable Themes:\n'));

    themeNames.forEach((name, i) => {
        const displayName = name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        console.log(chalk.white(`  ${i + 1}. ${displayName}`));
    });

    console.log(chalk.gray(`\nTotal: ${themeNames.length} themes`));
}

/**
 * Menu action: Plugins
 */
async function runPlugins() {
    await pluginManager.initialize({});
    const discovered = await pluginManager.discover();
    const loaded = pluginManager.getAllPlugins();

    console.log(chalk.cyan('\nPlugins:\n'));

    if (discovered.length === 0) {
        console.log(chalk.gray('  No plugins found. Add plugins to plugins/'));
        return;
    }

    for (const name of discovered) {
        const plugin = loaded.find(p => p.name === name);
        const pluginStatus = plugin
            ? (plugin.enabled ? chalk.green('Enabled') : chalk.yellow('Disabled'))
            : chalk.gray('Not loaded');

        console.log(`  ${chalk.bold(name)} ${pluginStatus}`);
    }

    console.log(chalk.gray(`\nTotal: ${discovered.length} plugins`));
}

/**
 * Menu action: Config
 */
async function runConfig() {
    const config = await loadConfig();

    console.log(chalk.cyan('\nCurrent Configuration:\n'));
    console.log(JSON.stringify(config, null, 2));
}

/**
 * Menu action: Loader
 */
async function runLoader() {
    const { path: resourcePath } = await getContext();

    const choices = Object.keys(loaderThemes).map(key => ({
        name: loaderThemes[key].name,
        value: key
    }));

    const { theme } = await inquirer.prompt([{
        type: 'list',
        name: 'theme',
        message: 'Choose loading screen theme:',
        choices
    }]);

    spinner.start('Applying loader...');
    await applyLoader(resourcePath, theme);
    spinner.succeed('Loading screen applied! Restart Discord to see changes.');
}

/**
 * Menu action: Import BD Theme
 */
async function runImportBD() {
    const { path: resourcePath } = await getContext();

    const { bdPath } = await inquirer.prompt([{
        type: 'input',
        name: 'bdPath',
        message: 'Enter BetterDiscord theme file path:',
    }]);

    if (!bdPath) return;

    spinner.start('Importing BD theme...');

    try {
        const cssPath = path.join(resourcePath, 'app', 'custom.css');
        const metadata = await importBDTheme(bdPath, cssPath);

        spinner.succeed(`Imported: ${metadata.name} by ${metadata.author}`);
    } catch (err) {
        spinner.fail('Import failed: ' + err.message);
    }
}

/**
 * Menu action: Notification Sound
 */
async function runSounds() {
    const { path: resourcePath, status } = await getContext();

    if (!status.injected) {
        console.log(chalk.yellow('Discord is not injected. Install a theme first.'));
        return;
    }

    const settingsPath = path.join(resourcePath, 'app', 'settings.json');
    let currentSettings = {};
    if (fs.existsSync(settingsPath)) {
        currentSettings = await fs.readJson(settingsPath);
    }

    const choices = Object.keys(soundPresets).map(key => ({
        name: soundPresets[key].name,
        value: key
    }));

    const soundsDir = path.join(process.cwd(), 'sounds');
    await fs.ensureDir(soundsDir);
    const localFiles = (await fs.readdir(soundsDir)).filter(f => f.endsWith('.mp3') || f.endsWith('.wav'));

    localFiles.forEach(file => {
        choices.push({ name: `Local: ${file}`, value: `local:${file}` });
    });

    choices.push(new inquirer.Separator());
    choices.push({ name: 'Custom URL...', value: 'custom' });

    const { sound } = await inquirer.prompt([{
        type: 'list',
        name: 'sound',
        message: 'Choose notification sound:',
        choices,
        default: currentSettings.notificationSoundKey || 'default'
    }]);

    let soundUrl = '';
    let soundKey = sound;

    if (sound === 'custom') {
        const { name } = await inquirer.prompt([{
            type: 'input',
            name: 'name',
            message: 'Enter sound name (e.g. My Custom Sound):',
            default: 'Custom Sound'
        }]);

        const { url } = await inquirer.prompt([{
            type: 'input',
            name: 'url',
            message: 'Enter sound URL (direct mp3 link):',
            validate: (input) => input.startsWith('http') || 'Please enter a valid URL'
        }]);
        soundUrl = url;
    } else if (sound.startsWith('local:')) {
        const fileName = sound.split(':')[1];
        // We need to serve this file or use a data URI
        // For now, let's use a Data URI to make it simple and reliable
        const filePath = path.join(soundsDir, fileName);
        const buffer = await fs.readFile(filePath);
        const base64 = buffer.toString('base64');
        const ext = path.extname(fileName).substring(1);
        soundUrl = `data:audio/${ext};base64,${base64}`;
    } else {
        soundUrl = soundPresets[sound].url;
    }

    spinner.start('Updating notification sound...');

    currentSettings.notificationSound = soundUrl;
    currentSettings.notificationSoundKey = soundKey;

    await fs.writeJson(settingsPath, currentSettings, { spaces: 2 });

    spinner.succeed(chalk.green('Notification sound updated!'));
    console.log(chalk.gray('Restart Discord or wait for auto-reload to hear changes.'));
}


/**
 * Menu action: Backup Management
 */
async function runBackupManagement() {
    console.log(chalk.cyan('\nBackup Management:\n'));

    const { action } = await inquirer.prompt([{
        type: 'list',
        name: 'action',
        message: 'Choose action:',
        choices: [
            { name: 'List all backups', value: 'list' },
            { name: 'Restore a backup', value: 'restore' },
            { name: 'Clean old backups', value: 'clean' },
            { name: 'Cancel', value: 'cancel' }
        ]
    }]);

    if (action === 'list') {
        const backups = await listBackups();
        if (backups.length === 0) {
            console.log(chalk.gray('No backups found.'));
        } else {
            for (const b of backups) {
                console.log(chalk.white(`  [${b.filename}]`));
                console.log(chalk.gray(`    Size: ${(b.size / 1024).toFixed(1)} KB  |  Modified: ${b.date.toLocaleString()}`));
            }
            console.log(chalk.gray(`\nTotal: ${backups.length} backup(s)`));
        }
    } else if (action === 'restore') {
        const backups = await listBackups();
        if (backups.length === 0) {
            console.log(chalk.gray('No backups found.'));
            return;
        }

        const { backupChoice } = await inquirer.prompt([{
            type: 'list',
            name: 'backupChoice',
            message: 'Choose a backup to restore:',
            choices: backups.map(b => ({
                name: `${b.filename} (${(b.size / 1024).toFixed(1)} KB, ${b.date.toLocaleString()})`,
                value: b.filename
            }))
        }]);

        spinner.start('Restoring backup...');
        const result = await restoreBackup(backupChoice);
        if (result.success) {
            spinner.succeed(chalk.green('Backup restored!'));
            console.log(chalk.gray(`Restored to: ${result.path}`));
        } else {
            spinner.fail(chalk.red(`Failed: ${result.error}`));
        }
    } else if (action === 'clean') {
        const { keepNum } = await inquirer.prompt([{
            type: 'input',
            name: 'keepNum',
            message: 'How many backups to keep?',
            default: '10',
            validate: (input) => !isNaN(parseInt(input)) || 'Enter a valid number'
        }]);

        spinner.start('Cleaning old backups...');
        const result = await cleanOldBackups(parseInt(keepNum, 10));
        if (result.error) {
            spinner.fail(chalk.red(`Error: ${result.error}`));
        } else {
            spinner.succeed(chalk.green(`Cleaned! Deleted ${result.deleted}, kept ${result.kept}`));
        }
    }
}

// ==================== PROGRAM SETUP ====================

program
    .name('pancord')
    .description('Pancord - Client Customization Kit: CSS theming and plugins for your client')
    .version('2.0.0')
    .hook('preAction', () => showBanner());

// ==================== INSTALL COMMAND ====================

program.command('install')
    .description('Inject CSS loader into Discord')
    .option('-t, --theme <name>', 'Theme to apply')
    .option('--no-backup', 'Skip backup (not recommended)')
    .action(async (options) => {
        try {
            const { path: resourcePath, status } = await getContext();
            const config = await loadConfig();

            // Check if already injected
            if (status.injected) {
                const { overwrite } = await inquirer.prompt([{
                    type: 'confirm',
                    name: 'overwrite',
                    message: 'Discord is already injected. Overwrite?',
                    default: false
                }]);

                if (!overwrite) {
                    console.log(chalk.yellow('Installation cancelled.'));
                    return;
                }
            }

            // Theme selection
            let themeChoice = options.theme;

            if (!themeChoice) {
                const themeNames = Object.keys(themes);
                const choices = [
                    ...themeNames.map(name => ({
                        name: name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
                        value: name
                    })),
                    new inquirer.Separator(),
                    { name: 'Custom (Blank)', value: '__blank__' }
                ];

                const answer = await inquirer.prompt([{
                    type: 'list',
                    name: 'theme',
                    message: 'Choose a theme:',
                    choices,
                    pageSize: 15
                }]);

                themeChoice = answer.theme;
            }

            // Get CSS content
            let cssContent;
            if (themeChoice === '__blank__') {
                cssContent = '/* Write your custom CSS here */\n';
            } else {
                cssContent = themes[themeChoice];
                if (!cssContent) {
                    console.log(chalk.red(`Theme not found: ${themeChoice}`));
                    return;
                }
            }

            // Kill Discord
            spinner.start('Stopping Discord processes...');
            await killDiscord();
            spinner.succeed('Discord stopped');
            await logger.info('Discord processes killed');

            // Inject
            spinner.start('Injecting CSS loader...');
            await injectDiscord(resourcePath, cssContent);
            spinner.succeed(chalk.green('Injection successful!'));
            await logger.success(`Injection completed with theme: ${themeChoice}`);

            // Deploy enabled plugins
            try {
                await pluginManager.triggerHook('afterInject', { resourcePath, css: cssContent });
            } catch (e) {
                logger.error('Failed to trigger plugin afterInject hook', { error: e.message });
            }

            // Update config
            await saveConfig({
                ...config,
                lastInjection: new Date().toISOString(),
                activeTheme: themeChoice
            });

            // Next steps
            console.log(chalk.cyan('\nNext Steps:'));
            console.log(chalk.white('  1. Open Discord'));
            console.log(chalk.white('  2. Your theme should be applied automatically'));
            console.log(chalk.white('  3. Run `npm start editor` to edit CSS live'));
            console.log(chalk.white('  4. Press Ctrl+Shift+I in Discord for DevTools\n'));

            // Open Discord?
            const { openNow } = await inquirer.prompt([{
                type: 'confirm',
                name: 'openNow',
                message: 'Open Discord now?',
                default: true
            }]);

            if (openNow) {
                exec('start discord://');
                console.log(chalk.green('Discord is starting...'));
            }

        } catch (err) {
            spinner.fail('Installation failed');
            handleError(err);
            console.log(chalk.yellow('\nTroubleshooting:'));
            console.log(chalk.gray('  1. Make sure Discord is completely closed'));
            console.log(chalk.gray('  2. Try running as Administrator'));
            console.log(chalk.gray('  3. Check logs in logs/ folder'));
        }
    });

// ==================== EDITOR COMMAND ====================

program.command('editor')
    .description('Open live CSS editor')
    .option('-p, --port <port>', 'Server port', '8765')
    .action(async (options) => {
        try {
            const { path: resourcePath, status } = await getContext();

            if (!status.injected) {
                console.log(chalk.yellow('Discord is not injected. Run `npm start install` first.'));
                return;
            }

            console.log(chalk.cyan('\nTips:'));
            console.log(chalk.gray('  • Changes auto-save and apply to Discord'));
            console.log(chalk.gray('  • Use Ctrl+S to manually save'));
            console.log(chalk.gray('  • Press Ctrl+C to stop the server\n'));

            await logger.info('Starting live CSS editor');
            startServer(resourcePath, parseInt(options.port));

        } catch (err) {
            handleError(err);
        }
    });

// ==================== SOUND COMMAND ====================

program.command('sound')
    .description('Change notification sound')
    .argument('[key]', 'Sound preset key or "custom"')
    .option('-u, --url <url>', 'Custom sound URL')
    .action(async (key, options) => {
        try {
            const { path: resourcePath, status } = await getContext();
            if (!status.injected) {
                console.log(chalk.yellow('Discord is not injected. Run `npm start install` first.'));
                return;
            }

            const settingsPath = path.join(resourcePath, 'app', 'settings.json');
            let currentSettings = {};
            if (fs.existsSync(settingsPath)) {
                currentSettings = await fs.readJson(settingsPath);
            }

            let soundUrl = '';
            let soundKey = key;

            if (key === 'custom' || options.url) {
                if (!options.url) {
                    console.log(chalk.red('Error: URL is required for custom sound. Use --url <url>'));
                    return;
                }
                soundUrl = options.url;
                soundKey = 'custom';
            } else if (key && key.startsWith('local:')) {
                const fileName = key.split(':')[1];
                const filePath = path.join(process.cwd(), 'sounds', fileName);
                if (!fs.existsSync(filePath)) {
                    console.log(chalk.red(`Error: File not found in sounds/ folder: ${fileName}`));
                    return;
                }
                const buffer = await fs.readFile(filePath);
                const base64 = buffer.toString('base64');
                const ext = path.extname(fileName).substring(1);
                soundUrl = `data:audio/${ext};base64,${base64}`;
                soundKey = key;
            } else if (key && soundPresets[key]) {
                soundUrl = soundPresets[key].url;
            } else if (!key) {
                // Run interactive if no key provided
                await runSounds();
                return;
            } else {
                console.log(chalk.red(`Error: Invalid sound preset "${key}"`));
                console.log(chalk.gray('Available presets: ' + Object.keys(soundPresets).join(', ')));
                console.log(chalk.gray('For local files, use: local:filename.mp3'));
                return;
            }

            spinner.start('Updating sound...');
            currentSettings.notificationSound = soundUrl;
            currentSettings.notificationSoundKey = soundKey;
            await fs.writeJson(settingsPath, currentSettings, { spaces: 2 });
            spinner.succeed(chalk.green('Notification sound updated!'));

        } catch (err) {
            handleError(err);
        }
    });

// ==================== RESTORE COMMAND ====================

program.command('restore')
    .description('Remove injection and restore original Discord')
    .option('-f, --force', 'Skip confirmation')
    .action(async (options) => {
        try {
            const { path: resourcePath, status } = await getContext();

            if (!status.injected && !status.backupExists) {
                console.log(chalk.yellow('Discord is not injected. Nothing to restore.'));
                return;
            }

            if (!options.force) {
                const { confirm } = await inquirer.prompt([{
                    type: 'confirm',
                    name: 'confirm',
                    message: 'This will remove all custom CSS. Continue?',
                    default: false
                }]);

                if (!confirm) {
                    console.log(chalk.yellow('Restore cancelled.'));
                    return;
                }
            }

            // Kill Discord
            spinner.start('Stopping Discord...');
            await killDiscord();
            spinner.succeed('Discord stopped');

            // Restore
            spinner.start('Restoring original Discord...');
            const success = await restoreDiscord(resourcePath);

            if (success) {
                spinner.succeed(chalk.green('Discord restored successfully!'));
                await logger.success('Discord restored to original state');
                console.log(chalk.gray('\nDiscord is back to normal. You can open Discord now.'));
            } else {
                spinner.fail(chalk.red('No injection found to restore.'));
                await logger.warn('No injection found to restore');
            }

        } catch (err) {
            spinner.fail('Restore failed');
            handleError(err);
        }
    });

// ==================== STATUS COMMAND ====================

// ==================== BACKUP COMMANDS ====================

program
    .command('backup')
    .description('Backup management commands')
    .addCommand(
        program.command('list')
            .description('List all backups')
            .action(async () => {
                try {
                    console.log(chalk.cyan('\nBackups:\n'));
                    const backups = await listBackups();

                    if (backups.length === 0) {
                        console.log(chalk.gray('No backups found.'));
                        return;
                    }

                    for (const b of backups) {
                        const size = (b.size / 1024).toFixed(1) + ' KB';
                        const date = b.date.toLocaleString();
                        console.log(chalk.white(`  ${b.filename}`));
                        console.log(chalk.gray(`    Size: ${size}  |  Date: ${date}`));
                    }

                    console.log(chalk.gray(`\nTotal: ${backups.length} backup(s)`));
                } catch (err) {
                    handleError(err);
                }
            })
    )
    .addCommand(
        program.command('restore <filename>')
            .description('Restore a backup to its original location')
            .option('-d, --dest <path>', 'Custom destination path')
            .action(async (filename, options) => {
                try {
                    spinner.start(`Restoring backup: ${filename}...`);
                    const result = await restoreBackup(filename, options.dest);

                    if (result.success) {
                        spinner.succeed(chalk.green(`Backup restored successfully!`));
                        console.log(chalk.gray(`Restored to: ${result.path}`));
                    } else {
                        spinner.fail(chalk.red(`Failed: ${result.error}`));
                    }
                } catch (err) {
                    spinner.fail('Restore failed');
                    handleError(err);
                }
            })
    )
    .addCommand(
        program.command('clean')
            .description('Remove old backups (keeps newest by default)')
            .option('-k, --keep <number>', 'Number of backups to keep', '10')
            .action(async (options) => {
                try {
                    const keep = parseInt(options.keep, 10);
                    spinner.start('Cleaning old backups...');
                    const result = await cleanOldBackups(keep);

                    if (result.error) {
                        spinner.fail(chalk.red(`Error: ${result.error}`));
                    } else {
                        spinner.succeed(chalk.green(`Cleaned! Deleted ${result.deleted}, kept ${result.kept}`));
                    }
                } catch (err) {
                    spinner.fail('Clean failed');
                    handleError(err);
                }
            })
    );

program.command('status')
    .description('Check injection status of all Discord installations')
    .action(async () => {
        try {
            console.log(chalk.cyan('\nChecking Discord status...\n'));

            const installations = await findAllDiscordInstances();

            if (installations.length === 0) {
                console.log(chalk.yellow('No Discord installations found.'));
                return;
            }

            for (const inst of installations) {
                const status = await getInjectionStatus(inst.path);
                const statusIcon = status.injected ? '✅' : '⬜';

                console.log(`${statusIcon} ${chalk.bold(inst.variant)}`);
                console.log(chalk.gray(`   Path: ${inst.path}`));
                console.log(chalk.gray(`   Version: ${inst.version}`));
                if (status.injected) {
                    console.log(chalk.green(`   Status: Injected (${status.cssLines} lines)`));
                } else {
                    console.log(chalk.yellow(`   Status: Not injected`));
                }
                console.log('');
            }

            console.log(chalk.gray(`Total: ${installations.length} installation(s)`));

        } catch (err) {
            handleError(err);
        }
    });

// ==================== THEMES COMMAND ====================

program.command('themes')
    .description('List available themes')
    .action(async () => {
        const themeNames = Object.keys(themes);

        console.log(chalk.cyan('\nAvailable Themes:\n'));

        if (themeNames.length === 0) {
            console.log(chalk.gray('No themes found. Add themes to src/css/themes/'));
            return;
        }

        for (const name of themeNames) {
            const displayName = name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            console.log(chalk.bold(`  - ${displayName}`));
        }

        console.log(chalk.gray(`\nTotal: ${themeNames.length} themes`));
        console.log(chalk.gray('Use: npm start install -- -t <theme-name>'));
    });

// ==================== PLUGINS COMMAND ====================

program.command('plugins')
    .description('Manage plugins')
    .option('-l, --list', 'List all plugins')
    .option('--enable <name>', 'Enable a plugin')
    .option('--disable <name>', 'Disable a plugin')
    .action(async (options) => {
        try {
            // Initialize plugin manager
            await pluginManager.initialize({});

            if (options.enable) {
                const success = await pluginManager.load(options.enable);
                if (success) {
                    pluginManager.enable(options.enable);
                    console.log(chalk.green(`Plugin enabled: ${options.enable}`));
                } else {
                    console.log(chalk.red(`Failed to enable plugin: ${options.enable}`));
                }
                return;
            }

            if (options.disable) {
                pluginManager.disable(options.disable);
                console.log(chalk.green(`Plugin disabled: ${options.disable}`));
                return;
            }

            // List plugins (default)
            const discovered = await pluginManager.discover();
            const loaded = pluginManager.getAllPlugins();

            console.log(chalk.cyan('\nPlugins:\n'));

            if (discovered.length === 0) {
                console.log(chalk.gray('No plugins found. Add plugins to plugins/'));
                return;
            }

            for (const name of discovered) {
                const plugin = loaded.find(p => p.name === name);
                const pluginStatus = plugin
                    ? (plugin.enabled ? chalk.green('Enabled') : chalk.yellow('Disabled'))
                    : chalk.gray('Not loaded');

                console.log(`  ${chalk.bold(name)} ${pluginStatus}`);

                if (plugin) {
                    console.log(chalk.gray(`    ${plugin.displayName} v${plugin.version}`));
                }
            }

            console.log(chalk.gray(`\nTotal: ${discovered.length} plugins`));

        } catch (err) {
            handleError(err);
        }
    });

// ==================== CONFIG COMMAND ====================

program.command('config')
    .description('Manage configuration')
    .option('--show', 'Show current config')
    .option('--reset', 'Reset to defaults')
    .option('--set <key=value>', 'Set a config value')
    .action(async (options) => {
        try {
            if (options.reset) {
                await fs.remove(path.join(process.cwd(), 'config.json'));
                console.log(chalk.green('Configuration reset to defaults'));
                return;
            }

            const config = await loadConfig();

            if (options.set) {
                const [key, value] = options.set.split('=');
                if (!key || value === undefined) {
                    console.log(chalk.red('Invalid format. Use: --set key=value'));
                    return;
                }

                // Parse value
                let parsedValue = value;
                if (value === 'true') parsedValue = true;
                else if (value === 'false') parsedValue = false;
                else if (!isNaN(value)) parsedValue = Number(value);

                // Update nested config
                const keys = key.split('.');
                let current = config;
                for (let i = 0; i < keys.length - 1; i++) {
                    if (!current[keys[i]]) current[keys[i]] = {};
                    current = current[keys[i]];
                }
                current[keys[keys.length - 1]] = parsedValue;

                await saveConfig(config);
                console.log(chalk.green(`Set ${key} = ${parsedValue}`));
                return;
            }

            // Show config
            console.log(chalk.cyan('\nCurrent Configuration:\n'));
            console.log(JSON.stringify(config, null, 2));

        } catch (err) {
            handleError(err);
        }
    });

// ==================== IMPORT-BD COMMAND ====================

program.command('import-bd')
    .description('Import BetterDiscord theme')
    .action(async () => {
        const { path: resourcePath } = await getContext();

        const { bdPath } = await inquirer.prompt([{
            type: 'input',
            name: 'bdPath',
            message: 'Enter BetterDiscord theme file path:',
        }]);

        if (!bdPath) return;

        spinner.start('Importing BD theme...');

        try {
            const cssPath = path.join(resourcePath, 'app', 'custom.css');
            const metadata = await importBDTheme(bdPath, cssPath);

            spinner.succeed(`Imported: ${metadata.name} by ${metadata.author}`);
            console.log(chalk.gray(`Version: ${metadata.version}`));
            console.log(chalk.gray(`Description: ${metadata.description}`));

        } catch (err) {
            spinner.fail('Import failed: ' + err.message);
        }
    });

// ==================== LOADER COMMAND ====================

program.command('loader')
    .description('Customize loading screen')
    .action(async () => {
        const { path: resourcePath } = await getContext();

        const choices = Object.keys(loaderThemes).map(key => ({
            name: loaderThemes[key].name,
            value: key
        }));

        const { theme } = await inquirer.prompt([{
            type: 'list',
            name: 'theme',
            message: 'Choose loading screen theme:',
            choices
        }]);

        spinner.start('Applying loader...');

        try {
            await applyLoader(resourcePath, theme);
            spinner.succeed('Loading screen applied! Restart Discord to see changes.');
        } catch (err) {
            spinner.fail('Failed: ' + err.message);
        }
    });

// ==================== INFO COMMAND ====================

program.command('info')
    .description('Show detailed Discord information')
    .action(async () => {
        const { path: resourcePath } = await getContext();

        try {
            const info = await getDiscordInfo(resourcePath);

            console.log(chalk.cyan('\nDiscord Information:\n'));
            console.log(`  Path: ${chalk.white(info.path)}`);
            console.log(`  Version: ${chalk.white(info.version)}`);
            console.log(`  App Size: ${chalk.white((info.appAsarSize / 1024 / 1024).toFixed(2) + ' MB')}`);
            console.log(`  Running: ${info.isRunning ? chalk.green('Yes') : chalk.yellow('No')}`);

            console.log(chalk.cyan('\n  Injection Status:'));
            if (info.injectionStatus.injected) {
                console.log(chalk.green('    ✓ Injected'));
                console.log(`    CSS Size: ${info.injectionStatus.cssSize} bytes`);
                console.log(`    CSS Lines: ${info.injectionStatus.cssLines}`);
                console.log(`    Last Modified: ${info.injectionStatus.lastModified}`);
            } else {
                console.log(chalk.yellow('    [-] Not injected'));
            }
            console.log(`    Backup Exists: ${info.injectionStatus.backupExists ? chalk.green('Yes') : chalk.yellow('No')}`);

        } catch (err) {
            handleError(err);
        }
    });

// ==================== TEST COMMAND ====================

program.command('test')
    .description('Run diagnostic tests')
    .action(async () => {
        console.log(chalk.cyan('\n🧪 Running Diagnostics...\n'));

        const tests = [];

        // Test 1: Discord Detection
        spinner.start('Test 1: Discord detection...');
        try {
            const installations = await findAllDiscordInstances();
            if (installations.length > 0) {
                spinner.succeed(`Found ${installations.length} Discord installation(s)`);
                tests.push({ name: 'Discord Detection', passed: true });
            } else {
                spinner.fail('No Discord found');
                tests.push({ name: 'Discord Detection', passed: false });
            }
        } catch (err) {
            spinner.fail(err.message);
            tests.push({ name: 'Discord Detection', passed: false, error: err.message });
        }

        // Test 2: Config Loading
        spinner.start('Test 2: Configuration...');
        try {
            const config = await loadConfig();
            spinner.succeed(`Config loaded (v${config.version})`);
            tests.push({ name: 'Configuration', passed: true });
        } catch (err) {
            spinner.fail(err.message);
            tests.push({ name: 'Configuration', passed: false, error: err.message });
        }

        // Test 3: Theme Loading
        spinner.start('Test 3: Theme system...');
        try {
            const themeCount = Object.keys(themes).length;
            spinner.succeed(`Loaded ${themeCount} theme(s)`);
            tests.push({ name: 'Theme System', passed: true });
        } catch (err) {
            spinner.fail(err.message);
            tests.push({ name: 'Theme System', passed: false, error: err.message });
        }

        // Test 4: Plugin System
        spinner.start('Test 4: Plugin system...');
        try {
            await pluginManager.initialize({});
            const discovered = await pluginManager.discover();
            spinner.succeed(`Found ${discovered.length} plugin(s)`);
            tests.push({ name: 'Plugin System', passed: true });
        } catch (err) {
            spinner.fail(err.message);
            tests.push({ name: 'Plugin System', passed: false, error: err.message });
        }

        // Test 5: File Permissions
        spinner.start('Test 5: File permissions...');
        try {
            const testPath = path.join(process.cwd(), '.test-write');
            await fs.writeFile(testPath, 'test');
            await fs.remove(testPath);
            spinner.succeed('Write permissions OK');
            tests.push({ name: 'File Permissions', passed: true });
        } catch (err) {
            spinner.fail('No write permission');
            tests.push({ name: 'File Permissions', passed: false, error: err.message });
        }

        // Summary
        console.log(chalk.cyan('\nTest Results:\n'));

        const passed = tests.filter(t => t.passed).length;
        const failed = tests.filter(t => !t.passed).length;

        for (const test of tests) {
            const icon = test.passed ? chalk.green('[OK]') : chalk.red('[X]');
            console.log(`  ${icon} ${test.name}`);
            if (test.error) {
                console.log(chalk.gray(`    Error: ${test.error}`));
            }
        }

        console.log('');
        console.log(chalk.bold(`Results: ${passed} passed, ${failed} failed`));

        if (failed === 0) {
            console.log(chalk.green('\nAll tests passed! Ready to use.'));
        } else {
            console.log(chalk.yellow('\nSome tests failed. Check the errors above.'));
        }
    });

// ==================== HELP IMPROVEMENTS ====================

program.on('command:*', () => {
    console.log(chalk.red(`\nUnknown command: ${program.args.join(' ')}`));
    console.log(chalk.gray('Run `npm start --help` for available commands.\n'));
    process.exit(1);
});

// ==================== MAIN ====================

async function main() {
    try {
        // Cleanup old logs
        await cleanOldLogs();

        // Initialize plugin manager with API
        await pluginManager.initialize({
            findDiscordPath,
            getCurrentCSS: async () => {
                const discordPath = await findDiscordPath();
                if (discordPath) {
                    const cssPath = path.join(discordPath, 'app', 'custom.css');
                    if (await fs.pathExists(cssPath)) {
                        return await fs.readFile(cssPath, 'utf8');
                    }
                }
                return null;
            },
            applyTheme: async (themeName) => {
                const css = themes[themeName];
                if (!css) return false;

                const discordPath = await findDiscordPath();
                if (discordPath) {
                    const cssPath = path.join(discordPath, 'app', 'custom.css');
                    await fs.writeFile(cssPath, css);
                    return true;
                }
                return false;
            },

            // --- RPC helpers (used by dynamic-status plugin) ---
            getGlobalConfig: loadConfig,
            initRPC,
            setActivity,
            clearActivity,
            disconnectRPC,
            isConnectedRPC: isConnected,

            // --- CSS status helper ---
            applyStatus: async (presetName, customText) => {
                const discordPath = await findDiscordPath();
                if (discordPath) {
                    return await applyStatus(discordPath, presetName, customText);
                }
                return false;
            }
        });

        // Load configured plugins
        const config = await loadConfig();
        if (config.plugins?.enabled) {
            for (const pluginName of config.plugins.enabled) {
                await pluginManager.load(pluginName);
            }
        }

        // Check if any command was passed
        const args = process.argv.slice(2);

        if (args.length === 0) {
            // No arguments - show interactive menu
            await showMainMenu();
        } else {
            // Parse CLI arguments
            await program.parseAsync(process.argv);
        }

    } catch (err) {
        handleError(err);
        process.exit(1);
    }
}

// Run
main();