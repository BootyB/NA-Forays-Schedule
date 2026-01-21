// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const logger = require('../utils/logger');

module.exports = {
  name: 'guildCreate',
  async execute(guild) {
    logger.info('Bot added to new guild', {
      guildId: guild.id,
      guildName: guild.name,
      memberCount: guild.memberCount
    });

    try {
      const owner = await guild.fetchOwner();
      
      const welcomeMessage = 
        `👋 Welcome to **NA Forays Schedule**!\n\n` +
        `This bot displays FFXIV NA datacenter raid schedules from multiple host servers.\n\n` +
        `**To get started:**\n` +
        `1. Run \`/na-schedule\` in your server\n` +
        `2. Choose which raid types to display (BA/FT/DRS)\n` +
        `3. Select channels for each raid type\n` +
        `4. Choose which host servers to include\n\n` +
        `Schedules will automatically update every 60 seconds.\n\n`;

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
