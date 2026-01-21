// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const fs = require('fs').promises;
const path = require('path');
const { encryptJSON, decryptJSON } = require('../utils/encryption');
const logger = require('../utils/logger');

class EncryptedStateManager {
  constructor() {
    this.stateFile = path.join(__dirname, '../data/scheduleState.encrypted.json');
    this.state = {};
  }

  async initialize() {
    try {
      const fileContents = await fs.readFile(this.stateFile, 'utf8');
      const parsed = JSON.parse(fileContents);
      this.state = decryptJSON(parsed.encrypted);
      logger.info('Loaded encrypted schedule state', { stateKeys: Object.keys(this.state).length });
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.info('No existing encrypted state file, starting fresh');
        this.state = {};
      } else {
        logger.error('Error loading encrypted state file', { error: error.message });
        this.state = {};
      }
    }
  }

  async save() {
    try {
      const dataDir = path.dirname(this.stateFile);
      await fs.mkdir(dataDir, { recursive: true });
      
      const encryptedData = encryptJSON(this.state);
      const fileContents = JSON.stringify({ encrypted: encryptedData }, null, 2);
      await fs.writeFile(this.stateFile, fileContents, 'utf8');
      logger.debug('Saved encrypted schedule state');
    } catch (error) {
      logger.error('Error saving encrypted state file', { error: error.message });
    }
  }

  get(key) {
    return this.state[key] || null;
  }

  set(key, value) {
    this.state[key] = value;
  }

  delete(key) {
    delete this.state[key];
  }

  keys() {
    return Object.keys(this.state);
  }

  async cleanupOldState(activeGuildIds) {
    const stateKeys = Object.keys(this.state);
    let removedCount = 0;
    
    for (const key of stateKeys) {
      const guildId = key.split('_')[0];
      if (!activeGuildIds.has(guildId)) {
        delete this.state[key];
        removedCount++;
      }
    }
    
    if (removedCount > 0) {
      logger.info('Cleaned up old encrypted state entries', { removed: removedCount });
      await this.save();
    }
  }

  async clearStateForGuild(guildId) {
    const stateKeys = Object.keys(this.state);
    let removedCount = 0;
    
    for (const key of stateKeys) {
      const keyGuildId = key.split('_')[0];
      if (keyGuildId === guildId) {
        delete this.state[key];
        removedCount++;
      }
    }
    
    if (removedCount > 0) {
      logger.info('Cleared state for guild', { guildId, removed: removedCount });
      await this.save();
    }
    
    return removedCount;
  }
}

module.exports = EncryptedStateManager;
