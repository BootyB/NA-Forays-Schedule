// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const logger = require('../utils/logger');
const { getAllHostServers } = require('../config/hostServers');
const encryptedDb = require('../config/encryptedDatabase');
const { WHITELIST_ENABLED } = require('../config/constants');

class WhitelistManager {
  constructor(pool) {
    this.pool = pool;
  }

  async isGuildWhitelisted(guildId) {
    try {
      // If whitelist is disabled, allow all guilds
      if (!WHITELIST_ENABLED) {
        logger.debug('Whitelist disabled, allowing guild', { guildId });
        return true;
      }

      logger.info('Checking guild whitelist', { guildId });
      
      const guild = await encryptedDb.getWhitelistedGuild(guildId);
      const isWhitelisted = guild !== null;
      
      logger.info('Whitelist check result', { 
        guildId, 
        isWhitelisted
      });
      
      return isWhitelisted;
    } catch (error) {
      logger.error('Error checking guild whitelist', {
        error: error.message,
        stack: error.stack,
        guildId
      });
      return false;
    }
  }

  async addGuild(guildId, guildName, addedBy) {
    try {
      await encryptedDb.addWhitelistedGuild(guildId, guildName, addedBy);
      
      logger.info('Guild added to whitelist', { guildId, guildName, addedBy });
      return true;
    } catch (error) {
      logger.error('Error adding guild to whitelist', {
        error: error.message,
        guildId
      });
      return false;
    }
  }

  async removeGuild(guildId) {
    try {
      await encryptedDb.removeWhitelistedGuild(guildId);
      
      logger.info('Guild removed from whitelist', { guildId });
      return true;
    } catch (error) {
      logger.error('Error removing guild from whitelist', {
        error: error.message,
        guildId
      });
      return false;
    }
  }

  async getAllWhitelistedGuilds() {
    try {
      return await encryptedDb.getAllWhitelistedGuilds();
    } catch (error) {
      logger.error('Error fetching whitelisted guilds', {
        error: error.message
      });
      return [];
    }
  }

  async isHostWhitelisted(serverName) {
    try {
      const result = await this.pool.query(
        'SELECT 1 FROM na_bot_whitelisted_hosts WHERE server_name = ? AND is_active = 1',
        [serverName]
      );
      return result.length > 0;
    } catch (error) {
      logger.error('Error checking host whitelist', {
        error: error.message,
        serverName
      });
      return getAllHostServers().includes(serverName);
    }
  }

  async getAllWhitelistedHosts() {
    try {
      const hosts = await this.pool.query(
        'SELECT server_name FROM na_bot_whitelisted_hosts WHERE is_active = 1'
      );
      return hosts.map(h => h.server_name);
    } catch (error) {
      logger.error('Error fetching whitelisted hosts', {
        error: error.message
      });
      return getAllHostServers();
    }
  }

  async initializeWhitelists() {
    try {
      const hostServers = getAllHostServers();
      
      for (const serverName of hostServers) {
        await this.pool.query(
          `INSERT INTO na_bot_whitelisted_hosts 
           (server_name, added_by, added_at, is_active)
           VALUES (?, 'system', NOW(), 1)
           ON DUPLICATE KEY UPDATE is_active = 1`,
          [serverName]
        );
      }
      
      logger.info('Initialized host whitelist', { count: hostServers.length });
      
    } catch (error) {
      logger.error('Error initializing whitelists', {
        error: error.message
      });
    }
  }
}

module.exports = WhitelistManager;
