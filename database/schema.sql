-- database/schema.sql - Database schema for NA Schedule Bot

-- Server configurations table
CREATE TABLE IF NOT EXISTS na_bot_server_configs (
  guild_id VARCHAR(20) NOT NULL,
  guild_id_encrypted TEXT DEFAULT NULL,
  guild_id_hash VARCHAR(64) NOT NULL,
  guild_name VARCHAR(255) DEFAULT NULL,
  setup_complete BOOLEAN DEFAULT false,
  auto_update BOOLEAN DEFAULT true,
  
  -- BA configuration
  schedule_channel_ba VARCHAR(20) DEFAULT NULL,
  enabled_hosts_ba JSONB DEFAULT NULL,
  schedule_message_ba JSONB DEFAULT NULL,
  schedule_overview_ba VARCHAR(20) DEFAULT NULL,
  schedule_color_ba INTEGER DEFAULT NULL,
  
  -- FT configuration
  schedule_channel_ft VARCHAR(20) DEFAULT NULL,
  enabled_hosts_ft JSONB DEFAULT NULL,
  enabled_ft_variants JSONB DEFAULT NULL,
  ft_channel_mode TEXT DEFAULT NULL,
  ft_variant_channel_ids JSONB DEFAULT NULL,
  ft_variant_overview_ids JSONB DEFAULT NULL,
  ft_variant_message_ids JSONB DEFAULT NULL,
  schedule_message_ft JSONB DEFAULT NULL,
  schedule_overview_ft VARCHAR(20) DEFAULT NULL,
  schedule_color_ft INTEGER DEFAULT NULL,
  schedule_color_ft_blood INTEGER DEFAULT -2,
  schedule_color_ft_magic INTEGER DEFAULT -2,
  
  -- DRS configuration
  schedule_channel_drs VARCHAR(20) DEFAULT NULL,
  enabled_hosts_drs JSONB DEFAULT NULL,
  schedule_message_drs JSONB DEFAULT NULL,
  schedule_overview_drs VARCHAR(20) DEFAULT NULL,
  schedule_color_drs INTEGER DEFAULT NULL,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  PRIMARY KEY (guild_id),
  CONSTRAINT idx_guild_id_hash UNIQUE (guild_id_hash)
);

CREATE INDEX IF NOT EXISTS idx_setup_complete ON na_bot_server_configs(setup_complete);
CREATE INDEX IF NOT EXISTS idx_auto_update ON na_bot_server_configs(auto_update);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_na_bot_server_configs_updated_at ON na_bot_server_configs;
CREATE TRIGGER update_na_bot_server_configs_updated_at
  BEFORE UPDATE ON na_bot_server_configs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Whitelisted guilds table
CREATE TABLE IF NOT EXISTS na_bot_whitelisted_guilds (
  guild_id VARCHAR(20) NOT NULL,
  guild_id_encrypted TEXT DEFAULT NULL,
  guild_id_hash VARCHAR(64) NOT NULL,
  guild_name VARCHAR(255) DEFAULT NULL,
  added_by VARCHAR(20) DEFAULT NULL,
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  notes TEXT DEFAULT NULL,
  
  PRIMARY KEY (guild_id),
  CONSTRAINT idx_whitelisted_guild_id_hash UNIQUE (guild_id_hash)
);

CREATE INDEX IF NOT EXISTS idx_whitelisted_is_active ON na_bot_whitelisted_guilds(is_active);

-- Whitelisted host servers table
CREATE TABLE IF NOT EXISTS na_bot_whitelisted_hosts (
  server_name VARCHAR(100) NOT NULL,
  added_by VARCHAR(20) DEFAULT NULL,
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  notes TEXT DEFAULT NULL,
  
  PRIMARY KEY (server_name)
);

CREATE INDEX IF NOT EXISTS idx_host_is_active ON na_bot_whitelisted_hosts(is_active);

-- Insert default host servers
INSERT INTO na_bot_whitelisted_hosts (server_name, added_by, is_active) VALUES
('CAFE', 'system', true),
('ABBA+', 'system', true),
('Field Op Enjoyers', 'system', true)
ON CONFLICT (server_name) DO UPDATE SET is_active = true;
