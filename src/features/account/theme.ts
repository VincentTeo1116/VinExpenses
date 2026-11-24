// The colour theme (blue, pink, orange, green). It is a per-device, per-account choice kept in this browser only; light and dark
// still follow the phone's own setting.
export const THEMES = ['blue', 'pink', 'orange', 'green'] as const;
export type Theme = (typeof THEMES)[number];

const key = (userId: string) => `vinexpenses.theme.${userId}`;

export function readTheme(userId: string | undefined): Theme {
  if (!userId) return 'blue';
  try {
    const value = localStorage.getItem(key(userId));
    return THEMES.find((theme) => theme === value) ?? 'blue';
  } catch {
    return 'blue';
  }
}

export function saveTheme(userId: string | undefined, theme: Theme): void {
  if (!userId) return;
  try {
    localStorage.setItem(key(userId), theme);
  } catch {
    // storage blocked: the choice lasts until the page is closed
  }
}

/** Blue is the base design, so it carries no attribute. */
export function applyTheme(theme: Theme): void {
  if (theme === 'blue') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}
