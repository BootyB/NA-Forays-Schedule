// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { hashCodeSchedules } = require('./hashCode');

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

function isSystemUpdateVisible(systemUpdate, now = Date.now()) {
  if (!systemUpdate?.expiresAt) return false;

  if (systemUpdate.startsAt) {
    const startsAt = new Date(systemUpdate.startsAt).getTime();
    if (!Number.isFinite(startsAt) || now < startsAt) return false;
  }

  const expiresAt = new Date(systemUpdate.expiresAt).getTime();
  return Number.isFinite(expiresAt) && now <= expiresAt;
}

function buildSystemUpdateBlock(now = Date.now()) {
  const systemUpdate = loadSystemUpdateConfig();
  const message = getSystemUpdateMessage(systemUpdate);
  if (!message || !isSystemUpdateVisible(systemUpdate, now)) return null;

  return `\`\`\`ansi
\u001b[40;32m${message.replace(/\`\`\`/g, "'''")}\u001b[0m
\`\`\``;
}

function getSystemUpdateHash(now = Date.now()) {
  return hashCodeSchedules(buildSystemUpdateBlock(now) || '');
}

module.exports = {
  buildSystemUpdateBlock,
  getSystemUpdateHash,
  isSystemUpdateVisible,
  loadSystemUpdateConfig
};
