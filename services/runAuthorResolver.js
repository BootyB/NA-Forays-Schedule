// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const { PermissionFlagsBits } = require('discord.js');
const { getGuildId, getHostChannelId, getAuthorPostChannelIds } = require('../config/hostServers');
const logger = require('../utils/logger');
const { decrypt, encrypt, hashUserId } = require('../utils/encryption');

const SNOWFLAKE_RE = /^\d{17,20}$/;
const SUCCESS_TTL_MS = 6 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 10 * 60 * 1000;
const CAFE_GUILD_ID = '750103971187654736';
const CAFE_PROTO_OZMA_SOURCE_ID = '1377808695102279862';
const MAX_ARCHIVED_THREAD_BATCHES = 3;

function normalizeSnowflake(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return SNOWFLAKE_RE.test(normalized) ? normalized : null;
}

function normalizeUsername(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().replace(/^@+/, '');
}

function lowerUsername(value) {
  return normalizeUsername(value).toLowerCase();
}


class RunAuthorResolver {
  constructor(client, options = {}) {
    this.client = client;
    this.pool = options.pool || null;
    this.successTtlMs = options.successTtlMs || SUCCESS_TTL_MS;
    this.failureTtlMs = options.failureTtlMs || FAILURE_TTL_MS;
    this.cache = new Map();
    this.inFlight = new Map();
  }

  parseDiscordMessageLink(referenceLink) {
    if (!referenceLink) return null;

    const cleaned = String(referenceLink).trim().replace(/^<|>$/g, '');

    try {
      const url = new URL(cleaned);
      if (!/(^|\.)discord(app)?\.com$/i.test(url.hostname)) return null;

      const parts = url.pathname.split('/').filter(Boolean);
      const channelsIndex = parts.indexOf('channels');
      if (channelsIndex === -1 || parts.length < channelsIndex + 3) return null;

      const guildId = normalizeSnowflake(parts[channelsIndex + 1]);
      const channelId = normalizeSnowflake(parts[channelsIndex + 2]);
      const messageId = normalizeSnowflake(parts[channelsIndex + 3]) || null;
      if (!guildId || !channelId) return null;

      return { guildId, channelId, messageId };
    } catch (error) {
      return null;
    }
  }

  resolveMessageLocation(run, raidType) {
    const parsedLink = this.parseDiscordMessageLink(run.referenceLink);
    const guildId = parsedLink?.guildId ||
      normalizeSnowflake(run.ServerID) ||
      normalizeSnowflake(getGuildId(run.ServerName));
    const channelId = parsedLink?.channelId ||
      normalizeSnowflake(getHostChannelId(run.ServerName, raidType));
    const messageId = parsedLink?.messageId ||
      normalizeSnowflake(run.SourceMessageID) ||
      (parsedLink?.channelId ? parsedLink.channelId : null);

    if (!guildId || !channelId || !messageId) {
      return null;
    }

    return { guildId, channelId, messageId };
  }

  getCached(cacheKey) {
    const cached = this.cache.get(cacheKey);
    if (!cached) return undefined;

    if (Date.now() > cached.expiresAt) {
      this.cache.delete(cacheKey);
      return undefined;
    }

    return cached.value;
  }

