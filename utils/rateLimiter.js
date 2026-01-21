// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const logger = require('./logger');
const { RATE_LIMITER } = require('../config/constants');
class RateLimiter {
  constructor() {
    this.userCommandCooldowns = new Map();
    this.userInteractionCooldowns = new Map();
    
    this.COMMAND_COOLDOWN = RATE_LIMITER.COMMAND_COOLDOWN;
    this.INTERACTION_COOLDOWN = RATE_LIMITER.INTERACTION_COOLDOWN;
    
    this.userRequestCounts = new Map();
    this.REQUEST_WINDOW = RATE_LIMITER.REQUEST_WINDOW;
    this.MAX_REQUESTS_PER_WINDOW = RATE_LIMITER.MAX_REQUESTS_PER_WINDOW;
    
    setInterval(() => this.cleanup(), RATE_LIMITER.CLEANUP_INTERVAL);
  }

  checkCommandCooldown(userId, commandName) {
    const key = `${userId}:${commandName}`;
    const now = Date.now();
    
    const requestCheck = this.checkRequestLimit(userId);
    if (!requestCheck.allowed) {
      return requestCheck;
    }
    
    const lastUsed = this.userCommandCooldowns.get(key);
    
    if (lastUsed) {
      const timeSince = now - lastUsed;
      if (timeSince < this.COMMAND_COOLDOWN) {
        const timeLeft = Math.ceil((this.COMMAND_COOLDOWN - timeSince) / 1000);
        return { allowed: false, timeLeft };
      }
    }
    
    this.userCommandCooldowns.set(key, now);
    this.incrementRequestCount(userId);
    return { allowed: true };
  }

  checkInteractionCooldown(userId, interactionType) {
    const key = `${userId}:${interactionType}`;
    const now = Date.now();
    
    const requestCheck = this.checkRequestLimit(userId);
    if (!requestCheck.allowed) {
      return requestCheck;
    }
    
    const lastUsed = this.userInteractionCooldowns.get(key);
    
    if (lastUsed) {
      const timeSince = now - lastUsed;
      if (timeSince < this.INTERACTION_COOLDOWN) {
        return { allowed: false, timeLeft: 1 };
      }
    }
    
    this.userInteractionCooldowns.set(key, now);
    this.incrementRequestCount(userId);
    return { allowed: true };
  }

  checkRequestLimit(userId) {
    const now = Date.now();
    const userData = this.userRequestCounts.get(userId);
    
    if (!userData) {
      return { allowed: true };
    }
    
    const recentRequests = userData.requests.filter(time => now - time < this.REQUEST_WINDOW);
    
    if (recentRequests.length >= this.MAX_REQUESTS_PER_WINDOW) {
      const oldestRequest = Math.min(...recentRequests);
      const timeLeft = Math.ceil((this.REQUEST_WINDOW - (now - oldestRequest)) / 1000);
      
      logger.warn('Rate limit exceeded', {
        userId,
        requestCount: recentRequests.length,
        timeLeft
      });
      
      return { allowed: false, timeLeft };
    }
    
    return { allowed: true };
  }

  incrementRequestCount(userId) {
    const now = Date.now();
    const userData = this.userRequestCounts.get(userId) || { requests: [] };
    
    userData.requests.push(now);
    userData.requests = userData.requests.filter(time => now - time < this.REQUEST_WINDOW);
    
    this.userRequestCounts.set(userId, userData);
  }

  clearCommandCooldown(userId, commandName) {
    const key = `${userId}:${commandName}`;
    this.userCommandCooldowns.delete(key);
  }

  clearUserCooldowns(userId) {
    for (const [key] of this.userCommandCooldowns) {
      if (key.startsWith(`${userId}:`)) {
        this.userCommandCooldowns.delete(key);
      }
    }
    
    for (const [key] of this.userInteractionCooldowns) {
      if (key.startsWith(`${userId}:`)) {
        this.userInteractionCooldowns.delete(key);
      }
    }
    
    this.userRequestCounts.delete(userId);
  }

  cleanup() {
    const now = Date.now();
    
    for (const [key, timestamp] of this.userCommandCooldowns) {
      if (now - timestamp > this.COMMAND_COOLDOWN * 10) {
        this.userCommandCooldowns.delete(key);
      }
    }
    
    for (const [key, timestamp] of this.userInteractionCooldowns) {
      if (now - timestamp > this.INTERACTION_COOLDOWN * 10) {
        this.userInteractionCooldowns.delete(key);
      }
    }
    
    for (const [userId, userData] of this.userRequestCounts) {
      userData.requests = userData.requests.filter(time => now - time < this.REQUEST_WINDOW);
      if (userData.requests.length === 0) {
        this.userRequestCounts.delete(userId);
      }
    }
    
    logger.debug('Rate limiter cleanup completed', {
      commandCooldowns: this.userCommandCooldowns.size,
      interactionCooldowns: this.userInteractionCooldowns.size,
      requestCounts: this.userRequestCounts.size
    });
  }

  getStats() {
    return {
      commandCooldowns: this.userCommandCooldowns.size,
      interactionCooldowns: this.userInteractionCooldowns.size,
      trackedUsers: this.userRequestCounts.size,
      totalRequests: Array.from(this.userRequestCounts.values())
        .reduce((sum, data) => sum + data.requests.length, 0)
    };
  }
}

module.exports = new RateLimiter();
