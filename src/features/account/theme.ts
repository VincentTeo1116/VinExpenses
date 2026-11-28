// The colour theme (blue, pink, orange, green) and the appearance (auto, light, dark). Both are per-device, per-account choices kept in this
// browser only. Auto follows the phone's own light or dark setting; light and dark force one of them inside the signed-in app.
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

export const MODES = ['auto', 'light', 'dark'] as const;
export type Mode = (typeof MODES)[number];

const modeKey = (userId: string) => `vinexpenses.mode.${userId}`;

export function readMode(userId: string | undefined): Mode {
  if (!userId) return 'auto';
  try {
    const value = localStorage.getItem(modeKey(userId));
    return MODES.find((mode) => mode === value) ?? 'auto';
  } catch {
    return 'auto';
  }
}

export function saveMode(userId: string | undefined, mode: Mode): void {
  if (!userId) return;
  try {
    localStorage.setItem(modeKey(userId), mode);
  } catch {
    // storage blocked: the choice lasts until the page is closed
  }
}

/** Auto carries no attribute, so the page follows the device exactly as before. */
export function applyMode(mode: Mode): void {
  if (mode === 'auto') delete document.documentElement.dataset.mode;
  else document.documentElement.dataset.mode = mode;
}