  setCached(cacheKey, value) {
    const ttl = value ? this.successTtlMs : this.failureTtlMs;
    this.cache.set(cacheKey, {
      value,
      expiresAt: Date.now() + ttl
    });

    if (this.cache.size > 1000) {
      const entries = [...this.cache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
      for (let i = 0; i < 100; i++) {
        this.cache.delete(entries[i][0]);
      }
    }
  }

  getDisplayName(member, author) {
    return member?.displayName ||
      member?.nickname ||
      member?.user?.globalName ||
      author?.globalName ||
      author?.username ||
      null;
  }

  isCafeFtRun(run, raidType) {
    return raidType === 'FT' && String(run.ServerName || '').trim() === 'CAFE';
  }

  buildDiscordPostUrl(guildId, channelId, messageId = null) {
    if (!guildId || !channelId) return null;
    const normalizedMessageId = normalizeSnowflake(messageId);
    return normalizedMessageId
      ? `https://discord.com/channels/${guildId}/${channelId}/${normalizedMessageId}`
      : `https://discord.com/channels/${guildId}/${channelId}`;
  }

  async enrichCafeFtLeadThreadUrl(run, raidType, author) {
    if (!this.isCafeFtRun(run, raidType) || !author?.sourceAuthorId || author.sourceAuthorUrl) {
      return author;
    }

    const cacheKey = `cafe-ft-lead-thread:${author.sourceAuthorId}`;
    const cached = this.getCached(cacheKey);
    if (cached !== undefined) {
      return cached ? { ...author, sourceAuthorUrl: cached } : author;
    }

    if (this.inFlight.has(cacheKey)) {
      const url = await this.inFlight.get(cacheKey);
      return url ? { ...author, sourceAuthorUrl: url } : author;
    }

    const lookup = this.fetchCafeFtLeadThreadUrl(author.sourceAuthorId, run)
      .then((url) => {
        this.setCached(cacheKey, url);
        return url;
      })
      .finally(() => {
        this.inFlight.delete(cacheKey);
      });

    this.inFlight.set(cacheKey, lookup);
    const url = await lookup;
    return url ? { ...author, sourceAuthorUrl: url } : author;
  }

  async fetchCafeFtLeadThreadUrl(authorId, run) {
    if (!this.pool) return null;

    try {
      const rows = await this.pool`
        SELECT "ThreadID", "LastPinnedMessageID"
        FROM public."FTLeadThreads"
        WHERE "UserID" = ${authorId}
        LIMIT 1
      `;
      const row = rows[0];
      const threadId = normalizeSnowflake(row?.ThreadID);
      if (!threadId) return null;

      const messageId = normalizeSnowflake(row?.LastPinnedMessageID) || threadId;
      return this.buildDiscordPostUrl(CAFE_GUILD_ID, threadId, messageId);
    } catch (error) {
      logger.debug('Unable to resolve CAFE FT lead thread URL', {
        error: error.message,
        runId: run.ID,
        authorIdHash: hashUserId(authorId)
      });
      return null;
    }
  }

  isCafeInjectedRun(run) {
    const serverName = String(run.ServerName || '').trim();
    const serverId = normalizeSnowflake(run.ServerID);
    const username = normalizeUsername(run.ServerNameTag);

    return serverName === 'CAFE' && serverId === CAFE_PROTO_OZMA_SOURCE_ID && Boolean(username);
  }

  getStoredUsernameMatchScore(member, storedUsername) {
    const query = lowerUsername(storedUsername);
    const user = member?.user;

    if (!query || !user) return 0;
    if (lowerUsername(user.username) === query) return 100;
    if (lowerUsername(user.tag) === query) return 95;
    if (lowerUsername(user.globalName) === query) return 80;
    if (lowerUsername(member.nickname) === query) return 70;
    if (lowerUsername(member.displayName) === query) return 60;

    return 0;
  }

  findBestStoredUsernameMatch(members, storedUsername) {
    const scoredMatches = [...members.values()]
      .map((member) => ({ member, score: this.getStoredUsernameMatchScore(member, storedUsername) }))
      .filter((match) => match.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scoredMatches.length === 0) return null;
    if (scoredMatches.length > 1 && scoredMatches[0].score === scoredMatches[1].score) return null;

    return scoredMatches[0].member;
  }

  buildInjectedAuthorFallback(username) {
    return {
      sourceAuthorId: null,
      sourceAuthorDisplayName: username,
      sourceAuthorUsername: username,
      sourceAuthorUrl: null
    };
  }

  async resolveCafeInjectedRunAuthor(run) {
    if (!this.isCafeInjectedRun(run)) return null;

    const username = normalizeUsername(run.ServerNameTag);
    const fallback = this.buildInjectedAuthorFallback(username);
    const cacheKey = `cafe-injected:${lowerUsername(username)}`;
    const cached = this.getCached(cacheKey);
    if (cached !== undefined) return cached || fallback;

    try {
      const guild = this.client.guilds.cache.get(CAFE_GUILD_ID);
      if (!guild?.members?.search) {
        this.setCached(cacheKey, null);
        return fallback;
      }

      const members = await guild.members.search({ query: username, limit: 10, cache: true }).catch(() => null);
      if (!members || members.size === 0) {
        this.setCached(cacheKey, null);
        return fallback;
      }

      const member = this.findBestStoredUsernameMatch(members, username);
      if (!member) {
        logger.debug('CAFE injected run username did not resolve to one exact member', {
          username,
          matchCount: members.size,
          runId: run.ID
        });
        this.setCached(cacheKey, null);
        return fallback;
      }

      const displayName = this.getDisplayName(member, member.user) || username;
      const resolved = {
        sourceAuthorId: member.id,
        sourceAuthorDisplayName: displayName,
        sourceAuthorUsername: member.user?.username || username,
        sourceAuthorUrl: null
      };
      this.setCached(cacheKey, resolved);
      return resolved;
    } catch (error) {
      logger.debug('Unable to resolve CAFE injected run author from username', {
        error: error.message,
        username,
        runId: run.ID
      });
      this.setCached(cacheKey, null);
      return fallback;
    }
  }

  async resolveRunAuthor(run, raidType) {
    const author = await this.resolveBaseRunAuthor(run, raidType);
    return this.enrichAuthorWithPostUrl(run, raidType, author);
  }

  async resolveBaseRunAuthor(run, raidType) {
    const injectedAuthor = await this.resolveCafeInjectedRunAuthor(run);
    if (this.isCafeInjectedRun(run) && injectedAuthor) {
      return injectedAuthor;
    }

    const location = this.resolveMessageLocation(run, raidType);
    if (!location) return injectedAuthor;

    const cacheKey = `${location.guildId}:${location.channelId}:${location.messageId}`;
    const cached = this.getCached(cacheKey);
    if (cached !== undefined) return cached || injectedAuthor;

    if (this.inFlight.has(cacheKey)) {
      return this.inFlight.get(cacheKey);
    }

    const lookup = this.fetchRunAuthor(location, run, raidType)
      .then((result) => {
        this.setCached(cacheKey, result);
        return result || injectedAuthor;
      })
      .finally(() => {
        this.inFlight.delete(cacheKey);
      });

    this.inFlight.set(cacheKey, lookup);
    return lookup;
  }

  async fetchRunAuthor(location, run, raidType) {
    try {
      const guild = this.client.guilds.cache.get(location.guildId);
      if (!guild) return null;

      const channel = guild.channels.cache.get(location.channelId) ||
        await this.client.channels.fetch(location.channelId).catch(() => null);
      if (!channel) return null;
      if (!await this.canReadSourceChannel(guild, channel)) return null;

      if (!channel?.messages || typeof channel.messages.fetch !== 'function') {
        return null;
      }

      const message = await channel.messages.fetch({
        message: location.messageId,
        cache: false,
        force: true
      }).catch(() => null);
      const author = message?.author;
      if (!author?.id) return null;

      let member = null;
      if (!message.webhookId) {
        member = await guild.members.fetch(author.id).catch(() => null);
      }

      const displayName = this.getDisplayName(member, author);
      if (!displayName) return null;

      return {
        sourceAuthorId: author.id,
        sourceAuthorDisplayName: displayName,
        sourceAuthorUsername: author.username || null,
        sourceAuthorUrl: null
      };
    } catch (error) {
      logger.debug('Unable to resolve run author', {
        error: error.message,
        raidType,
        runId: run.ID,
        serverName: run.ServerName,
        guildId: location.guildId,
        channelId: location.channelId,
        messageId: location.messageId
      });
      return null;
    }
  }

  buildDiscordThreadUrl(guildId, threadId) {
    if (!guildId || !threadId) return null;
    return `https://discord.com/channels/${guildId}/${threadId}`;
  }

  async getBotMember(guild) {
    return guild?.members?.me || await guild?.members?.fetchMe?.().catch(() => null);
  }

  async canReadSourceChannel(guild, channel) {
    const botMember = await this.getBotMember(guild);
    const permissions = botMember && typeof channel?.permissionsFor === 'function'
      ? channel.permissionsFor(botMember)
      : null;

    if (!permissions) return false;
    return permissions.has(PermissionFlagsBits.ViewChannel) &&
      permissions.has(PermissionFlagsBits.ReadMessageHistory);
  }



  async collectConfiguredChannelThreads(channel) {
    if (!channel?.threads) return new Map();

    const threadsById = new Map();
    const addThreads = (threads) => {
      if (!threads) return;
      for (const thread of threads.values()) {
        if (thread?.id && (!channel.id || thread.parentId === channel.id)) {
          threadsById.set(thread.id, thread);
        }
      }
    };

    addThreads(channel.threads.cache);

    const active = typeof channel.threads.fetchActive === 'function'
      ? await channel.threads.fetchActive().catch(() => null)
      : null;
    addThreads(active?.threads);

    let before;
    for (let batch = 0; batch < MAX_ARCHIVED_THREAD_BATCHES; batch++) {
      const options = { limit: 100 };
      if (before) options.before = before;

      const archived = typeof channel.threads.fetchArchived === 'function'
        ? await channel.threads.fetchArchived(options).catch(() => null)
        : null;
      addThreads(archived?.threads);
      if (!archived?.hasMore || !archived.threads || archived.threads.size === 0) break;

      const lastThread = archived.threads.last();
      before = lastThread?.archiveTimestamp || lastThread?.createdTimestamp || null;
      if (!before) break;
    }

    return threadsById;
  }

  getThreadIdCandidates(run, location) {
    const parsedLink = this.parseDiscordMessageLink(run.referenceLink);
    return [
      parsedLink?.channelId,
      parsedLink?.messageId,
      location?.messageId,
      run.SourceMessageID,
      run.EventID
    ]
      .map(normalizeSnowflake)
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index);
  }

