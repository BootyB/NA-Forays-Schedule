// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const ScheduleManager = require('./scheduleManager');
const ScheduleContainerBuilder = require('./containerBuilder');
const CalendarService = require('./calendarService');
const RunAuthorResolver = require('./runAuthorResolver');
const { AttachmentBuilder, PermissionFlagsBits } = require('discord.js');
const EncryptedStateManager = require('./encryptedStateManager');
const logger = require('../utils/logger');
const encryptedDb = require('../config/encryptedDatabase');
const { getAuthorPostChannelIds } = require('../config/hostServers');
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
const { getSystemUpdateHash, getSystemUpdateHashes } = require('../utils/systemUpdate');
const { hashCodeSchedules } = require('../utils/hashCode');
const { buildPollOverviewAssets } = require('./pollOverview');
const { normalizeEnabledPolls, getEnabledPollIdsForRaid } = require('./pollConfig');
const fs = require('fs');

const FT_VARIANT_COLOR_INHERIT = -2;
const DISCORD_UNKNOWN_MESSAGE_CODE = 10008;
const SCHEDULE_RENDER_VERSION = 'run-author-links-v7';

function isUnknownDiscordMessage(error) {
  return error?.code === DISCORD_UNKNOWN_MESSAGE_CODE ||
    error?.rawError?.code === DISCORD_UNKNOWN_MESSAGE_CODE ||
    error?.message?.includes('Unknown Message');
}

