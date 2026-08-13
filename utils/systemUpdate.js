// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { hashCodeSchedules } = require('./hashCode');
const { ALL_RAID_TYPES, isValidRaidType } = require('./raidTypes');

const SYSTEM_UPDATE_CONFIG_PATH = path.join(__dirname, '..', 'config', 'systemUpdate.json');

function loadSystemUpdateConfig() {
  try {
    return JSON.parse(fs.readFileSync(SYSTEM_UPDATE_CONFIG_PATH, 'utf8'));
  } catch (error) {
    logger.warn('Unable to load schedule system update config', {
      error: error.message,
      configPath: SYSTEM_UPDATE_CONFIG_PATH
    });
    return null;
  }
}

function getSystemUpdateMessage(systemUpdate) {
  if (!systemUpdate) return '';
  return Array.isArray(systemUpdate.message)
    ? systemUpdate.message.join('\n')
    : String(systemUpdate.message || '').trim();
}

function getSystemUpdateRaidTypes(systemUpdate) {
  if (!systemUpdate) return null;

  const rawRaidTypes = systemUpdate.raidTypes
    ?? systemUpdate.raidType
    ?? systemUpdate.targetRaidTypes
    ?? systemUpdate.targetRaidType;

  if (rawRaidTypes === undefined || rawRaidTypes === null || rawRaidTypes === '') {
    return null;
  }

  const values = Array.isArray(rawRaidTypes)
    ? rawRaidTypes
    : String(rawRaidTypes).split(',');

  const normalized = [...new Set(
    values
      .map(value => String(value || '').trim().toUpperCase())
      .filter(Boolean)
  )];

  const invalidRaidTypes = normalized.filter(raidType => !isValidRaidType(raidType));
  if (invalidRaidTypes.length > 0) {
    logger.warn('System update config has invalid raid type targets', {
      invalidRaidTypes,
      validRaidTypes: ALL_RAID_TYPES
    });
  }

  return normalized.filter(isValidRaidType);
}

function appliesToRaidType(systemUpdate, raidType = null) {
  const raidTypes = getSystemUpdateRaidTypes(systemUpdate);
  if (raidTypes === null) return true;
  if (!raidType) return false;
  return raidTypes.includes(String(raidType).trim().toUpperCase());
}

function isSystemUpdateVisible(systemUpdate, now = Date.now()) {
  if (!systemUpdate?.expiresAt) return false;

  if (systemUpdate.startsAt) {
    const startsAt = new Date(systemUpdate.startsAt).getTime();
    if (!Number.isFinite(startsAt) || now < startsAt) return false;
  }

  const expiresAt = new Date(systemUpdate.expiresAt).getTime();
  return Number.isFinite(expiresAt) && now <= expiresAt;
}

function normalizeRaidTypeAndNow(raidTypeOrNow = null, now = Date.now()) {
  if (typeof raidTypeOrNow === 'number' || raidTypeOrNow instanceof Date) {
    return { raidType: null, now: raidTypeOrNow instanceof Date ? raidTypeOrNow.getTime() : raidTypeOrNow };
  }

  return {
    raidType: raidTypeOrNow ? String(raidTypeOrNow).trim().toUpperCase() : null,
    now
  };
}

function buildSystemUpdateBlock(raidTypeOrNow = null, now = Date.now()) {
  const normalizedArgs = normalizeRaidTypeAndNow(raidTypeOrNow, now);
  const systemUpdate = loadSystemUpdateConfig();
  const message = getSystemUpdateMessage(systemUpdate);
  if (
    !message ||
    !isSystemUpdateVisible(systemUpdate, normalizedArgs.now) ||
    !appliesToRaidType(systemUpdate, normalizedArgs.raidType)
  ) {
    return null;
  }

  return `\`\`\`ansi
\u001b[40;32m${message.replace(/\`\`\`/g, "'''")}\u001b[0m
\`\`\``;
}

function buildGlobalSystemUpdateHashInput(systemUpdate, now = Date.now()) {
  if (!systemUpdate || !getSystemUpdateMessage(systemUpdate) || !isSystemUpdateVisible(systemUpdate, now)) {
    return '';
  }

  return JSON.stringify({
    message: getSystemUpdateMessage(systemUpdate),
    raidTypes: getSystemUpdateRaidTypes(systemUpdate)
  });
}

function getSystemUpdateHash(raidTypeOrNow = null, now = Date.now()) {
  if (typeof raidTypeOrNow === 'string') {
    return hashCodeSchedules(buildSystemUpdateBlock(raidTypeOrNow, now) || '');
  }

  if (raidTypeOrNow === null || raidTypeOrNow === undefined || typeof raidTypeOrNow === 'number' || raidTypeOrNow instanceof Date) {
    const normalizedArgs = normalizeRaidTypeAndNow(raidTypeOrNow, now);
    const systemUpdate = loadSystemUpdateConfig();
    return hashCodeSchedules(buildGlobalSystemUpdateHashInput(systemUpdate, normalizedArgs.now));
  }

  return hashCodeSchedules(buildSystemUpdateBlock(raidTypeOrNow, now) || '');
}

function getSystemUpdateHashes(now = Date.now()) {
  return Object.fromEntries(
    ALL_RAID_TYPES.map(raidType => [raidType, getSystemUpdateHash(raidType, now)])
  );
}

module.exports = {
  appliesToRaidType,
  buildSystemUpdateBlock,
  getSystemUpdateHashes,
  getSystemUpdateHash,
  getSystemUpdateRaidTypes,
  isSystemUpdateVisible,
  loadSystemUpdateConfig
};
