/**
 * The Tokyo Dusk palette, by value.
 *
 * The engine's own components name theme keys (`subtle`, `claude`) and the surface
 * resolves them, but a plugin tree is surer of what it draws if it names the colour
 * itself — and the separators in particular were asked for in these colours. Swap
 * these six lines for your own palette and the whole pane follows.
 */
export const TOKYO = {
  text: '#c0caf5',
  dim: '#565f89',
  line: '#7aa2f7',
  accent: '#bb9af7',
  blue: '#7aa2f7',
  cyan: '#7dcfff',
  green: '#9ece6a',
  yellow: '#e0af68',
  orange: '#ff9e64',
  red: '#f7768e',
} as const

/** The colour a 0-100 figure is drawn in: calm until it is worth noticing. */
export const heatOf = (percent: number): string => {
  if (percent >= 90) return TOKYO.red
  if (percent >= 75) return TOKYO.orange
  if (percent >= 50) return TOKYO.yellow

  return TOKYO.green
}
