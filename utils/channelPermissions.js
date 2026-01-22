// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const { PermissionFlagsBits, ChannelType, OverwriteType } = require('discord.js');
const logger = require('./logger');
const { DEFAULT_SCHEDULE_CHANNEL_NAMES } = require('../config/constants');

const REQUIRED_PERMISSIONS = {
  ViewChannel: true,
  SendMessages: true,
  EmbedLinks: true,
  AttachFiles: true,
  ReadMessageHistory: true
};

const PERMISSION_NAME_BY_BIT = Object.fromEntries(
  Object.entries(PermissionFlagsBits).map(([name, value]) => [value, name])
);

function getPermissionNames(bits) {
  return bits.map((bit) => PERMISSION_NAME_BY_BIT[bit] || String(bit));
}

function filterPermissionBits(permissionBits, permissions) {
  if (!permissions) return [];
  return permissionBits.filter((bit) => permissions.has(bit));
}

function buildPermissionObject(bits, value) {
  return bits.reduce((acc, bit) => {
    const name = PERMISSION_NAME_BY_BIT[bit];
    if (name) {
      acc[name] = value;
    }
    return acc;
  }, {});
}

async function setChannelPermissions(channel, botMember) {
  try {
    if (!channel || !channel.id) {
      return { success: false, error: 'Invalid channel' };
    }

    const botRole = botMember.roles.botRole || botMember.roles.highest;
    
    if (!botRole) {
      return { success: false, error: 'Bot has no roles' };
    }

    const canManage = channel.permissionsFor(botMember).has(PermissionFlagsBits.ManageChannels);
    
    if (!canManage) {
      return { 
        success: false, 
        error: 'Bot lacks ManageChannels permission. This feature requires the bot to have "Manage Channels" permission.' 
      };
    }

    const originalOverwrites = channel.permissionOverwrites.cache.get(botRole.id);
    
    logger.info('Setting channel permissions', {
      channelId: channel.id,
      channelName: channel.name,
      guildId: channel.guild.id,
      botRoleId: botRole.id,
      hadExistingOverwrites: !!originalOverwrites
    });

    await channel.permissionOverwrites.edit(botRole, REQUIRED_PERMISSIONS, {
      reason: 'NA Schedule Bot: Auto-configuration of required permissions'
    });

    logger.info('Successfully set channel permissions', {
      channelId: channel.id,
      channelName: channel.name,
      guildId: channel.guild.id
    });

    return { success: true };

  } catch (error) {
    logger.error('Failed to set channel permissions', {
      error: error.message,
      channelId: channel?.id,
      channelName: channel?.name,
      guildId: channel?.guild?.id
    });

    return { 
      success: false, 
      error: `Failed to set permissions: ${error.message}` 
    };
  }
}

function canManageChannelPermissions(channel, botMember) {
  const permissions = channel.permissionsFor(botMember);
  return permissions && permissions.has(PermissionFlagsBits.ManageChannels);
}

async function removeChannelPermissions(channel, botMember) {
  try {
    const botRole = botMember.roles.botRole || botMember.roles.highest;
    
    if (!botRole) {
      return { success: false, error: 'Bot has no roles' };
    }

    await channel.permissionOverwrites.delete(botRole, {
      reason: 'NA Schedule Bot: Removing auto-configured permissions'
    });

    logger.info('Removed channel permission overwrites', {
      channelId: channel.id,
      guildId: channel.guild.id
    });

    return { success: true };

  } catch (error) {
    logger.error('Failed to remove channel permissions', {
      error: error.message,
      channelId: channel?.id
    });

    return { 
      success: false, 
      error: `Failed to remove permissions: ${error.message}` 
    };
  }
}