  async resolveConfiguredAuthorPostThread(guild, run, raidType, location) {
    const channelIds = getAuthorPostChannelIds(run.ServerName, raidType)
      .map(normalizeSnowflake)
      .filter(Boolean);
    if (channelIds.length === 0) return null;

    const threadIdCandidates = this.getThreadIdCandidates(run, location);
    if (threadIdCandidates.length === 0) return null;

    for (const channelId of [...new Set(channelIds)]) {
      const cachedChannel = guild.channels.cache.get(channelId);
      const channel = cachedChannel || await this.client.channels.fetch(channelId).catch(() => null);

      if (!channel) continue;
      if (channel.guild?.id !== guild.id) continue;

      const canReadChannel = await this.canReadSourceChannel(guild, channel);
      if (!canReadChannel) continue;

      for (const threadId of threadIdCandidates) {
        if (channel.id === threadId && typeof channel.isThread === 'function' && channel.isThread()) {
          return channel;
        }

        if (typeof channel.threads?.fetch === 'function') {
          const thread = await channel.threads.fetch(threadId).catch(() => null);
          if (thread?.parentId === channel.id) {
            return thread;
          }
        }

        const fetched = await this.client.channels.fetch(threadId).catch(() => null);
        if (typeof fetched?.isThread === 'function' && fetched.isThread() && fetched.parentId === channel.id) {
          return fetched;
        }
      }
    }

    return null;
  }

