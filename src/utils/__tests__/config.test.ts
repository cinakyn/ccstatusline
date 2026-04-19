import * as fs from 'fs';
import path from 'path';
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
    type MockInstance
} from 'vitest';

import {
    CURRENT_VERSION,
    DEFAULT_SETTINGS,
    type Settings
} from '../../types/Settings';

const MOCK_HOME_DIR = '/tmp/ccstatusline-config-test-home';
const ORIGINAL_CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR;

let loadSettings: () => Promise<Settings>;
let saveSettings: (settings: Settings) => Promise<void>;
let initConfigPath: (filePath?: string) => void;
let consoleErrorSpy: MockInstance<typeof console.error>;

function getSettingsPaths(): {
    configDir: string;
    settingsPath: string;
    backupPath: string;
    v3BackupPath: string;
} {
    const configDir = path.join(MOCK_HOME_DIR, '.config', 'ccstatusline');
    return {
        configDir,
        settingsPath: path.join(configDir, 'settings.json'),
        backupPath: path.join(configDir, 'settings.bak'),
        v3BackupPath: path.join(configDir, 'settings.json.v3.bak')
    };
}

function getClaudeConfigDir(): string {
    return path.join(MOCK_HOME_DIR, '.claude');
}

describe('config utilities', () => {
    beforeAll(async () => {
        const configModule = await import('../config');
        loadSettings = configModule.loadSettings;
        saveSettings = configModule.saveSettings;
        initConfigPath = configModule.initConfigPath;
    });

    beforeEach(() => {
        fs.rmSync(MOCK_HOME_DIR, { recursive: true, force: true });
        process.env.CLAUDE_CONFIG_DIR = getClaudeConfigDir();
        const { settingsPath } = getSettingsPaths();
        initConfigPath(settingsPath);
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    afterAll(() => {
        fs.rmSync(MOCK_HOME_DIR, { recursive: true, force: true });
        if (ORIGINAL_CLAUDE_CONFIG_DIR === undefined) {
            delete process.env.CLAUDE_CONFIG_DIR;
        } else {
            process.env.CLAUDE_CONFIG_DIR = ORIGINAL_CLAUDE_CONFIG_DIR;
        }
        initConfigPath();
    });

    it('writes defaults when settings file does not exist', async () => {
        const { settingsPath } = getSettingsPaths();

        const settings = await loadSettings();

        expect(settings.version).toBe(CURRENT_VERSION);
        expect(fs.existsSync(settingsPath)).toBe(true);

        const onDisk = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as {
            version?: number;
            lines?: unknown[];
        };
        expect(onDisk.version).toBe(CURRENT_VERSION);
        expect(Array.isArray(onDisk.lines)).toBe(true);
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining('Default settings written to')
        );
    });

    it('backs up invalid JSON and recovers with defaults', async () => {
        const { settingsPath, backupPath, configDir } = getSettingsPaths();
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(settingsPath, '{ invalid json', 'utf-8');

        const settings = await loadSettings();

        expect(settings.version).toBe(CURRENT_VERSION);
        expect(fs.existsSync(backupPath)).toBe(true);
        expect(fs.readFileSync(backupPath, 'utf-8')).toBe('{ invalid json');

        const recovered = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as { version?: number };
        expect(recovered.version).toBe(CURRENT_VERSION);
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            'Failed to parse settings.json, backing up and using defaults'
        );
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining('Bad settings backed up to')
        );
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining('Default settings written to')
        );
    });

    it('backs up invalid v1 payloads and recovers with defaults', async () => {
        const { settingsPath, backupPath, configDir } = getSettingsPaths();
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(settingsPath, JSON.stringify({ flexMode: 123 }), 'utf-8');

        const settings = await loadSettings();

        expect(settings.version).toBe(CURRENT_VERSION);
        expect(fs.existsSync(backupPath)).toBe(true);
        const recovered = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as { version?: number };
        expect(recovered.version).toBe(CURRENT_VERSION);
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            'Invalid v1 settings format:',
            expect.anything()
        );
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining('Bad settings backed up to')
        );
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining('Default settings written to')
        );
    });

    it('migrates older versioned settings and persists migrated result', async () => {
        const { settingsPath, configDir } = getSettingsPaths();
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
            settingsPath,
            JSON.stringify({
                version: 2,
                lines: [[{ id: 'widget-1', type: 'model' }]]
            }),
            'utf-8'
        );

        const settings = await loadSettings();

        expect(settings.version).toBe(CURRENT_VERSION);
        const migrated = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as {
            version?: number;
            updatemessage?: { message?: string };
        };
        expect(migrated.version).toBe(CURRENT_VERSION);
        expect(migrated.updatemessage?.message).toContain('v2.0.2');
        // A pre-v4 config triggers a one-time backup whose path is logged via
        // console.error for user visibility; the migration itself succeeded.
        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining('Pre-v4 settings backed up to')
        );
    });

    it('always saves current version in saveSettings', async () => {
        const { settingsPath } = getSettingsPaths();

        await saveSettings({
            ...DEFAULT_SETTINGS,
            version: 1
        });

        const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as { version?: number };
        expect(saved.version).toBe(CURRENT_VERSION);
        expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('rewrites legacy hide flags to when rules at load time without touching disk', async () => {
        const { settingsPath, configDir } = getSettingsPaths();
        fs.mkdirSync(configDir, { recursive: true });
        const rawConfig = {
            version: CURRENT_VERSION,
            lines: [{
                groups: [{
                    continuousColor: true,
                    widgets: [{
                        id: 'w-1',
                        type: 'git-branch',
                        metadata: { hideNoGit: 'true', linkToGitHub: 'true' }
                    }]
                }]
            }]
        };
        fs.writeFileSync(settingsPath, JSON.stringify(rawConfig), 'utf-8');

        const settings = await loadSettings();
        const widget = settings.lines[0]?.groups[0]?.widgets[0];

        expect(widget?.when).toEqual([{ on: 'git.no-git', do: 'hide' }]);
        expect(widget?.metadata).toEqual({ linkToGitHub: 'true' });

        interface OnDiskWidget { metadata?: Record<string, string>; when?: unknown }
        interface OnDiskLine { groups: { widgets: OnDiskWidget[] }[] }
        const ondisk = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as { lines: OnDiskLine[] };
        const ondiskWidget = ondisk.lines[0]?.groups[0]?.widgets[0];
        expect(ondiskWidget?.metadata).toEqual({ hideNoGit: 'true', linkToGitHub: 'true' });
        expect(ondiskWidget?.when).toBeUndefined();
    });

    it('creates settings.json.v3.bak with original bytes when migrating from v3', async () => {
        const { settingsPath, configDir, v3BackupPath } = getSettingsPaths();
        fs.mkdirSync(configDir, { recursive: true });
        const v3Bytes = JSON.stringify({
            version: 3,
            lines: [[{ id: '1', type: 'model', color: 'cyan' }]]
        });
        fs.writeFileSync(settingsPath, v3Bytes, 'utf-8');

        const settings = await loadSettings();

        expect(settings.version).toBe(CURRENT_VERSION);
        expect(fs.existsSync(v3BackupPath)).toBe(true);
        expect(fs.readFileSync(v3BackupPath, 'utf-8')).toBe(v3Bytes);

        // settings.json itself should now be the migrated v4 content
        const migrated = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as { version?: number };
        expect(migrated.version).toBe(CURRENT_VERSION);
    });

    it('does not overwrite an existing settings.json.v3.bak on a second v3 load', async () => {
        const { settingsPath, configDir, v3BackupPath } = getSettingsPaths();
        fs.mkdirSync(configDir, { recursive: true });

        const v3Bytes = JSON.stringify({
            version: 3,
            lines: [[{ id: '1', type: 'model', color: 'cyan' }]]
        });
        fs.writeFileSync(settingsPath, v3Bytes, 'utf-8');

        // Pre-create a v3.bak with custom marker content so we can detect
        // whether loadSettings overwrites it.
        const markerBytes = JSON.stringify({
            version: 3,
            marker: 'pre-existing-backup-do-not-overwrite',
            lines: [[{ id: 'x', type: 'model' }]]
        });
        fs.writeFileSync(v3BackupPath, markerBytes, 'utf-8');

        const settings = await loadSettings();

        expect(settings.version).toBe(CURRENT_VERSION);
        // The backup was already present — the short-circuit in backupV3Settings
        // must have left the marker content intact.
        expect(fs.readFileSync(v3BackupPath, 'utf-8')).toBe(markerBytes);

        // settings.json should still have been migrated.
        const migrated = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as { version?: number };
        expect(migrated.version).toBe(CURRENT_VERSION);
    });

    it('does not create settings.json.v3.bak when migrating from v2', async () => {
        const { settingsPath, configDir, v3BackupPath } = getSettingsPaths();
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
            settingsPath,
            JSON.stringify({
                version: 2,
                lines: [[{ id: '1', type: 'model' }]]
            }),
            'utf-8'
        );

        const settings = await loadSettings();

        expect(settings.version).toBe(CURRENT_VERSION);
        expect(fs.existsSync(v3BackupPath)).toBe(false);

        const migrated = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as { version?: number };
        expect(migrated.version).toBe(CURRENT_VERSION);
    });

    it('does not create settings.json.v3.bak when migrating from v1 (no version field)', async () => {
        const { settingsPath, configDir, v3BackupPath } = getSettingsPaths();
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
            settingsPath,
            JSON.stringify({ lines: [[{ type: 'model', color: 'cyan' }]] }),
            'utf-8'
        );

        const settings = await loadSettings();

        expect(settings.version).toBe(CURRENT_VERSION);
        expect(fs.existsSync(v3BackupPath)).toBe(false);

        const migrated = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as { version?: number };
        expect(migrated.version).toBe(CURRENT_VERSION);
    });

    it('does not create settings.json.v3.bak when loading an already-v4 file', async () => {
        const { settingsPath, configDir, v3BackupPath } = getSettingsPaths();
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
            settingsPath,
            JSON.stringify({
                version: CURRENT_VERSION,
                lines: [
                    {
                        groups: [{
                            continuousColor: true,
                            widgets: [{ id: '1', type: 'model', color: 'cyan' }]
                        }]
                    }
                ]
            }),
            'utf-8'
        );

        const settings = await loadSettings();

        expect(settings.version).toBe(CURRENT_VERSION);
        expect(fs.existsSync(v3BackupPath)).toBe(false);
    });
});