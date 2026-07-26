// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const { ContainerBuilder, TextDisplayBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const encryptedDb = require('../../config/encryptedDatabase');
const logger = require('../../utils/logger');
const serviceLocator = require('../../services/serviceLocator');
const { showRaidConfig } = require('./menuHandlers');
const { getFtVariantOptions, normalizeEnabledFtVariants, validateEnabledFtVariants } = require('../../utils/ftVariants');

async function showFtVariantChangeMenu(interaction) {
  const guildId = interaction.guild.id;
  const config = await encryptedDb.getServerConfig(guildId);
  const currentVariants = normalizeEnabledFtVariants(config?.enabled_ft_variants);

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## Change Forked Tower Raids\n\n` +
      `Select which Forked Tower schedules to display. At least one must remain enabled.`
    )
  );

  const variantSelect = new StringSelectMenuBuilder()
    .setCustomId('config_save_ft_variants')
    .setPlaceholder('Select Forked Tower raids')
    .setMinValues(1)
    .setMaxValues(2)
    .addOptions(getFtVariantOptions(currentVariants));

  const cancelButton = new ButtonBuilder()
    .setCustomId('config_back_to_raid_ft')
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Secondary);

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(variantSelect)
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(cancelButton)
  );

  await interaction.update({
    components: [container],
    flags: 64 | 32768
  });
}

async function saveFtVariantChanges(interaction) {
  const guildId = interaction.guild.id;
  const updateManager = serviceLocator.get('updateManager');
  const selectedVariants = normalizeEnabledFtVariants(interaction.values);

  try {
    await interaction.deferUpdate();

    if (!validateEnabledFtVariants(interaction.values)) {
      const errorContainer = new ContainerBuilder();
      errorContainer.addTextDisplayComponents(
        new TextDisplayBuilder().setContent('? Invalid Forked Tower raid selection. Please choose Blood, Magic, or both.')
      );
      await interaction.editReply({
        components: [errorContainer],
        flags: 64 | 32768
      });
      return;
    }

    await encryptedDb.updateServerConfig(guildId, {
      enabled_ft_variants: selectedVariants
    });

    logger.info('FT variants updated', {
      guildId,
      variants: selectedVariants
    });

    await showRaidConfig(interaction, 'FT', true);

    updateManager.forceUpdate(guildId).catch(err => {
      logger.error('Error in background schedule update after FT variant change', {
        error: err.message,
        guildId
      });
    });
  } catch (error) {
    logger.error('Error saving FT variant changes', {
      error: error.message,
      guildId
    });

    const errorContainer = new ContainerBuilder();
    errorContainer.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('? Error saving Forked Tower raid settings. Please try again.')
    );

    await interaction.editReply({
      components: [errorContainer],
      flags: 1 << 15
    }).catch(() => {});
  }
}

module.exports = {
  showFtVariantChangeMenu,
  saveFtVariantChanges
};