  async resolveSourceThread(channel, location) {
    if (typeof channel?.isThread === 'function' && channel.isThread()) {
      return channel;
    }

    const threadId = normalizeSnowflake(location.messageId);
    if (!threadId) return null;

    if (typeof channel?.threads?.fetch === 'function') {
      const thread = await channel.threads.fetch(threadId).catch(() => null);
      if (thread) return thread;
    }

    const fetched = await this.client.channels.fetch(threadId).catch(() => null);
    if (typeof fetched?.isThread === 'function' && fetched.isThread()) {
      if (!channel?.id || fetched.parentId === channel.id) return fetched;
    }

    return null;
  }

  async buildAuthorFromUserId(guild, userId, fallbackUser = null, sourceAuthorUrl = null) {
    const normalizedUserId = normalizeSnowflake(userId);
    if (!normalizedUserId) return null;

    const member = await guild.members.fetch(normalizedUserId).catch(() => null);
    const author = fallbackUser || member?.user || await this.client.users.fetch(normalizedUserId).catch(() => null);
    const displayName = this.getDisplayName(member, author);
    if (!displayName) return null;

    return {
      sourceAuthorId: normalizedUserId,
      sourceAuthorDisplayName: displayName,
      sourceAuthorUsername: author?.username || null,
      sourceAuthorUrl
    };
  }

  async resolveThreadCreatorAuthor(guild, thread) {
    if (!thread?.id) return null;

    const sourceAuthorUrl = this.buildDiscordPostUrl(thread.guild?.id || thread.guildId || guild.id, thread.id, thread.id);

    if (thread.ownerId) {
      const ownerAuthor = await this.buildAuthorFromUserId(guild, thread.ownerId, null, sourceAuthorUrl);
      if (ownerAuthor) return ownerAuthor;
    }

    const starterMessage = await this.fetchThreadStarterMessage(thread);
    const starterAuthor = starterMessage?.author;
    if (starterAuthor?.id) {
      return this.buildAuthorFromUserId(guild, starterAuthor.id, starterAuthor, starterMessage.url || sourceAuthorUrl);
    }

    return null;
  }

