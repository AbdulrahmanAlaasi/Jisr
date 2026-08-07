'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function migrateLegacyPreferences({ legacyDirectory, targetDirectory, downloadsPath }) {
  if (!legacyDirectory || !targetDirectory || path.resolve(legacyDirectory) === path.resolve(targetDirectory)) {
    return { migrated: false };
  }

  const markerPath = path.join(targetDirectory, 'orbit-to-jisr-migration.json');
  const existingMarker = await readJson(markerPath, null);
  if (existingMarker) return { migrated: false, alreadyCompleted: true };

  const legacySettings = await readJson(path.join(legacyDirectory, 'settings.json'), null);
  const legacyHistory = await readJson(path.join(legacyDirectory, 'history.json'), null);
  if (!legacySettings && !Array.isArray(legacyHistory)) return { migrated: false };

  await fs.mkdir(targetDirectory, { recursive: true });
  const targetSettingsPath = path.join(targetDirectory, 'settings.json');
  const targetHistoryPath = path.join(targetDirectory, 'history.json');
  const canMigrateSettings = legacySettings
    && typeof legacySettings === 'object'
    && !Array.isArray(legacySettings)
    && !(await fileExists(targetSettingsPath));
  const canMigrateHistory = Array.isArray(legacyHistory)
    && !(await fileExists(targetHistoryPath));

  if (canMigrateSettings) {
    const settings = { ...legacySettings };
    const oldDefaultDownload = path.join(downloadsPath, 'OrbitSend');
    if (path.resolve(String(settings.downloadPath || '')) === path.resolve(oldDefaultDownload)) {
      settings.downloadPath = path.join(downloadsPath, 'Jisr');
    }
    await writeJson(targetSettingsPath, settings);
  }
  if (canMigrateHistory) {
    await writeJson(targetHistoryPath, legacyHistory.slice(0, 200));
  }

  const marker = {
    migratedAt: new Date().toISOString(),
    source: 'OrbitSend',
    settingsMigrated: Boolean(canMigrateSettings),
    historyMigrated: Boolean(canMigrateHistory),
    identityMigrated: false,
    peersMigrated: false,
  };
  await writeJson(markerPath, marker);
  return { migrated: Boolean(canMigrateSettings || canMigrateHistory), ...marker };
}

module.exports = { migrateLegacyPreferences };
