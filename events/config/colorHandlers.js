// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const { ModalBuilder, TextInputBuilder, TextInputStyle, LabelBuilder } = require('discord.js');
const logger = require('../../utils/logger');
const encryptedDb = require('../../config/encryptedDatabase');
const serviceLocator = require('../../services/serviceLocator');
const { getColorFieldConfigs } = require('../../utils/raidTypes');

/**
 * Show the color settings modal
 */
async function showColorSettingsModal(interaction) {
  const guildId = interaction.guild.id;

  const config = await encryptedDb.getServerConfig(guildId) || {};
  
  logger.debug('Color settings modal - raw config values', {
    guildId,
    ba: config.schedule_color_ba,
    ft: config.schedule_color_ft,
    drs: config.schedule_color_drs
  });
  
  const baColor = formatColorForInput(config.schedule_color_ba);
  const ftColor = formatColorForInput(config.schedule_color_ft);
  const drsColor = formatColorForInput(config.schedule_color_drs);

  const baInput = new TextInputBuilder()
    .setCustomId('color_ba')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('ex: #5865F2, 5865F2, none, or default')
    .setRequired(false)
    .setMaxLength(7)
    .setValue(baColor || '');

  const ftInput = new TextInputBuilder()
    .setCustomId('color_ft')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('ex: #57F287, 57F287, none, or default')
    .setRequired(false)
    .setMaxLength(7)
    .setValue(ftColor || '');

  const drsInput = new TextInputBuilder()
    .setCustomId('color_drs')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('ex: #ED4245, ED4245, none, or default')
    .setRequired(false)
    .setMaxLength(7)
    .setValue(drsColor || '');

  const baLabel = new LabelBuilder()
    .setLabel('BA Color (hex)')
    .setTextInputComponent(baInput);

  const ftLabel = new LabelBuilder()
    .setLabel('FT Color (hex)')
    .setTextInputComponent(ftInput);

  const drsLabel = new LabelBuilder()
    .setLabel('DRS Color (hex)')
    .setTextInputComponent(drsInput);

  const modal = new ModalBuilder()
    .setCustomId('config_color_modal')
    .setTitle('Schedule Accent Colors')
    .addLabelComponents(baLabel, drsLabel, ftLabel);

  await interaction.showModal(modal);
}

async function saveColorSettings(interaction) {
  const updateManager = serviceLocator.get('updateManager');
  const guildId = interaction.guild.id;

  try {
    const currentConfig = await encryptedDb.getServerConfig(guildId) || {};
    
    const baColor = interaction.fields.getTextInputValue('color_ba').trim();    
    const drsColor = interaction.fields.getTextInputValue('color_drs').trim();
    const ftColor = interaction.fields.getTextInputValue('color_ft').trim();

    const { updateData, changedRaidTypes, errors } = validateAndParseColors(
      { ba: baColor, ft: ftColor, drs: drsColor },
      currentConfig
    );

    if (errors.length > 0) {
      await interaction.reply({
        content: `❌ **Invalid color format:**\n${errors.join('\n')}\n\nPlease use hex format: #RRGGBB or RRGGBB`,
        flags: 64
      });
      return;
    }

    if (Object.keys(updateData).length === 0) {
      await interaction.reply({
        content: '❌ No color changes provided.',
        flags: 64
      });
      return;
    }

    await encryptedDb.updateServerConfig(guildId, updateData);

    logger.info('Color settings updated', {
      guildId,
      colors: { ba: baColor, ft: ftColor, drs: drsColor }
    });

    const successText = buildColorSuccessMessage({ ba: baColor, ft: ftColor, drs: drsColor });

    await interaction.reply({
      content: successText,
      flags: 64
    });

    await updateSchedulesWithNewColors(interaction, updateManager, guildId, changedRaidTypes);

  } catch (error) {
    logger.error('Error saving color settings', {
      error: error.message,
      stack: error.stack,
      guildId
    });

    await interaction.reply({
      content: `❌ Error saving color settings: ${error.message}`,
      flags: 64
    });
  }
}

function formatColorForInput(colorValue) {
  if (colorValue === null || colorValue === undefined) return '';
  const numValue = typeof colorValue === 'string' ? parseInt(colorValue, 10) : colorValue;
  if (numValue === -1) return '';
  if (typeof numValue === 'number' && numValue >= 0) {
    return '#' + numValue.toString(16).padStart(6, '0').toUpperCase();
  }
  return '';
}

function parseHexColor(hexColor) {
  if (!hexColor) return null;
  
  const lowerValue = hexColor.toLowerCase().trim();
  
  if (lowerValue === 'none') {
    return null;
  }
  
  if (lowerValue === 'default') {
    return -1;
  }
  
  let hex = hexColor.startsWith('#') ? hexColor.slice(1) : hexColor;
  
  if (!/^[0-9A-Fa-f]{6}$/.test(hex)) {
    return null;
  }
  
  return parseInt(hex, 16);
}

function validateAndParseColors(colors, currentConfig) {
  const errors = [];
  const updateData = {};
  const changedRaidTypes = [];

  const colorMap = getColorFieldConfigs();

  for (const { key, configKey, raidType } of colorMap) {
    const colorValue = colors[key];
    if (!colorValue) continue;

    const parsed = parseHexColor(colorValue);
    const lowerValue = colorValue.toLowerCase();

    if (lowerValue !== 'none' && lowerValue !== 'default' && parsed === null) {
      errors.push(`${raidType} color is invalid`);
    } else {
      const currentValue = typeof currentConfig[configKey] === 'string' 
        ? parseInt(currentConfig[configKey], 10) 
        : currentConfig[configKey];
      
      if (parsed !== currentValue) {
        updateData[configKey] = parsed;
        changedRaidTypes.push(raidType);
      }
    }
  }

  return { updateData, changedRaidTypes, errors };
}

function buildColorSuccessMessage(colors) {
  const colorMessages = [];
  
  if (colors.ba) colorMessages.push(`**BA:** ${colors.ba}`);
  if (colors.ft) colorMessages.push(`**FT:** ${colors.ft}`);
  if (colors.drs) colorMessages.push(`**DRS:** ${colors.drs}`);

  let successText = '✅ **Color settings saved!**\n\n';
  if (colorMessages.length > 0) {
    successText += colorMessages.join('\n') + '\n';
  } else {
    successText += 'All colors cleared (using default).\n';
  }
  successText += '\nSchedules are updating...';

  return successText;
}

async function updateSchedulesWithNewColors(interaction, updateManager, guildId, changedRaidTypes) {
  try {
    if (changedRaidTypes.length > 0) {
      for (const raidType of changedRaidTypes) {
        await updateManager.regenerateSchedule(guildId, raidType);
      }
      
      await interaction.editReply({
        content: '✅ **Completed!** Schedules updated with new colors.'
      }).catch(() => {});
    } else {
      await interaction.editReply({
        content: '✅ **No changes detected.** Colors remain the same.'
      }).catch(() => {});
    }
    
    setTimeout(async () => {
      await interaction.deleteReply().catch(() => {});
    }, 3000);
    
  } catch (err) {
    logger.error('Error updating schedules after color change', {
      error: err.message,
      guildId
    });
    
    await interaction.editReply({
      content: '⚠️ Colors saved but schedules failed to update. Try refreshing manually.'
    }).catch(() => {});
  }
}

module.exports = {
  showColorSettingsModal,
  saveColorSettings,
  parseHexColor
};