  async getSavedAuthorPostThreadId(serverName, raidType, guildId, channelId, authorIdHash) {
    if (!this.pool) return null;

    try {
      const rows = await this.pool`
        SELECT thread_id_encrypted
        FROM public.na_bot_author_post_threads
        WHERE server_name = ${serverName}
          AND raid_type = ${raidType}
          AND guild_id = ${guildId}
          AND channel_id = ${channelId}
          AND author_id_hash = ${authorIdHash}
        LIMIT 1
      `;
      return normalizeSnowflake(decrypt(rows[0]?.thread_id_encrypted));
    } catch (error) {
      logger.debug('Unable to read author post cache', {
        error: error.message,
        serverName,
        raidType,
        guildId,
        channelId,
        authorIdHash
      });
      return null;
    }
  }

  async saveAuthorPostThread(serverName, raidType, guildId, channelId, authorIdHash, thread) {
    if (!this.pool || !thread?.id) return;

    try {
      await this.pool`
        INSERT INTO public.na_bot_author_post_threads
          (server_name, raid_type, guild_id, channel_id, author_id_hash, thread_id_encrypted, last_seen_at, updated_at)
        VALUES
          (${serverName}, ${raidType}, ${guildId}, ${channelId}, ${authorIdHash}, ${encrypt(thread.id)}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (server_name, raid_type, guild_id, channel_id, author_id_hash)
        DO UPDATE SET
          thread_id_encrypted = EXCLUDED.thread_id_encrypted,
          last_seen_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      `;
    } catch (error) {
      logger.debug('Unable to save author post cache', {
        error: error.message,
        serverName,
        raidType,
        guildId,
        channelId,
        authorIdHash
      });
    }
  }

  async enrichAuthorWithPostUrl(run, raidType, author) {
    if (!author?.sourceAuthorId || author.sourceAuthorUrl) return author;

    const cafeAuthor = await this.enrichCafeFtLeadThreadUrl(run, raidType, author);
    if (cafeAuthor?.sourceAuthorUrl) return cafeAuthor;

    const channelIds = getAuthorPostChannelIds(run.ServerName, raidType)
      .map(normalizeSnowflake)
      .filter(Boolean);
    if (channelIds.length === 0) return author;

    const guildId = normalizeSnowflake(getGuildId(run.ServerName)) || normalizeSnowflake(run.ServerID);
    if (!guildId) return { ...author, authorPostLookupStatus: 'no-guild-id' };

    const uniqueChannelIds = [...new Set(channelIds)];
    const cacheKey = `author-post:${guildId}:${author.sourceAuthorId}:${uniqueChannelIds.join(',')}`;
    const cached = this.getCached(cacheKey);
    if (cached !== undefined) {
      return cached
        ? { ...author, sourceAuthorUrl: cached, authorPostLookupStatus: 'memory-cache-hit' }
        : { ...author, authorPostLookupStatus: 'memory-cache-miss' };
    }

    if (this.inFlight.has(cacheKey)) {
      const result = await this.inFlight.get(cacheKey);
      return result?.url
        ? { ...author, sourceAuthorUrl: result.url, authorPostLookupStatus: result.status || 'in-flight-hit' }
        : { ...author, authorPostLookupStatus: result?.status || 'in-flight-miss' };
    }

    const lookup = this.fetchAuthorPostUrl(guildId, uniqueChannelIds, author.sourceAuthorId, run, raidType)
      .then((result) => {
        if (result?.url) this.setCached(cacheKey, result.url);
        return result;
      })
      .finally(() => {
        this.inFlight.delete(cacheKey);
      });

    this.inFlight.set(cacheKey, lookup);
    const result = await lookup;
    return result?.url
      ? { ...author, sourceAuthorUrl: result.url, authorPostLookupStatus: result.status || 'linked' }
      : { ...author, authorPostLookupStatus: result?.status || 'not-found' };
  }

