// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const { ContainerBuilder, TextDisplayBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, SeparatorBuilder, SeparatorSpacingSize, StringSelectMenuBuilder, SectionBuilder, ThumbnailBuilder } = require('discord.js');
const { SPACER_IMAGE_URL, getCalendarLinks, TIMEZONE_OPTIONS, MAX_TEXT_LENGTH } = require('../config/constants');
const { getServerIcon, getInviteLink, getChannelLink, getGuildStats } = require('../config/hostServers');
const { hashCodeSchedules } = require('../utils/hashCode');
const { buildSystemUpdateBlock } = require('../utils/systemUpdate');
const { FT_VARIANTS, DEFAULT_FT_VARIANTS, getFtVariantLabel, getFtVariantShortLabel, normalizeEnabledFtVariants, normalizeFtVariantValue } = require('../utils/ftVariants');
const logger = require('../utils/logger');

const RUN_TEXT_BUDGET_PER_CONTAINER = Math.max(1000, MAX_TEXT_LENGTH - 1000);
const RUN_COMPONENT_BUDGET_PER_CONTAINER = 28;

const { 
  getRaidTypeName, 
  getRaidTypeColor, 
  getRaidTypeEmoji,
  getRunTypePriority,
  getBannerImage,
  getCalendarId
} = require('../utils/raidTypes');

function formatEmoji(emoji) {
  if (typeof emoji === 'string') return emoji;
  if (emoji && emoji.id) {
    return emoji.animated ? `<a:${emoji.name}:${emoji.id}>` : `<:${emoji.name}:${emoji.id}>`;
  }
  return '';
}

function setContainerColor(container, customColor, defaultColor) {
  if (customColor === undefined) {
    container.setAccentColor(defaultColor);
  } else if (customColor === null) {
    container.setAccentColor(null);
  } else {
    container.setAccentColor(customColor);
  }
}

