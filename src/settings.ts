import { ProvenanceWord } from "./provenance";

export interface MDPSettings {
	colors: {
		assistant: string;
		self:      string;   // neutral blue-grey by default; configurable
		quote:     string;
		unknown:   string;
	};
	/** Rendering fallback for notes without frontmatter; also used for new-note auto-insert. */
	pluginDefault: ProvenanceWord | "none";
	/** When true, new .md files automatically get a frontmatter provenance key. */
	autoInsertFrontmatter: boolean;
}

export const DEFAULT_SETTINGS: MDPSettings = {
	colors: {
		assistant: "#6495ed",
		self:      "#a0a0b0",   // neutral blue-grey — subtle baseline
		quote:     "#3cb371",
		unknown:   "#ffc107",
	},
	pluginDefault: "self",         // most vaults are self-authored
	autoInsertFrontmatter: false,  // opt-in only
};

/**
 * Convert a hex colour + alpha into an rgba() string.
 * Falls back to a semi-transparent black on malformed input.
 */
export function hexToRgba(hex: string, alpha: number): string {
	const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
	if (!match || !match[1] || !match[2] || !match[3]) return `rgba(0,0,0,${alpha})`;
	return `rgba(${parseInt(match[1], 16)}, ${parseInt(match[2], 16)}, ${parseInt(match[3], 16)}, ${alpha})`;
}

/** Build the CSS custom-property block injected at runtime. */
export function buildDynamicCSS(settings: MDPSettings): string {
	const c = settings.colors;
	const fallback = DEFAULT_SETTINGS.colors;
	return `
:root {
  --mdp-color-assistant: ${hexToRgba(c.assistant ?? fallback.assistant, 0.18)};
  --mdp-color-self:      ${hexToRgba(c.self      ?? fallback.self,      0.15)};
  --mdp-color-quote:     ${hexToRgba(c.quote     ?? fallback.quote,     0.18)};
  --mdp-color-unknown:   ${hexToRgba(c.unknown   ?? fallback.unknown,   0.22)};
}`.trim();
}
