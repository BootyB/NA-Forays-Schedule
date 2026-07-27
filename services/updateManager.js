// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const ScheduleManager = require('./scheduleManager');
const ScheduleContainerBuilder = require('./containerBuilder');
const CalendarService = require('./calendarService');
const { AttachmentBuilder, PermissionFlagsBits } = require('discord.js');
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
const { DEFAULT_FT_VARIANTS, FT_CHANNEL_MODES, normalizeEnabledFtVariants, normalizeFtChannelMode, normalizeFtVariantMap, normalizeFtVariantValue } = require('../utils/ftVariants');
const path = require('path');
const { getSystemUpdateHash } = require('../utils/systemUpdate');
const { hashCodeSchedules } = require('../utils/hashCode');
const fs = require('fs');

const FT_VARIANT_COLOR_INHERIT = -2;

class UpdateManager {
  constructor(pool, client) {
    this.pool = pool;
    this.client = client;
    this.scheduleManager = new ScheduleManager(pool);
    this.containerBuilder = new ScheduleContainerBuilder(client);
    this.calendarService = new CalendarService(pool);
    this.stateManager = new EncryptedStateManager();
    this.state = {};
    this.updateLocks = new Map();
    this.pendingUpdates = new Map();
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

  getBannerCandidates(raidType, options = {}) {
    if (raidType !== 'FT') {
      return [`${raidType.toLowerCase()}_opening.avif`];
    }

    const variants = normalizeEnabledFtVariants(options.enabledFtVariants);
    const hasBlood = variants.includes('Blood');
    const hasMagic = variants.includes('Magic');

    if (hasBlood && hasMagic) {
      return ['ft_opening.avif', 'ft_opening.png', 'ftb_opening.avif', 'ftb_opening.png'];
    }

    if (hasMagic) {
      return ['ftm_opening.png', 'ftm_opening.avif'];
    }

    return ['ftb_opening.avif', 'ftb_opening.png'];
  }

  resolveBannerAttachment(raidType, options = {}) {
    try {
      const candidates = this.getBannerCandidates(raidType, options);
      for (const filename of candidates) {
        const filepath = path.join(__dirname, '../assets', filename);
        if (fs.existsSync(filepath)) {
          return {
            attachment: new AttachmentBuilder(filepath, { name: filename }),
            url: `attachment://${filename}`,
            filename
          };
        }
      }

      logger.debug('Banner file not found', { raidType, candidates });
      return { attachment: null, url: null, filename: null };
    } catch (error) {
      logger.warn('Error creating banner attachment', { raidType, error: error.message });
      return { attachment: null, url: null, filename: null };
    }
  }

  getBannerAttachment(raidType, options = {}) {
    return this.resolveBannerAttachment(raidType, options).attachment;
  }
  async updateSchedule(guildId, raidType, config) {
    const startTime = Date.now();
    
    if (!this.acquireLock(guildId, raidType)) {
      const lockKey = `${guildId}_${raidType}`;
      this.pendingUpdates.set(lockKey, { guildId, raidType, config });
      logger.debug('Update already in progress, queued follow-up update', { guildId, raidType });
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

      if (raidType === 'FT' && normalizeFtChannelMode(config.ft_channel_mode) === FT_CHANNEL_MODES.Separate) {
        await this.updateFtSeparateSchedules(guildId, config);
        return;
      }

      if (raidType === 'FT') {
        await this.cleanupAllFtVariantMessages(guildId, config);
      }

      const enabledFtVariants = raidType === 'FT' ? normalizeEnabledFtVariants(config.enabled_ft_variants) : null;
      const scheduleOptions = raidType === 'FT' ? { enabledFtVariants } : {};

      const groupedRuns = await this.scheduleManager.fetchScheduleGroupedByServer(
        raidType,
        enabledHosts,
        undefined,
        scheduleOptions
      );

      const overviewHash = getSystemUpdateHash();
      const scheduleHash = this.containerBuilder.generateContentHash(groupedRuns, raidType, scheduleOptions);
      const newHash = hashCodeSchedules(`${scheduleHash}|overview:${overviewHash}`);

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

      const containers = await this.containerBuilder.buildScheduleContainers(groupedRuns, raidType, customColor, scheduleOptions);

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

      const overviewChanged = oldState.overviewHash !== overviewHash;
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
        
        const banner = this.resolveBannerAttachment(raidType, scheduleOptions);
        const overviewContainer = this.containerBuilder.buildOverviewContainer(raidType, customColor, { bannerImage: banner.url });
        const bannerAttachment = banner.attachment;
        
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
      } else if (overviewChanged) {
        const banner = this.resolveBannerAttachment(raidType, scheduleOptions);
        const overviewContainer = this.containerBuilder.buildOverviewContainer(raidType, customColor, { bannerImage: banner.url });
        const overviewMessage = await channel.messages.fetch(existingOverviewId).catch(() => null);

        if (overviewMessage) {
          const editOptions = {
            components: [overviewContainer.toJSON()],
            flags: 1 << 15
          };
          if (banner.attachment) {
            editOptions.files = [banner.attachment];
          }
          await overviewMessage.edit(editOptions);
          logger.info('Updated overview message for system update change', { guildId, raidType, messageId: existingOverviewId });
        } else {
          logger.warn('Overview message not found during system update refresh', { guildId, raidType, messageId: existingOverviewId });
          overviewMessageId = null;
        }
      } else {
        logger.debug('Overview already exists, skipping update', { guildId, raidType, messageId: existingOverviewId });
      }

      const newMessageIds = [];
      const oldServerHashes = oldState.serverHashes || {};
      const oldServerOrder = oldState.serverOrder || [];
      const newServerHashes = {};
      const newServerOrder = [];
      let updatedCount = 0;
      let skippedCount = 0;

      for (let i = 0; i < containers.length; i++) {
        const { container, serverName, hash } = containers[i];
        newServerHashes[serverName] = hash;
        newServerOrder.push(serverName);
        
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
                const oldHash = oldServerHashes[serverName];
                const oldServerAtIndex = oldServerOrder[i];
                const serverPositionChanged = oldServerAtIndex !== serverName;
                
                if (oldHash === hash && !serverPositionChanged) {
                  newMessageIds.push(message.id);
                  skippedCount++;
                  logger.debug('Server unchanged, skipping edit', { guildId, raidType, serverName, messageIndex: i });
                } else {
                  await message.edit({ components: [container.toJSON()], flags: 1 << 15 });
                  newMessageIds.push(message.id);
                  updatedCount++;
                  logger.debug('Updated schedule message', { guildId, raidType, serverName, messageIndex: i, positionChanged: serverPositionChanged });
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
        serverOrder: newServerOrder,
        enabledHosts: enabledHosts.slice().sort(),
        enabledFtVariants: enabledFtVariants ? enabledFtVariants.slice().sort() : null,
        overviewHash,
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

      const lockKey = `${guildId}_${raidType}`;
      const pendingUpdate = this.pendingUpdates.get(lockKey);
      if (pendingUpdate) {
        this.pendingUpdates.delete(lockKey);
        logger.debug('Running queued follow-up update', { guildId, raidType });
        await this.updateSchedule(pendingUpdate.guildId, pendingUpdate.raidType, pendingUpdate.config);
      }
    }
  }

  async updateFtSeparateSchedules(guildId, config) {
    const hostsKey = getEnabledHostsKey('FT');
    const enabledHosts = config[hostsKey];
    if (!enabledHosts || enabledHosts.length === 0) {
      logger.debug('No enabled hosts for separate FT schedule', { guildId });
      return;
    }

    const channelIds = normalizeFtVariantMap(config.ft_variant_channel_ids);
    if (!channelIds.Blood || !channelIds.Magic) {
      logger.warn('Separate FT mode requires Blood and Magic channels', { guildId, channelIds });
      return;
    }

    const enabledFtVariants = normalizeEnabledFtVariants(config.enabled_ft_variants);
    const allRuns = await this.scheduleManager.fetchScheduleGroupedByServer(
      'FT',
      enabledHosts,
      undefined,
      { enabledFtVariants: DEFAULT_FT_VARIANTS }
    );

    const overviewMap = normalizeFtVariantMap(config.ft_variant_overview_ids);
    const messageMap = normalizeFtVariantMap(config.ft_variant_message_ids);
    const nextOverviewMap = { ...overviewMap };
    const nextMessageMap = { ...messageMap };

    await this.cleanupSharedFtMessages(guildId, config);

    logger.info('Updating separate FT schedules', {
      guildId,
      enabledFtVariants,
      bloodChannelId: channelIds.Blood,
      magicChannelId: channelIds.Magic
    });

    for (const variant of DEFAULT_FT_VARIANTS) {
      const channelId = channelIds[variant];
      logger.info('Starting separate FT variant update', { guildId, variant, channelId, enabled: enabledFtVariants.includes(variant) });

      try {
        const channel = await this.client.channels.fetch(channelId).catch((error) => {
          logger.warn('FT variant channel fetch failed', { guildId, variant, channelId, error: error.message });
          return null;
        });
        if (!channel) {
          logger.warn('FT variant channel not found', { guildId, variant, channelId });
          continue;
        }

        if (!enabledFtVariants.includes(variant)) {
          logger.info('Skipping disabled FT variant schedule', { guildId, variant, enabledFtVariants });
          await this.cleanupFtVariantMessages(channel, nextOverviewMap[variant], nextMessageMap[variant], guildId, variant);
          nextOverviewMap[variant] = null;
          nextMessageMap[variant] = [];
          delete this.state[guildId + '_FT_' + variant];
          continue;
        }

        const groupedRuns = this.filterGroupedRunsByFtVariant(allRuns, variant);
        const variantRunsCount = Object.values(groupedRuns).reduce((total, runs) => total + runs.length, 0);
        if (variantRunsCount === 0) {
          logger.info('FT variant schedule has no future runs', { guildId, variant, channelId });
        }

        const result = await this.updateFtVariantTarget({
          guildId,
          variant,
          channel,
          groupedRuns,
          enabledHosts,
          customColor: this.getCustomFtVariantColor(config, variant),
          existingOverviewId: nextOverviewMap[variant],
          existingMessageIds: Array.isArray(nextMessageMap[variant]) ? nextMessageMap[variant] : []
        });
        nextOverviewMap[variant] = result.overviewMessageId;
        nextMessageMap[variant] = result.messageIds;
        logger.info('Finished separate FT variant update', { guildId, variant, channelId, overviewMessageId: result.overviewMessageId, messageCount: result.messageIds.length });
      } catch (error) {
        logger.error('Error updating separate FT variant schedule', {
          guildId,
          variant,
          channelId,
          error: error.message,
          stack: error.stack
        });
      }
    }

    await encryptedDb.updateServerConfig(guildId, {
      ft_variant_overview_ids: nextOverviewMap,
      ft_variant_message_ids: nextMessageMap,
      schedule_overview_ft: null,
      schedule_message_ft: null
    });
    await this.saveState();
  }

  filterGroupedRunsByFtVariant(groupedRuns, variant) {
    const filtered = {};
    for (const [serverName, runs] of Object.entries(groupedRuns || {})) {
      const variantRuns = runs.filter(run => normalizeFtVariantValue(run.FTRaidVariant) === variant);
      if (variantRuns.length > 0) {
        filtered[serverName] = variantRuns;
      }
    }
    return filtered;
  }

  async validateScheduleTargetPermissions(channel, guildId, raidType, options = {}) {
    const botMember = await channel.guild.members.fetchMe();
    const permissions = channel.permissionsFor(botMember);
    const checks = [
      { name: 'View Channel', bit: PermissionFlagsBits.ViewChannel },
      { name: 'Send Messages', bit: PermissionFlagsBits.SendMessages },
      { name: 'Embed Links', bit: PermissionFlagsBits.EmbedLinks },
      { name: 'Read Message History', bit: PermissionFlagsBits.ReadMessageHistory }
    ];

    if (options.requiresAttachment) {
      checks.push({ name: 'Attach Files', bit: PermissionFlagsBits.AttachFiles });
    }

    const missingPermissions = checks
      .filter((check) => !permissions || !permissions.has(check.bit))
      .map((check) => check.name);

    if (missingPermissions.length > 0) {
      logger.warn('Skipping schedule target with missing permissions', {
        guildId,
        raidType,
        variant: options.variant,
        channelId: channel.id,
        missingPermissions
      });
      return false;
    }

    return true;
  }

  async hasExistingScheduleMessages(channel, overviewId, messageIds) {
    if (!overviewId) return false;

    const overviewMessage = await channel.messages.fetch(overviewId).catch(() => null);
    if (!overviewMessage || overviewMessage.author.id !== channel.client.user.id) {
      return false;
    }

    if (!Array.isArray(messageIds)) return false;
    for (const messageId of messageIds) {
      const message = await channel.messages.fetch(messageId).catch(() => null);
      if (!message || message.author.id !== channel.client.user.id) {
        return false;
      }
    }

    return true;
  }

  async updateFtVariantTarget({ guildId, variant, channel, groupedRuns, enabledHosts, customColor, existingOverviewId, existingMessageIds }) {
    const stateKey = guildId + '_FT_' + variant;
    const scheduleOptions = { enabledFtVariants: [variant] };
    const overviewHash = getSystemUpdateHash();
    const scheduleHash = this.containerBuilder.generateContentHash(groupedRuns, 'FT', scheduleOptions);
    const colorHash = customColor === undefined ? 'default' : String(customColor);
    const newHash = hashCodeSchedules(String(scheduleHash) + '|overview:' + overviewHash + '|channel:' + channel.id + '|variant:' + variant + '|color:' + colorHash);
    const oldState = this.state[stateKey] || {};

    if (oldState.hash === newHash && existingOverviewId && existingMessageIds) {
      const messagesExist = await this.hasExistingScheduleMessages(channel, existingOverviewId, existingMessageIds);
      if (messagesExist) {
        logger.debug('Separate FT variant unchanged, skipping update', { guildId, variant });
        return { overviewMessageId: existingOverviewId, messageIds: existingMessageIds };
      }

      logger.info('Separate FT variant state was unchanged but messages were missing; recreating', {
        guildId,
        variant,
        existingOverviewId,
        existingMessageCount: Array.isArray(existingMessageIds) ? existingMessageIds.length : 0
      });
    }

    const banner = this.resolveBannerAttachment('FT', scheduleOptions);
    const hasTargetPermissions = await this.validateScheduleTargetPermissions(channel, guildId, 'FT', {
      variant,
      requiresAttachment: Boolean(banner.attachment)
    });
    if (!hasTargetPermissions) {
      return { overviewMessageId: existingOverviewId, messageIds: Array.isArray(existingMessageIds) ? existingMessageIds : [] };
    }

    await this.cleanupFtVariantMessages(channel, existingOverviewId, existingMessageIds, guildId, variant);

    const overviewContainer = this.containerBuilder.buildOverviewContainer('FT', customColor, { bannerImage: banner.url, ftVariant: variant });
    const bannerAttachment = banner.attachment;
    const overviewOptions = { components: [overviewContainer.toJSON()], flags: 1 << 15 };
    if (bannerAttachment) {
      overviewOptions.files = [bannerAttachment];
    }
    const overviewMessage = await channel.send(overviewOptions);
    const containers = await this.containerBuilder.buildScheduleContainers(groupedRuns, 'FT', customColor, scheduleOptions);
    const messageIds = [];
    const serverHashes = {};
    const serverOrder = [];

    for (const { container, serverName, hash } of containers) {
      const message = await channel.send({ components: [container.toJSON()], flags: 1 << 15 });
      messageIds.push(message.id);
      serverHashes[serverName] = hash;
      serverOrder.push(serverName);
    }

    this.state[stateKey] = {
      hash: newHash,
      serverHashes,
      serverOrder,
      enabledHosts: enabledHosts.slice().sort(),
      enabledFtVariants: [variant],
      overviewHash,
      lastUpdate: Date.now(),
      messageCount: messageIds.length
    };
    await this.saveState();

    logger.info('Updated separate FT variant schedule', { guildId, variant, channelId: channel.id, messageCount: messageIds.length });
    return { overviewMessageId: overviewMessage.id, messageIds };
  }

  async cleanupAllFtVariantMessages(guildId, config) {
    const channelIds = normalizeFtVariantMap(config.ft_variant_channel_ids);
    const overviewMap = normalizeFtVariantMap(config.ft_variant_overview_ids);
    const messageMap = normalizeFtVariantMap(config.ft_variant_message_ids);
    let cleaned = false;

    for (const variant of DEFAULT_FT_VARIANTS) {
      const hasMessages = overviewMap[variant] || (Array.isArray(messageMap[variant]) && messageMap[variant].length > 0);
      if (!channelIds[variant] || !hasMessages) continue;

      const channel = await this.client.channels.fetch(channelIds[variant]).catch(() => null);
      if (!channel) continue;

      await this.cleanupFtVariantMessages(channel, overviewMap[variant], messageMap[variant], guildId, variant);
      overviewMap[variant] = null;
      messageMap[variant] = [];
      delete this.state[guildId + '_FT_' + variant];
      cleaned = true;
    }

    if (cleaned) {
      await encryptedDb.updateServerConfig(guildId, {
        ft_variant_overview_ids: overviewMap,
        ft_variant_message_ids: messageMap
      });
      await this.saveState();
    }
  }

  async cleanupSharedFtMessages(guildId, config) {
    const channelId = config.schedule_channel_ft;
    const hasSharedMessages = config.schedule_overview_ft || (Array.isArray(config.schedule_message_ft) && config.schedule_message_ft.length > 0);
    if (!channelId || !hasSharedMessages) return;

    const channel = await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;

    await this.cleanupFtVariantMessages(channel, config.schedule_overview_ft, config.schedule_message_ft || [], guildId, 'Shared');
    await encryptedDb.updateServerConfig(guildId, { schedule_overview_ft: null, schedule_message_ft: null });
  }

  async cleanupFtVariantMessages(channel, overviewId, messageIds, guildId, variant) {
    const ids = [];
    if (overviewId) ids.push(overviewId);
    if (Array.isArray(messageIds)) ids.push(...messageIds);

    for (const messageId of ids) {
      try {
        const message = await channel.messages.fetch(messageId).catch(() => null);
        if (message) {
          await message.delete();
        }
      } catch (error) {
        logger.error('Error deleting FT variant schedule message', { guildId, variant, messageId, error: error.message });
      }
    }
  }

  getCustomColor(config, raidType) {
    const colorKey = getScheduleColorKey(raidType);
    const colorValue = config[colorKey];
    return colorValue === -1 ? undefined : (colorValue !== undefined ? colorValue : undefined);
  }

  getCustomFtVariantColor(config, variant) {
    const key = variant === 'Magic' ? 'schedule_color_ft_magic' : 'schedule_color_ft_blood';
    const variantColor = config[key];

    if (variantColor === undefined || variantColor === FT_VARIANT_COLOR_INHERIT) {
      return this.getCustomColor(config, 'FT');
    }

    return variantColor === -1 ? undefined : variantColor;
  }

  async invalidateFtVariantState(guildId, variants) {
    const normalizedVariants = normalizeEnabledFtVariants(Array.isArray(variants) ? variants : [variants]);
    for (const variant of normalizedVariants) {
      delete this.state[guildId + '_FT_' + variant];
    }
    await this.saveState();
  }

  async updateAllSchedules() {
    try {
      const hasChanges = await this.scheduleManager.hasDataChanges();
      const systemUpdateHash = getSystemUpdateHash();
      const systemUpdateChanged = this.state.systemUpdateHash !== systemUpdateHash;
      
      if (!hasChanges && !systemUpdateChanged) {
        logger.debug('No database or system update changes detected, skipping update cycle');
        return;
      }
      
      logger.info('Changes detected, running full update cycle', {
        hasDatabaseChanges: hasChanges,
        systemUpdateChanged
      });
      
      this.scheduleManager.invalidateCache();
      
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

      await this.calendarService.syncAll();
      
      if (hasChanges) {
        await this.scheduleManager.markDataProcessed();
      }

      this.state.systemUpdateHash = systemUpdateHash;
      await this.saveState();

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      const successful = results.filter(r => r.success).length;
      logger.info('Update cycle complete', { 
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

      if (raidType === 'FT' && normalizeFtChannelMode(config.ft_channel_mode) === FT_CHANNEL_MODES.Separate) {
        logger.info('Regenerating separate FT schedules', { guildId });
        delete this.state[guildId + '_FT_Blood'];
        delete this.state[guildId + '_FT_Magic'];
        await this.saveState();
        await this.updateFtSeparateSchedules(guildId, config);
        return { success: true };
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
  
  destroy() {
    if (this.scheduleManager) {
      this.scheduleManager.destroy();
      logger.info('UpdateManager: Schedule manager cache cleaned up');
    }
  }
}

module.exports = UpdateManager;