async function createScheduleChannel(guild, raidType, botMember, options = {}) {
  try {
    if (!guild || !raidType || !botMember) {
      return { success: false, error: 'Missing required parameters' };
    }

    const raidTypeKey = raidType.toUpperCase();

    const freshBotMember = await guild.members.fetchMe();
    const botPermissions = freshBotMember.permissions;
    
    logger.debug('Checking bot permissions for channel creation', {
      guildId: guild.id,
      hasManageChannels: botPermissions.has(PermissionFlagsBits.ManageChannels),
      hasManageRoles: botPermissions.has(PermissionFlagsBits.ManageRoles),
      hasAdministrator: botPermissions.has(PermissionFlagsBits.Administrator),
      rolePosition: freshBotMember.roles.highest.position,
      roleName: freshBotMember.roles.highest.name,
      roleId: freshBotMember.roles.highest.id,
      permissions: botPermissions.toArray()
    });
    
    if (!botPermissions.has(PermissionFlagsBits.ManageChannels) && !botPermissions.has(PermissionFlagsBits.Administrator)) {
      return {
        success: false,
        error: 'Bot lacks "Manage Channels" permission. Please check Server Settings → Roles → NA Forays Schedule, or re-invite the bot with updated permissions.'
      };
    }

    if (freshBotMember.roles.highest.position <= 1) {
      logger.warn('Bot role position too low for channel creation', {
        guildId: guild.id,
        rolePosition: freshBotMember.roles.highest.position,
        roleName: freshBotMember.roles.highest.name
      });
      
      return {
        success: false,
        error: 'Bot role is too low in the role hierarchy (position ≤1). Please go to Server Settings → Roles and drag the bot\'s role higher in the list, then try again.'
      };
    }

    logger.info('Bot role position check passed', {
      guildId: guild.id,
      rolePosition: freshBotMember.roles.highest.position,
      roleName: freshBotMember.roles.highest.name
    });

    const channelName = options.name || DEFAULT_SCHEDULE_CHANNEL_NAMES[raidTypeKey] || `na-forays-${raidType.toLowerCase()}`;
    const topic = options.topic || `Automated ${raidType} schedule updates from NA datacenter host servers`;
    const readOnly = options.readOnly !== false;

    logger.info('Creating schedule channel', {
      guildId: guild.id,
      guildName: guild.name,
      raidType,
      channelName,
      readOnly,
      categoryId: options.categoryId || null,
      botMemberId: freshBotMember.id
    });

    let channel;
    let permissionsSetDuringCreation = false;
    
    try {
      const baseBotAllow = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ReadMessageHistory
      ];
      const botAllow = filterPermissionBits(baseBotAllow, botPermissions);
      const missingBotAllow = baseBotAllow.filter((bit) => !botAllow.includes(bit));

      if (!botAllow.includes(PermissionFlagsBits.ManageChannels)) {
        throw new Error('Bot lacks ManageChannels in guild permissions');
      }

      if (missingBotAllow.length > 0) {
        logger.warn('Skipping bot overwrite permissions not granted to bot', {
          guildId: guild.id,
          missingPermissions: getPermissionNames(missingBotAllow)
        });
      }

      const permissionOverwrites = [
        {
          id: freshBotMember.id,
          type: OverwriteType.Member,
          allow: botAllow
        }
      ];

      if (readOnly) {
        const baseEveryoneDeny = [
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.SendMessagesInThreads,
          PermissionFlagsBits.CreatePublicThreads,
          PermissionFlagsBits.CreatePrivateThreads
        ];
        const everyoneDeny = filterPermissionBits(baseEveryoneDeny, botPermissions);
        const missingEveryoneDeny = baseEveryoneDeny.filter((bit) => !everyoneDeny.includes(bit));

        if (missingEveryoneDeny.length > 0) {
          logger.warn('Skipping @everyone deny permissions not granted to bot', {
            guildId: guild.id,
            missingPermissions: getPermissionNames(missingEveryoneDeny)
          });
        }

        if (everyoneDeny.length > 0) {
          permissionOverwrites.push({
            id: guild.roles.everyone.id,
            type: OverwriteType.Role,
            deny: everyoneDeny
          });
        } else {
          logger.warn('Read-only requested but no valid deny permissions available', {
            guildId: guild.id,
            channelName
          });
        }
      }

      channel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        topic: topic,
        parent: options.categoryId || null,
        permissionOverwrites: permissionOverwrites,
        reason: `NA Schedule Bot: Creating ${raidType} schedule channel`
      });
      
      permissionsSetDuringCreation = true;
      
    } catch (permError) {
      logger.warn('Could not create channel with permission overwrites, trying without', {
        error: permError.message,
        code: permError.code,
        guildId: guild.id
      });
      
      channel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        topic: topic,
        parent: options.categoryId || null,
        reason: `NA Schedule Bot: Creating ${raidType} schedule channel`
      });
    }

    logger.info('Channel created with permissions', {
      channelId: channel.id,
      channelName: channel.name,
      guildId: guild.id,
      readOnly,
      botMemberId: freshBotMember.id,
      permissionsSetDuringCreation
    });

    return { 
      success: true, 
      channel,
      permissionsSet: permissionsSetDuringCreation
    };

  } catch (error) {
    logger.error('Failed to create schedule channel', {
      error: error.message,
      code: error.code,
      stack: error.stack,
      guildId: guild?.id,
      raidType
    });

    let errorMessage = 'Failed to create channel';
    
    if (error.code === 50013) {
      const freshBotMember = await guild.members.fetchMe();
      errorMessage = 
        'Missing Permissions: The bot\'s role is too low in the hierarchy or lacks Administrator permission. ' +
        'Go to Server Settings → Roles and drag "' + (freshBotMember?.roles?.highest?.name || 'the bot\'s role') + '" higher in the list (ideally near the top), then try again.';
    } else if (error.code === 50035) {
      errorMessage = 'Invalid channel configuration. Please try again or use an existing channel.';
    } else if (error.code === 30013) {
      errorMessage = 'Server has reached maximum channel limit. Please use an existing channel.';
    } else {
      errorMessage = `Failed to create channel: ${error.message}`;
    }

    return {
      success: false,
      error: errorMessage
    };
  }
}

