// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const { ModalBuilder, TextInputBuilder, TextInputStyle, LabelBuilder } = require('discord.js');
const logger = require('../../utils/logger');
const encryptedDb = require('../../config/encryptedDatabase');
const serviceLocator = require('../../services/serviceLocator');
const { FT_CHANNEL_MODES, normalizeFtChannelMode } = require('../../utils/ftVariants');

const FT_VARIANT_COLOR_INHERIT = -2;

function getColorFieldConfig(currentConfig = {}) {
  const ftChannelMode = normalizeFtChannelMode(currentConfig.ft_channel_mode);
  const fields = [
    { key: 'ba', customId: 'color_ba', configKey: 'schedule_color_ba', raidType: 'BA', label: 'BA Color (hex)', placeholder: 'ex: #5865F2, 5865F2, none, or default' },
    { key: 'drs', customId: 'color_drs', configKey: 'schedule_color_drs', raidType: 'DRS', label: 'DRS Color (hex)', placeholder: 'ex: #ED4245, ED4245, none, or default' }
  ];

  if (ftChannelMode === FT_CHANNEL_MODES.Separate) {
    fields.push(
      { key: 'ftBlood', customId: 'color_ft_blood', configKey: 'schedule_color_ft_blood', raidType: 'FT', ftVariant: 'Blood', label: 'FTB Color (hex)', placeholder: 'ex: #57F287, none, default, or inherit', allowInherit: true, hashAwareUpdate: true },
      { key: 'ftMagic', customId: 'color_ft_magic', configKey: 'schedule_color_ft_magic', raidType: 'FT', ftVariant: 'Magic', label: 'FTM Color (hex)', placeholder: 'ex: #EB459E, none, default, or inherit', allowInherit: true, hashAwareUpdate: true }
    );
  } else {
    fields.push({ key: 'ft', customId: 'color_ft', configKey: 'schedule_color_ft', raidType: 'FT', label: 'FT Color (hex)', placeholder: 'ex: #57F287, 57F287, none, or default' });
  }

  return fields;
}

function makeColorInput(field, config) {
  return new TextInputBuilder()
    .setCustomId(field.customId)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(field.placeholder)
    .setRequired(false)
    .setMaxLength(7)
    .setValue(formatColorForInput(config[field.configKey]) || '');
}

/**
 * Show the color settings modal
 */
async function showColorSettingsModal(interaction) {
  const guildId = interaction.guild.id;
  const config = await encryptedDb.getServerConfig(guildId) || {};
  const fields = getColorFieldConfig(config);
  const ftChannelMode = normalizeFtChannelMode(config.ft_channel_mode);

  logger.debug('Color settings modal - raw config values', {
    guildId,
    ftChannelMode,
    ba: config.schedule_color_ba,
    ft: config.schedule_color_ft,
    ftBlood: config.schedule_color_ft_blood,
    ftMagic: config.schedule_color_ft_magic,
    drs: config.schedule_color_drs
  });

  const labels = fields.map((field) => new LabelBuilder()
    .setLabel(field.label)
    .setTextInputComponent(makeColorInput(field, config)));

  const modal = new ModalBuilder()
    .setCustomId('config_color_modal')
    .setTitle(ftChannelMode === FT_CHANNEL_MODES.Separate ? 'Schedule Accent Colors - Split FT' : 'Schedule Accent Colors')
    .addLabelComponents(...labels);

  await interaction.showModal(modal);
}

function getSubmittedValue(interaction, customId) {
  try {
    return interaction.fields.getTextInputValue(customId).trim();
  } catch (error) {
    return '';
  }
}

/**
 * Save color settings from modal submission
 */
async function saveColorSettings(interaction) {
  const updateManager = serviceLocator.get('updateManager');
  const guildId = interaction.guild.id;

  try {
    const currentConfig = await encryptedDb.getServerConfig(guildId) || {};
    const fields = getColorFieldConfig(currentConfig);
    const colors = {};

    for (const field of fields) {
      colors[field.key] = getSubmittedValue(interaction, field.customId);
    }

    const { updateData, changedColorTargets, errors } = validateAndParseColors(colors, currentConfig, fields);

    if (errors.length > 0) {
      await interaction.reply({
        content: `Invalid color format:\n${errors.join('\n')}\n\nPlease use hex format: #RRGGBB or RRGGBB. Split FT colors also accept inherit.`,
        flags: 64
      });
      return;
    }

    if (Object.keys(updateData).length === 0) {
      await interaction.reply({
        content: 'No color changes provided.',
        flags: 64
      });
      return;
    }

    await encryptedDb.updateServerConfig(guildId, updateData);

    logger.info('Color settings updated', {
      guildId,
      colors
    });

    const successText = buildColorSuccessMessage(colors, fields);

    await interaction.reply({
      content: successText,
      flags: 64
    });

    await updateSchedulesWithNewColors(interaction, updateManager, guildId, changedColorTargets);

  } catch (error) {
    logger.error('Error saving color settings', {
      error: error.message,
      stack: error.stack,
      guildId
    });

    await interaction.reply({
      content: `Error saving color settings: ${error.message}`,
      flags: 64
    });
  }
}

/**
 * Format a color value for display in input field
 */
