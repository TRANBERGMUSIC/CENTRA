/**
 * CENTRA design tokens — the single source of truth.
 *
 * Everything in the app is built from these values. Web/desktop read them as
 * CSS custom properties (dist/tokens.css), mobile reads them as a typed object
 * (this file, via `@centra/design-system`). No component may hard-code a colour,
 * size, radius, duration or easing.
 *
 * Brand source: the CENTRA brand board (logo, palette, type, texture).
 *   Charcoal #0B0F0E · Forest #1E3A34 · Sage #6B8F81 · Stone #E8DCC6 · Terracotta #C9683A
 *
 * The brand idea carried into the UI: "Your life. In focus." The prism in the
 * logo gathers light into one point. In the app, exactly one thing at a time is
 * "in the light": the next event, the mail that needs you, the AI suggestion
 * waiting for approval. That one thing carries `focus` (terracotta). Everything
 * else is drawn in charcoal, stone and sage. Colour share stays under ~3%.
 */

export const brand = {
  charcoal: '#0B0F0E',
  forest: '#1E3A34',
  sage: '#6B8F81',
  stone: '#E8DCC6',
  terracotta: '#C9683A',
} as const;

/** Semantic colour roles. Every theme defines every role. */
export type ColorRoles = {
  /** Window / page ground. Sidebar and top bar sit on it too. */
  ground: string;
  /** Panels and cards: one tone step off the ground. */
  surface: string;
  /** Nested panels, row cards, inputs on dark. */
  raised: string;
  /** Selected row, active nav pill, pressed state. */
  active: string;
  /** 1px edge of a panel (when a theme uses edges at all). */
  border: string;
  /** Row rules inside lists and tables. */
  rule: string;
  /** Edges of interactive controls: one step stronger than border. */
  control: string;
  /** Primary text: identity, headings, body. */
  text: string;
  /** Secondary text: sublines, previews. */
  muted: string;
  /** Meta: timestamps, labels, placeholders. Still ≥ 4.5:1. */
  faint: string;
  /** The one primary action's fill, and its label. */
  primary: string;
  onPrimary: string;
  /** "In focus": the one thing in the light. Data marks, the now-line, the waiting item. */
  focus: string;
  /** Focus used as text (≥ 4.5:1 on surface). */
  focusText: string;
  /** Pale wash of focus for the one highlighted row/pill. */
  focusWash: string;
  /** Calm secondary identity hue (sage): AI provenance, linked items. */
  calm: string;
  calmWash: string;
  positive: string;
  positiveWash: string;
  negative: string;
  negativeWash: string;
  warning: string;
  warningWash: string;
  /** Keyboard focus ring. */
  ring: string;
  /** Scrim under sheets and the command palette. */
  scrim: string;
};

export const themes: Record<'light' | 'dark' | 'oled', ColorRoles> = {
  /** Dark: the brand board's own ground (charcoal), elevation by lightness alone. */
  dark: {
    ground: '#0B0F0E',
    surface: '#131816',
    raised: '#1C2220',
    active: '#252C29',
    border: '#1A201E',
    rule: '#1A201E',
    control: '#3A4440',
    text: '#F2EEE6',
    muted: '#B4B8B2',
    faint: '#959A94',
    primary: '#E8DCC6',
    onPrimary: '#0B0F0E',
    focus: '#C9683A',
    focusText: '#E0824F',
    focusWash: '#2A1B13',
    calm: '#8FB3A4',
    calmWash: '#16231F',
    positive: '#7FB89A',
    positiveWash: '#14231C',
    negative: '#E5697A',
    negativeWash: '#2C1A1E',
    warning: '#E2B45C',
    warningWash: '#2A2214',
    ring: '#E8DCC6',
    scrim: 'rgba(0,0,0,0.56)',
  },
  /** True black for OLED: same roles, the ground goes to #000 and every step follows. */
  oled: {
    ground: '#000000',
    surface: '#0E1110',
    raised: '#181C1A',
    active: '#202523',
    border: '#141716',
    rule: '#141716',
    control: '#343C39',
    text: '#F2EEE6',
    muted: '#B4B8B2',
    faint: '#959A94',
    primary: '#E8DCC6',
    onPrimary: '#000000',
    focus: '#C9683A',
    focusText: '#E0824F',
    focusWash: '#24170F',
    calm: '#8FB3A4',
    calmWash: '#111B18',
    positive: '#7FB89A',
    positiveWash: '#101C16',
    negative: '#E5697A',
    negativeWash: '#26151A',
    warning: '#E2B45C',
    warningWash: '#241D10',
    ring: '#E8DCC6',
    scrim: 'rgba(0,0,0,0.64)',
  },
  /**
   * Light: a sage-tinted neutral ground (never cream — stone stays an accent of
   * the dark theme), white sheets, charcoal ink, forest as the primary fill.
   */
  light: {
    ground: '#F4F5F3',
    surface: '#FFFFFF',
    raised: '#F7F8F6',
    active: '#E9ECE9',
    border: '#E4E8E5',
    rule: '#EEF1EE',
    control: '#CBD2CE',
    text: '#0B0F0E',
    muted: '#4A524E',
    faint: '#626B66',
    primary: '#1E3A34',
    onPrimary: '#FFFFFF',
    focus: '#C9683A',
    focusText: '#9E4A25',
    focusWash: '#FBEDE5',
    calm: '#456A5C',
    calmWash: '#EAF1EE',
    positive: '#2F6B57',
    positiveWash: '#E3F2EA',
    negative: '#B4232F',
    negativeWash: '#FCEAEA',
    warning: '#8A5A0B',
    warningWash: '#FBF3E1',
    ring: '#1E3A34',
    scrim: 'rgba(11,15,14,0.32)',
  },
};

