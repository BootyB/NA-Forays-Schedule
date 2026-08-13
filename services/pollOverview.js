// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const { AttachmentBuilder, ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const crypto = require('crypto');
const PollService = require('./pollService');
const { getPollConfig, getDefaultPollIdForRaid, getEnabledPollIdsForRaid } = require('./pollConfig');
const { generatePollImage } = require('./pollVisualization');
const { normalizeEnabledFtVariants, normalizeFtVariantValue, getFtVariantLabel } = require('../utils/ftVariants');
const { getRaidTypeName } = require('../utils/raidTypes');
const { getPollPeriodBounds } = require('./pollPeriod');
const { DateTime } = require('luxon');

function encodePart(value) {
  return String(value || 'all').toLowerCase();
}

function buildPollOpenCustomId(raidType, overviewFtVariant, scopeFtVariant, pollId) {
  return ['poll', 'open', raidType.toLowerCase(), encodePart(overviewFtVariant), encodePart(scopeFtVariant), pollId].join('_');
}

function buildPollSelectCustomId(raidType, overviewFtVariant, scopeFtVariant, messageId, pollId) {
  return ['poll', 'select', raidType.toLowerCase(), encodePart(overviewFtVariant), encodePart(scopeFtVariant), messageId, pollId].join('_');
}

function parsePollCustomId(customId, mode) {
  const parts = customId.split('_');
  const offset = mode === 'select' ? 6 : 5;
  return {
    raidType: parts[2].toUpperCase(),
    overviewFtVariant: parts[3] === 'all' ? null : normalizeFtVariantValue(parts[3]),
    scopeFtVariant: parts[4] === 'all' ? null : normalizeFtVariantValue(parts[4]),
    messageId: mode === 'select' ? parts[5] : null,
    pollId: parts.slice(offset).join('_')
  };
}

function getPollScopes(raidType, options = {}) {
  const enabledPollIds = new Set(getEnabledPollIdsForRaid(options.enabledPolls, raidType));
  if (enabledPollIds.size === 0) return [];

  if (raidType === 'FT') {
    const variants = options.ftVariant
      ? [normalizeFtVariantValue(options.ftVariant)]
      : normalizeEnabledFtVariants(options.enabledFtVariants);

    return variants
      .map(variant => ({
        pollId: getDefaultPollIdForRaid(raidType, { ftVariant: variant }),
        raidType,
        ftVariant: variant
      }))
      .filter(scope => scope.pollId && enabledPollIds.has(scope.pollId));
  }

  const pollId = getDefaultPollIdForRaid(raidType);
  return pollId && enabledPollIds.has(pollId) ? [{ pollId, raidType, ftVariant: null }] : [];
}

function getScopeLabel(raidType, ftVariant = null) {
  if (raidType === 'FT' && ftVariant) {
    return getFtVariantLabel(ftVariant);
  }
  return getRaidTypeName(raidType);
}

function getButtonLabel(raidType, ftVariant = null) {
  if (raidType === 'FT' && ftVariant) {
    return `FT:${ftVariant} Poll`;
  }
  return 'Participate in Poll';
}

function getPollFilename(scope, extension, imageHash) {
  const variant = scope.ftVariant ? `_${scope.ftVariant.toLowerCase()}` : '';
  const suffix = imageHash ? `_${imageHash.slice(0, 10)}` : '';
  return `poll_${scope.raidType.toLowerCase()}${variant}_${scope.pollId}${suffix}.${extension}`;
}

