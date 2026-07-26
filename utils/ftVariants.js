// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const FT_VARIANTS = Object.freeze({
  Blood: {
    value: 'Blood',
    label: 'Forked Tower: Blood',
    shortLabel: 'FTB',
    description: 'Display Forked Tower: Blood runs'
  },
  Magic: {
    value: 'Magic',
    label: 'Forked Tower: Magic (Extreme)',
    shortLabel: 'FTM',
    description: 'Display Forked Tower: Magic (Extreme) runs'
  }
});

const DEFAULT_FT_VARIANTS = Object.freeze(['Blood', 'Magic']);

function normalizeFtVariantValue(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'magic' || normalized === 'ftm' || normalized === 'ftmex') {
    return 'Magic';
  }
  return 'Blood';
}

function normalizeEnabledFtVariants(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return [...DEFAULT_FT_VARIANTS];
  }

  const variants = [];
  for (const item of value) {
    const variant = normalizeFtVariantValue(item);
    if (!variants.includes(variant)) {
      variants.push(variant);
    }
  }

  return variants.length > 0 ? variants : [...DEFAULT_FT_VARIANTS];
}

function validateEnabledFtVariants(value) {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((item) => DEFAULT_FT_VARIANTS.includes(item));
}

function getFtVariantInfo(value) {
  return FT_VARIANTS[normalizeFtVariantValue(value)];
}

function getFtVariantLabel(value) {
  return getFtVariantInfo(value).label;
}

function getFtVariantShortLabel(value) {
  return getFtVariantInfo(value).shortLabel;
}

function getFtVariantOptions(selectedVariants = DEFAULT_FT_VARIANTS) {
  const selected = normalizeEnabledFtVariants(selectedVariants);
  return DEFAULT_FT_VARIANTS.map((variant) => ({
    label: `${FT_VARIANTS[variant].shortLabel} - ${FT_VARIANTS[variant].label}`,
    description: FT_VARIANTS[variant].description,
    value: variant,
    default: selected.includes(variant)
  }));
}

module.exports = {
  FT_VARIANTS,
  DEFAULT_FT_VARIANTS,
  normalizeFtVariantValue,
  normalizeEnabledFtVariants,
  validateEnabledFtVariants,
  getFtVariantInfo,
  getFtVariantLabel,
  getFtVariantShortLabel,
  getFtVariantOptions
};
