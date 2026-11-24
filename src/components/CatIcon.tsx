// A coloured icon tile for a category (or income, a deposit, a loan). Drawn as SVG with the colour as an attribute, so it needs
// no inline style. Categories the person made themselves show their own glyph on the same tinted tile.
import { safeColor } from '@/features/money/taxonomy';

const SHAPES: Record<string, string> = {
  food: 'M7 3v7a2 2 0 0 0 4 0V3M9 3v18M17 3c-1.700 1-3 3.200-3 6v3h3zM17 12v9',
  beverages: 'M5 8h11v6a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 10h1.500a2.500 2.500 0 0 1 0 5H16M8 3v2M12 3v2',
  travel: 'M21 3 3 10.500l7 2.500 2.500 7zM10 13l4-4',
  entertain: 'M4 5h16v14H4zM8 5v14M16 5v14M4 9.500h4M4 14.500h4M16 9.500h4M16 14.500h4',
  work: 'M4 8h16v11H4zM9 8V5h6v3M4 13h16',
  shopping: 'M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2',
  utilities: 'M13 3 5 14h6l-1 7 8-11h-6z',
  car: 'M5 11l1.500-4.500A2 2 0 0 1 8.400 5h7.200a2 2 0 0 1 1.900 1.500L19 11M4 11h16v6H4zM7 17v2M17 17v2M7.500 14h.010M16.500 14h.010',
  health: 'M12 20s-7-4.400-7-10a4 4 0 0 1 7-2.600A4 4 0 0 1 19 10c0 5.600-7 10-7 10z',
  other: 'M6 12h.010M12 12h.010M18 12h.010',
  income: 'M4 16l5-5 4 4 7-7M15 8h5v5',
  fd: 'M4 10l8-5 8 5M6 10v7M10 10v7M14 10v7M18 10v7M4 19h16',
  loan: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v10M14.500 9.500h-3.500a1.500 1.500 0 0 0 0 3h2a1.500 1.500 0 0 1 0 3H9.500',
  telegram: 'M21 3 3 10.500l7 2.500 2.500 7zM10 13l4-4',
  bank: 'M4 10l8-5 8 5M6 10v7M10 10v7M14 10v7M18 10v7M4 19h16',
  card: 'M3 6h18v12H3zM3 10h18M7 15h3',
  ewallet: 'M7 3h10v18H7zM11 18h2',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l1.500 2h-15zM10 20a2 2 0 0 0 4 0',
};

export type CatIconName = keyof typeof SHAPES;

interface Props {
  /** A built-in category key, or one of: income, fd, loan, telegram, bell. */
  name: string;
  color?: string | undefined;
  /** Shown instead of a drawing for a category the person made. */
  glyph?: string | undefined;
  size?: number;
}

export function CatIcon({ name, color, glyph, size = 40 }: Props) {
  const tint = safeColor(color);
  const shape = SHAPES[name];
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true" focusable="false" data-cat-icon={name}>
      <rect width="40" height="40" rx="12" fill={tint} fillOpacity="0.14" />
      {shape ? (
        <g transform="translate(8 8)" fill="none" stroke={tint} strokeWidth={name === 'other' ? 3 : 2} strokeLinecap="round" strokeLinejoin="round">
          <path d={shape} />
        </g>
      ) : (
        <text x="20" y="26" textAnchor="middle" fontSize="18">
          {glyph ?? '•'}
        </text>
      )}
    </svg>
  );
}