class UpdateManager {
  constructor(pool, client) {
    this.pool = pool;
    this.client = client;
    this.scheduleManager = new ScheduleManager(pool);
    this.containerBuilder = new ScheduleContainerBuilder(client);
    this.runAuthorResolver = new RunAuthorResolver(client, { pool });
    this.calendarService = new CalendarService(pool);
    this.stateManager = new EncryptedStateManager();
    this.state = {};
    this.updateLocks = new Map();
    this.pendingUpdates = new Map();
    this.updateAllInProgress = false;
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

  async initialize(options = {}) {
    await this.stateManager.initialize();
    this.state = this.stateManager.state;

    if (options.cleanupOldState !== false) {
      await this.cleanupOldState();
    }
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

  isGuildAllowedForThisBot(guildId) {
    const isDevServer = guildId === DEV_SERVER_GUILD_ID;
    if (IS_DEV_BOT && !isDevServer) {
      return { allowed: false, error: 'Dev bot cannot update non-dev servers' };
    }
    if (!IS_DEV_BOT && isDevServer) {
      return { allowed: false, error: 'Prod bot cannot update dev server' };
    }
    return { allowed: true };
  }

  getScheduleTargets(config, options = {}) {
    const targets = [];
    const requestedRaidTypes = Array.isArray(options.raidTypes) && options.raidTypes.length > 0
      ? new Set(options.raidTypes)
      : null;
    const requestedFtVariants = Array.isArray(options.ftVariants) && options.ftVariants.length > 0
      ? new Set(normalizeEnabledFtVariants(options.ftVariants))
      : null;

    for (const raidType of ALL_RAID_TYPES) {
      if (requestedRaidTypes && !requestedRaidTypes.has(raidType)) continue;

      if (raidType === 'FT' && normalizeFtChannelMode(config.ft_channel_mode) === FT_CHANNEL_MODES.Separate) {
        const channelIds = normalizeFtVariantMap(config.ft_variant_channel_ids);
        for (const variant of DEFAULT_FT_VARIANTS) {
          if (requestedFtVariants && !requestedFtVariants.has(variant)) continue;
          if (channelIds[variant]) {
            targets.push({ raidType, variant, channelId: channelIds[variant] });
          }
        }
        continue;
      }

      const channelId = config[getScheduleChannelKey(raidType)];
      if (channelId) {
        targets.push({ raidType, variant: null, channelId });
      }
    }

    return targets;
  }

  getRequestedPurgeChannelIds(config, raidTypes = ALL_RAID_TYPES, ftVariants = null) {
    return new Set(
      this.getScheduleTargets(config, { raidTypes, ftVariants })
        .map(target => target.channelId)
    );
  }

  getAffectedScheduleTargetsForChannels(config, channelIds) {
    const affectedByKey = new Map();
    for (const target of this.getScheduleTargets(config)) {
      if (channelIds.has(target.channelId)) {
        affectedByKey.set(`${target.raidType}:${target.variant || ''}`, target);
      }
    }

    return [...affectedByKey.values()];
  }

  getAffectedRaidTypesForChannels(config, channelIds) {
    return [...new Set(
      this.getAffectedScheduleTargetsForChannels(config, channelIds)
        .map(target => target.raidType)
    )];
  }

  buildClearUpdatesForAffectedScheduleTargets(guildId, config, affectedTargets) {
    const updates = {};
    const nextOverviewMap = normalizeFtVariantMap(config?.ft_variant_overview_ids);
    const nextMessageMap = normalizeFtVariantMap(config?.ft_variant_message_ids);
    let ftVariantMapsChanged = false;

    for (const target of affectedTargets) {
      const { raidType, variant } = target;

      if (raidType === 'FT' && variant) {
        nextOverviewMap[variant] = null;
        nextMessageMap[variant] = [];
        delete this.state[`${guildId}_FT_${variant}`];
        ftVariantMapsChanged = true;
        continue;
      }

      updates[getScheduleMessageKey(raidType)] = null;
      updates[getScheduleOverviewKey(raidType)] = null;
      delete this.state[`${guildId}_${raidType}`];

      if (raidType === 'FT') {
        updates.ft_variant_overview_ids = normalizeFtVariantMap(null);
        updates.ft_variant_message_ids = { Blood: [], Magic: [] };
        delete this.state[`${guildId}_FT_Blood`];
        delete this.state[`${guildId}_FT_Magic`];
        ftVariantMapsChanged = false;
      }
    }

    if (ftVariantMapsChanged) {
      updates.ft_variant_overview_ids = nextOverviewMap;
      updates.ft_variant_message_ids = nextMessageMap;
    }

    return updates;
  }

  buildClearUpdatesForAffectedSchedules(guildId, affectedRaidTypes) {
    return this.buildClearUpdatesForAffectedScheduleTargets(
      guildId,
      null,
      affectedRaidTypes.map(raidType => ({ raidType, variant: null }))
    );
  }


  isTransientDiscordError(error) {
    const message = String(error?.message || '');
    return message.includes('Connect Timeout') ||
      message.includes('UND_ERR_CONNECT_TIMEOUT') ||
      message.includes('ECONNRESET') ||
      message.includes('ETIMEDOUT') ||
      message.includes('EAI_AGAIN') ||
      error?.code === 'UND_ERR_CONNECT_TIMEOUT' ||
      error?.code === 'ECONNRESET' ||
      error?.code === 'ETIMEDOUT' ||
      error?.code === 'EAI_AGAIN';
  }

  async retryDiscordOperation(label, fn, context = {}) {
    const maxAttempts = 3;
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (attempt === maxAttempts || !this.isTransientDiscordError(error)) {
          throw error;
        }

        const delay = 500 * attempt;
        logger.warn('Transient Discord operation failed, retrying', {
          label,
          attempt,
          maxAttempts,
          delay,
          error: error.message,
          ...context
        });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  async fetchScheduleChannel(channelId, guildId) {
    const channel = await this.retryDiscordOperation(
      'fetch schedule channel',
      () => this.client.channels.fetch(channelId),
      { guildId, channelId }
    ).catch(() => null);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }
    if (!channel.messages || typeof channel.messages.fetch !== 'function') {
      throw new Error(`Channel ${channelId} is not a message channel`);
    }

    const botMember = channel.guild
      ? await this.retryDiscordOperation(
        'fetch bot member',
        () => channel.guild.members.fetchMe(),
        { guildId, channelId }
      ).catch(() => null)
      : null;
    const permissions = botMember ? channel.permissionsFor(botMember) : null;
    if (!permissions ||
      !permissions.has(PermissionFlagsBits.ViewChannel) ||
      !permissions.has(PermissionFlagsBits.ReadMessageHistory) ||
      !permissions.has(PermissionFlagsBits.SendMessages) ||
      !permissions.has(PermissionFlagsBits.AttachFiles)) {
      logger.error('Bot missing purge/regenerate permissions in schedule channel', {
        guildId,
        channelId,
        hasViewChannel: permissions ? permissions.has(PermissionFlagsBits.ViewChannel) : false,
        hasReadMessageHistory: permissions ? permissions.has(PermissionFlagsBits.ReadMessageHistory) : false,
        hasSendMessages: permissions ? permissions.has(PermissionFlagsBits.SendMessages) : false,
        hasAttachFiles: permissions ? permissions.has(PermissionFlagsBits.AttachFiles) : false
      });
      throw new Error(`Missing View Channel, Read Message History, Send Messages, or Attach Files in ${channelId}`);
    }

    return channel;
  }

  async collectBotMessages(channel) {
    const messages = [];
    let before;

    do {
      const fetched = await this.retryDiscordOperation(
        'fetch schedule channel messages',
        () => channel.messages.fetch({ limit: 100, before }),
        { channelId: channel.id, before }
      );
      for (const message of fetched.values()) {
        if (message.author?.id === this.client.user.id) {
          messages.push(message);
        }
      }
      before = fetched.size > 0 ? fetched.last().id : null;
      if (fetched.size < 100) break;
    } while (before);

    return messages;
  }

  async planChannelPurge(channelIds, guildId) {
    const plans = [];

    for (const channelId of channelIds) {
      const channel = await this.fetchScheduleChannel(channelId, guildId);
      const messages = await this.collectBotMessages(channel);
      plans.push({
        channelId,
        channelName: channel.name || channelId,
        channel,
        messages,
        botMessageCount: messages.length
      });
    }

    return plans;
  }

  async deletePlannedBotMessages(plans, guildId) {
    const results = [];

    for (const plan of plans) {
      let deleted = 0;
      for (const message of plan.messages) {
        try {
          await message.delete();
          deleted++;
        } catch (error) {
          if (!isUnknownDiscordMessage(error)) {
            throw error;
          }
        }
      }

      logger.info('Purged bot-authored schedule channel messages', {
        guildId,
        channelId: plan.channelId,
        channelName: plan.channelName,
        deleted
      });

      results.push({
        channelId: plan.channelId,
        channelName: plan.channelName,
        deleted
      });
    }

    return results;
  }

  getBannerCandidates(raidType, options = {}) {
    if (raidType !== 'FT') {
      return [`${raidType.toLowerCase()}_opening.avif`];
    }

    const variants = normalizeEnabledFtVariants(options.enabledFtVariants);
    const hasBlood = variants.includes('Blood');
    const hasMagic = variants.includes('Magic');

    if (hasBlood && hasMagic) {
      return ['ftb_opening.avif'];
    }

    if (hasMagic) {
      return ['ftm_opening.avif'];
    }

    return ['ftb_opening.avif'];
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

  async buildOverviewMessageOptions(raidType, customColor, scheduleOptions = {}) {
    const banner = this.resolveBannerAttachment(raidType, scheduleOptions);
    let pollOverview = { pollScopes: [], attachments: [], hash: 'none' };

    try {
      pollOverview = await buildPollOverviewAssets(this.pool, raidType, scheduleOptions);
    } catch (error) {
      logger.warn('Poll overview assets unavailable', { raidType, variant: scheduleOptions.ftVariant, error: error.message });
    }

    const containerOptions = {
      bannerImage: banner.url,
      pollScopes: pollOverview.pollScopes,
      enabledFtVariants: scheduleOptions.enabledFtVariants
    };
    if (scheduleOptions.ftVariant) {
      containerOptions.ftVariant = scheduleOptions.ftVariant;
    }

    const overviewContainer = this.containerBuilder.buildOverviewContainer(raidType, customColor, containerOptions);
    const files = [banner.attachment, ...pollOverview.attachments].filter(Boolean);
    const messageOptions = {
      components: [overviewContainer.toJSON()],
      flags: 1 << 15
    };
    if (files.length > 0) {
      messageOptions.files = files;
    }

    return {
      messageOptions,
      pollHash: pollOverview.hash,
      hasAttachments: files.length > 0
    };
  }
  async enrichGroupedRunsWithSourceAuthors(groupedRuns, raidType) {
    if (!groupedRuns || Object.keys(groupedRuns).length === 0) {
      return groupedRuns;
    }

    const enrichedGroupedRuns = {};
    const authorPostStats = {};
    let resolvedCount = 0;
    let linkedCount = 0;
    let runCount = 0;

    for (const [serverName, runs] of Object.entries(groupedRuns)) {
      const hasAuthorPostChannels = getAuthorPostChannelIds(serverName, raidType).length > 0;
      if (hasAuthorPostChannels) {
        authorPostStats[serverName] = {
          runCount: runs.length,
          resolvedCount: 0,
          linkedCount: 0,
          statuses: {}
        };
      }

      enrichedGroupedRuns[serverName] = await Promise.all(runs.map(async (run) => {
        runCount++;
        const author = await this.runAuthorResolver.resolveRunAuthor(run, raidType);
        if (author) {
          resolvedCount++;
          if (author.sourceAuthorUrl) linkedCount++;
          if (hasAuthorPostChannels) {
            authorPostStats[serverName].resolvedCount++;
            if (author.sourceAuthorUrl) authorPostStats[serverName].linkedCount++;
            const status = author.authorPostLookupStatus || (author.sourceAuthorUrl ? 'linked' : 'not-attempted');
            authorPostStats[serverName].statuses[status] = (authorPostStats[serverName].statuses[status] || 0) + 1;
          }
          return { ...run, ...author };
        }
        return { ...run };
      }));
    }

    logger.debug('Resolved run authors for schedule', {
      raidType,
      runCount,
      resolvedCount,
      linkedCount
    });

    for (const [serverName, stats] of Object.entries(authorPostStats)) {
      const meaningfulStatuses = Object.fromEntries(
        Object.entries(stats.statuses).filter(([status]) => status !== 'memory-cache-hit')
      );
      const shouldLog = Object.keys(meaningfulStatuses).length > 0 || stats.linkedCount === 0;
      if (!shouldLog) continue;

      logger.info('Author post link resolution summary', {
        raidType,
        serverName,
        runCount: stats.runCount,
        resolvedCount: stats.resolvedCount,
        linkedCount: stats.linkedCount,
        statuses: meaningfulStatuses
      });
    }

    return enrichedGroupedRuns;
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
      const enabledPolls = normalizeEnabledPolls(config.enabled_polls);
      const scheduleOptions = raidType === 'FT' ? { enabledFtVariants, enabledPolls } : { enabledPolls };

      const groupedRuns = await this.scheduleManager.fetchScheduleGroupedByServer(
        raidType,
        enabledHosts,
        undefined,
        scheduleOptions
      );
      const enrichedGroupedRuns = await this.enrichGroupedRunsWithSourceAuthors(groupedRuns, raidType);

      const colorKey = getScheduleColorKey(raidType);
      const colorValue = config[colorKey];
      const customColor = colorValue === -1 ? undefined : (colorValue !== undefined ? colorValue : undefined);
      const overviewBundle = await this.buildOverviewMessageOptions(raidType, customColor, scheduleOptions);
      const overviewHash = hashCodeSchedules(`${getSystemUpdateHash(raidType)}|poll:${overviewBundle.pollHash}`);
      const scheduleHash = this.containerBuilder.generateContentHash(enrichedGroupedRuns, raidType, scheduleOptions);
      const newHash = hashCodeSchedules(`${scheduleHash}|overview:${overviewHash}|render:${SCHEDULE_RENDER_VERSION}`);
      const oldState = this.state[stateKey] || {};
      logger.debug('Hash comparison', { 
        guildId, 
        raidType, 
        stateKey,
        oldHash: oldState.hash || 'none',
        newHash,
        hashMatch: oldState.hash === newHash,
        runsCount: Object.values(enrichedGroupedRuns).flat().length
      });
      
      const containers = await this.containerBuilder.buildScheduleContainers(enrichedGroupedRuns, raidType, customColor, scheduleOptions);
      

      const channelKey = getScheduleChannelKey(raidType);
      const channelId = config[channelKey];
      
      if (!channelId) {
        return;
      }

      const channel = await this.retryDiscordOperation(
        'fetch schedule channel',
        () => this.client.channels.fetch(channelId),
        { guildId, channelId }
      ).catch(() => null);
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

      let needsLiveRecreation = false;
      if (oldState.hash === newHash) {
        const messagesExist = await this.hasExistingScheduleMessages(channel, existingOverviewId, existingMessageIds, containers.length);
        if (messagesExist) {
          logger.debug('Schedule unchanged, skipping update', { guildId, raidType });
          return;
        }

        needsLiveRecreation = true;
        logger.info('Schedule hash unchanged but live messages are missing or incomplete; rebuilding', {
          guildId,
          raidType,
          expectedMessages: containers.length,
          existingMessageCount: existingMessageIds.length
        });
      }

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
      
      const needsFullRecreation = needsLiveRecreation || hostsListChanged || serversAdded;
      
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
            const overviewMessage = await this.fetchLiveMessage(channel, existingOverviewId);
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
              const message = await this.fetchLiveMessage(channel, messageId);
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
              const message = await this.fetchLiveMessage(channel, messageId);
              if (message) {
                await message.delete();
              }
            } catch (error) {
              logger.error('Error deleting message during recreation', { error: error.message, messageId });
            }
          }
          existingMessageIds.length = 0;
        }
        
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
          
          if (overviewBundle.hasAttachments && !permissions.has('AttachFiles')) {
            logger.error('Bot missing AttachFiles permission needed for banner', {
              guildId,
              raidType,
              channelId: channel.id
            });
            throw new Error('Bot missing AttachFiles permission (required for banner image)');
          }
          
          const newMessage = await channel.send(overviewBundle.messageOptions);
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
        const overviewMessage = await this.fetchLiveMessage(channel, existingOverviewId);

        if (overviewMessage) {
          await overviewMessage.edit(overviewBundle.messageOptions);
          logger.info('Updated overview message for overview change', { guildId, raidType, messageId: existingOverviewId });
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
        renderVersion: SCHEDULE_RENDER_VERSION,
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
        runsCount: Object.values(enrichedGroupedRuns).flat().length,
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

  async updateFtSeparateSchedules(guildId, config, options = {}) {
    const hostsKey = getEnabledHostsKey('FT');
    const enabledHosts = config[hostsKey];
    if (!enabledHosts || enabledHosts.length === 0) {
      logger.debug('No enabled hosts for separate FT schedule', { guildId });
      return { success: false, error: 'No enabled FT host servers' };
    }

    const channelIds = normalizeFtVariantMap(config.ft_variant_channel_ids);
    const targetFtVariants = Array.isArray(options.ftVariants) && options.ftVariants.length > 0
      ? normalizeEnabledFtVariants(options.ftVariants)
      : [...DEFAULT_FT_VARIANTS];
    const missingChannelVariants = targetFtVariants.filter(variant => !channelIds[variant]);
    if (missingChannelVariants.length > 0) {
      logger.warn('Separate FT mode is missing target variant channels', { guildId, channelIds, targetFtVariants, missingChannelVariants });
      return { success: false, error: `Separate FT mode is missing channels for: ${missingChannelVariants.join(', ')}` };
    }

    const enabledFtVariants = normalizeEnabledFtVariants(config.enabled_ft_variants);
    const allRuns = await this.scheduleManager.fetchScheduleGroupedByServer(
      'FT',
      enabledHosts,
      undefined,
      { enabledFtVariants: DEFAULT_FT_VARIANTS, enabledPolls: normalizeEnabledPolls(config.enabled_polls) }
    );
    const enrichedAllRuns = await this.enrichGroupedRunsWithSourceAuthors(allRuns, 'FT');

    const overviewMap = normalizeFtVariantMap(config.ft_variant_overview_ids);
    const messageMap = normalizeFtVariantMap(config.ft_variant_message_ids);
    const nextOverviewMap = { ...overviewMap };
    const nextMessageMap = { ...messageMap };
    const updateResults = [];
    const updateErrors = [];

    await this.cleanupSharedFtMessages(guildId, config);

    logger.info('Updating separate FT schedules', {
      guildId,
      enabledFtVariants,
      targetFtVariants,
      bloodChannelId: channelIds.Blood,
      magicChannelId: channelIds.Magic
    });

    for (const variant of DEFAULT_FT_VARIANTS) {
      if (!targetFtVariants.includes(variant)) continue;
      const channelId = channelIds[variant];
      logger.info('Starting separate FT variant update', { guildId, variant, channelId, enabled: enabledFtVariants.includes(variant) });

      try {
        const channel = await this.client.channels.fetch(channelId).catch((error) => {
          logger.warn('FT variant channel fetch failed', { guildId, variant, channelId, error: error.message });
          return null;
        });
        if (!channel) {
          logger.warn('FT variant channel not found', { guildId, variant, channelId });
          updateErrors.push(`${variant}: channel not found`);
          continue;
        }

        if (!enabledFtVariants.includes(variant)) {
          logger.info('Skipping disabled FT variant schedule', { guildId, variant, enabledFtVariants });
          await this.cleanupFtVariantMessages(channel, nextOverviewMap[variant], nextMessageMap[variant], guildId, variant);
          nextOverviewMap[variant] = null;
          nextMessageMap[variant] = [];
          delete this.state[guildId + '_FT_' + variant];
          updateResults.push({ variant, skipped: true, reason: 'disabled' });
          continue;
        }

        const groupedRuns = this.filterGroupedRunsByFtVariant(enrichedAllRuns, variant);
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
          existingMessageIds: Array.isArray(nextMessageMap[variant]) ? nextMessageMap[variant] : [],
          enabledPolls: normalizeEnabledPolls(config.enabled_polls)
        });
        nextOverviewMap[variant] = result.overviewMessageId;
        nextMessageMap[variant] = result.messageIds;
        if (result.skipped) updateErrors.push(`${variant}: ${result.reason || 'skipped'}`);
        updateResults.push({ variant, overviewMessageId: result.overviewMessageId, messageCount: result.messageIds.length, skipped: Boolean(result.skipped), reason: result.reason || null });
        logger.info('Finished separate FT variant update', { guildId, variant, channelId, overviewMessageId: result.overviewMessageId, messageCount: result.messageIds.length });
      } catch (error) {
        logger.error('Error updating separate FT variant schedule', {
          guildId,
          variant,
          channelId,
          error: error.message,
          stack: error.stack
        });
        updateErrors.push(`${variant}: ${error.message}`);
      }
    }

    await encryptedDb.updateServerConfig(guildId, {
      ft_variant_overview_ids: nextOverviewMap,
      ft_variant_message_ids: nextMessageMap,
      schedule_overview_ft: null,
      schedule_message_ft: null
    });
    await this.saveState();

    return {
      success: updateErrors.length === 0,
      error: updateErrors.join('; '),
      results: updateResults
    };
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

  async hasExistingScheduleMessages(channel, overviewId, messageIds, expectedMessageCount = null) {
    if (!overviewId) return false;

    const overviewMessage = await this.fetchLiveMessage(channel, overviewId);
    if (!overviewMessage || overviewMessage.author.id !== channel.client.user.id) {
      return false;
    }

    if (!Array.isArray(messageIds)) return false;
    if (expectedMessageCount !== null && messageIds.length !== expectedMessageCount) {
      return false;
    }

    for (const messageId of messageIds) {
      const message = await this.fetchLiveMessage(channel, messageId);
      if (!message || message.author.id !== channel.client.user.id) {
        return false;
      }
    }

    return true;
  }

  async fetchLiveMessage(channel, messageId) {
    if (!messageId) return null;

    return channel.messages.fetch({ message: messageId, cache: false, force: true }).catch(() => null);
  }

  async updateFtVariantTarget({ guildId, variant, channel, groupedRuns, enabledHosts, customColor, existingOverviewId, existingMessageIds, enabledPolls }) {
    const stateKey = guildId + '_FT_' + variant;
    const scheduleOptions = { enabledFtVariants: [variant], ftVariant: variant, enabledPolls: normalizeEnabledPolls(enabledPolls) };
    const overviewBundle = await this.buildOverviewMessageOptions('FT', customColor, scheduleOptions);
    const overviewHash = hashCodeSchedules(`${getSystemUpdateHash('FT')}|poll:${overviewBundle.pollHash}`);
    const scheduleHash = this.containerBuilder.generateContentHash(groupedRuns, 'FT', scheduleOptions);
    const colorHash = customColor === undefined ? 'default' : String(customColor);
    const newHash = hashCodeSchedules(String(scheduleHash) + '|overview:' + overviewHash + '|channel:' + channel.id + '|variant:' + variant + '|color:' + colorHash + '|render:' + SCHEDULE_RENDER_VERSION);
    const oldState = this.state[stateKey] || {};
    const existingIds = Array.isArray(existingMessageIds) ? existingMessageIds.slice() : [];
    const containers = await this.containerBuilder.buildScheduleContainers(groupedRuns, 'FT', customColor, scheduleOptions);
    const serverHashes = {};
    const serverOrder = [];

    for (const { serverName, hash } of containers) {
      serverHashes[serverName] = hash;
      serverOrder.push(serverName);
    }

    const previousOrder = oldState.serverOrder || [];
    const serverOrderChanged = JSON.stringify(previousOrder) !== JSON.stringify(serverOrder);
    const messageCountChanged = existingIds.length !== containers.length;
    let needsFullRecreation = serverOrderChanged || messageCountChanged;

    if (oldState.hash === newHash) {
      const messagesExist = await this.hasExistingScheduleMessages(channel, existingOverviewId, existingIds, containers.length);
      if (messagesExist) {
        logger.debug('Separate FT variant unchanged, skipping update', { guildId, variant });
        return { overviewMessageId: existingOverviewId, messageIds: existingIds };
      }

      needsFullRecreation = true;
      logger.info('Separate FT variant hash unchanged but live messages are missing or incomplete; rebuilding', {
        guildId,
        variant,
        expectedMessages: containers.length,
        existingMessageCount: existingIds.length
      });
    }

    const hasTargetPermissions = await this.validateScheduleTargetPermissions(channel, guildId, 'FT', {
      variant,
      requiresAttachment: overviewBundle.hasAttachments
    });
    if (!hasTargetPermissions) {
      return { overviewMessageId: existingOverviewId, messageIds: existingIds, skipped: true, reason: 'missing permissions' };
    }

    let overviewMessageId = existingOverviewId;
    let mutableExistingIds = existingIds;
    let updatedCount = 0;
    let skippedCount = 0;

    if (needsFullRecreation && (existingOverviewId || existingIds.length > 0)) {
      logger.info('Recreating separate FT variant due to server display structure change', {
        guildId,
        variant,
        channelId: channel.id,
        serverOrderChanged,
        messageCountChanged,
        previousOrder,
        serverOrder
      });
      await this.cleanupFtVariantMessages(channel, existingOverviewId, existingIds, guildId, variant);
      overviewMessageId = null;
      mutableExistingIds = [];
      updatedCount += existingIds.length + (existingOverviewId ? 1 : 0);
    }

    const overviewNeedsUpdate = oldState.overviewHash !== overviewHash || oldState.colorHash !== colorHash || !overviewMessageId;
    if (overviewMessageId) {
      const overviewMessage = await this.fetchLiveMessage(channel, overviewMessageId);
      if (overviewMessage && overviewMessage.author.id === channel.client.user.id) {
        if (overviewNeedsUpdate) {
          try {
            await overviewMessage.edit(overviewBundle.messageOptions);
            logger.info('Updated separate FT variant overview', { guildId, variant, channelId: channel.id, messageId: overviewMessageId });
          } catch (error) {
            if (!isUnknownDiscordMessage(error)) {
              throw error;
            }

            logger.warn('Separate FT variant overview disappeared during edit; creating replacement', {
              guildId,
              variant,
              channelId: channel.id,
              messageId: overviewMessageId
            });
            overviewMessageId = null;
          }
        }
      } else {
        overviewMessageId = null;
      }
    }

    if (!overviewMessageId) {
      const overviewMessage = await channel.send(overviewBundle.messageOptions);
      overviewMessageId = overviewMessage.id;
      logger.info('Created separate FT variant overview', { guildId, variant, channelId: channel.id, messageId: overviewMessageId });
    }

    const oldServerHashes = oldState.serverHashes || {};
    const oldServerOrder = oldState.serverOrder || [];
    const newMessageIds = [];

    for (let i = 0; i < containers.length; i++) {
      const { container, serverName, hash } = containers[i];
      const existingId = mutableExistingIds[i];
      const oldHash = oldServerHashes[serverName];
      const oldServerAtIndex = oldServerOrder[i];
      const serverPositionChanged = oldServerAtIndex !== serverName;

      if (existingId) {
        const message = await this.fetchLiveMessage(channel, existingId);
        if (message && message.author.id === channel.client.user.id) {
          if (oldHash === hash && !serverPositionChanged) {
            newMessageIds.push(message.id);
            skippedCount++;
            continue;
          }

          try {
            await message.edit({ components: [container.toJSON()], flags: 1 << 15 });
            newMessageIds.push(message.id);
            updatedCount++;
            continue;
          } catch (error) {
            if (!isUnknownDiscordMessage(error)) {
              throw error;
            }

            logger.warn('Separate FT variant schedule message disappeared during edit; creating replacement', {
              guildId,
              variant,
              channelId: channel.id,
              serverName,
              messageIndex: i,
              messageId: existingId
            });
          }
        }
      }

      const newMessage = await channel.send({ components: [container.toJSON()], flags: 1 << 15 });
      newMessageIds.push(newMessage.id);
      updatedCount++;
    }

    for (let i = containers.length; i < mutableExistingIds.length; i++) {
      const message = await this.fetchLiveMessage(channel, mutableExistingIds[i]);
      if (message && message.author.id === channel.client.user.id) {
        await message.delete();
        updatedCount++;
      }
    }

    this.state[stateKey] = {
      hash: newHash,
      serverHashes,
      serverOrder,
      enabledHosts: enabledHosts.slice().sort(),
      enabledFtVariants: [variant],
      overviewHash,
      colorHash,
      renderVersion: SCHEDULE_RENDER_VERSION,
      lastUpdate: Date.now(),
      messageCount: newMessageIds.length
    };
    await this.saveState();

    logger.info('Updated separate FT variant schedule', {
      guildId,
      variant,
      channelId: channel.id,
      messageCount: newMessageIds.length,
      updated: updatedCount,
      skipped: skippedCount
    });
    return { overviewMessageId, messageIds: newMessageIds };
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

    const channel = await this.retryDiscordOperation(
      'fetch schedule channel',
      () => this.client.channels.fetch(channelId),
      { guildId, channelId }
    ).catch(() => null);
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
        const message = await this.fetchLiveMessage(channel, messageId);
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

  getPollOverviewRefreshTargets(config, raidType, pollId, ftVariant = null) {
    if (!config?.setup_complete) return [];
    if (!this.isGuildAllowedForThisBot(config.guild_id).allowed) return [];
    if (!getEnabledPollIdsForRaid(config.enabled_polls, raidType).includes(pollId)) return [];

    if (raidType === 'FT') {
      const enabledFtVariants = normalizeEnabledFtVariants(config.enabled_ft_variants);
      if (ftVariant && !enabledFtVariants.includes(ftVariant)) return [];

      if (normalizeFtChannelMode(config.ft_channel_mode) === FT_CHANNEL_MODES.Separate) {
        const channelIds = normalizeFtVariantMap(config.ft_variant_channel_ids);
        const overviewIds = normalizeFtVariantMap(config.ft_variant_overview_ids);
        const variants = ftVariant ? [ftVariant] : enabledFtVariants;

        return variants
          .filter(variant => enabledFtVariants.includes(variant) && channelIds[variant] && overviewIds[variant])
          .map(variant => ({
            guildId: config.guild_id,
            channelId: channelIds[variant],
            messageId: overviewIds[variant],
            raidType,
            ftVariant: variant
          }));
      }
    }

    const channelId = config[getScheduleChannelKey(raidType)];
    const messageId = config[getScheduleOverviewKey(raidType)];
    if (!channelId || !messageId) return [];

    return [{
      guildId: config.guild_id,
      channelId,
      messageId,
      raidType,
      ftVariant: null
    }];
  }

  async refreshPollOverviewMessagesForPoll({ pollId, raidType, ftVariant = null }) {
    let configs = await encryptedDb.getActiveServerConfigs('WHERE setup_complete = 1');
    configs = configs.filter(config => this.isGuildAllowedForThisBot(config.guild_id).allowed);

    const targetsByKey = new Map();
    for (const config of configs) {
      for (const target of this.getPollOverviewRefreshTargets(config, raidType, pollId, ftVariant)) {
        targetsByKey.set(`${target.guildId}:${target.channelId}:${target.messageId}`, target);
      }
    }

    const targets = [...targetsByKey.values()];
    const results = [];

    for (let i = 0; i < targets.length; i += CONCURRENCY_LIMIT) {
      const batch = targets.slice(i, i + CONCURRENCY_LIMIT);
      const batchResults = await Promise.all(batch.map(async (target) => {
        try {
          const refreshed = await this.refreshPollOverviewMessage(target);
          return { ...target, refreshed };
        } catch (error) {
          logger.error('Error refreshing poll overview target', {
            error: error.message,
            stack: error.stack,
            ...target
          });
          return { ...target, refreshed: false, error: error.message };
        }
      }));
      results.push(...batchResults);
    }

    const refreshedCount = results.filter(result => result.refreshed).length;
    logger.info('Finished refreshing poll overview images for poll response', {
      pollId,
      raidType,
      ftVariant,
      targetCount: targets.length,
      refreshedCount,
      failedCount: targets.length - refreshedCount
    });

    return {
      targetCount: targets.length,
      refreshedCount,
      results
    };
  }

  async refreshPollOverviewMessage({ guildId, channelId, messageId, raidType, ftVariant = null }) {
    const config = await encryptedDb.getServerConfig(guildId);
    if (!config) return false;

    const channel = await this.retryDiscordOperation(
      'fetch schedule channel',
      () => this.client.channels.fetch(channelId),
      { guildId, channelId }
    ).catch(() => null);
    if (!channel) return false;

    const message = await this.fetchLiveMessage(channel, messageId);
    if (!message || message.author.id !== channel.client.user.id) return false;

    const scheduleOptions = raidType === 'FT'
      ? (ftVariant
        ? { enabledFtVariants: [ftVariant], ftVariant, enabledPolls: normalizeEnabledPolls(config.enabled_polls) }
        : { enabledFtVariants: normalizeEnabledFtVariants(config.enabled_ft_variants), enabledPolls: normalizeEnabledPolls(config.enabled_polls) })
      : { enabledPolls: normalizeEnabledPolls(config.enabled_polls) };
    const customColor = raidType === 'FT' && ftVariant
      ? this.getCustomFtVariantColor(config, ftVariant)
      : this.getCustomColor(config, raidType);
    const overviewBundle = await this.buildOverviewMessageOptions(raidType, customColor, scheduleOptions);

    const botMember = await channel.guild.members.fetchMe();
    const permissions = channel.permissionsFor(botMember);
    if (overviewBundle.hasAttachments && (!permissions || !permissions.has(PermissionFlagsBits.AttachFiles))) {
      logger.warn('Cannot refresh poll overview image without AttachFiles permission', { guildId, raidType, ftVariant, channelId });
      return false;
    }

    await message.edit(overviewBundle.messageOptions);
    logger.info('Refreshed poll overview image', { guildId, raidType, ftVariant, messageId });
    return true;
  }
  async updateAllSchedules() {
    if (this.updateAllInProgress) {
      logger.info('Full update cycle already in progress, skipping overlapping trigger');
      return { skipped: true, reason: 'in_progress' };
    }

    this.updateAllInProgress = true;

    try {
      const hasChanges = await this.scheduleManager.hasDataChanges();
      const systemUpdateHash = getSystemUpdateHash();
      const systemUpdateHashes = getSystemUpdateHashes();
      const previousSystemUpdateHashes = this.state.systemUpdateHashes;
      const systemUpdateChangedRaidTypes = previousSystemUpdateHashes && typeof previousSystemUpdateHashes === 'object'
        ? ALL_RAID_TYPES.filter(raidType => previousSystemUpdateHashes[raidType] !== systemUpdateHashes[raidType])
        : (this.state.systemUpdateHash !== systemUpdateHash ? [...ALL_RAID_TYPES] : []);
      const systemUpdateChanged = systemUpdateChangedRaidTypes.length > 0;
      const renderVersionChanged = this.state.scheduleRenderVersion !== SCHEDULE_RENDER_VERSION;
      const raidTypesToUpdate = !hasChanges && !renderVersionChanged && systemUpdateChanged
        ? systemUpdateChangedRaidTypes
        : ALL_RAID_TYPES;
      
      if (!hasChanges && !systemUpdateChanged && !renderVersionChanged) {
        logger.debug('No database or system update changes detected, skipping update cycle');
        return;
      }
      
      logger.info('Changes detected, running update cycle', {
        hasDatabaseChanges: hasChanges,
        systemUpdateChanged,
        systemUpdateChangedRaidTypes,
        renderVersionChanged,
        raidTypesToUpdate
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
              raidTypesToUpdate.map(raidType =>
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
      this.state.systemUpdateHashes = systemUpdateHashes;
      this.state.scheduleRenderVersion = SCHEDULE_RENDER_VERSION;
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
    } finally {
      this.updateAllInProgress = false;
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

  async regenerateGuildSchedules(guildId, options = {}) {
    const dryRun = Boolean(options.dryRun);
    const raidTypes = Array.isArray(options.raidTypes) && options.raidTypes.length > 0
      ? options.raidTypes.filter(raidType => ALL_RAID_TYPES.includes(raidType))
      : ALL_RAID_TYPES;
    const ftVariants = Array.isArray(options.ftVariants) && options.ftVariants.length > 0
      ? normalizeEnabledFtVariants(options.ftVariants)
      : null;

    try {
      const allowed = this.isGuildAllowedForThisBot(guildId);
      if (!allowed.allowed) {
        return { success: false, error: allowed.error, guildId, dryRun };
      }

      const config = options.config || await encryptedDb.getServerConfig(guildId);
      if (!config) {
        logger.warn('No config found for guild regeneration', { guildId });
        return { success: false, error: 'Server not configured', guildId, dryRun };
      }

      if (ftVariants && raidTypes.includes('FT') && normalizeFtChannelMode(config.ft_channel_mode) !== FT_CHANNEL_MODES.Separate) {
        return { success: false, error: 'FT variant regeneration requires separate FT channels', guildId, dryRun, raidTypes, ftVariants };
      }

      const purgeChannelIds = this.getRequestedPurgeChannelIds(config, raidTypes, ftVariants);
      if (purgeChannelIds.size === 0) {
        return { success: false, error: 'No configured schedule channels', guildId, dryRun, raidTypes, ftVariants };
      }

      const affectedTargets = this.getAffectedScheduleTargetsForChannels(config, purgeChannelIds);
      const affectedRaidTypes = [...new Set(affectedTargets.map(target => target.raidType))];
      const affectedFtVariants = [...new Set(affectedTargets
        .filter(target => target.raidType === 'FT' && target.variant)
        .map(target => target.variant))];
      if (affectedTargets.length === 0) {
        return { success: false, error: 'No configured schedules for selected channels', guildId, dryRun, raidTypes, ftVariants };
      }

      if (ftVariants) {
        const requestedFtVariantSet = new Set(ftVariants);
        const extraFtVariants = affectedFtVariants.filter(variant => !requestedFtVariantSet.has(variant));
        if (extraFtVariants.length > 0) {
          return {
            success: false,
            error: `Selected FT variant channel also contains ${extraFtVariants.join(', ')}; cannot leave those posts intact`,
            guildId,
            dryRun,
            raidTypes,
            ftVariants
          };
        }
      }

      const purgePlans = await this.planChannelPurge([...purgeChannelIds], guildId);
      const channelResults = purgePlans.map(plan => ({
        channelId: plan.channelId,
        channelName: plan.channelName,
        wouldDelete: plan.botMessageCount
      }));

      logger.info(dryRun ? 'Planned guild schedule regeneration' : 'Starting guild schedule regeneration', {
        guildId,
        dryRun,
        raidTypes,
        ftVariants,
        affectedRaidTypes,
        affectedFtVariants,
        affectedTargets,
        channels: channelResults
      });

      if (dryRun) {
        return {
          success: true,
          dryRun: true,
          guildId,
          raidTypes: affectedRaidTypes,
          ftVariants: affectedFtVariants,
          channels: channelResults,
          wouldDelete: channelResults.reduce((total, channel) => total + channel.wouldDelete, 0)
        };
      }

      const deleteResults = await this.deletePlannedBotMessages(purgePlans, guildId);
      const updates = this.buildClearUpdatesForAffectedScheduleTargets(guildId, config, affectedTargets);

      if (Object.keys(updates).length > 0) {
        await encryptedDb.updateServerConfig(guildId, updates);
      }
      await this.saveState();

      const cleanedConfig = { ...config, ...updates };
      const rebuiltRaidTypes = [];
      const rebuiltFtVariants = [];
      for (const raidType of ALL_RAID_TYPES) {
        if (!affectedRaidTypes.includes(raidType)) continue;
        const hosts = cleanedConfig[getEnabledHostsKey(raidType)];
        if (!Array.isArray(hosts) || hosts.length === 0) continue;

        if (raidType === 'FT' && normalizeFtChannelMode(cleanedConfig.ft_channel_mode) === FT_CHANNEL_MODES.Separate && affectedFtVariants.length > 0) {
          const result = await this.updateFtSeparateSchedules(guildId, cleanedConfig, { ftVariants: affectedFtVariants });
          if (result?.success === false) {
            throw new Error(result.error || 'FT variant schedule update failed');
          }
          rebuiltRaidTypes.push(raidType);
          rebuiltFtVariants.push(...affectedFtVariants);
          continue;
        }

        await this.updateSchedule(guildId, raidType, cleanedConfig);
        rebuiltRaidTypes.push(raidType);
      }

      const deleted = deleteResults.reduce((total, channel) => total + channel.deleted, 0);
      logger.info('Guild schedule regeneration complete', {
        guildId,
        deleted,
        rebuiltRaidTypes,
        rebuiltFtVariants,
        channels: deleteResults
      });

      return {
        success: true,
        dryRun: false,
        guildId,
        raidTypes: rebuiltRaidTypes,
        ftVariants: rebuiltFtVariants,
        channels: deleteResults,
        deleted
      };
    } catch (error) {
      logger.error('Error regenerating guild schedules', {
        error: error.message,
        stack: error.stack,
        guildId,
        dryRun,
        raidTypes,
        ftVariants
      });
      return { success: false, error: error.message, guildId, dryRun, raidTypes, ftVariants };
    }
  }

  async regenerateSchedule(guildId, raidType) {
    return this.regenerateGuildSchedules(guildId, { raidTypes: [raidType], dryRun: false });
  }
  
  destroy() {
    if (this.scheduleManager) {
      this.scheduleManager.destroy();
      logger.info('UpdateManager: Schedule manager cache cleaned up');
    }
  }
}

module.exports = UpdateManager;