function escapeMarkdown(text) {
  return String(text).replace(/([\\`*_{}\[\]()#+\-.!|>])/g, '\\$1');
}

function normalizeDiscordLink(value) {
  if (!value) return null;

  try {
    const url = new URL(String(value).trim().replace(/^<|>$/g, ''));
    if (!/(^|\.)discord(app)?\.com$/i.test(url.hostname)) return null;
    if (!/^\/channels\/\d{17,20}\/\d{17,20}(\/\d{17,20})?\/?$/.test(url.pathname)) return null;
    return url.toString();
  } catch (error) {
    return null;
  }
}

function formatSourceAuthorLabel(text) {
  return String(text)
    .replace(/[\r\n]+/g, ' ')
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .trim();
}

function hasEmoji(text) {
  return /\p{Extended_Pictographic}/u.test(String(text));
}

function formatSourceAuthor(run) {
  const authorUrl = normalizeDiscordLink(run.sourceAuthorUrl);
  const displayName = authorUrl
    ? formatSourceAuthorLabel(run.sourceAuthorDisplayName)
    : escapeMarkdown(run.sourceAuthorDisplayName);

  if (!authorUrl) return displayName;

  // Discord can fail masked links when emoji are inside the link label.
  if (hasEmoji(displayName)) {
    return `${displayName} ([Lead Post](${authorUrl}))`;
  }

  return `[${displayName}](${authorUrl})`;
}

class ScheduleContainerBuilder {
  constructor(client = null) {
    this.componentCount = 0;
    this.client = client;
  }

  buildOverviewContainer(raidType, customColor = undefined, options = {}) {
    const container = new ContainerBuilder();
    
    setContainerColor(container, customColor, getRaidTypeColor(raidType));

    const calendarId = getCalendarId(raidType, { ftVariant: options.ftVariant });
    const links = getCalendarLinks(calendarId);

    const bannerImage = options.bannerImage !== undefined ? options.bannerImage : getBannerImage(raidType);
    if (bannerImage) {
      container.addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
          new MediaGalleryItemBuilder().setURL(bannerImage)
        )
      );
    }
    
    const raidName = raidType === 'FT' && options.ftVariant ? getFtVariantLabel(options.ftVariant) : getRaidTypeName(raidType);
    let headerContent = '';
    if (bannerImage) {
      headerContent = `### Multi-Server *${raidName}* Schedule for North American and Materia Data Centers\n`;
    } else {
      const emoji = getRaidTypeEmoji(raidType);
      headerContent = `## ${formatEmoji(emoji)} ${raidName} Schedule\n### Multi-Server ${raidName} Schedule for North American and Materia Data Centers\n`;
    }
    
    const calendarSection = links
      ? `[Add to Google Calendar](${links.gcal}) | [iCal](${links.ical})`
      : '';

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(headerContent + calendarSection)
    );

    if (links) {
      const timezoneSelect = new StringSelectMenuBuilder()
        .setCustomId(`timezone_select_${raidType.toLowerCase()}${options.ftVariant ? '_' + options.ftVariant.toLowerCase() : ''}`)
        .setPlaceholder('View calendar by city or timezone')
        .addOptions(TIMEZONE_OPTIONS);

      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(timezoneSelect)
      );
    } else if (raidType === 'FT' && !options.ftVariant) {
      const enabledVariants = normalizeEnabledFtVariants(options.enabledFtVariants);
      const variantSelect = new StringSelectMenuBuilder()
        .setCustomId('calendar_variant_select_ft')
        .setPlaceholder('Choose FTB or FTM calendar')
        .addOptions(enabledVariants.map(variant => ({
          label: `${getFtVariantShortLabel(variant)} - ${FT_VARIANTS[variant].label}`,
          value: variant.toLowerCase()
        })));

      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(variantSelect)
      );
    }

    const infoButton = new ButtonBuilder()
      .setCustomId(`schedule_info_${raidType.toLowerCase()}`)
      .setLabel('ℹ️ Schedule Info')
      .setStyle(ButtonStyle.Primary);

    const serversButton = new ButtonBuilder()
      .setCustomId(`schedule_servers_${raidType.toLowerCase()}`)
      .setLabel('🌐 Followed Servers')
      .setStyle(ButtonStyle.Secondary);

    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(infoButton, serversButton)
    );

    if (Array.isArray(options.pollScopes) && options.pollScopes.length > 0) {
      container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
      );

      options.pollScopes.forEach((scope, index) => {
        if (index > 0) {
          container.addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false)
          );
        }

        const pollButton = new ButtonBuilder()
          .setCustomId(scope.customId)
          .setLabel(scope.label)
          .setStyle(ButtonStyle.Secondary);

        const headerText = [
          '### Prog Point Requests',
          `-# ${scope.participantCount || 0} participants`,
          `-# Period: ${scope.periodText || 'Unknown'}`
        ].join('\n');

        container.addSectionComponents(
          new SectionBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText))
            .setButtonAccessory(pollButton)
        );

        container.addMediaGalleryComponents(
          new MediaGalleryBuilder().addItems(
            new MediaGalleryItemBuilder().setURL(scope.imageUrl)
          )
        );
      });
    }
    const systemUpdateBlock = buildSystemUpdateBlock(raidType);
    if (systemUpdateBlock) {
      container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
      );

      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(systemUpdateBlock)
      );
    }

    logger.debug('Built overview container', { raidType });
    return container;
  }

  async buildScheduleContainers(groupedRuns, raidType, customColor = undefined, options = {}) {
    const containers = [];

    if (!groupedRuns || Object.keys(groupedRuns).length === 0) {
      containers.push({
        container: this.buildEmptyContainer(raidType, customColor),
        serverName: '__empty__',
        hash: this.generateServerHash('__empty__', [])
      });
      return containers;
    }

    let isFirst = true;
    for (const serverName in groupedRuns) {
      const runs = groupedRuns[serverName];

      if (raidType === 'FT') {
        const enabledVariants = normalizeEnabledFtVariants(options.enabledFtVariants);

        for (const variant of DEFAULT_FT_VARIANTS) {
          if (!enabledVariants.includes(variant)) continue;

          const variantRuns = runs.filter(run => normalizeFtVariantValue(run.FTRaidVariant) === variant);
          if (variantRuns.length === 0) continue;

          const containerKey = `${serverName}|${variant}`;
          const entries = await this.buildServerContainerEntries(serverName, variantRuns, raidType, isFirst, customColor, variant, containerKey);
          containers.push(...entries);
          isFirst = false;
        }
        continue;
      }

      const entries = await this.buildServerContainerEntries(serverName, runs, raidType, isFirst, customColor, null, serverName);
      containers.push(...entries);
      isFirst = false;
    }

    logger.debug('Built schedule containers', {
      raidType,
      containerCount: containers.length,
      servers: Object.keys(groupedRuns).length
    });

    return containers;
  }

  splitRunsForContainerBudget(runs) {
    const chunks = [];
    let currentRuns = [];
    let currentTextLength = 0;
    let currentTypes = new Set();

    for (const run of runs) {
      const runType = run.Type || 'Unknown';
      const runTextLength = this.formatSingleRunBlock(run).length;
      const headingLength = currentTypes.has(runType) ? 0 : `### ${runType}`.length + 1;
      const nextTextLength = currentTextLength + headingLength + runTextLength + 1;
      const nextComponentCount = currentRuns.length + currentTypes.size + (currentTypes.has(runType) ? 0 : 1) + 1;
      const exceedsTextBudget = currentRuns.length > 0 && nextTextLength > RUN_TEXT_BUDGET_PER_CONTAINER;
      const exceedsComponentBudget = currentRuns.length > 0 && nextComponentCount > RUN_COMPONENT_BUDGET_PER_CONTAINER;

      if (exceedsTextBudget || exceedsComponentBudget) {
        chunks.push(currentRuns);
        currentRuns = [];
        currentTextLength = 0;
        currentTypes = new Set();
      }

      const freshHeadingLength = currentTypes.has(runType) ? 0 : `### ${runType}`.length + 1;
      currentRuns.push(run);
      currentTextLength += freshHeadingLength + runTextLength + 1;
      currentTypes.add(runType);
    }

    if (currentRuns.length > 0) {
      chunks.push(currentRuns);
    }

    return chunks.length > 0 ? chunks : [[]];
  }

  async buildServerContainerEntries(serverName, runs, raidType, isFirst, customColor, ftVariant, baseKey) {
    const chunks = this.splitRunsForContainerBudget(runs);
    const entries = [];

    if (chunks.length > 1) {
      logger.debug('Split schedule server container by display text budget', {
        serverName,
        raidType,
        ftVariant,
        runCount: runs.length,
        containerCount: chunks.length,
        textBudget: RUN_TEXT_BUDGET_PER_CONTAINER,
        componentBudget: RUN_COMPONENT_BUDGET_PER_CONTAINER
      });
    }

    for (let index = 0; index < chunks.length; index++) {
      const partInfo = chunks.length > 1
        ? { index: index + 1, count: chunks.length }
        : null;
      const container = await this.buildServerContainer(serverName, chunks[index], raidType, isFirst && index === 0, customColor, ftVariant, partInfo);
      const entryKey = chunks.length > 1 ? `${baseKey}#${index + 1}` : baseKey;
      entries.push({
        container,
        serverName: entryKey,
        hash: this.generateServerHash(entryKey, chunks[index], ftVariant)
      });
    }

    return entries;
  }

  async buildServerContainer(serverName, runs, raidType, isFirst = false, customColor = undefined, ftVariant = null, partInfo = null) {
    const container = new ContainerBuilder();
    
    setContainerColor(container, customColor, getRaidTypeColor(raidType));

    const ftVariantLabel = raidType === 'FT' && ftVariant ? getFtVariantLabel(ftVariant) : null;
    const partLabel = partInfo ? ` (${partInfo.index}/${partInfo.count})` : '';
    let headerContent = `## ${getChannelLink(serverName, raidType)}${ftVariantLabel ? ` - ${ftVariantLabel}` : ''}${partLabel}\n`;
    
    const guildStats = await getGuildStats(serverName, this.client);    
    const serverIcon = guildStats?.icon || await getServerIcon(serverName, this.client);
    
    if (guildStats) {
      if (guildStats.description) {
        headerContent += `-# *${guildStats.description}*\n`;
      }
      if (guildStats.memberCount) {
        const memberText = guildStats.fromInvite 
          ? `~${guildStats.memberCount.toLocaleString()} members` 
          : `${guildStats.memberCount.toLocaleString()} members`;
        headerContent += `-# 👥 ${memberText}`;
      }
      if (guildStats.createdAt) {
        const createdTimestamp = Math.round(guildStats.createdAt.getTime() / 1000);
        headerContent += `\n-# • Created <t:${createdTimestamp}:D>`;
      }
    }

    const serverHeaderSection = new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(headerContent)
      )
      .setThumbnailAccessory(
        new ThumbnailBuilder()
          .setURL(serverIcon)
          .setDescription(`${serverName} icon`)
      );

    container.addSectionComponents(serverHeaderSection);

    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );

    const runsByType = {};
    for (const run of runs) {
      const runType = run.Type || 'Unknown';
      if (!runsByType[runType]) {
        runsByType[runType] = [];
      }
      runsByType[runType].push(run);
    }

    const priorityOrder = getRunTypePriority(raidType);
    const sortedRunTypes = Object.keys(runsByType).sort((a, b) => {
      const indexA = priorityOrder.indexOf(a);
      const indexB = priorityOrder.indexOf(b);
      
      if (indexA !== -1 && indexB !== -1) {
        return indexA - indexB;
      }
      
      if (indexA !== -1) return -1;
      if (indexB !== -1) return 1;
      
      return a.localeCompare(b);
    });

    const runDisplayCount = sortedRunTypes.length + runs.length;
    const usePerRunComponents = runDisplayCount <= 32;

    for (const runType of sortedRunTypes) {
      const typeRuns = runsByType[runType];

      if (!usePerRunComponents) {
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(this.formatRunGroup(runType, typeRuns))
        );
        continue;
      }

      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`### ${runType}`)
      );

      for (const run of typeRuns) {
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(this.formatSingleRunBlock(run))
        );
      }
    }

    
    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );

    const inviteLink = getInviteLink(serverName);
    if (inviteLink !== '#') {
      const inviteButton = new ButtonBuilder()
        .setLabel(`Join ${serverName}`)
        .setURL(inviteLink)
        .setStyle(ButtonStyle.Link);
      
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(inviteButton)
      );
    }

    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(SPACER_IMAGE_URL)
      )
    );

    return container;
  }

  quoteRunBlock(text) {
    return String(text)
      .split('\n')
      .map((line) => line ? `> ${line}` : '>')
      .join('\n');
  }

  formatSingleRunBlock(run) {
    const timestamp = Math.round(run.Start / 1000);
    const currentTime = Date.now();
    const thirtyHoursMs = 30 * 60 * 60 * 1000; // 30 hours in milliseconds
    
    let isNew = false;
    if (run.TimeStamp) {
      const createdTime = run.TimeStamp instanceof Date 
        ? run.TimeStamp.getTime() 
        : new Date(run.TimeStamp).getTime();
      isNew = (currentTime - createdTime) < thirtyHoursMs;
    }

    const newBadge = isNew ? '\u{1F195} ' : '';
    const runLines = [`${newBadge}<t:${timestamp}:F>`];
    
    if (run.RunDC) {
      runLines.push(`Data Center: ${run.RunDC}`);
    }

    if (run.sourceAuthorDisplayName) {
      runLines.push(`Posted by: ${formatSourceAuthor(run)}`);
    }
    
    if (run.referenceLink) {
      runLines.push(`[Run Info](${run.referenceLink})`);
    }
    
    return this.quoteRunBlock(runLines.join('\n'));
  }

  formatRunGroup(runType, runs) {
    const runBlocks = runs.map((run) => this.formatSingleRunBlock(run));
    return [`### ${runType}`, ...runBlocks].join('\n');
  }

  
  buildEmptyContainer(raidType, customColor = undefined) {
    const container = new ContainerBuilder();
    
    setContainerColor(container, customColor, getRaidTypeColor(raidType));
    
    const emoji = getRaidTypeEmoji(raidType);
    const raidName = getRaidTypeName(raidType);
    const emptyText = 
      `# ${formatEmoji(emoji)} ${raidName} Runs\n\n` +
      `No runs currently scheduled for the next 3 months.\n\n` +
      `*This schedule updates automatically every 60 seconds.*`;
    
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(emptyText)
    );
    
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL('https://i.imgur.com/ZfizSs7.png')
      )
    );
    
    return container;
  }

  generateServerHash(serverName, runs, ftVariant = null) {
    let contentString = `${serverName}:${ftVariant || ''}:quote-runs-v8:`;
    const currentTime = Date.now();
    const thirtyHoursMs = 30 * 60 * 60 * 1000;
    
    for (const run of runs) {
      let isNew = false;
      if (run.TimeStamp) {
        const createdTime = run.TimeStamp instanceof Date 
          ? run.TimeStamp.getTime() 
          : new Date(run.TimeStamp).getTime();
        isNew = (currentTime - createdTime) < thirtyHoursMs;
      }
      contentString += `${run.ID}|${run.Type}|${run.FTRaidVariant || ''}|${run.Start}|${run.RunDC}|${run.sourceAuthorId || ''}|${run.sourceAuthorDisplayName || ''}|${run.sourceAuthorUrl || ''}|${isNew ? 'NEW' : ''}|`;
    }
    return hashCodeSchedules(contentString);
  }

  generateContentHash(groupedRuns, raidType, options = {}) {
    let contentString = `${raidType}|`;

    for (const serverName in groupedRuns) {
      const runs = groupedRuns[serverName];

      if (raidType === 'FT') {
        const enabledVariants = normalizeEnabledFtVariants(options.enabledFtVariants);

        for (const variant of DEFAULT_FT_VARIANTS) {
          if (!enabledVariants.includes(variant)) continue;

          const variantRuns = runs.filter(run => normalizeFtVariantValue(run.FTRaidVariant) === variant);
          if (variantRuns.length > 0) {
            contentString += this.generateServerHash(`${serverName}|${variant}`, variantRuns, variant);
          }
        }
        continue;
      }

      contentString += this.generateServerHash(serverName, runs);
    }

    return hashCodeSchedules(contentString);
  }
}

module.exports = ScheduleContainerBuilder;
