// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const commands = [];
const commandsPath = path.join(__dirname, 'commands', 'slash');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  
  if ('data' in command && 'execute' in command) {
    commands.push(command.data.toJSON());
    console.log(`✅ Loaded command: ${command.data.name}`);
  } else {
    console.log(`⚠️  Skipping ${file}: missing "data" or "execute" property`);
  }
}

if (!process.env.DISCORD_TOKEN || !process.env.DISCORD_CLIENT_ID) {
  console.error('❌ Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in .env file');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`\nStarted refreshing ${commands.length} application (/) commands.`);

    const data = await rest.put(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
      { body: commands },
    );

    console.log(`✅ Successfully reloaded ${data.length} application (/) commands globally.\n`);
    
    console.log('Deployed commands:');
    data.forEach(cmd => {
      console.log(`  - /${cmd.name}: ${cmd.description}`);
    });
    
    console.log('\n✨ Deployment complete!');

  } catch (error) {
    console.error('❌ Error deploying commands:', error);
    process.exit(1);
  }
})();
