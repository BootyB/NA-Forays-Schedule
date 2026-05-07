// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const { DateTime } = require('luxon');
const { SCHEDULE_DAYS_AHEAD } = require('../config/constants');
const { isWhitelistedHost } = require('../config/hostServers');
const logger = require('../utils/logger');
const { isValidRaidType, getRunTypePriority, getRaidTypeQueryFilter } = require('../utils/raidTypes');

class ScheduleManager {
  constructor(pool) {
    this.pool = pool;
    
    this.queryCache = new Map();
    this.CACHE_TTL = 30000;
    
    this.cacheStats = { hits: 0, misses: 0 };
    
    this.statsInterval = setInterval(() => {
      const total = this.cacheStats.hits + this.cacheStats.misses;
      if (total > 0) {
        const hitRate = (this.cacheStats.hits / total * 100).toFixed(2);
        logger.info('Query cache statistics', {
          hits: this.cacheStats.hits,
          misses: this.cacheStats.misses,
          hitRate: `${hitRate}%`,
          cacheSize: this.queryCache.size
        });
      }
      this.cacheStats = { hits: 0, misses: 0 };
    }, 300000);
  }
  
  getCacheKey(raidType, enabledHosts, currentTime) {
    const timeWindow = Math.floor(currentTime / 60000);
    const sortedHosts = enabledHosts.slice().sort().join(',');
    return `${raidType}:${sortedHosts}:${timeWindow}`;
  }
  
