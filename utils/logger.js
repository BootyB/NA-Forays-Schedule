// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const winston = require('winston');
const { format } = winston;
const path = require('path');

const sanitizeSensitiveData = format((info) => {
  if (process.env.NODE_ENV !== 'production') {
    return info;
  }
  
  const sensitiveFields = ['guildId', 'userId', 'channelId', 'messageId'];
  
  for (const field of sensitiveFields) {
    if (info[field] && typeof info[field] === 'string') {
      info[field] = '***' + info[field].slice(-4);
    }
  }
  
  if (info.guildName && typeof info.guildName === 'string') {
    info.guildName = '[REDACTED]';
  }
  
  return info;
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    format.splat(),
    sanitizeSensitiveData(),
    format.json()
  ),
  defaultMeta: { service: 'na-schedule-bot' },
  transports: [
    new winston.transports.File({ 
      filename: path.join('logs', 'error.log'), 
      level: 'error',
      maxsize: 5242880,
      maxFiles: 5
    }),
    new winston.transports.File({ 
      filename: path.join('logs', 'combined.log'),
      maxsize: 5242880,
      maxFiles: 5
    }),
    new winston.transports.Console({
      format: format.combine(
        format.colorize(),
        format.printf(({ level, message, timestamp, ...metadata }) => {
          let msg = `${timestamp} ${level}: ${message}`;
          
          const metaKeys = Object.keys(metadata).filter(key => key !== 'service');
          if (metaKeys.length > 0) {
            const cleanMeta = {};
            metaKeys.forEach(key => cleanMeta[key] = metadata[key]);
            msg += ` ${JSON.stringify(cleanMeta)}`;
          }
          
          return msg;
        })
      )
    })
  ]
});

module.exports = logger;
