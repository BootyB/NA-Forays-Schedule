// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const ScheduleManager = require('./scheduleManager');
const ScheduleContainerBuilder = require('./containerBuilder');
const { AttachmentBuilder } = require('discord.js');
const EncryptedStateManager = require('./encryptedStateManager');
const logger = require('../utils/logger');
const encryptedDb = require('../config/encryptedDatabase');
const { CONCURRENCY_LIMIT, DEV_SERVER_GUILD_ID, IS_DEV_BOT } = require('../config/constants');
const { 
  ALL_RAID_TYPES, 
  getEnabledHostsKey, 
  getScheduleColorKey, 
  getScheduleChannelKey, 
  getScheduleMessageKey, 
  getScheduleOverviewKey 
} = require('../utils/raidTypes');
const path = require('path');
const fs = require('fs');

class UpdateManager {
  constructor(pool, client) {
    this.pool = pool;
    this.client = client;
    this.scheduleManager = new ScheduleManager(pool);
    this.containerBuilder = new ScheduleContainerBuilder(client);
    this.stateManager = new EncryptedStateManager();
    this.state = {};
    this.updateLocks = new Map();
  }

  acquireLock(guildId, raidType) {
    const lockKey = `${guildId}_${raidType}`;
    if (this.updateLocks.has(lockKey)) {
      return false;
    }
    this.updateLocks.set(lockKey, Date.now());
    return true;
  }

  releaseLock(guildId, raidType) {
    const lockKey = `${guildId}_${raidType}`;
    this.updateLocks.delete(lockKey);
  }

  async initialize() {
    await this.stateManager.initialize();
    this.state = this.stateManager.state;
    
    await this.cleanupOldState();
  }

  async cleanupOldState() {
    try {
      let activeGuilds = await encryptedDb.getActiveServerConfigs(
        'WHERE setup_complete = 1'
      );
      
      activeGuilds = activeGuilds.filter(g => {
        if (IS_DEV_BOT) {
          return g.guild_id === DEV_SERVER_GUILD_ID;
        } else {
          return g.guild_id !== DEV_SERVER_GUILD_ID;
        }
      });
      
      const activeGuildIds = new Set(activeGuilds.map(g => g.guild_id));
      await this.stateManager.cleanupOldState(activeGuildIds);
      this.state = this.stateManager.state;
    } catch (error) {
      logger.error('Error cleaning up state', { error: error.message });
    }
  }

  async saveState() {
    await this.stateManager.save();
  }

  getBannerAttachment(raidType) {
    try {
      const filename = `${raidType.toLowerCase()}_opening.avif`;
      const filepath = path.join(__dirname, '../assets', filename);
      if (!fs.existsSync(filepath)) {
        logger.debug('Banner file not found', { raidType, filepath });
        return null;
      }
      
      return new AttachmentBuilder(filepath, { name: filename });
    } catch (error) {
      logger.warn('Error creating banner attachment', { raidType, error: error.message });
      return null;
    }
  }