function formatColorForInput(colorValue) {
  if (colorValue === null || colorValue === undefined) return '';
  const numValue = typeof colorValue === 'string' ? parseInt(colorValue, 10) : colorValue;
  if (numValue === -1 || numValue === FT_VARIANT_COLOR_INHERIT) return '';
  if (typeof numValue === 'number' && numValue >= 0) {
    return '#' + numValue.toString(16).padStart(6, '0').toUpperCase();
  }
  return '';
}

/**
 * Parse hex color string to integer value.
 * @returns {number|null} Parsed color or null if invalid/none, -1 for default.
 */
function parseHexColor(hexColor) {
  const parsed = parseColorInput(hexColor, { allowInherit: false });
  return parsed === FT_VARIANT_COLOR_INHERIT ? null : parsed;
}

function parseColorInput(hexColor, options = {}) {
  if (!hexColor) return null;

  const lowerValue = hexColor.toLowerCase().trim();

  if (lowerValue === 'none') {
    return null;
  }

  if (lowerValue === 'default') {
    return -1;
  }

  if (options.allowInherit && lowerValue === 'inherit') {
    return FT_VARIANT_COLOR_INHERIT;
  }

  const hex = hexColor.startsWith('#') ? hexColor.slice(1) : hexColor;

  if (!/^[0-9A-Fa-f]{6}$/.test(hex)) {
    return null;
  }

  return parseInt(hex, 16);
}

function isInvalidColorInput(colorValue, parsed, allowInherit) {
  const lowerValue = colorValue.toLowerCase().trim();
  if (lowerValue === 'none' || lowerValue === 'default') return false;
  if (allowInherit && lowerValue === 'inherit') return false;
  return parsed === null;
}

function addChangedColorTarget(targets, field) {
  const mode = field.hashAwareUpdate ? 'update' : 'regenerate';
  const raidType = field.raidType;
  const variant = field.ftVariant || null;

  const exists = targets.some((target) =>
    target.mode === mode && target.raidType === raidType && target.variant === variant
  );

  if (!exists) {
    targets.push({ mode, raidType, variant });
  }
}

/**
 * Validate and parse color inputs, comparing against current config
 */
function validateAndParseColors(colors, currentConfig, fields = getColorFieldConfig(currentConfig)) {
  const errors = [];
  const updateData = {};
  const changedColorTargets = [];

  for (const field of fields) {
    const colorValue = colors[field.key];
    if (!colorValue) continue;

    const parsed = parseColorInput(colorValue, { allowInherit: Boolean(field.allowInherit) });

    if (isInvalidColorInput(colorValue, parsed, Boolean(field.allowInherit))) {
      errors.push(`${field.label} is invalid`);
      continue;
    }

    const currentValue = typeof currentConfig[field.configKey] === 'string'
      ? parseInt(currentConfig[field.configKey], 10)
      : currentConfig[field.configKey];

    if (parsed !== currentValue) {
      updateData[field.configKey] = parsed;
      addChangedColorTarget(changedColorTargets, field);
    }
  }

  return { updateData, changedColorTargets, errors };
}

/**
 * Build success message for color changes
 */
function buildColorSuccessMessage(colors, fields = []) {
  const colorMessages = [];

  for (const field of fields) {
    if (colors[field.key]) {
      colorMessages.push(`**${field.label.replace(' (hex)', '')}:** ${colors[field.key]}`);
    }
  }

  let successText = '**Color settings saved!**\n\n';
  if (colorMessages.length > 0) {
    successText += colorMessages.join('\n') + '\n';
  } else {
    successText += 'All colors cleared (using default).\n';
  }
  successText += '\nSchedules are updating...';

  return successText;
}

/**
 * Update only the schedules affected by changed colors.
 */
async function updateSchedulesWithNewColors(interaction, updateManager, guildId, changedColorTargets) {
  try {
    if (changedColorTargets.length > 0) {
      const latestConfig = await encryptedDb.getServerConfig(guildId);
      let didUpdate = false;
      const regeneratedRaidTypes = new Set();
      const updatedRaidTypes = new Set();

      for (const target of changedColorTargets) {
        if (target.mode === 'update') {
          if (!updatedRaidTypes.has(target.raidType)) {
            await updateManager.updateSchedule(guildId, target.raidType, latestConfig);
            updatedRaidTypes.add(target.raidType);
            didUpdate = true;
          }
          continue;
        }

        if (!regeneratedRaidTypes.has(target.raidType)) {
          await updateManager.regenerateSchedule(guildId, target.raidType);
          regeneratedRaidTypes.add(target.raidType);
          didUpdate = true;
        }
      }

      await interaction.editReply({
        content: didUpdate
          ? '**Completed!** Schedules updated with new colors.'
          : '**No changes detected.** Colors remain the same.'
      }).catch(() => {});
    } else {
      await interaction.editReply({
        content: '**No changes detected.** Colors remain the same.'
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
      content: 'Colors saved but schedules failed to update. Try refreshing manually.'
    }).catch(() => {});
  }
}

module.exports = {
  showColorSettingsModal,
  saveColorSettings,
  parseHexColor,
  FT_VARIANT_COLOR_INHERIT
};
