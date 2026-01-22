// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const logger = require('../utils/logger');
const serviceLocator = require('../services/serviceLocator');

module.exports = {
  name: 'guildCreate',
  async execute(guild) {
    logger.info('Bot added to new guild', {
      guildId: guild.id,
      guildName: guild.name,
      memberCount: guild.memberCount
    });

    const whitelistManager = serviceLocator.get('whitelistManager');

    const isWhitelisted = await whitelistManager.isGuildWhitelisted(guild.id);

    if (!isWhitelisted) {
      logger.warn('Non-whitelisted guild detected', {
        guildId: guild.id,
        guildName: guild.name
      });

      try {
        const owner = await guild.fetchOwner();
        
        const message = 
          `👋 Hello! Thank you for adding the NA Forays Schedule Bot.\n\n` +
          `⚠️ **This bot is currently in private beta.**\n\n` +
          `To use this bot, please contact the bot owner, <@${process.env.BOT_OWNER_ID}>, to request access. ` +
          `Once your server is whitelisted, you can run \`/na-schedule\` to configure schedule displays.\n\n` +
          `For now, the bot will remain in your server but will not function until whitelisted.`;

        await owner.send(message).catch(() => {
          if (guild.systemChannel) {
            guild.systemChannel.send(message).catch(() => {
              logger.warn('Could not send whitelist message', { guildId: guild.id });
            });
          }
        });

      } catch (error) {
        logger.error('Error sending whitelist notification', {
          error: error.message,
          guildId: guild.id
        });
      }


      return;
    }

    try {
      const owner = await guild.fetchOwner();
      const botMember = await guild.members.fetchMe();
      const rolePosition = botMember.roles.highest.position;
      
      let welcomeMessage = 
        `👋 Welcome to **NA Forays Schedule**!\n\n` +
        `This bot displays FFXIV NA datacenter raid schedules from multiple host servers.\n\n` +
        `**To get started:**\n` +
        `1. Run \`/na-schedule\` in your server\n` +
        `2. Choose which raid types to display (BA/FT/DRS)\n` +
        `3. Select channels for each raid type\n` +
        `4. Choose which host servers to include\n\n` +
        `Schedules will automatically update every 60 seconds.\n\n`;
      
      if (rolePosition <= 1) {
        welcomeMessage +=
          `⚠️ **Setup Tip:**\n` +
          `For the best experience (automatic channel creation), please move the bot's role higher:\n` +
          `• Go to **Server Settings** → **Roles**\n` +
          `• Find **${botMember.roles.highest.name}**\n` +
          `• Drag it higher in the list (above @everyone)\n\n` +
          `This is optional but recommended for easier setup!\n\n`;
      }

      await owner.send(welcomeMessage).catch(() => {
        if (guild.systemChannel) {
          guild.systemChannel.send(welcomeMessage).catch(() => {
            logger.warn('Could not send welcome message', { guildId: guild.id });
          });
        }
      });

    } catch (error) {
      logger.error('Error sending welcome message', {
        error: error.message,
        guildId: guild.id
      });
    }
  }
};
