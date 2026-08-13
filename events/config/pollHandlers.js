// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const { ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const encryptedDb = require('../../config/encryptedDatabase');
const serviceLocator = require('../../services/serviceLocator');
const { getPollsForRaidConfig, getEnabledPollIdsForRaid, normalizeEnabledPolls } = require('../../services/pollConfig');
const { buildRaidConfigContainer } = require('./menuHandlers');
const logger = require('../../utils/logger');

async function showPollChangeMenu(interaction, raidType) {
  const config = await encryptedDb.getServerConfig(interaction.guild.id);
  const polls = getPollsForRaidConfig(raidType);
  const enabledPollIds = getEnabledPollIdsForRaid(config?.enabled_polls, raidType);

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${raidType} Polls\n\nChoose which poll result panels should appear on this raid schedule overview.`)
  );

  if (polls.length === 0) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('No polls are configured for this raid type.')
    );
  } else {
    const select = new StringSelectMenuBuilder()
      .setCustomId(`config_save_polls_${raidType.toLowerCase()}`)
      .setPlaceholder('Select polls to show')
      .setMinValues(0)
      .setMaxValues(polls.length)
      .addOptions(polls.map(poll => ({
        label: poll.title.slice(0, 100),
        description: poll.description.slice(0, 100),
        value: poll.id,
        default: enabledPollIds.includes(poll.id)
      })));

    container.addActionRowComponents(new ActionRowBuilder().addComponents(select));
  }

  const backButton = new ButtonBuilder()
    .setCustomId(`config_back_to_raid_${raidType.toLowerCase()}`)
    .setLabel('Back')
    .setStyle(ButtonStyle.Secondary);

  container.addActionRowComponents(new ActionRowBuilder().addComponents(backButton));

  await interaction.update({
    components: [container],
    flags: 1 << 15
  });
}

async function savePollChanges(interaction, raidType) {
  const guildId = interaction.guild.id;
  const config = await encryptedDb.getServerConfig(guildId);
  const enabledPolls = normalizeEnabledPolls(config?.enabled_polls);
  const validPollIds = new Set(getPollsForRaidConfig(raidType).map(poll => poll.id));
  enabledPolls[raidType] = interaction.values.filter(pollId => validPollIds.has(pollId));

  await encryptedDb.updateServerConfig(guildId, { enabled_polls: enabledPolls });

  const hostsKey = `enabled_hosts_${raidType.toLowerCase()}`;
  const container = buildRaidConfigContainer(
    raidType,
    config?.[hostsKey] || [],
    'Poll settings saved. Regenerating schedule overview...',
    { ...config, enabled_polls: enabledPolls }
  );

  await interaction.update({
    components: [container],
    flags: 1 << 15
  });

  if (serviceLocator.has('updateManager')) {
    serviceLocator.get('updateManager').regenerateSchedule(guildId, raidType).catch(error => {
      logger.error('Error regenerating schedule after poll config change', { guildId, raidType, error: error.message });
    });
  }
}

module.exports = {
  showPollChangeMenu,
  savePollChanges
};
