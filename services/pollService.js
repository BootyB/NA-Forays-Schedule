// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const logger = require('../utils/logger');
const { isValidRaidType } = require('../utils/raidTypes');
const { normalizeFtVariantValue } = require('../utils/ftVariants');
const { getPollConfig, validatePollForRaid } = require('./pollConfig');
const { getCurrentPollPeriodId } = require('./pollPeriod');


class PollService {
  constructor(pool) {
    this.pool = pool;
  }

  normalizeScope(raidType, ftVariant = null) {
    const normalizedRaidType = String(raidType || '').trim().toUpperCase();
    if (!isValidRaidType(normalizedRaidType)) {
      throw new Error(`Invalid raid type: ${raidType}`);
    }

    const normalizedFtVariant = normalizedRaidType === 'FT'
      ? normalizeFtVariantValue(ftVariant)
      : null;

    return {
      raidType: normalizedRaidType,
      ftVariant: normalizedFtVariant,
      scopeKey: `${normalizedRaidType}:${normalizedFtVariant || 'all'}`
    };
  }

  validateSelections(pollConfig, selections) {
    const allowedValues = new Set(pollConfig.options.map(option => option.value));
    const normalized = Array.isArray(selections)
      ? selections.filter(value => allowedValues.has(value))
      : [];

    return [...new Set(normalized)];
  }

  parseSelections(value) {
    if (Array.isArray(value)) return value;
    try {
      const parsed = JSON.parse(value || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      logger.warn('Invalid poll response selections payload', { error: error.message });
      return [];
    }
  }

  async getResponse(pollId, userId, weekId = getCurrentPollPeriodId()) {
    const rows = await this.pool.unsafe(
      `SELECT poll_id, week_id, user_id, username, selections, timestamp
       FROM public.poll_responses
       WHERE poll_id = $1
         AND user_id = $2
         AND week_id = $3
       LIMIT 1`,
      [pollId, userId, weekId]
    );

    const row = rows[0];
    if (!row) return null;

    return {
      pollId: row.poll_id,
      weekId: row.week_id,
      userId: row.user_id,
      username: row.username,
      selections: this.parseSelections(row.selections),
      timestamp: row.timestamp
    };
  }

  async saveResponse({ pollId, raidType, ftVariant = null, user, selections }) {
    const pollConfig = getPollConfig(pollId);
    if (!pollConfig) {
      throw new Error(`Unknown poll: ${pollId}`);
    }

    const scope = this.normalizeScope(raidType, ftVariant);
    if (!validatePollForRaid(pollId, scope.raidType, { ftVariant: scope.ftVariant })) {
      throw new Error(`Poll ${pollId} is not valid for ${scope.scopeKey}`);
    }

    const cleanSelections = this.validateSelections(pollConfig, selections);
    if (cleanSelections.length === 0) {
      throw new Error('At least one poll option must be selected');
    }

    const weekId = getCurrentPollPeriodId();
    const username = user?.tag || user?.username || user?.id;

    await this.pool.unsafe(
      `INSERT INTO public.poll_responses
        (poll_id, week_id, user_id, username, selections)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (poll_id, user_id, week_id)
       DO UPDATE SET
         username = EXCLUDED.username,
         selections = EXCLUDED.selections,
         timestamp = CURRENT_TIMESTAMP`,
      [pollId, weekId, user.id, username, JSON.stringify(cleanSelections)]
    );

    logger.debug('Poll response saved', {
      pollId,
      raidType: scope.raidType,
      ftVariant: scope.ftVariant,
      weekId,
      userId: user.id,
      selections: cleanSelections.length
    });

    return {
      pollConfig,
      scope,
      weekId,
      selections: cleanSelections
    };
  }

  async getTallies(pollId, raidType, ftVariant = null, weekId = getCurrentPollPeriodId()) {
    const pollConfig = getPollConfig(pollId);
    if (!pollConfig) {
      throw new Error(`Unknown poll: ${pollId}`);
    }

    this.normalizeScope(raidType, ftVariant);
    const rows = await this.pool.unsafe(
      `SELECT selections
       FROM public.poll_responses
       WHERE poll_id = $1
         AND week_id = $2`,
      [pollId, weekId]
    );

    const tallies = Object.fromEntries(pollConfig.options.map(option => [option.value, 0]));
    for (const row of rows) {
      const selections = this.parseSelections(row.selections);
      for (const value of selections) {
        if (Object.prototype.hasOwnProperty.call(tallies, value)) {
          tallies[value] += 1;
        }
      }
    }

    return tallies;
  }

  async getParticipantCount(pollId, raidType, ftVariant = null, weekId = getCurrentPollPeriodId()) {
    this.normalizeScope(raidType, ftVariant);
    const rows = await this.pool.unsafe(
      `SELECT COUNT(DISTINCT user_id)::int AS count
       FROM public.poll_responses
       WHERE poll_id = $1
         AND week_id = $2`,
      [pollId, weekId]
    );

    return rows[0]?.count || 0;
  }

  async getLatestWeekIdWithResponses(pollId) {
    const rows = await this.pool.unsafe(
      `SELECT week_id
       FROM public.poll_responses
       WHERE poll_id = $1
       GROUP BY week_id
       HAVING COUNT(*) > 0
       ORDER BY week_id DESC
       LIMIT 1`,
      [pollId]
    );

    return rows[0]?.week_id || null;
  }

  async getDisplayStats(pollId, raidType, ftVariant = null) {
    const currentWeekId = getCurrentPollPeriodId();
    let weekId = currentWeekId;
    let participantCount = await this.getParticipantCount(pollId, raidType, ftVariant, weekId);

    if (participantCount === 0) {
      const latestWeekId = await this.getLatestWeekIdWithResponses(pollId);
      if (latestWeekId) {
        weekId = latestWeekId;
        participantCount = await this.getParticipantCount(pollId, raidType, ftVariant, weekId);
      }
    }

    const tallies = await this.getTallies(pollId, raidType, ftVariant, weekId);
    return {
      tallies,
      participantCount,
      weekId,
      isCurrentPeriod: weekId === currentWeekId
    };
  }
}

module.exports = PollService;
