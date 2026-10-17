// CRM Theme & Appearance State Manager

import { COLOR_PALETTES, generateRandomHarmoniousPalette } from '../SiteSettings/ThemeAndPalettePresets';
import { saveSettingsToApi } from '../../../platformDefaults';

export { COLOR_PALETTES };

export const CRM_THEME_PRESETS = [
  {
    id: 'apple-space-gray',
    name: 'Apple Space Gray (Original Standard)',
    category: 'Dark',
    desc: 'A neutral dark workspace with distinct solid surfaces, clear borders, and Cupertino Blue.',
    isLight: false,
    accent: '#0A84FF',
    accentHover: '#0071E3',
    bg: '#16171B',
    card: '#23242A',
    cardHover: '#2D2F36',
    border: 'rgba(255, 255, 255, 0.14)',
    borderHover: 'rgba(255, 255, 255, 0.22)',
    textPrimary: '#F5F5F7',
    textSecondary: '#B0B0B5',
    textMuted: '#929298',
    inputBg: '#1C1C1E',
    tag: 'Apple Default',
  },
  {
    id: 'apple-dark-graphite',
    name: 'Apple Dark Graphite (Titanium)',
    category: 'Dark',
    desc: 'A restrained graphite workspace with an Indigo accent.',
    isLight: false,
    accent: '#5E5CE6',
    accentHover: '#7D7AFF',
    bg: '#121214',
    card: '#1C1C1E',
    cardHover: '#2C2C2E',
    border: 'rgba(255, 255, 255, 0.14)',
    borderHover: 'rgba(255, 255, 255, 0.22)',
    textPrimary: '#F5F5F7',
    textSecondary: '#B0B0B5',
    textMuted: '#929298',
    inputBg: '#1C1C1E',
    tag: 'Graphite',
  },
  {
    id: 'apple-light',
    name: 'Apple Light (Cupertino Clean)',
    category: 'Light',
    desc: 'White panels on a soft gray canvas, clear dividers, and deep teal.',
    isLight: true,
    accent: '#2E756A',
    accentHover: '#236056',
    bg: '#EEF0F3',
    card: '#F8F9FB',
    cardHover: '#ECEEF2',
    border: 'rgba(29, 29, 31, 0.16)',
    borderHover: 'rgba(29, 29, 31, 0.24)',
    textPrimary: '#1D1D1F',
    textSecondary: '#6E6E73',
    textMuted: '#6E6E73',
    inputBg: '#FBFBFC',
    tag: 'Cupertino Light',
  },
  {
    id: 'macos-slate-gray',
    name: 'macOS Slate Gray',
    category: 'Dark',
    desc: 'A cool slate workspace with solid surfaces and a restrained cyan accent.',
    isLight: false,
    accent: '#00C7BE',
    accentHover: '#30D8D1',
    bg: '#131922',
    card: '#202A38',
    cardHover: '#303F52',
    border: 'rgba(255, 255, 255, 0.14)',
    borderHover: 'rgba(255, 255, 255, 0.22)',
    textPrimary: '#F0F4F8',
    textSecondary: '#8B98A5',
    textMuted: '#586574',
    inputBg: '#1C1C1E',
    tag: 'Slate',
  },
  {
    id: 'sunset-gold',
    name: 'Sunset Amber & Gold',
    category: 'Luxury',
    desc: 'Warm charcoal obsidian and amber gold palette delivering high-end agency prestige.',
    isLight: false,
    accent: '#F28C45',
    accentHover: '#FFA66D',
    bg: '#161310',
    card: '#251F1A',
    cardHover: '#382C22',
    border: 'rgba(242, 140, 69, 0.16)',
    borderHover: 'rgba(242, 140, 69, 0.32)',
    textPrimary: '#FAF5EE',
    textSecondary: '#A39587',
    textMuted: '#6B6055',
    inputBg: 'rgba(255, 255, 255, 0.05)',
    tag: 'Luxury Gold',
  },
  {
    id: 'emerald-mint',
    name: 'Apple Mint & Pine',
    category: 'Dark',
    desc: 'Deep evergreen pine canvas paired with crisp Apple Mint green metrics and clean typography.',
    isLight: false,
    accent: '#30D158',
    accentHover: '#34E061',
    bg: '#121714',
    card: '#1D2520',
    cardHover: '#26312B',
    border: 'rgba(48, 209, 88, 0.16)',
    borderHover: 'rgba(48, 209, 88, 0.3)',
    textPrimary: '#EDF8F1',
    textSecondary: '#7CA88D',
    textMuted: '#4C6E59',
    inputBg: 'rgba(255, 255, 255, 0.05)',
    tag: 'Apple Mint',
  },
  {
    id: 'royal-purple',
    name: 'Royal Amethyst',
    category: 'Dark',
    desc: 'A dark neutral canvas with a restrained purple accent.',
    isLight: false,
    accent: '#BF5AF2',
    accentHover: '#D17CFA',
    bg: '#1A1427',
    card: '#2B2040',
    cardHover: '#40305D',
    border: 'rgba(191, 90, 242, 0.18)',
    borderHover: 'rgba(191, 90, 242, 0.35)',
    textPrimary: '#F7F2FC',
    textSecondary: '#9A8AA8',
    textMuted: '#635570',
    inputBg: 'rgba(255, 255, 255, 0.05)',
    tag: 'Amethyst',
  },
  {
    id: 'obsidian-cyber',
    name: 'Obsidian Jet & Gold',
    category: 'Dark',
    desc: 'Deepest pure jet-black foundation with crisp Codex Gold and razor-sharp Apple hairlines.',
    isLight: false,
    accent: '#F0B90B',
    accentHover: '#FCD535',
    bg: '#08090B',
    card: '#17191C',
    cardHover: '#282B30',
    border: 'rgba(240, 185, 11, 0.15)',
    borderHover: 'rgba(240, 185, 11, 0.3)',
    textPrimary: '#EAECEF',
    textSecondary: '#848E9C',
    textMuted: '#5E6673',
    inputBg: 'rgba(255, 255, 255, 0.05)',
    tag: 'Codex Gold',
  },
  {
    id: 'arctic-ice',
    name: 'Arctic Ice',
    category: 'Light',
    desc: 'Cool, airy blue-gray surfaces with a composed teal-blue accent.',
    isLight: true,
    accent: '#176B87',
    accentHover: '#12566D',
    bg: '#EAF3F6',
    card: '#F3FAFC',
    cardHover: '#D2E7ED',
    border: 'rgba(23, 107, 135, 0.16)',
    borderHover: 'rgba(23, 107, 135, 0.3)',
    textPrimary: '#172A32',
    textSecondary: '#526B75',
    textMuted: '#71858C',
    inputBg: '#F8FCFD',
    tag: 'Nordic',
  },
  {
    id: 'rose-quartz',
    name: 'Rose Quartz',
    category: 'Light',
    desc: 'Powder-rose surfaces with a restrained berry accent.',
    isLight: true,
    accent: '#A44762',
    accentHover: '#87364F',
    bg: '#F7EDF0',
    card: '#FDF9FA',
    cardHover: '#EDDDE3',
    border: 'rgba(164, 71, 98, 0.15)',
    borderHover: 'rgba(164, 71, 98, 0.28)',
    textPrimary: '#302128',
    textSecondary: '#725761',
    textMuted: '#88727C',
    inputBg: '#FFFBFC',
    tag: 'Blush',
  },
  {
    id: 'sage-canvas',
    name: 'Sage Canvas',
    category: 'Light',
    desc: 'Muted botanical surfaces paired with a deep evergreen accent.',
    isLight: true,
    accent: '#38634D',
    accentHover: '#2D523F',
    bg: '#EDF3ED',
    card: '#FAFCF8',
    cardHover: '#DCE8DC',
    border: 'rgba(56, 99, 77, 0.16)',
    borderHover: 'rgba(56, 99, 77, 0.3)',
    textPrimary: '#1C2920',
    textSecondary: '#566B5C',
    textMuted: '#718275',
    inputBg: '#FAFCF9',
    tag: 'Botanical',
  },
  {
    id: 'lavender-mist',
    name: 'Lavender Mist',
    category: 'Light',
    desc: 'Soft lilac-gray surfaces finished with a muted violet accent.',
    isLight: true,
    accent: '#68508F',
    accentHover: '#553F78',
    bg: '#F1EEF8',
    card: '#F7F3FC',
    cardHover: '#DED6ED',
    border: 'rgba(104, 80, 143, 0.16)',
    borderHover: 'rgba(104, 80, 143, 0.3)',
    textPrimary: '#282235',
    textSecondary: '#625A73',
    textMuted: '#7B738A',
    inputBg: '#FCFBFE',
    tag: 'Lavender',
  },
  {
    id: 'sandstone-studio',
    name: 'Sandstone Studio',
    category: 'Luxury',
    desc: 'Warm limestone neutrals with a subtle espresso-brown accent.',
    isLight: true,
    accent: '#81592F',
    accentHover: '#684625',
    bg: '#EEE2D1',
    card: '#FFF8ED',
    cardHover: '#E6D4B8',
    border: 'rgba(129, 89, 47, 0.18)',
    borderHover: 'rgba(129, 89, 47, 0.3)',
    textPrimary: '#29241D',
    textSecondary: '#665B4D',
    textMuted: '#7C7163',
    inputBg: '#FFFEFC',
    tag: 'Stone',
  },
  {
    id: 'oceanic-teal',
    name: 'Oceanic Teal',
    category: 'Dark',
    desc: 'Deep blue-green panels accented with calm sea-glass teal.',
    isLight: false,
    accent: '#63C9B2',
    accentHover: '#83D8C5',
    bg: '#0F1C1F',
    card: '#182B2E',
    cardHover: '#234043',
    border: 'rgba(99, 201, 178, 0.17)',
    borderHover: 'rgba(99, 201, 178, 0.32)',
    textPrimary: '#EAF5F1',
    textSecondary: '#A3BCB5',
    textMuted: '#78918A',
    inputBg: '#142427',
    tag: 'Sea Glass',
  },
  {
    id: 'midnight-navy',
    name: 'Midnight Navy',
    category: 'Dark',
    desc: 'Ink-navy surfaces with softened cornflower-blue highlights.',
    isLight: false,
    accent: '#88A9E8',
    accentHover: '#A6BDF0',
    bg: '#111929',
    card: '#1A2940',
    cardHover: '#283B59',
    border: 'rgba(136, 169, 232, 0.17)',
    borderHover: 'rgba(136, 169, 232, 0.32)',
    textPrimary: '#EEF2F9',
    textSecondary: '#A7B4C9',
    textMuted: '#7D8AA0',
    inputBg: '#172238',
    tag: 'Navy',
  },
  {
    id: 'crimson-ember',
    name: 'Crimson Ember',
    category: 'Dark',
    desc: 'Smoky garnet surfaces with a softened rose-red highlight.',
    isLight: false,
    accent: '#E68A9C',
    accentHover: '#F0A8B5',
    bg: '#1C151B',
    card: '#2C202A',
    cardHover: '#3F2B38',
    border: 'rgba(230, 138, 156, 0.17)',
    borderHover: 'rgba(230, 138, 156, 0.32)',
    textPrimary: '#F8EFF2',
    textSecondary: '#C3AAB4',
    textMuted: '#967E88',
    inputBg: '#231922',
    tag: 'Garnet',
  },
  {
    id: 'violet-nebula',
    name: 'Violet Nebula',
    category: 'Dark',
    desc: 'Quiet aubergine layers with a soft, luminous periwinkle accent.',
    isLight: false,
    accent: '#B7A7EE',
    accentHover: '#CCBFF5',
    bg: '#171523',
    card: '#242238',
    cardHover: '#342F4E',
    border: 'rgba(183, 167, 238, 0.18)',
    borderHover: 'rgba(183, 167, 238, 0.34)',
    textPrimary: '#F2F0FB',
    textSecondary: '#B3AEC9',
    textMuted: '#85809F',
    inputBg: '#1E1C30',
    tag: 'Periwinkle',
  },
  {
    id: 'forest-canopy',
    name: 'Forest Canopy',
    category: 'Dark',
    desc: 'Deep forest-green layers with gentle olive-lime highlights.',
    isLight: false,
    accent: '#AEBB69',
    accentHover: '#C0CC82',
    bg: '#1A1B11',
    card: '#2A2B1B',
    cardHover: '#41412A',
    border: 'rgba(174, 187, 105, 0.16)',
    borderHover: 'rgba(174, 187, 105, 0.3)',
    textPrimary: '#EEF4E9',
    textSecondary: '#AAB79F',
    textMuted: '#7E8A74',
    inputBg: '#222318',
    tag: 'Canopy',
  },
  {
    id: 'copper-noir',
    name: 'Copper Noir',
    category: 'Luxury',
    desc: 'Understated espresso surfaces with a polished copper highlight.',
    isLight: false,
    accent: '#D6A278',
    accentHover: '#E4B995',
    bg: '#1B1715',
    card: '#2A221E',
    cardHover: '#3B3028',
    border: 'rgba(214, 162, 120, 0.17)',
    borderHover: 'rgba(214, 162, 120, 0.32)',
    textPrimary: '#F7F1EB',
    textSecondary: '#B9AAA0',
    textMuted: '#8D7F75',
    inputBg: '#221C19',
    tag: 'Espresso',
  },
  {
    id: 'cyber-cyan',
    name: 'Neon Circuit',
    category: 'Dark',
    desc: 'Deep blue-steel panels with a clear electric-cyan accent.',
    isLight: false,
    accent: '#59B9D0',
    accentHover: '#79C9DA',
    bg: '#0D1B25',
    card: '#173141',
    cardHover: '#22485A',
    border: 'rgba(89, 185, 208, 0.17)',
    borderHover: 'rgba(89, 185, 208, 0.32)',
    textPrimary: '#EDF6F8',
    textSecondary: '#A5BDC4',
    textMuted: '#78949D',
    inputBg: '#122630',
    tag: 'Circuit',
  },
  {
    id: 'monaco-rose',
    name: 'Bordeaux Atelier',
    category: 'Luxury',
    desc: 'Bordeaux-charcoal surfaces finished with a quiet orchid accent.',
    isLight: false,
    accent: '#B08BB5',
    accentHover: '#C3A0C7',
    bg: '#211719',
    card: '#34252A',
    cardHover: '#4A3439',
    border: 'rgba(176, 139, 181, 0.17)',
    borderHover: 'rgba(176, 139, 181, 0.32)',
    textPrimary: '#F7EFEC',
    textSecondary: '#BBA9A4',
    textMuted: '#8F7D78',
    inputBg: '#241B1F',
    tag: 'Orchid',
  },
  {
    id: 'alpine-slate',
    name: 'Alpine Slate',
    category: 'Dark',
    desc: 'Cool slate layers with restrained, pale mineral highlights.',
    isLight: false,
    accent: '#B9CCD1',
    accentHover: '#D2E0E3',
    bg: '#1A2028',
    card: '#283845',
    cardHover: '#3A5060',
    border: 'rgba(185, 204, 209, 0.16)',
    borderHover: 'rgba(185, 204, 209, 0.3)',
    textPrimary: '#EDF2F3',
    textSecondary: '#A9B6BA',
    textMuted: '#7E8B8F',
    inputBg: '#1A252A',
    tag: 'Alpine',
  },
  {
    id: 'solar-flare',
    name: 'Solar Flare',
    category: 'Dark',
    desc: 'Deep umber surfaces with a crisp, ember-red accent.',
    isLight: false,
    accent: '#D96C4E',
    accentHover: '#EA8A6F',
    bg: '#1E1912',
    card: '#30271A',
    cardHover: '#48391F',
    border: 'rgba(217, 108, 78, 0.17)',
    borderHover: 'rgba(217, 108, 78, 0.32)',
    textPrimary: '#F8F2E7',
    textSecondary: '#C1B297',
    textMuted: '#90836A',
    inputBg: '#251F16',
    tag: 'Ember',
  },
  {
    id: 'monochrome-ink',
    name: 'Monochrome Ink',
    category: 'Dark',
    desc: 'Quiet graphite surfaces with precise, cool-silver details.',
    isLight: false,
    accent: '#E1E4E8',
    accentHover: '#F0F2F4',
    bg: '#202124',
    card: '#2E3033',
    cardHover: '#404348',
    border: 'rgba(196, 205, 216, 0.16)',
    borderHover: 'rgba(196, 205, 216, 0.3)',
    textPrimary: '#F1F3F5',
    textSecondary: '#AEB6BF',
    textMuted: '#7F8994',
    inputBg: '#27292C',
    tag: 'Monochrome',
  },
  {
    id: 'porcelain-blue',
    name: 'Porcelain Ivory',
    category: 'Light',
    desc: 'Warm ivory paper tones grounded by a quiet clay accent.',
    isLight: true,
    accent: '#98654D',
    accentHover: '#7C513D',
    bg: '#F4F0E6',
    card: '#FFFCF5',
    cardHover: '#E7E0D1',
    border: 'rgba(152, 101, 77, 0.16)',
    borderHover: 'rgba(152, 101, 77, 0.3)',
    textPrimary: '#242820',
    textSecondary: '#5F6258',
    textMuted: '#77796F',
    inputBg: '#FDFBF6',
    tag: 'Porcelain',
  },
  {
    id: 'citrus-grove',
    name: 'Citrus Grove',
    category: 'Light',
    desc: 'Soft citron paper with a grounded olive accent.',
    isLight: true,
    accent: '#667C32',
    accentHover: '#526427',
    bg: '#F4EDCF',
    card: '#FFF8DD',
    cardHover: '#E9DDAE',
    border: 'rgba(102, 124, 50, 0.17)',
    borderHover: 'rgba(102, 124, 50, 0.3)',
    textPrimary: '#29281E',
    textSecondary: '#65624E',
    textMuted: '#7C7964',
    inputBg: '#FDFBF5',
    tag: 'Citrus',
  },
  {
    id: 'coral-reef',
    name: 'Coral Reef',
    category: 'Light',
    desc: 'Warm shell-pink surfaces with a composed terracotta accent.',
    isLight: true,
    accent: '#B54C3C',
    accentHover: '#963E33',
    bg: '#F8EFEB',
    card: '#FCEFEA',
    cardHover: '#EBCFC3',
    border: 'rgba(181, 76, 60, 0.16)',
    borderHover: 'rgba(181, 76, 60, 0.3)',
    textPrimary: '#2B211E',
    textSecondary: '#6B5751',
    textMuted: '#85716A',
    inputBg: '#FFFBF9',
    tag: 'Coral',
  },
  {
    id: 'champagne-luxe',
    name: 'Silver Pearl',
    category: 'Luxury',
    desc: 'Cool pearl-gray surfaces with tailored slate-blue details.',
    isLight: true,
    accent: '#465B76',
    accentHover: '#36475D',
    bg: '#DFE5ED',
    card: '#EEF2F7',
    cardHover: '#CBD5E0',
    border: 'rgba(89, 103, 125, 0.17)',
    borderHover: 'rgba(89, 103, 125, 0.3)',
    textPrimary: '#20242B',
    textSecondary: '#5C6470',
    textMuted: '#747C87',
    inputBg: '#FBFCFD',
    tag: 'Pearl',
  },
];