function formatPollPeriod(periodId) {
  const bounds = getPollPeriodBounds(periodId);
  const start = DateTime.fromMillis(bounds.start).toFormat('MMM dd');
  const end = DateTime.fromMillis(bounds.end).toFormat('MMM dd');
  return `${start} - ${end}`;
}
async function buildPollOverviewAssets(pool, raidType, options = {}) {
  const pollService = new PollService(pool);
  const scopes = getPollScopes(raidType, options);
  const overviewFtVariant = options.ftVariant || null;
  const pollScopes = [];
  const attachments = [];
  const hashInput = [];

  for (const scope of scopes) {
    const pollConfig = getPollConfig(scope.pollId);
    if (!pollConfig) continue;

    const stats = await pollService.getDisplayStats(scope.pollId, scope.raidType, scope.ftVariant);
    const { tallies, participantCount } = stats;
    const scopeLabel = getScopeLabel(scope.raidType, scope.ftVariant);
    const image = generatePollImage({
      title: pollConfig.title,
      scopeLabel,
      tallies,
      options: pollConfig.options
    });
    const imageHash = crypto.createHash('sha256').update(image.buffer).digest('hex');
    const filename = getPollFilename(scope, image.extension, imageHash);

    attachments.push(new AttachmentBuilder(image.buffer, { name: filename, description: scopeLabel + ' poll results' }));
    pollScopes.push({
      pollId: scope.pollId,
      raidType: scope.raidType,
      ftVariant: scope.ftVariant,
      label: getButtonLabel(scope.raidType, scope.ftVariant),
      imageUrl: `attachment://${filename}`,
      participantCount,
      periodText: formatPollPeriod(stats.weekId),
      customId: buildPollOpenCustomId(scope.raidType, overviewFtVariant, scope.ftVariant, scope.pollId)
    });
    hashInput.push({ scope, tallies, participantCount, weekId: stats.weekId });
  }

  return {
    pollScopes,
    attachments,
    hash: crypto.createHash('sha256').update(JSON.stringify(hashInput)).digest('hex')
  };
}

function formatSelectedLabels(pollConfig, selections = []) {
  return selections.map(value => {
    const option = pollConfig.options.find(item => item.value === value);
    return option ? option.label : value;
  }).join(', ');
}

function buildPollSelectContainer({ pollConfig, raidType, overviewFtVariant, scopeFtVariant, messageId, selectedValues = [] }) {
  const scopeLabel = getScopeLabel(raidType, scopeFtVariant);
  const selectedSet = new Set(selectedValues);
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${pollConfig.title}\n` +
      `**Scope:** ${scopeLabel}\n\n` +
      pollConfig.description
    )
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId(buildPollSelectCustomId(raidType, overviewFtVariant, scopeFtVariant, messageId, pollConfig.id))
    .setPlaceholder(pollConfig.label)
    .setMinValues(1)
    .setMaxValues(pollConfig.options.length)
    .addOptions(pollConfig.options.map(option => ({
      label: option.label,
      description: option.description,
      value: option.value,
      default: selectedSet.has(option.value)
    })));

  container.addActionRowComponents(new ActionRowBuilder().addComponents(select));
  return container;
}

async function handlePollOpen(interaction) {
  const parsed = parsePollCustomId(interaction.customId, 'open');
  const pollConfig = getPollConfig(parsed.pollId);
  if (!pollConfig) {
    await interaction.reply({ content: 'Poll configuration not found.', flags: MessageFlags.Ephemeral });
    return;
  }

  const pollService = new PollService(require('./serviceLocator').get('pool'));
  const existingResponse = await pollService.getResponse(parsed.pollId, interaction.user.id);

  await interaction.reply({
    components: [buildPollSelectContainer({
      pollConfig,
      raidType: parsed.raidType,
      overviewFtVariant: parsed.overviewFtVariant,
      scopeFtVariant: parsed.scopeFtVariant,
      messageId: interaction.message.id,
      selectedValues: existingResponse?.selections || []
    })],
    flags: MessageFlags.Ephemeral | 32768
  });
}

async function handlePollSelection(interaction) {
  const parsed = parsePollCustomId(interaction.customId, 'select');
  const pollService = new PollService(require('./serviceLocator').get('pool'));
  const saved = await pollService.saveResponse({
    pollId: parsed.pollId,
    raidType: parsed.raidType,
    ftVariant: parsed.scopeFtVariant,
    user: interaction.user,
    selections: interaction.values
  });

  const selectedLabels = formatSelectedLabels(saved.pollConfig, saved.selections);

  await interaction.reply({
    content: `Your poll response has been recorded.\n\n**Your selections:** ${selectedLabels}`,
    flags: MessageFlags.Ephemeral
  });

  const serviceLocator = require('./serviceLocator');
  if (serviceLocator.has('updateManager')) {
    await serviceLocator.get('updateManager').refreshPollOverviewMessagesForPoll({
      pollId: parsed.pollId,
      raidType: parsed.raidType,
      ftVariant: parsed.scopeFtVariant
    });
  }
}

module.exports = {
  buildPollOpenCustomId,
  buildPollSelectCustomId,
  buildPollOverviewAssets,
  handlePollOpen,
  handlePollSelection
};
