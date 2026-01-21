// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const logger = require('../utils/logger');
const { UPDATE_INTERVAL } = require('../config/constants');

class TimerService {
  constructor(updateManager) {
    this.updateManager = updateManager;
    this.intervalId = null;
    this.isRunning = false;
  }

  start() {
    if (this.isRunning) {
      logger.warn('Timer service already running');
      return;
    }

    logger.info('Starting timer service', { interval: UPDATE_INTERVAL });
    
    this.runUpdate();
    
    this.intervalId = setInterval(() => {
      this.runUpdate();
    }, UPDATE_INTERVAL);
    
    this.isRunning = true;
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    logger.info('Timer service stopped');
  }

  async runUpdate() {
    try {
      logger.info('Timer triggered update cycle');
      await this.updateManager.updateAllSchedules();
    } catch (error) {
      logger.error('Error in timer update cycle', {
        error: error.message,
        stack: error.stack
      });
    }
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      interval: UPDATE_INTERVAL
    };
  }
}

module.exports = TimerService;