export const ACCENT_SWATCHES = [
  { name: 'Cupertino Blue', hex: '#0071E3' },
  { name: 'Azure Vibrant', hex: '#0A84FF' },
  { name: 'Apple Mint', hex: '#30D158' },
  { name: 'Apple Indigo', hex: '#5E5CE6' },
  { name: 'Apple Amber', hex: '#FF9F0A' },
  { name: 'Apple Rose', hex: '#FF375F' },
  { name: 'Apple Cyan', hex: '#00C7BE' },
  { name: 'Apple Purple', hex: '#BF5AF2' },
  { name: 'Codex Gold', hex: '#F0B90B' },
  { name: 'Titanium Gray', hex: '#8E8E93' },
];

export const DENSITY_OPTIONS = [
  { id: 'compact', name: 'Compact', desc: 'Maximum data density (38px rows, tighter padding)' },
  { id: 'comfortable', name: 'Comfortable', desc: 'Apple standard balance (48px rows, balanced whitespace)' },
  { id: 'spacious', name: 'Spacious', desc: 'Relaxed touch-friendly flow (56px rows, airy padding)' },
];

export const RADIUS_OPTIONS = [
  { id: 'ios-modern', name: 'iOS Squircle (14px)', radius: '14px' },
  { id: 'clean', name: 'Refined Rounded (8px)', radius: '8px' },
  { id: 'subtle', name: 'Crisp Minimal (4px)', radius: '4px' },
];

