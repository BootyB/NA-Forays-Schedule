-- database/schema.sql - Database schema for NA Forays Schedule Bot

-- Server configurations table
CREATE TABLE IF NOT EXISTS `na_bot_server_configs` (
  `guild_id` VARCHAR(20) NOT NULL,
  `guild_id_encrypted` TEXT DEFAULT NULL,
  `guild_id_hash` VARCHAR(64) NOT NULL,
  `guild_name` VARCHAR(255) DEFAULT NULL,
  `setup_complete` TINYINT(1) DEFAULT 0,
  `auto_update` TINYINT(1) DEFAULT 1,
  
  -- BA configuration
  `schedule_channel_ba` VARCHAR(20) DEFAULT NULL,
  `enabled_hosts_ba` JSON DEFAULT NULL,
  `schedule_message_ba` JSON DEFAULT NULL,
  `schedule_overview_ba` VARCHAR(20) DEFAULT NULL,
  `schedule_color_ba` INT DEFAULT NULL,
  
  -- FT configuration
  `schedule_channel_ft` VARCHAR(20) DEFAULT NULL,
  `enabled_hosts_ft` JSON DEFAULT NULL,
  `schedule_message_ft` JSON DEFAULT NULL,
  `schedule_overview_ft` VARCHAR(20) DEFAULT NULL,
  `schedule_color_ft` INT DEFAULT NULL,
  
  -- DRS configuration
  `schedule_channel_drs` VARCHAR(20) DEFAULT NULL,
  `enabled_hosts_drs` JSON DEFAULT NULL,
  `schedule_message_drs` JSON DEFAULT NULL,
  `schedule_overview_drs` VARCHAR(20) DEFAULT NULL,
  `schedule_color_drs` INT DEFAULT NULL,
  
  -- Timestamps
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  PRIMARY KEY (`guild_id`),
  UNIQUE KEY `idx_guild_id_hash` (`guild_id_hash`),
  KEY `idx_setup_complete` (`setup_complete`),
  KEY `idx_auto_update` (`auto_update`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Whitelisted guilds table
CREATE TABLE IF NOT EXISTS `na_bot_whitelisted_guilds` (
  `guild_id` VARCHAR(20) NOT NULL,
  `guild_id_encrypted` TEXT DEFAULT NULL,
  `guild_id_hash` VARCHAR(64) NOT NULL,
  `guild_name` VARCHAR(255) DEFAULT NULL,
  `added_by` VARCHAR(20) DEFAULT NULL,
  `added_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `is_active` TINYINT(1) DEFAULT 1,
  `notes` TEXT DEFAULT NULL,
  
  PRIMARY KEY (`guild_id`),
  UNIQUE KEY `idx_guild_id_hash` (`guild_id_hash`),
  KEY `idx_is_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Whitelisted host servers table
CREATE TABLE IF NOT EXISTS `na_bot_whitelisted_hosts` (
  `server_name` VARCHAR(100) NOT NULL,
  `added_by` VARCHAR(20) DEFAULT NULL,
  `added_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `is_active` TINYINT(1) DEFAULT 1,
  `notes` TEXT DEFAULT NULL,
  
  PRIMARY KEY (`server_name`),
  KEY `idx_is_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Insert default host servers
INSERT INTO `na_bot_whitelisted_hosts` (`server_name`, `added_by`, `is_active`) VALUES
('CAFE', 'system', 1),
('ABBA+', 'system', 1),
('Field Op Enjoyers', 'system', 1)
ON DUPLICATE KEY UPDATE `is_active` = 1;
