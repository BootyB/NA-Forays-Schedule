// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const { MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder } = require('discord.js');
const logger = require('../utils/logger');
const { canConfigureBot } = require('../utils/permissions');
const { GOOGLE_CALENDAR_IDS } = require('../config/constants');
const rateLimiter = require('../utils/rateLimiter');
const { getServerEmoji, getGuildStats, HOST_SERVERS } = require('../config/hostServers');
const encryptedDb = require('../config/encryptedDatabase');
const { getEnabledHostsKey, getRaidTypeName } = require('../utils/raidTypes');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    if (interaction.isChatInputCommand()) {
      await handleSlashCommand(interaction);
    }
    
    else if (interaction.isButton()) {
      await handleButtonInteraction(interaction);
    }
    
    else if (interaction.isStringSelectMenu() || interaction.isChannelSelectMenu()) {
      await handleSelectMenuInteraction(interaction);
    }
    
    else if (interaction.isModalSubmit()) {
      await handleModalSubmit(interaction);
    }
  }
};

async function handleSlashCommand(interaction) {
  const command = interaction.client.commands.get(interaction.commandName);

  if (!command) {
    logger.warn('Unknown command', { commandName: interaction.commandName });
    return;
  }

  try {
    const rateLimitCheck = rateLimiter.checkCommandCooldown(interaction.user.id, interaction.commandName);
    if (!rateLimitCheck.allowed) {
      await interaction.reply({
        content: `⏱️ Please wait ${rateLimitCheck.timeLeft} second(s) before using this command again.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (['setup', 'configure'].includes(interaction.commandName)) {
      if (!canConfigureBot(interaction.member)) {
        await interaction.reply({
          content: '❌ You need **Manage Server** permission to use this command.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }
    }

    await command.execute(interaction);

    logger.info('Command executed', {
      command: interaction.commandName,
      user: interaction.user.tag,
      guild: interaction.guild?.name
    });

  } catch (error) {
    logger.error('Error executing command', {
      error: error.message,
      stack: error.stack,
      command: interaction.commandName,
      user: interaction.user.tag,
      guild: interaction.guild?.name
    });

    let errorContent = '❌ There was an error executing this command.';
    
    if (error.message.includes('Missing Permissions')) {
      errorContent = '❌ The bot lacks the required permissions to perform this action. Please ensure the bot has **View Channel**, **Send Messages**, and **Embed Links** permissions.';
    } else if (error.message.includes('Unknown Channel')) {
      errorContent = '❌ The configured channel no longer exists. Please reconfigure using `/na-schedule`.';
    } else if (error.message.includes('Unknown Message')) {
      errorContent = '❌ The schedule message was deleted. The bot will recreate it on the next update.';
    } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
      errorContent = '❌ Connection timeout. The bot is having trouble connecting to services. Please try again in a moment.';
    } else if (error.message.includes('database') || error.message.includes('Database')) {
      errorContent = '❌ Database error occurred. Please try again or contact the bot administrator if the issue persists.';
    }

    const errorMessage = {
      content: errorContent,
      flags: MessageFlags.Ephemeral
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorMessage);
    } else {
      await interaction.reply(errorMessage);
    }
  }
}

async function handleButtonInteraction(interaction) {
  const customId = interaction.customId;

  try {
    const rateLimitCheck = rateLimiter.checkInteractionCooldown(interaction.user.id, 'button');
    if (!rateLimitCheck.allowed) {
      await interaction.reply({
        content: '⏱️ You\'re clicking too fast! Please slow down.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (customId.startsWith('setup_')) {
      const { handleSetupInteraction } = require('./setupInteractions');
      await handleSetupInteraction(interaction);
    }
    
    else if (customId.startsWith('config_')) {
      const { handleConfigInteraction } = require('./config');
      await handleConfigInteraction(interaction);
    }
    
    else if (customId.startsWith('schedule_info_')) {
      await handleScheduleInfoButton(interaction);
    }
    
    else if (customId.startsWith('schedule_servers_')) {
      await handleScheduleServersButton(interaction);
    }
    
    else if (customId.startsWith('timezone_select_')) {
      await handleTimezoneSelect(interaction);
    }
    
    else {
      logger.warn('Unknown button interaction', { customId });
      await interaction.reply({
        content: '❌ This button interaction is not recognized.',
        flags: MessageFlags.Ephemeral
      });
    }

  } catch (error) {
    logger.error('Error handling button', {
      error: error.message,
      stack: error.stack,
      customId,
      userId: interaction.user.id
    });

    const errorContent = error.message.includes('Unknown interaction') 
      ? '❌ This interaction has expired. Please run the command again.'
      : '❌ An error occurred processing this button. Please try again.';

    await interaction.reply({
      content: errorContent,
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
  }
}

async function handleSelectMenuInteraction(interaction) {
  const customId = interaction.customId;

  try {
    const rateLimitCheck = rateLimiter.checkInteractionCooldown(interaction.user.id, 'selectmenu');
    if (!rateLimitCheck.allowed) {
      await interaction.reply({
        content: '⏱️ Please wait a moment before making another selection.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (customId.startsWith('setup_')) {
      const { handleSetupInteraction } = require('./setupInteractions');
      await handleSetupInteraction(interaction);
    }
    
    else if (customId.startsWith('config_')) {
      const { handleConfigInteraction } = require('./config');
      await handleConfigInteraction(interaction);
    }
    
    else if (customId.startsWith('timezone_select_')) {
      await handleTimezoneSelect(interaction);
    }
    
    else {
      logger.warn('Unknown select menu interaction', { customId });
      await interaction.reply({
        content: '❌ This menu interaction is not recognized.',
        flags: MessageFlags.Ephemeral
      });
    }

  } catch (error) {
    logger.error('Error handling select menu', {
      error: error.message,
      stack: error.stack,
      customId,
      userId: interaction.user.id
    });

    const errorContent = error.message.includes('Unknown interaction')
      ? '❌ This interaction has expired. Please run the command again.'
      : '❌ An error occurred processing this menu. Please try again.';

    await interaction.reply({
      content: errorContent,
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
  }
}

async function handleScheduleInfoButton(interaction) {
  const container = new ContainerBuilder();
  
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('## About This Schedule\n\n')
  );

  container.addSeparatorComponents(
    new SeparatorBuilder()
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      'This schedule aggregates runs from participating Discord servers, automatically tracking announcements, edits, and cancellations.\n\n' +
      '**How It Works**\n' +
      '• Runs are tracked from official announcement channels\n' +
      '• Edits to the original post update the schedule in real-time\n' +
      '• Deleted posts are interpreted as cancellations\n' +
      '• Some servers may have unlisted or private runs not shown here\n\n' +
      '**Important Notes**\n' +
      '• All times are displayed in your local timezone\n' +
      '• Always verify details with the host server before joining\n' +
      '• Run details and requirements may change\n\n'      
    )
  );

  container.addSeparatorComponents(
    new SeparatorBuilder()
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# Questions or corrections? Contact <@${process.env.BOT_OWNER_ID}>`)
  );

  await interaction.reply({
    components: [container],
    flags: 64 | 32768
  });

  logger.debug('Displayed schedule info', { 
    user: interaction.user.tag,
    guild: interaction.guild?.name 
  });
}

async function handleScheduleServersButton(interaction) {
  const raidType = interaction.customId.split('_')[2].toUpperCase();
  const guildId = interaction.guild.id;
  
  try {
    const config = await encryptedDb.getServerConfig(guildId);
    const hostsKey = getEnabledHostsKey(raidType);
    const enabledHosts = (config[hostsKey] || []).sort();
    
    if (enabledHosts.length === 0) {
      await interaction.reply({
        content: '❌ No servers are configured for this raid type.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    
    let currentServerName = 'this discord server';
    for (const [serverName, serverData] of Object.entries(HOST_SERVERS)) {
      if (serverData.guildId === guildId) {
        currentServerName = serverName;
        break;
      }
    }
    
    const guildStatsPromises = enabledHosts.map(serverName => 
      getGuildStats(serverName, interaction.client)
    );
    const guildStatsArray = await Promise.all(guildStatsPromises);
    
    const container = new ContainerBuilder();
    
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## Followed Servers - ${getRaidTypeName(raidType)}\n\nThese are the servers currently tracked for ${raidType} in ${currentServerName}.`)
    );
    
    container.addSeparatorComponents(
      new SeparatorBuilder()
    );
    
    for (let i = 0; i < enabledHosts.length; i++) {
      const serverName = enabledHosts[i];
      const serverData = HOST_SERVERS[serverName];
      if (!serverData) continue;
      
      const emoji = getServerEmoji(serverName);
      const emojiString = emoji ? `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>` : '';
      
      const guildStats = guildStatsArray[i];
      const fullName = guildStats?.name || serverName;
      const acronym = serverData.acronym || serverName;      
      const displayName = fullName !== acronym ? `${fullName} (${acronym})` : acronym;
      
      let serverText = `${emojiString} **${displayName}**\n`;
      
      if (serverData.description || guildStats?.description) {
        serverText += `-# *${guildStats?.description || serverData.description}*\n`;
      }
      
      if (guildStats?.memberCount) {
        const memberText = guildStats.fromInvite 
          ? `~${guildStats.memberCount.toLocaleString()}` 
          : `${guildStats.memberCount.toLocaleString()}`;
        serverText += `-# 👥 ${memberText} members`;
        
        if (guildStats.onlineCount) {
          serverText += ` • 🟢 ${guildStats.onlineCount.toLocaleString()} online`;
        }
        serverText += '\n';
      }
      
      if (serverData.inviteLink) {
        serverText += `[Join Server](${serverData.inviteLink})\n`;
      }
      
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(serverText)
      );
    }
    
    container.addSeparatorComponents(
      new SeparatorBuilder()
    );
    
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`-# All server info fetched from the respective server's publicly available discord invite.`)
    );
    
    await interaction.reply({
      components: [container],
      flags: 64 | 32768
    });
    
    logger.debug('Displayed represented servers', {
      user: interaction.user.tag,
      guild: interaction.guild?.name,
      raidType,
      serverCount: enabledHosts.length
    });
    
  } catch (error) {
    logger.error('Error displaying represented servers', {
      error: error.message,
      stack: error.stack,
      raidType,
      guildId
    });
    
    await interaction.reply({
      content: '❌ An error occurred while loading server information.',
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
  }
}

async function handleTimezoneSelect(interaction) {
  const selectedTimezone = interaction.values[0];
  const raidType = interaction.customId.split('_')[2].toUpperCase();
  
  const calendarId = GOOGLE_CALENDAR_IDS[raidType];
  if (!calendarId) {
    await interaction.reply({
      content: '❌ Calendar not available for this raid type.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }
  
  const calendarUrl = `https://calendar.google.com/calendar/embed?src=${calendarId}&ctz=${encodeURIComponent(selectedTimezone)}`;
  
  const timezoneOption = interaction.component.options.find(opt => opt.value === selectedTimezone);
  const timezoneName = timezoneOption?.label || selectedTimezone;
  
  await interaction.reply({
    content: `📅 **${raidType} Calendar - ${timezoneName}**\n\n[Click here to view the calendar](${calendarUrl})`,
    flags: MessageFlags.Ephemeral
  });

  logger.debug('Generated timezone calendar link', { 
    user: interaction.user.tag,
    raidType,
    timezone: selectedTimezone
  });
}

async function handleModalSubmit(interaction) {
  const customId = interaction.customId;

  if (!canConfigureBot(interaction.member)) {
    await interaction.reply({
      content: '❌ You need **Manage Server** permission to configure the bot.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  try {
    if (customId === 'config_color_modal') {
      const { handleConfigInteraction } = require('./config');
      await handleConfigInteraction(interaction);
    }
  } catch (error) {
    logger.error('Error handling modal submit', {
      error: error.message,
      stack: error.stack,
      customId,
      user: interaction.user.tag,
      guild: interaction.guild?.name
    });

    try {
      const response = {
        content: '❌ An error occurred processing your submission. Please try again.',
        flags: MessageFlags.Ephemeral
      };
      
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(response);
      } else {
        await interaction.reply(response);
      }
    } catch (replyError) {
      logger.error('Could not send error message', { error: replyError.message });
    }
  }
}