// Harmonious seeds for Coolors generator
export const COOLORS_SEEDS = [
  {
    name: 'Apple Space Gray Pro',
    accent: '#0A84FF',
    bg: '#16171B',
    card: '#23242A',
    glow: '#64D2FF',
    secondary: '#2D2F36',
    isLight: false,
  },
  {
    name: 'Cupertino Clean Ivory',
    accent: '#0071E3',
    bg: '#F5F5F7',
    card: '#FFFFFF',
    glow: '#38BDF8',
    secondary: '#E5E5EA',
    isLight: true,
  },
  {
    name: 'Graphite Titanium Mint',
    accent: '#30D158',
    bg: '#141416',
    card: '#1F2024',
    glow: '#34E061',
    secondary: '#2A2C32',
    isLight: false,
  },
  {
    name: 'Pacific Azure Marina',
    accent: '#00C7BE',
    bg: '#0E1721',
    card: '#172230',
    glow: '#30D8D1',
    secondary: '#202D3E',
    isLight: false,
  },
  {
    name: 'Sunset Imperial Amber',
    accent: '#FF9F0A',
    bg: '#171412',
    card: '#241F1A',
    glow: '#FFB340',
    secondary: '#302A24',
    isLight: false,
  },
  {
    name: 'Royal Velvet Indigo',
    accent: '#5E5CE6',
    bg: '#15121E',
    card: '#221C30',
    glow: '#7D7AFF',
    secondary: '#2E2740',
    isLight: false,
  },
  {
    name: 'Obsidian Gold Reserve',
    accent: '#F0B90B',
    bg: '#111215',
    card: '#1C1E23',
    glow: '#FCD535',
    secondary: '#272A31',
    isLight: false,
  },
  {
    name: 'Neon Cyber Azure',
    accent: '#00E5FF',
    bg: '#0B0F17',
    card: '#141C2B',
    glow: '#00FF88',
    secondary: '#1C273C',
    isLight: false,
  },
];