async function canCreateChannels(guild, botMember) {
  if (!guild || !botMember) {
    return { canCreate: false, reason: 'Missing guild or bot member' };
  }
  
  try {
    const freshMember = await guild.members.fetchMe();
    const permissions = freshMember.permissions;
    
    if (!permissions || !permissions.has(PermissionFlagsBits.ManageChannels)) {
      return { 
        canCreate: false, 
        reason: 'Bot lacks "Manage Channels" permission' 
      };
    }
    
    if (freshMember.roles.highest.position <= 1) {
      return { 
        canCreate: false, 
        reason: `Bot role "${freshMember.roles.highest.name}" is too low in the role hierarchy (position ${freshMember.roles.highest.position}).`
      };
    }
    
    return { canCreate: true };
    
  } catch (error) {
    logger.error('Error checking channel creation permissions', {
      error: error.message,
      guildId: guild?.id
    });
    return { 
      canCreate: false, 
      reason: `Error checking permissions: ${error.message}` 
    };
  }
}

async function lockdownChannel(channel, botMember) {
  if (!channel || !botMember) {
    return { success: false, error: 'Missing channel or bot member' };
  }

  try {
    const freshBotMember = await channel.guild.members.fetchMe();
    
    const channelPermissions = channel.permissionsFor(freshBotMember);
    
    if (!channelPermissions || !channelPermissions.has(PermissionFlagsBits.ManageChannels)) {
      return { 
        success: false, 
        error: 'Bot lacks ManageChannels permission in this channel' 
      };
    }

    logger.info('Attempting to lock down channel', {
      channelId: channel.id,
      channelName: channel.name,
      guildId: channel.guild.id,
      botMemberId: freshBotMember.id,
      hasManageChannelsInChannel: channelPermissions.has(PermissionFlagsBits.ManageChannels)
    });

    const baseBotAllow = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.ManageChannels,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.ReadMessageHistory
    ];
    const botAllow = filterPermissionBits(baseBotAllow, channelPermissions);
    const missingBotAllow = baseBotAllow.filter((bit) => !botAllow.includes(bit));

    if (!botAllow.includes(PermissionFlagsBits.ManageChannels)) {
      return { success: false, error: 'Bot lacks ManageChannels permission in this channel' };
    }

    if (missingBotAllow.length > 0) {
      logger.warn('Skipping bot overwrite permissions not granted in channel', {
        channelId: channel.id,
        missingPermissions: getPermissionNames(missingBotAllow)
      });
    }

    await channel.permissionOverwrites.edit(
      freshBotMember.id,
      buildPermissionObject(botAllow, true),
      { reason: 'NA Schedule Bot: Ensuring bot permissions in channel' }
    );

    logger.info('Bot member permissions set in channel', {
      channelId: channel.id,
      botMemberId: freshBotMember.id
    });

    const baseEveryoneDeny = [
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.SendMessagesInThreads,
      PermissionFlagsBits.CreatePublicThreads,
      PermissionFlagsBits.CreatePrivateThreads
    ];
    const everyoneDeny = filterPermissionBits(baseEveryoneDeny, channelPermissions);
    const missingEveryoneDeny = baseEveryoneDeny.filter((bit) => !everyoneDeny.includes(bit));

    if (missingEveryoneDeny.length > 0) {
      logger.warn('Skipping @everyone deny permissions not granted in channel', {
        channelId: channel.id,
        missingPermissions: getPermissionNames(missingEveryoneDeny)
      });
    }

    if (everyoneDeny.length > 0) {
      await channel.permissionOverwrites.edit(
        channel.guild.roles.everyone.id,
        buildPermissionObject(everyoneDeny, false),
        { reason: 'NA Schedule Bot: Making channel read-only' }
      );
    } else {
      logger.warn('Read-only requested but no valid deny permissions available in channel', {
        channelId: channel.id
      });
    }

    logger.info('Successfully locked down channel', {
      channelId: channel.id,
      channelName: channel.name,
      guildId: channel.guild.id
    });

    return { success: true };

  } catch (error) {
    logger.warn('Failed to lock down channel', {
      error: error.message,
      code: error.code,
      channelId: channel?.id,
      guildId: channel?.guild?.id
    });

    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  REQUIRED_PERMISSIONS,
  setChannelPermissions,
  canManageChannelPermissions,
  removeChannelPermissions,
  createScheduleChannel,
  canCreateChannels,
  lockdownChannel
};