  async fetchAuthorPostUrl(guildId, channelIds, authorId, run, raidType) {
    try {
      const authorIdHash = hashUserId(authorId);
      if (!authorIdHash) return { url: null, status: 'no-author-hash' };

      for (const channelId of channelIds) {
        const savedThreadId = await this.getSavedAuthorPostThreadId(run.ServerName, raidType, guildId, channelId, authorIdHash);
        if (savedThreadId) {
          return { url: this.buildDiscordPostUrl(guildId, savedThreadId, savedThreadId), status: 'db-cache-hit' };
        }
      }

      const guild = this.client.guilds.cache.get(guildId) ||
        await this.client.guilds.fetch(guildId).catch(() => null);
      if (!guild) return { url: null, status: 'no-guild' };

      let sawChannel = false;
      let sawReadableChannel = false;
      for (const channelId of channelIds) {
        const channel = guild.channels.cache.get(channelId) ||
          await this.client.channels.fetch(channelId).catch(() => null);
        if (!channel || channel.guild?.id !== guildId) continue;
        sawChannel = true;
        if (!await this.canReadSourceChannel(guild, channel)) continue;
        sawReadableChannel = true;

        if (typeof channel.isThread === 'function' && channel.isThread()) {
          const threadUrl = await this.getAuthorThreadUrl(channel, authorId);
          if (threadUrl) return { url: threadUrl, status: 'direct-thread-match' };
          continue;
        }

        const thread = await this.findAuthorThread(channel, authorId);
        if (thread) {
          await this.saveAuthorPostThread(run.ServerName, raidType, guildId, channel.id, authorIdHash, thread);
          return { url: this.buildDiscordPostUrl(guildId, thread.id, thread.id), status: 'scan-match' };
        }
      }

      if (!sawChannel) return { url: null, status: 'no-channel' };
      if (!sawReadableChannel) return { url: null, status: 'no-permission' };
      return { url: null, status: 'scan-no-match' };
    } catch (error) {
      logger.warn('Unable to resolve author post URL', {
        error: error.message,
        raidType,
        runId: run.ID,
        serverName: run.ServerName,
        guildId,
        authorIdHash: hashUserId(authorId)
      });
      return { url: null, status: 'error' };
    }
  }

  async fetchThreadStarterMessage(thread) {
    if (!thread?.messages || typeof thread.messages.fetch !== 'function') return null;
    return thread.messages.fetch({
      message: thread.id,
      cache: false,
      force: true
    }).catch(() => null);
  }

  async getAuthorThreadUrl(thread, authorId) {
    if (!thread?.id || !authorId) return null;

    if (thread.ownerId === authorId) {
      return this.buildDiscordPostUrl(thread.guild?.id || thread.guildId, thread.id, thread.id) ||
        this.buildDiscordThreadUrl(thread.guild?.id || thread.guildId, thread.id);
    }

    const starterMessage = await this.fetchThreadStarterMessage(thread);
    if (starterMessage?.author?.id === authorId) {
      return starterMessage.url || this.buildDiscordThreadUrl(thread.guild?.id || thread.guildId, thread.id);
    }

    return null;
  }

  async findAuthorThread(channel, authorId) {
    if (!channel?.threads || !authorId) return null;

    const cachedThreads = channel.threads.cache || new Map();
    for (const thread of cachedThreads.values()) {
      if (thread?.ownerId === authorId) return thread;
    }

    const active = typeof channel.threads.fetchActive === 'function'
      ? await channel.threads.fetchActive().catch(() => null)
      : null;
    for (const thread of (active?.threads || new Map()).values()) {
      if (thread?.ownerId === authorId) return thread;
    }

    let before;
    for (let batch = 0; batch < MAX_ARCHIVED_THREAD_BATCHES; batch++) {
      const options = { limit: 100 };
      if (before) options.before = before;

      const archived = typeof channel.threads.fetchArchived === 'function'
        ? await channel.threads.fetchArchived(options).catch(() => null)
        : null;
      if (!archived?.threads || archived.threads.size === 0) break;

      for (const thread of archived.threads.values()) {
        if (thread?.ownerId === authorId) return thread;
      }

      if (!archived.hasMore) break;

      const lastThread = archived.threads.last();
      before = lastThread?.archiveTimestamp || lastThread?.createdTimestamp || null;
      if (!before) break;
    }

    return null;
  }
}

module.exports = RunAuthorResolver;