/** One family, two weights. Manrope: geometric, slightly extended like the wordmark, real tabular figures. */
export const font = {
  family: "'Manrope', system-ui, -apple-system, 'Segoe UI', sans-serif",
  /** Brand wordmark only. Never used for UI text. */
  wordmark: 'CENTRA wordmark (SVG asset)',
  weight: { regular: 400, strong: 600 },
} as const;

/** Type scale: size / line-height in px. Five steps; app type is never display type. */
export const type = {
  meta: { size: 12, line: 16 },
  body: { size: 14, line: 20 },
  reading: { size: 16, line: 26 }, // note editor & mail body
  section: { size: 16, line: 24 },
  title: { size: 24, line: 32, tracking: -0.01 },
  greeting: { size: 32, line: 40, tracking: -0.02 }, // home only
} as const;

/** 4px base. */
export const space = { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64 } as const;

/** Tight radii (the directions may switch to the soft set). Nested radii step down. */
export const radius = {
  tight: { sheet: 12, card: 8, control: 6, chip: 4, round: 999 },
  soft: { sheet: 20, card: 16, control: 999, chip: 999, round: 999 },
} as const;

/** Shadows exist only on what floats. Resting surfaces never cast one. */
export const shadow = {
  light: {
    popover: '0 8px 24px rgba(11,15,14,0.10), 0 1px 2px rgba(11,15,14,0.06)',
    dialog: '0 24px 64px rgba(11,15,14,0.16)',
  },
  dark: {
    popover: '0 8px 24px rgba(0,0,0,0.40)',
    dialog: '0 24px 64px rgba(0,0,0,0.56)',
  },
} as const;

/** Motion: 100–250 ms, transform + opacity only. Every move has a reduced-motion fallback. */
export const motion = {
  duration: { instant: 100, quick: 150, base: 200, slow: 250 },
  easing: {
    /** Most UI: settles softly. */
    standard: 'cubic-bezier(0.2, 0, 0, 1)',
    /** Things arriving (sheets, palette, rows). */
    enter: 'cubic-bezier(0.05, 0.7, 0.1, 1)',
    /** Things leaving. */
    exit: 'cubic-bezier(0.3, 0, 0.8, 0.15)',
  },
  /** React Native Reanimated spring for drags and sheets. */
  spring: { damping: 24, stiffness: 280, mass: 1 },
  /** Press feedback: scale on press-in. */
  press: { scale: 0.97 },
} as const;

/** Mobile haptics, mapped to expo-haptics. */
export const haptics = {
  select: 'selection', // moving through tabs, segmented controls
  toggle: 'impactLight', // checkbox, pin, star
  approve: 'notificationSuccess', // Godkend on an AI suggestion, mail sent
  destructive: 'notificationWarning', // delete, discard
} as const;

/** Layout constants. */
export const layout = {
  sidebar: 240,
  railCompact: 56,
  topBar: 48,
  listColumn: 384,
  detailRail: 320,
  navRow: 32,
  navPitch: 34,
  control: 32,
  controlLarge: 40,
  touch: 44,
  row: 48,
  row2: 72,
  maxReading: 720,
  breakpoints: { phone: 640, tablet: 1100 },
} as const;

/** Icons: one outline set, 1.5px stroke, 16px in nav and rows, 20px in the tab bar. */
export const icon = { size: { inline: 14, nav: 16, tab: 22 }, stroke: 1.5 } as const;

/** Stable identity hues for people (pale tints only, never data). ≥ 60° apart. */
export const personHues = [150, 30, 205, 90, 340] as const;

export const tokens = { brand, themes, font, type, space, radius, shadow, motion, haptics, layout, icon };
export default tokens;
