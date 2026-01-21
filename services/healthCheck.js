// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const http = require('http');
const logger = require('../utils/logger');
const { DEFAULT_HEALTH_PORT } = require('../config/constants');

class HealthCheck {
  constructor(client, pool) {
    this.client = client;
    this.pool = pool;
    this.server = null;
    // Port can be overridden via HEALTH_PORT environment variable
    this.port = parseInt(process.env.HEALTH_PORT) || DEFAULT_HEALTH_PORT;
  }

  start() {
    this.server = http.createServer(async (req, res) => {
      if (req.url === '/health' && req.method === 'GET') {
        await this.handleHealthCheck(req, res);
      } else if (req.url === '/ready' && req.method === 'GET') {
        await this.handleReadyCheck(req, res);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    });

    this.server.listen(this.port, () => {
      logger.info(`Health check endpoint listening on port ${this.port}`);
    });

    this.server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        logger.warn(`Port ${this.port} already in use, health check disabled`);
      } else {
        logger.error('Health check server error', { error: error.message });
      }
    });
  }

  async handleHealthCheck(req, res) {
    try {
      const health = await this.getHealthStatus();
      const statusCode = health.status === 'healthy' ? 200 : 503;
      
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(health, null, 2));
    } catch (error) {
      logger.error('Health check error', { error: error.message });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        status: 'error', 
        error: error.message 
      }));
    }
  }

  async handleReadyCheck(req, res) {
    try {
      const isReady = await this.isReady();
      const statusCode = isReady ? 200 : 503;
      
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        ready: isReady,
        timestamp: new Date().toISOString()
      }));
    } catch (error) {
      logger.error('Ready check error', { error: error.message });
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        ready: false,
        error: error.message 
      }));
    }
  }

  async getHealthStatus() {
    const checks = {
      discord: await this.checkDiscord(),
      database: await this.checkDatabase(),
      uptime: this.getUptime()
    };

    const allHealthy = checks.discord.healthy && checks.database.healthy;

    return {
      status: allHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      checks
    };
  }

  async checkDiscord() {
    try {
      if (!this.client || !this.client.user) {
        return {
          healthy: false,
          message: 'Discord client not ready'
        };
      }

      const ping = this.client.ws.ping;
      
      return {
        healthy: true,
        message: 'Connected',
        username: this.client.user.tag,
        guilds: this.client.guilds.cache.size,
        ping: `${ping}ms`
      };
    } catch (error) {
      return {
        healthy: false,
        message: error.message
      };
    }
  }

  async checkDatabase() {
    try {
      const conn = await this.pool.getConnection();
      await conn.query('SELECT 1');
      conn.release();

      return {
        healthy: true,
        message: 'Connected'
      };
    } catch (error) {
      return {
        healthy: false,
        message: error.message
      };
    }
  }

  getUptime() {
    const uptime = process.uptime();
    const days = Math.floor(uptime / 86400);
    const hours = Math.floor((uptime % 86400) / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);

    return {
      seconds: Math.floor(uptime),
      formatted: `${days}d ${hours}h ${minutes}m ${seconds}s`
    };
  }

  async isReady() {
    const discord = await this.checkDiscord();
    const database = await this.checkDatabase();
    return discord.healthy && database.healthy;
  }

  stop() {
    if (this.server) {
      this.server.close(() => {
        logger.info('Health check server stopped');
      });
    }
  }
}

module.exports = HealthCheck;
