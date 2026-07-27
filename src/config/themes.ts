/**
 * Campus themes. Night is the primary design target; day is a supported
 * alternate. Themes are plain data so new ones can be added without code.
 */

import { palette } from '@/design/tokens';
import type { CampusTheme } from '@/core/types';

export const THEMES: Record<string, CampusTheme> = {
  obsidian_night: {
    id: 'obsidian_night',
    name: 'Obsidian Night',
    skyTop: 0x03050a,
    skyBottom: 0x0a1018,
    ground: 0x090c11,
    pathLight: palette.lightWhite,
    accent: palette.blue,
    buildingBase: palette.graphite,
    glass: palette.obsidianGlass,
    ambientLight: 0.22,
  },
  obsidian_day: {
    id: 'obsidian_day',
    name: 'Obsidian Day',
    skyTop: 0x27313d,
    skyBottom: 0x3d4a59,
    ground: 0x2a313a,
    pathLight: 0xe8eef6,
    accent: palette.blueDeep,
    buildingBase: 0x2e3641,
    glass: 0x1b232d,
    ambientLight: 0.78,
  },
  glacier: {
    id: 'glacier',
    name: 'Glacier',
    skyTop: 0x040910,
    skyBottom: 0x0b1622,
    ground: 0x0a1017,
    pathLight: 0xe4f1ff,
    accent: 0x63a8e8,
    buildingBase: 0x18202a,
    glass: 0x0c141d,
    ambientLight: 0.26,
  },
  vault: {
    id: 'vault',
    name: 'Vault',
    skyTop: 0x05060a,
    skyBottom: 0x0b0d12,
    ground: 0x08090d,
    pathLight: 0xf1ece0,
    accent: palette.gold,
    buildingBase: 0x14161c,
    glass: 0x090c11,
    ambientLight: 0.18,
  },
};

export const DEFAULT_THEME_ID = 'obsidian_night';

export function getTheme(id: string): CampusTheme {
  return THEMES[id] ?? THEMES[DEFAULT_THEME_ID];
}

/**
 * Resolve the effective theme, honouring the `auto` time-of-day setting.
 * Day runs 07:00–18:59 local.
 */
export function resolveTheme(themeId: string, timeOfDay: 'night' | 'day' | 'auto'): CampusTheme {
  if (timeOfDay === 'auto') {
    const hour = new Date().getHours();
    return hour >= 7 && hour < 19 ? THEMES.obsidian_day : THEMES.obsidian_night;
  }
  if (timeOfDay === 'day' && themeId === 'obsidian_night') return THEMES.obsidian_day;
  if (timeOfDay === 'night' && themeId === 'obsidian_day') return THEMES.obsidian_night;
  return getTheme(themeId);
}
