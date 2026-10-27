/**
 * CENTRA design tokens — the single source of truth.
 *
 * Everything in the app is built from these values. Web/desktop read them as
 * CSS custom properties (dist/tokens.css), mobile reads them as a typed object
 * (this file, via `@centra/design-system`). No component may hard-code a colour,
 * size, radius, duration or easing.
 *
 * Brand source: the CENTRA brand board (2026 logo: a C around a glowing orb).
 *   Void #0B0C0F · Amber #FFE2B8 · Flare #FF9A5C · Rose #D9507A · Violet #7B4DFF · Mist #F4F1EC
 * The C's gradient (amber → flare → rose → violet) is the brand's signature and is used only for
 * the logo, the living background and a few moments of motion. The UI itself acts in violet.
 *
 * The brand idea carried into the UI: "Your life. In focus." The prism in the
 * logo gathers light into one point. In the app, exactly one thing at a time is
 * "in the light": the next event, the mail that needs you, the AI suggestion
 * waiting for approval. That one thing carries `focus` (terracotta). Everything
 * else is drawn in charcoal, stone and sage. Colour share stays under ~3%.
 */

export const brand = {
  void: '#0B0C0F',
  amber: '#FFE2B8',
  flare: '#FF9A5C',
  rose: '#D9507A',
  violet: '#7B4DFF',
  mist: '#F4F1EC',
} as const;

/** The signature gradient of the C, in order along the stroke. */
export const brandGradient = [brand.amber, brand.flare, brand.rose, brand.violet] as const;

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

/**
 * Apple-style themes (macOS / iOS system colours, apple.com tokens): one violet for everything you
 * can act on, flare orange for the one thing that needs you, ink on mist in light, and
 * void greys in dark. Surfaces are separated by tone, not lines or shadows.
 */
export const themes: Record<'light' | 'dark' | 'oled', ColorRoles> = {
  dark: {
    ground: '#0B0C0F',
    surface: '#16171B',
    raised: '#212228',
    active: '#2C2D34',
    border: '#212228',
    rule: '#1F2025',
    control: '#3E3F47',
    text: '#F4F1EC',
    muted: '#CAC6C0',
    faint: '#A9A5A0',
    primary: '#7B4DFF',
    onPrimary: '#FFFFFF',
    focus: '#FF9A5C',
    focusText: '#FFB27A',
    focusWash: '#3A2416',
    calm: '#A88CFF',
    calmWash: '#241C40',
    positive: '#30D158',
    positiveWash: '#13301C',
    negative: '#FF7B73',
    negativeWash: '#3A1A1A',
    warning: '#FFD60A',
    warningWash: '#3A3210',
    ring: '#9B7BFF',
    scrim: 'rgba(0,0,0,0.55)',
  },
  oled: {
    ground: '#000000',
    surface: '#0F1013',
    raised: '#1A1B1F',
    active: '#25262C',
    border: '#1A1B1F',
    rule: '#1A1B1F',
    control: '#35363D',
    text: '#F4F1EC',
    muted: '#CAC6C0',
    faint: '#A9A5A0',
    primary: '#7B4DFF',
    onPrimary: '#FFFFFF',
    focus: '#FF9A5C',
    focusText: '#FFB27A',
    focusWash: '#33200F',
    calm: '#A88CFF',
    calmWash: '#1E173A',
    positive: '#30D158',
    positiveWash: '#102A18',
    negative: '#FF6961',
    negativeWash: '#331717',
    warning: '#FFD60A',
    warningWash: '#332C0D',
    ring: '#9B7BFF',
    scrim: 'rgba(0,0,0,0.6)',
  },
  light: {
    ground: '#F4F1EC',
    surface: '#FFFFFF',
    raised: '#F4F1EC',
    active: '#EAE5DD',
    border: '#E6E1D9',
    rule: '#ECE7E0',
    control: '#D3CDC3',
    text: '#16171B',
    muted: '#45433F',
    faint: '#625E58',
    primary: '#7B4DFF',
    onPrimary: '#FFFFFF',
    focus: '#E5602A',
    focusText: '#AE3F12',
    focusWash: '#FDEDE3',
    calm: '#5F33E6',
    calmWash: '#EFE9FF',
    positive: '#18692C',
    positiveWash: '#E5F5E9',
    negative: '#C20012',
    negativeWash: '#FDEBEC',
    warning: '#8A5300',
    warningWash: '#FFF6DF',
    ring: '#7B4DFF',
    scrim: 'rgba(11,12,15,0.3)',
  },
};

/** San Francisco on Apple devices (the system font), Segoe UI on Windows. Weights 400 and 600, as Apple does. */
export const font = {
  family: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', system-ui, 'Segoe UI', 'Helvetica Neue', 'Manrope', sans-serif",
  /** Brand wordmark only. Never used for UI text. */
  wordmark: 'CENTRA wordmark (SVG asset)',
  weight: { regular: 400, strong: 600 },
} as const;

/** Type scale: size / line-height in px. Five steps; app type is never display type. */
export const type = {
  meta: { size: 12, line: 16 },
  body: { size: 15, line: 21 },
  reading: { size: 17, line: 25 }, // note editor & mail body (Apple runs reading text at 17)
  section: { size: 17, line: 22 },
  title: { size: 30, line: 36, tracking: -0.022 },
  greeting: { size: 40, line: 46, tracking: -0.028 }, // home only
} as const;

/** 4px base. */
export const space = { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64 } as const;

/** Tight radii (the directions may switch to the soft set). Nested radii step down. */
export const radius = {
  tight: { sheet: 22, card: 18, control: 10, chip: 999, round: 999 },
  soft: { sheet: 20, card: 16, control: 999, chip: 999, round: 999 },
} as const;

/** Shadows exist only on what floats. Resting surfaces never cast one. */
export const shadow = {
  light: {
    popover: '0 10px 30px rgba(0,0,0,0.12), 0 0 0 0.5px rgba(0,0,0,0.08)',
    dialog: '0 24px 70px rgba(0,0,0,0.22), 0 0 0 0.5px rgba(0,0,0,0.08)',
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
  sidebar: 252,
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