  getCachedResult(cacheKey) {
    const cached = this.queryCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < this.CACHE_TTL)) {
      this.cacheStats.hits++;
      logger.debug('Cache hit', { cacheKey });
      return cached.data;
    }
    if (cached) {
      this.queryCache.delete(cacheKey);
    }
    this.cacheStats.misses++;
    return null;
  }
  
  setCachedResult(cacheKey, data) {
    this.queryCache.set(cacheKey, { 
      data, 
      timestamp: Date.now() 
    });
    
    if (this.queryCache.size > 100) {
      const entries = [...this.queryCache.entries()];
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      for (let i = 0; i < 20; i++) {
        this.queryCache.delete(entries[i][0]);
      }
      logger.debug('Cache cleanup performed', { 
        oldSize: this.queryCache.size + 20,
        newSize: this.queryCache.size 
      });
    }
  }
  
  destroy() {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
    }
    this.queryCache.clear();
  }

  async retryWithBackoff(fn, maxRetries = 3, initialDelay = 100) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        const isLastAttempt = attempt === maxRetries - 1;
        const isConnectionError = error.message && (
          error.message.includes('Max client connections reached') ||
          error.message.includes('connection') ||
          error.message.includes('timeout')
        );
        
        if (isLastAttempt || !isConnectionError) {
          throw error;
        }
        
        const delay = initialDelay * Math.pow(2, attempt);
        logger.warn('Database query failed, retrying', {
          attempt: attempt + 1,
          maxRetries,
          delay,
          error: error.message
        });
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  async fetchScheduleGroupedByServer(raidType, enabledHosts = [], daysAhead = SCHEDULE_DAYS_AHEAD) {
    const startTime = Date.now();
    
    try {
      if (!isValidRaidType(raidType)) {
        throw new Error(`Invalid raid type: ${raidType}`);
      }

      if (!enabledHosts || enabledHosts.length === 0) {
        logger.warn('No enabled hosts provided for schedule fetch', { raidType });
        return {};
      }

      const currentTime = Date.now();
      const futureTime = currentTime + (daysAhead * 24 * 60 * 60 * 1000);
      
      const cacheKey = this.getCacheKey(raidType, enabledHosts, currentTime);
      const cached = this.getCachedResult(cacheKey);
      if (cached) {
        logger.debug('Returning cached schedule', {
          raidType,
          cacheKey,
          duration: Date.now() - startTime
        });
        return cached;
      }

      const tableName = process.env.DB_TABLE_NAME;
      
      if (!tableName) {
        throw new Error('DB_TABLE_NAME must be set in environment variables');
      }
      
      const identifierRegex = /^[a-zA-Z0-9_]+$/;
      if (!identifierRegex.test(tableName)) {
        throw new Error('Invalid table name format');
      }
      
      const raidTypeFilter = getRaidTypeQueryFilter(raidType);
      const escapedHosts = enabledHosts.map(host => host.replace(/'/g, "''"));
      const arrayLiteral = `ARRAY[${escapedHosts.map(h => `'${h}'`).join(',')}]::text[]`;
      
      const query = `
        SELECT 
          "ID",
          "Type",
          "Start",
          "ServerNameTag",
          "ServerID",
          "RunDC",
          "ServerName",
          "referenceLink",
          "SourceMessageID",
          "EventID",
          "TimeStamp"
        FROM "${tableName}"
        WHERE "Start" > $1
          AND "Start" < $2
          AND "isCancelled" = 0
          AND ${raidTypeFilter}
          AND "ServerName" = ANY(${arrayLiteral})
        ORDER BY "ServerName", "Start" ASC
      `;
      
      const queryStartTime = Date.now();
      let runs;
      
      try {
        runs = await this.retryWithBackoff(async () => {
          return await this.pool.unsafe(query, [currentTime, futureTime]);
        });
      } catch (queryError) {
        logger.error('Database query failed', {
          raidType,
          duration: Date.now() - queryStartTime,
          error: queryError.message
        });
        throw queryError;
      }

      const groupedRuns = {};
      for (const run of runs) {
        if (!groupedRuns[run.ServerName]) {
          groupedRuns[run.ServerName] = [];
        }
        groupedRuns[run.ServerName].push(run);
      }
      
      this.setCachedResult(cacheKey, groupedRuns);

      const queryDuration = Date.now() - queryStartTime;
      const totalDuration = Date.now() - startTime;
      
      const logLevel = queryDuration > 1000 ? 'info' : 'debug';
      logger[logLevel]('Fetched schedule from database', {
        raidType,
        enabledHosts: enabledHosts.length,
        totalRuns: runs.length,
        servers: Object.keys(groupedRuns).length,
        queryDuration,
        totalDuration,
        cached: false
      });

      return groupedRuns;

    } catch (error) {
      logger.error('Error fetching schedule', {
        error: error.message,
        raidType,
        enabledHosts,
        duration: Date.now() - startTime
      });
      throw error;
    }
  }

  async fetchScheduleGroupedByType(raidType, enabledHosts = [], daysAhead = SCHEDULE_DAYS_AHEAD) {
    try {
      const groupedByServer = await this.fetchScheduleGroupedByServer(raidType, enabledHosts, daysAhead);
      
      const groupedByType = {};
      
      for (const serverName in groupedByServer) {
        for (const run of groupedByServer[serverName]) {
          const runType = run.Type || 'Unknown';
          if (!groupedByType[runType]) {
            groupedByType[runType] = [];
          }
          groupedByType[runType].push(run);
        }
      }

      for (const runType in groupedByType) {
        groupedByType[runType].sort((a, b) => a.Start - b.Start);
      }

      return groupedByType;

    } catch (error) {
      logger.error('Error fetching schedule grouped by type', {
        error: error.message,
        raidType
      });
      throw error;
    }
  }

  sortRunTypes(groupedRuns, raidType) {
    const priority = getRunTypePriority(raidType);
    const runTypes = Object.keys(groupedRuns);
    
    return runTypes.sort((a, b) => {
      const indexA = priority.indexOf(a);
      const indexB = priority.indexOf(b);
      
      if (indexA !== -1 && indexB !== -1) {
        return indexA - indexB;
      }
      
      if (indexA !== -1) return -1;
      
      if (indexB !== -1) return 1;
      
      return a.localeCompare(b);
    });
  }

  formatRunTime(startTime) {
    const timestamp = Math.round(startTime / 1000);
    return `<t:${timestamp}:F>`;
  }

  getRelativeTime(startTime) {
    const timestamp = Math.round(startTime / 1000);
    return `<t:${timestamp}:R>`;
  }

  async hasUpcomingRuns(raidType, enabledHosts) {
    try {
      const runs = await this.fetchScheduleGroupedByServer(raidType, enabledHosts);
      return Object.keys(runs).length > 0;
    } catch (error) {
      logger.error('Error checking for upcoming runs', {
        error: error.message,
        raidType
      });
      return false;
    }
  }
}

module.exports = ScheduleManager;