  async updateSchedule(guildId, raidType, config) {
    const startTime = Date.now();
    
    if (!this.acquireLock(guildId, raidType)) {
      logger.debug('Update already in progress, skipping', { guildId, raidType });
      return;
    }
    
    try {
      logger.debug('Starting updateSchedule', { guildId, raidType });
      const stateKey = `${guildId}_${raidType}`;
      
      const hostsKey = getEnabledHostsKey(raidType);
      const enabledHosts = config[hostsKey];
      
      logger.debug('Enabled hosts check', { guildId, raidType, hostsKey, enabledHosts });
      
      if (!enabledHosts) {
        logger.debug('No enabled hosts for raid type', { guildId, raidType });
        return;
      }
      if (!enabledHosts || enabledHosts.length === 0) {
        logger.debug('Empty enabled hosts array', { guildId, raidType });
        return;
      }

      const groupedRuns = await this.scheduleManager.fetchScheduleGroupedByServer(
        raidType,
        enabledHosts
      );

      const newHash = this.containerBuilder.generateContentHash(groupedRuns, raidType);

      const oldState = this.state[stateKey] || {};
      logger.debug('Hash comparison', { 
        guildId, 
        raidType, 
        stateKey,
        oldHash: oldState.hash || 'none',
        newHash,
        hashMatch: oldState.hash === newHash,
        runsCount: Object.values(groupedRuns).flat().length
      });
      
      if (oldState.hash === newHash) {
        logger.debug('Schedule unchanged, skipping update', { guildId, raidType });
        return;
      }

      const colorKey = getScheduleColorKey(raidType);
      const colorValue = config[colorKey];
      const customColor = colorValue === -1 ? undefined : (colorValue !== undefined ? colorValue : undefined);

      const containers = await this.containerBuilder.buildScheduleContainers(groupedRuns, raidType, customColor);
      
      const channelKey = getScheduleChannelKey(raidType);
      const channelId = config[channelKey];
      
      if (!channelId) {
        return;
      }

      const channel = await this.client.channels.fetch(channelId).catch(() => null);
      if (!channel) {
        logger.warn('Channel not found', { guildId, raidType, channelId });
        return;
      }

      const messageKey = getScheduleMessageKey(raidType);
      const overviewMessageKey = getScheduleOverviewKey(raidType);
      const existingMessageIds = config[messageKey] || [];
      const existingOverviewId = config[overviewMessageKey];

      logger.debug('Existing message state', { 
        guildId, 
        raidType, 
        existingMessageIds,
        existingMessageIdsLength: existingMessageIds.length,
        existingOverviewId,
        messageKey,
        overviewMessageKey
      });

      const oldEnabledHosts = oldState.enabledHosts || [];
      const currentEnabledHosts = enabledHosts.slice().sort();
      const hostsListChanged = JSON.stringify(oldEnabledHosts) !== JSON.stringify(currentEnabledHosts);      
      const oldServerList = Object.keys(oldState.serverHashes || {}).sort();
      const newServerList = containers.map(c => c.serverName).sort();
      const containerServersChanged = JSON.stringify(oldServerList) !== JSON.stringify(newServerList);
      

      let serversAdded = false;
      let serversRemoved = false;
      
      if (containerServersChanged) {
        const oldSet = new Set(oldServerList);
        const newSet = new Set(newServerList);
        
        serversAdded = newServerList.some(s => !oldSet.has(s));
        serversRemoved = oldServerList.some(s => !newSet.has(s));
      }
      
      const needsFullRecreation = hostsListChanged || serversAdded;
      
      if (hostsListChanged) {
        logger.info('Enabled hosts list changed', { 
          guildId, 
          raidType,
          oldHosts: oldEnabledHosts,
          newHosts: currentEnabledHosts,
          action: serversAdded && serversRemoved ? 'added and removed' : serversAdded ? 'added' : 'removed'
        });
      }
      
      if (containerServersChanged && !hostsListChanged) {
        logger.info('Container servers changed', { 
          guildId, 
          raidType,
          oldServers: oldServerList,
          newServers: newServerList,
          serversAdded,
          serversRemoved,
          needsFullRecreation
        });
      }

      const needsOverviewCreation = !existingOverviewId || (existingMessageIds.length > 0 && !existingOverviewId);
      let overviewMessageId = existingOverviewId;
      
      if (needsOverviewCreation || needsFullRecreation) {
        logger.info('Creating overview message (missing or recreating)', { guildId, raidType, reason: needsFullRecreation ? 'servers changed' : 'missing overview' });
        
        if (needsFullRecreation && existingOverviewId) {
          logger.info('Deleting old overview message due to server list change', { guildId, raidType, overviewId: existingOverviewId });
          try {
            const overviewMessage = await channel.messages.fetch(existingOverviewId).catch(() => null);
            if (overviewMessage) {
              await overviewMessage.delete();
            }
          } catch (error) {
            logger.error('Error deleting old overview message', { error: error.message, messageId: existingOverviewId });
          }
          overviewMessageId = null;
        }
        
        if (needsFullRecreation && existingMessageIds.length > 0) {
          logger.info('Deleting all existing messages due to server list change', { guildId, raidType, count: existingMessageIds.length });
          for (const messageId of existingMessageIds) {
            try {
              const message = await channel.messages.fetch(messageId).catch(() => null);
              if (message) {
                await message.delete();
              }
            } catch (error) {
              logger.error('Error deleting message during recreation', { error: error.message, messageId });
            }
          }
          existingMessageIds.length = 0;
        }
        
        if (existingMessageIds.length > 0 && !needsFullRecreation) {
          for (const messageId of existingMessageIds) {
            try {
              const message = await channel.messages.fetch(messageId).catch(() => null);
              if (message) {
                await message.delete();
              }
            } catch (error) {
              logger.error('Error deleting message during recreation', { error: error.message, messageId });
            }
          }
          existingMessageIds.length = 0;
        }
        
        const overviewContainer = this.containerBuilder.buildOverviewContainer(raidType, customColor);
        const bannerAttachment = this.getBannerAttachment(raidType);
        
        try {
          const botMember = await channel.guild.members.fetchMe();
          const permissions = channel.permissionsFor(botMember);
          
          if (!permissions.has('ViewChannel') || !permissions.has('SendMessages')) {
            logger.error('Bot missing basic permissions in channel', {
              guildId,
              raidType,
              channelId: channel.id,
              hasViewChannel: permissions.has('ViewChannel'),
              hasSendMessages: permissions.has('SendMessages')
            });
            throw new Error('Bot missing ViewChannel or SendMessages permission');
          }
          
          if (bannerAttachment && !permissions.has('AttachFiles')) {
            logger.error('Bot missing AttachFiles permission needed for banner', {
              guildId,
              raidType,
              channelId: channel.id
            });
            throw new Error('Bot missing AttachFiles permission (required for banner image)');
          }
          
          const messageOptions = { 
            components: [overviewContainer.toJSON()], 
            flags: 1 << 15
          };
          if (bannerAttachment) {
            messageOptions.files = [bannerAttachment];
          }
          const newMessage = await channel.send(messageOptions);
          overviewMessageId = newMessage.id;
          logger.info('Created overview message', { guildId, raidType, messageId: overviewMessageId });
        } catch (error) {
          logger.error('Error creating overview message', {
            error: error.message,
            code: error.code,
            httpStatus: error.httpStatus,
            stack: error.stack,
            guildId,
            raidType
          });
          return;
        }
      } else {
        logger.debug('Overview already exists, skipping update', { guildId, raidType, messageId: existingOverviewId });
      }

      const newMessageIds = [];
      const oldServerHashes = oldState.serverHashes || {};
      const newServerHashes = {};
      let updatedCount = 0;
      let skippedCount = 0;

      for (let i = 0; i < containers.length; i++) {
        const { container, serverName, hash } = containers[i];
        newServerHashes[serverName] = hash;
        
        try {
          if (needsFullRecreation || !existingMessageIds[i]) {
            const newMessage = await channel.send({ components: [container.toJSON()], flags: 1 << 15 });
            newMessageIds.push(newMessage.id);
            updatedCount++;
            logger.debug('Created new schedule message', { guildId, raidType, serverName, messageIndex: i, reason: needsFullRecreation ? 'servers changed' : 'new container' });
          } else if (existingMessageIds[i]) {
            const message = await channel.messages.fetch(existingMessageIds[i]).catch(() => null);
            if (message) {
              if (message.author.id !== channel.client.user.id) {
                logger.warn('Schedule message not owned by bot, recreating', { 
                  guildId, 
                  raidType,
                  messageIndex: i,
                  serverName,
                  messageAuthor: message.author.id,
                  botId: channel.client.user.id
                });
                const newMessage = await channel.send({ components: [container.toJSON()], flags: 1 << 15 });
                newMessageIds.push(newMessage.id);
                updatedCount++;
              } else {
                // Check if this specific server's content changed
                const oldHash = oldServerHashes[serverName];
                if (oldHash === hash) {
                  // Content unchanged, skip editing
                  newMessageIds.push(message.id);
                  skippedCount++;
                  logger.debug('Server unchanged, skipping edit', { guildId, raidType, serverName, messageIndex: i });
                } else {
                  await message.edit({ components: [container.toJSON()], flags: 1 << 15 });
                  newMessageIds.push(message.id);
                  updatedCount++;
                  logger.debug('Updated schedule message', { guildId, raidType, serverName, messageIndex: i });
                }
              }
            } else {
              logger.warn('Schedule message not found, creating new', { 
                guildId, 
                raidType, 
                messageIndex: i,
                serverName,
                oldMessageId: existingMessageIds[i]
              });
              const newMessage = await channel.send({ components: [container.toJSON()], flags: 1 << 15 });
              newMessageIds.push(newMessage.id);
              updatedCount++;
            }
          }
        } catch (error) {
          logger.error('Error updating container message', {
            error: error.message,
            guildId,
            raidType,
            serverName,
            messageIndex: i
          });
        }
      }

      for (let i = containers.length; i < existingMessageIds.length; i++) {
        try {
          logger.info('Deleting extra schedule message', { 
            guildId, 
            raidType, 
            messageIndex: i,
            messageId: existingMessageIds[i],
            containersLength: containers.length,
            existingMessageIdsLength: existingMessageIds.length
          });
          const message = await channel.messages.fetch(existingMessageIds[i]).catch(() => null);
          if (message) {
            await message.delete();
            logger.info('Deleted extra schedule message', { guildId, raidType, messageIndex: i });
          }
        } catch (error) {
          logger.error('Error deleting extra message', { error: error.message });
        }
      }

      if (newMessageIds.length > 0 || overviewMessageId) {
        const updates = {};
        
        if (newMessageIds.length > 0) {
          updates[messageKey] = newMessageIds;
        }
        
        if (overviewMessageId) {
          updates[overviewMessageKey] = overviewMessageId;
        }
        
        logger.debug('Saving message IDs to database', {
          guildId,
          raidType,
          updates,
          newMessageIds,
          overviewMessageId
        });
        
        await encryptedDb.updateServerConfig(guildId, updates);
      }

      this.state[stateKey] = {
        hash: newHash,
        serverHashes: newServerHashes,
        enabledHosts: enabledHosts.slice().sort(),
        lastUpdate: Date.now(),
        messageCount: newMessageIds.length
      };
      logger.debug('Saving state hash', { guildId, raidType, stateKey, hash: newHash, serverCount: Object.keys(newServerHashes).length });
      await this.saveState();

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.info('Schedule updated successfully', {
        guildId,
        raidType,
        containers: containers.length,
        updated: updatedCount,
        skipped: skippedCount,
        runsCount: Object.values(groupedRuns).flat().length,
        duration: `${duration}s`
      });

      if (updatedCount > 0 || overviewMessageId) {
        try {
          const { lockdownChannel } = require('../utils/channelPermissions');
          const guild = await this.client.guilds.fetch(guildId);
          const botMember = await guild.members.fetchMe();
          const lockResult = await lockdownChannel(channel, botMember);
          
          if (lockResult.success) {
            logger.info('Channel permissions set successfully after update', {
              guildId,
              raidType,
              channelId: channel.id
            });
          }
        } catch (lockError) {
          logger.debug('Could not set channel permissions', {
            error: lockError.message,
            guildId,
            raidType,
            note: 'This is expected - users can set manually'
          });
        }
      }

    } catch (error) {
      logger.error('Error in updateSchedule', {
        error: error.message,
        stack: error.stack,
        guildId,
        raidType
      });
    } finally {
      // Always release the lock
      this.releaseLock(guildId, raidType);
    }
  }

