export interface MDPSettings {
	colors: {
		assistant: string; // hex, e.g. "#6495ed"
		quote: string;
		unknown: string;
		// "self" is always transparent — no color needed
	};
}

export const DEFAULT_SETTINGS: MDPSettings = {
	colors: {
		assistant: "#6495ed",
		quote: "#3cb371",
		unknown: "#ffc107",
	},
};

/**
 * Convert a hex color + alpha into an rgba() string.
 * Falls back to transparent on malformed input.
 */
export function hexToRgba(hex: string, alpha: number): string {
	const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
	if (!match || !match[1] || !match[2] || !match[3]) return `rgba(0,0,0,${alpha})`;
	return `rgba(${parseInt(match[1], 16)}, ${parseInt(match[2], 16)}, ${parseInt(match[3], 16)}, ${alpha})`;
}

/** Build the CSS custom-property block from current settings. */
export function buildDynamicCSS(settings: MDPSettings): string {
	const c = settings.colors;
	return `
:root {
  --mdp-color-assistant: ${hexToRgba(c.assistant ?? DEFAULT_SETTINGS.colors.assistant, 0.18)};
  --mdp-color-quote:     ${hexToRgba(c.quote     ?? DEFAULT_SETTINGS.colors.quote,     0.18)};
  --mdp-color-unknown:   ${hexToRgba(c.unknown   ?? DEFAULT_SETTINGS.colors.unknown,   0.22)};
}`.trim();
}