export function generateHarmoniousCrmColors(mode = 'dark', currentColors = []) {
  const pal = generateRandomHarmoniousPalette(mode === 'light' ? 'light' : mode === 'all' ? null : 'dark');
  return {
    accent: pal.primary,
    bg: pal.bg,
    card: pal.card,
    glow: pal.accent,
    secondary: pal.secondary,
    name: pal.name,
    isLight: pal.isLight,
  };
}

export function calcContrast(hex1, hex2) {
  if (!hex1 || !hex2) return '10:1';
  function lum(hex) {
    const clean = hex.replace('#', '');
    const num = parseInt(clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    const [rs, gs, bs] = [r, g, b].map(v => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  }
  const l1 = lum(hex1);
  const l2 = lum(hex2);
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  return `${ratio.toFixed(1)}:1`;
}

const STORAGE_KEY = 'cdx_crm_theme_settings';

export const DEFAULT_CRM_SETTINGS = {
  themeId: 'apple-space-gray',
  accentColor: '#0A84FF',
  customBg: '',
  customCard: '',
  customCardHover: '',
  density: 'comfortable',
  radius: 'clean',
  glassEffect: false,
  cardElevation: 'flat',
  tableZebra: false,
};

const DENSITY_IDS = new Set(DENSITY_OPTIONS.map(({ id }) => id));
const RADIUS_IDS = new Set(RADIUS_OPTIONS.map(({ id }) => id));
const THEME_IDS = new Set(CRM_THEME_PRESETS.map(({ id }) => id));
const HEX_COLOR = /^#(?:[\da-f]{3}|[\da-f]{6})$/i;

function normalizeCrmThemeSettings(settings = {}) {
  const merged = { ...DEFAULT_CRM_SETTINGS, ...settings };
  return {
    ...merged,
    themeId: THEME_IDS.has(merged.themeId) ? merged.themeId : DEFAULT_CRM_SETTINGS.themeId,
    accentColor: HEX_COLOR.test(merged.accentColor) ? merged.accentColor : DEFAULT_CRM_SETTINGS.accentColor,
    customBg: HEX_COLOR.test(merged.customBg) ? merged.customBg : '',
    customCard: HEX_COLOR.test(merged.customCard) ? merged.customCard : '',
    customCardHover: HEX_COLOR.test(merged.customCardHover) ? merged.customCardHover : '',
    density: DENSITY_IDS.has(merged.density) ? merged.density : DEFAULT_CRM_SETTINGS.density,
    radius: RADIUS_IDS.has(merged.radius) ? merged.radius : DEFAULT_CRM_SETTINGS.radius,
    glassEffect: false,
    cardElevation: merged.cardElevation === 'raised' ? 'raised' : 'flat',
    tableZebra: Boolean(merged.tableZebra),
  };
}

export function getCrmThemeSettings() {
  if (typeof window === 'undefined') return DEFAULT_CRM_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CRM_SETTINGS;
    return normalizeCrmThemeSettings(JSON.parse(raw));
  } catch (_) {
    return DEFAULT_CRM_SETTINGS;
  }
}

export function applyCrmThemeToDom(settings = getCrmThemeSettings()) {
  if (typeof document === 'undefined') return;

  settings = normalizeCrmThemeSettings(settings);
  const preset = CRM_THEME_PRESETS.find(p => p.id === settings.themeId) || CRM_THEME_PRESETS[0];
  const accent = settings.accentColor || preset.accent;
  const isHex = (value) => typeof value === 'string' && HEX_COLOR.test(value.trim());
  const isLightColor = (value) => {
    if (!isHex(value)) return false;
    let clean = value.slice(1);
    if (clean.length === 3) clean = clean.split('').map((char) => char + char).join('');
    const channels = [0, 2, 4].map((offset) => parseInt(clean.slice(offset, offset + 2), 16));
    const [r, g, b] = channels.map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.42;
  };
  const isGlaringWhite = (value) => isHex(value) && /^#(f{3}|f{6}|fefefe|fdfdfd|fcfcfc|fbfbfb|fafafa)$/i.test(value.trim());
  const requestedBg = isHex(settings.customBg) ? settings.customBg : preset.bg;
  const bg = isGlaringWhite(requestedBg) ? '#EEF0F3' : requestedBg;
  const isLight = isLightColor(bg);
  const standardCard = isLight ? '#F8F9FB' : '#242426';
  const presetCard = isLightColor(preset.card) === isLight ? preset.card : standardCard;
  const requestedCard = isHex(settings.customCard) && isLightColor(settings.customCard) === isLight
    ? settings.customCard
    : presetCard;
  const card = isGlaringWhite(requestedCard) ? standardCard : requestedCard;
  const requestedCardHover = settings.customCardHover || preset.cardHover;
  const cardHover = isHex(requestedCardHover) && isLightColor(requestedCardHover) === isLight
    ? requestedCardHover
    : isLight ? '#ECEEF2' : '#2C2C2E';
  const cardSurface = isHex(settings.customCard) && isLightColor(settings.customCard) === isLight
    ? card
    : cardHover;
  const border = isLight ? 'rgba(29, 29, 31, 0.16)' : 'rgba(255, 255, 255, 0.14)';
  const borderHover = isLight ? 'rgba(29, 29, 31, 0.24)' : 'rgba(255, 255, 255, 0.22)';
  const textPrimary = isLight ? '#1D1D1F' : '#F5F5F7';
  const textSecondary = isLight ? '#626269' : '#B0B0B5';
  const textMuted = isLight ? '#6E6E73' : '#929298';
  const inputBg = isLight ? '#FBFBFC' : '#1C1C1E';
  const accentForeground = isLightColor(accent) ? '#1D1D1F' : '#FFFFFF';

  const root = document.querySelector('.crm-admin-app') || document.documentElement;

  // Set data attributes for selector targeting
  root.setAttribute('data-crm-theme', settings.themeId);
  root.setAttribute('data-crm-mode', isLight ? 'light' : 'dark');
  root.setAttribute('data-crm-density', settings.density);
  root.setAttribute('data-crm-radius', settings.radius);
  root.setAttribute('data-crm-glass', String(settings.glassEffect));
  root.setAttribute('data-crm-zebra', String(settings.tableZebra));
  root.style.colorScheme = isLight ? 'light' : 'dark';

  // Compute radii
  const radiusValue = settings.radius === 'ios-modern' ? '14px' : settings.radius === 'clean' ? '8px' : '4px';
  const radiusSm = settings.radius === 'ios-modern' ? '8px' : settings.radius === 'clean' ? '4px' : '2px';
  const expandedAccent = accent.length === 4
    ? `#${accent[1]}${accent[1]}${accent[2]}${accent[2]}${accent[3]}${accent[3]}`
    : accent;
  const accentRgb = [1, 3, 5].map((offset) => parseInt(expandedAccent.slice(offset, offset + 2), 16)).join(', ');
  const shadowCard = settings.cardElevation === 'raised'
    ? (isLight
      ? '0 1px 2px rgba(0, 0, 0, 0.06), 0 8px 18px rgba(0, 0, 0, 0.05)'
      : '0 1px 2px rgba(0, 0, 0, 0.24), 0 10px 22px rgba(0, 0, 0, 0.28)')
    : (isLight
      ? '0 1px 2px rgba(0, 0, 0, 0.04)'
      : '0 1px 2px rgba(0, 0, 0, 0.18)');
  const shadowRaised = '0 1px 2px rgba(0, 0, 0, 0.16)';

  // Apply CSS Variables directly for instant styling
  root.style.setProperty('--crm-bg', bg);
  root.style.setProperty('--crm-card', card);
  root.style.setProperty('--crm-card-hover', cardHover);
  root.style.setProperty('--crm-card-surface', cardSurface);
  root.style.setProperty('--crm-border', border);
  root.style.setProperty('--crm-border-hover', borderHover);
  root.style.setProperty('--crm-text-primary', textPrimary);
  root.style.setProperty('--crm-text-secondary', textSecondary);
  root.style.setProperty('--crm-text-muted', textMuted);
  root.style.setProperty('--crm-input-bg', inputBg);
  root.style.setProperty('--crm-accent', accent);
  root.style.setProperty('--crm-accent-hover', preset.accentHover || accent);
  root.style.setProperty('--crm-radius', radiusValue);
  root.style.setProperty('--crm-radius-sm', radiusSm);
  root.style.setProperty('--crm-ios-radius-card', radiusValue);
  root.style.setProperty('--crm-ios-radius-control', radiusValue);
  root.style.setProperty('--crm-ios-radius-sm', radiusSm);
  root.style.setProperty('--crm-ios-blue', accent);
  root.style.setProperty('--crm-ios-blue-rgb', accentRgb);
  root.style.setProperty('--crm-ios-focus', `rgba(${accentRgb}, 0.35)`);
  root.style.setProperty('--crm-ios-shadow-card', shadowCard);
  root.style.setProperty('--crm-ios-shadow-raised', shadowRaised);
  root.style.setProperty('--crm-surface-glass', 'var(--crm-card-surface)');
  root.style.setProperty('--crm-accent-fg', accentForeground);
  root.style.setProperty('--crm-surface-alt', cardHover);
  root.style.setProperty('--cdx-accent-glow', 'transparent');
  root.style.setProperty('--cdx-bg', bg);
  root.style.setProperty('--cdx-surface', card);
  root.style.setProperty('--cdx-surface-2', cardHover);
   root.style.setProperty('--cdx-text', textPrimary);
   root.style.setProperty('--cdx-muted', textSecondary);
  root.style.setProperty('--cdx-accent', accent);
  root.style.setProperty('--cdx-accent-hi', preset.accentHover || accent);

  // Map legacy color variables to ensure entire admin app switches gracefully
  root.style.setProperty('--color-primary-dark', bg);
  root.style.setProperty('--color-primary-darker', bg);
  root.style.setProperty('--color-surface-0', bg);
  root.style.setProperty('--color-surface-1', card);
  root.style.setProperty('--color-surface-2', cardHover);
  root.style.setProperty('--color-surface-3', cardHover);
  root.style.setProperty('--color-surface-hover', cardHover);
  root.style.setProperty('--color-border-primary', border);
  root.style.setProperty('--color-border-secondary', border);
  root.style.setProperty('--color-border-subtle', border);
  root.style.setProperty('--color-text-primary', textPrimary);
  root.style.setProperty('--color-text-secondary', textSecondary);
  root.style.setProperty('--color-text-tertiary', textMuted);
  root.style.setProperty('--color-primary-yellow', accent);
  root.style.setProperty('--color-accent-yellow', accent);
  root.style.setProperty('--color-accent-blue', accent);

  // Legacy fallback aliases
  root.style.setProperty('--bg', bg);
  root.style.setProperty('--panel', card);
  root.style.setProperty('--surface', card);
  root.style.setProperty('--border', border);
  root.style.setProperty('--muted', textSecondary);
  root.style.setProperty('--text', textPrimary);
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--button-color', accent);
  root.style.setProperty('--card-color', card);
  root.style.setProperty('--bg-input', inputBg);
}

// The CRM theme is stored in platform settings (`settings.crmTheme`). The
// localStorage copy is only a first-paint cache of the server value.
export async function loadCrmThemeFromServer() {
  const response = await fetch('/api/crm/settings', { headers: { Accept: 'application/json' } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(data?.error || 'CRM theme could not be loaded.');
  const serverTheme = data?.settings?.crmTheme;
  if (!serverTheme || typeof serverTheme !== 'object') return getCrmThemeSettings();
  return cacheAndApplyCrmTheme(normalizeCrmThemeSettings(serverTheme));
}

export function cacheCrmThemeLocally(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeCrmThemeSettings(settings)));
  } catch (_) {}
}

function cacheAndApplyCrmTheme(merged) {
  cacheCrmThemeLocally(merged);
  applyCrmThemeToDom(merged);
  window.dispatchEvent(new CustomEvent('cdx:crm-theme-changed', { detail: merged }));
  return merged;
}

export async function saveCrmThemeSettings(newSettings) {
  if (typeof window === 'undefined') return undefined;
  const merged = normalizeCrmThemeSettings({ ...getCrmThemeSettings(), ...newSettings });
  await saveSettingsToApi({ crmTheme: merged });
  return cacheAndApplyCrmTheme(merged);
}