  async updateAllSchedules() {
    try {
      const startTime = Date.now();
      let configs = await encryptedDb.getActiveServerConfigs(
        'WHERE setup_complete = 1 AND auto_update = 1'
      );

      configs = configs.filter(config => {
        if (IS_DEV_BOT) {
          return config.guild_id === DEV_SERVER_GUILD_ID;
        } else {
          return config.guild_id !== DEV_SERVER_GUILD_ID;
        }
      });

      logger.debug('Starting update cycle', { 
        configCount: configs.length,
        isDevBot: IS_DEV_BOT 
      });

      const results = [];
      
      for (let i = 0; i < configs.length; i += CONCURRENCY_LIMIT) {
        const batch = configs.slice(i, i + CONCURRENCY_LIMIT);
        
        const batchPromises = batch.map(async (config) => {
          try {
            await Promise.all(
              ALL_RAID_TYPES.map(raidType => 
                this.updateSchedule(config.guild_id, raidType, config)
              )
            );
            return { guild_id: config.guild_id, success: true };
          } catch (error) {
            logger.error('Error updating guild schedules', {
              guildId: config.guild_id,
              error: error.message
            });
            return { guild_id: config.guild_id, success: false, error: error.message };
          }
        });
        
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
        
        if (i + CONCURRENCY_LIMIT < configs.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      const successful = results.filter(r => r.success).length;
      logger.debug('Update cycle complete', { 
        duration: `${duration}s`,
        totalGuilds: configs.length,
        successful,
        failed: configs.length - successful
      });

    } catch (error) {
      logger.error('Error in updateAllSchedules', {
        error: error.message,
        stack: error.stack
      });
    }
  }

  async forceUpdate(guildId) {
    try {
      const isDevServer = guildId === DEV_SERVER_GUILD_ID;
      if (IS_DEV_BOT && !isDevServer) {
        logger.debug('Dev bot skipping non-dev server', { guildId });
        return { success: false, error: 'Dev bot cannot update non-dev servers' };
      }
      if (!IS_DEV_BOT && isDevServer) {
        logger.debug('Prod bot skipping dev server', { guildId });
        return { success: false, error: 'Prod bot cannot update dev server' };
      }

      const config = await encryptedDb.getServerConfig(guildId);

      if (!config) {
        logger.warn('No config found for force update', { guildId });
        return { success: false, error: 'Server not configured' };
      }

      for (const raidType of ALL_RAID_TYPES) {
        await this.updateSchedule(config.guild_id, raidType, config);
      }

      return { success: true };

    } catch (error) {
      logger.error('Error in forceUpdate', {
        error: error.message,
        guildId
      });
      return { success: false, error: error.message };
    }
  }

  async regenerateSchedule(guildId, raidType) {
    try {
      const isDevServer = guildId === DEV_SERVER_GUILD_ID;
      if (IS_DEV_BOT && !isDevServer) {
        return { success: false, error: 'Dev bot cannot update non-dev servers' };
      }
      if (!IS_DEV_BOT && isDevServer) {
        return { success: false, error: 'Prod bot cannot update dev server' };
      }

      const config = await encryptedDb.getServerConfig(guildId);

      if (!config) {
        logger.warn('No config found for regeneration', { guildId });
        return { success: false, error: 'Server not configured' };
      }

      const channelKey = getScheduleChannelKey(raidType);
      const channelId = config[channelKey];
      
      if (!channelId) {
        return { success: false, error: 'No channel configured' };
      }

      const channel = await this.client.channels.fetch(channelId).catch(() => null);
      if (!channel) {
        return { success: false, error: 'Channel not found' };
      }

      const overviewMessageKey = getScheduleOverviewKey(raidType);
      const existingOverviewId = config[overviewMessageKey];
      
      if (existingOverviewId) {
        try {
          const message = await channel.messages.fetch(existingOverviewId).catch(() => null);
          if (message) {
            await message.delete();
            logger.debug('Deleted overview message', { guildId, raidType });
          }
        } catch (error) {
          logger.error('Error deleting overview message', { error: error.message });
        }
      }

      const messageKey = getScheduleMessageKey(raidType);
      const existingMessageIds = config[messageKey] || [];
      
      for (const messageId of existingMessageIds) {
        try {
          const message = await channel.messages.fetch(messageId).catch(() => null);
          if (message) {
            await message.delete();
            logger.debug('Deleted schedule message', { guildId, raidType, messageId });
          }
        } catch (error) {
          logger.error('Error deleting schedule message', { error: error.message, messageId });
        }
        
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      await encryptedDb.updateServerConfig(guildId, {
        [messageKey]: null,
        [overviewMessageKey]: null
      });

      const stateKey = `${guildId}_${raidType}`;
      delete this.state[stateKey];
      await this.saveState();

      await this.updateSchedule(guildId, raidType, {
        ...config,
        [messageKey]: null,
        [overviewMessageKey]: null
      });

      return { success: true };

    } catch (error) {
      logger.error('Error in regenerateSchedule', {
        error: error.message,
        stack: error.stack,
        guildId,
        raidType
      });
      return { success: false, error: error.message };
    }
  }
}

module.exports = UpdateManager;
