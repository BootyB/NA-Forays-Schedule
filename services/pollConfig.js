// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const POLL_CONFIGS = Object.freeze({
  ft_progpoint: {
    id: 'ft_progpoint',
    raidTypes: ['FT'],
    ftVariants: ['Blood'],
    title: 'Forked Tower: Blood Prog Point Poll',
    label: 'Which Blood prog points are you interested in?',
    description: 'Choose every Forked Tower: Blood prog point you would like to run this period.',
    options: [
      { value: 'fresh_anyprog', label: 'Early Prog', description: 'Fresh starts or any prog point welcome' },
      { value: 'dead_stars', label: 'Dead Stars', description: 'Second boss prog' },
      { value: 'marble_dragon', label: 'Marble Dragon', description: 'Third boss prog' },
      { value: 'magitaur', label: 'Magitaur', description: 'Final boss prog' },
      { value: 'reclear', label: 'Reclear', description: 'Full clear run' }
    ]
  },
  ft_magic_progpoint: {
    id: 'ft_magic_progpoint',
    raidTypes: ['FT'],
    ftVariants: ['Magic'],
    title: 'Forked Tower: Magic Prog Point Poll',
    label: 'Which prog points are you interested in?',
    description: 'Choose every prog point you would like to run this period.',
    options: [
      { value: 'fresh_anyprog', label: 'Fresh/AnyProg', description: 'Fresh starts or any prog point welcome' },
      { value: 'mid_prog', label: 'Boss #2', description: 'Boss #2 progression' },
      { value: 'late_prog', label: 'Boss #3', description: 'Boss #3 progression' },
      { value: 'final_prog', label: 'Boss #4', description: 'Final encounter progression' },
      { value: 'reclear', label: 'Reclear', description: 'Full clear run' }
    ]
  },
  ba_run_interest: {
    id: 'ba_run_interest',
    raidTypes: ['BA'],
    title: 'Baldesion Arsenal Interest Poll',
    label: 'Which BA runs are you interested in?',
    description: 'Choose every run style you would like to see this period.',
    options: [
      { value: 'learning', label: 'Learning', description: 'Learning or first-time friendly runs' },
      { value: 'standard', label: 'Standard', description: 'Standard scheduled runs' },
      { value: 'reclear', label: 'Reclear', description: 'Clear-focused repeat runs' },
      { value: 'frag', label: 'Frag', description: 'Fragment farming runs' },
      { value: 'meme', label: 'Meme', description: 'Special or unusual run formats' }
    ]
  },
  drs_progpoint: {
    id: 'drs_progpoint',
    raidTypes: ['DRS'],
    title: 'DRS Prog Point Poll',
    label: 'Which DRS prog points are you interested in?',
    description: 'Choose every prog point you would like to run this period.',
    options: [
      { value: 'fresh_anyprog', label: 'Fresh/AnyProg', description: 'Fresh starts or any prog point welcome' },
      { value: 'queens_guard', label: "Queen's Guard", description: 'Opening encounter prog' },
      { value: 'trinity_avowed', label: 'Trinity Avowed', description: 'Trinity Avowed prog' },
      { value: 'the_queen', label: 'The Queen', description: 'Final boss prog' },
      { value: 'reclear', label: 'Reclear', description: 'Full reclear runs' }
    ]
  }
});

const DEFAULT_ENABLED_POLLS = Object.freeze({
  BA: [],
  FT: ['ft_progpoint', 'ft_magic_progpoint'],
  DRS: []
});

function getPollConfig(pollId) {
  return POLL_CONFIGS[pollId] || null;
}

function normalizeFtVariant(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'magic' || normalized === 'ftm' || normalized === 'ftmex' ? 'Magic' : 'Blood';
}

function configMatchesScope(config, raidType, ftVariant = null) {
  if (!config || !config.raidTypes.includes(raidType)) return false;
  if (raidType !== 'FT') return true;
  if (!Array.isArray(config.ftVariants) || config.ftVariants.length === 0) return true;
  return config.ftVariants.includes(normalizeFtVariant(ftVariant));
}

function getDefaultPollIdForRaid(raidType, options = {}) {
  const entry = Object.values(POLL_CONFIGS).find(config => configMatchesScope(config, raidType, options.ftVariant));
  return entry?.id || null;
}

function getPollsForRaid(raidType, options = {}) {
  return Object.values(POLL_CONFIGS).filter(config => configMatchesScope(config, raidType, options.ftVariant));
}

function getPollsForRaidConfig(raidType) {
  return Object.values(POLL_CONFIGS).filter(config => config.raidTypes.includes(raidType));
}

function normalizeEnabledPolls(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = {};

  for (const raidType of Object.keys(DEFAULT_ENABLED_POLLS)) {
    const configured = Array.isArray(source[raidType]) ? source[raidType] : DEFAULT_ENABLED_POLLS[raidType];
    result[raidType] = configured.filter(pollId => {
      const config = getPollConfig(pollId);
      return Boolean(config && config.raidTypes.includes(raidType));
    });
  }

  return result;
}

function getEnabledPollIdsForRaid(value, raidType) {
  return normalizeEnabledPolls(value)[raidType] || [];
}

function validatePollForRaid(pollId, raidType, options = {}) {
  const config = getPollConfig(pollId);
  return Boolean(config && configMatchesScope(config, raidType, options.ftVariant));
}

module.exports = {
  POLL_CONFIGS,
  DEFAULT_ENABLED_POLLS,
  getPollConfig,
  getDefaultPollIdForRaid,
  getPollsForRaid,
  getPollsForRaidConfig,
  normalizeEnabledPolls,
  getEnabledPollIdsForRaid,
  validatePollForRaid
};
