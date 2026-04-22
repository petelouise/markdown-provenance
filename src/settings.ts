import { ProvenanceWord } from "./provenance";

export interface MDPSettings {
	colors: {
		assistant: string;
		user:      string;   // neutral blue-grey by default; configurable
		external:  string;
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
		user:      "#a0a0b0",   // neutral blue-grey — subtle baseline
		external:  "#3cb371",
		unknown:   "#ffc107",
	},
	pluginDefault: "user",         // most vaults are user-authored
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

/**
 * Build the CSS custom-property block injected at runtime.
 * Generates separate values for light and dark themes so tints remain
 * legible regardless of the active Obsidian colour scheme.
 *
 * Light mode uses lighter opacity; dark mode uses slightly higher opacity
 * since the same hue needs more presence against a dark canvas.
 */
export function buildDynamicCSS(settings: MDPSettings): string {
	const c = settings.colors;
	const fb = DEFAULT_SETTINGS.colors;

	const vars = (alpha: { assistant: number; user: number; external: number; unknown: number }) => `
  --mdp-color-assistant: ${hexToRgba(c.assistant ?? fb.assistant, alpha.assistant)};
  --mdp-color-user:      ${hexToRgba(c.user      ?? fb.user,      alpha.user)};
  --mdp-color-external:  ${hexToRgba(c.external  ?? fb.external,  alpha.external)};
  --mdp-color-unknown:   ${hexToRgba(c.unknown   ?? fb.unknown,   alpha.unknown)};`.trimEnd();

	return `
body.theme-light {${vars({ assistant: 0.18, user: 0.15, external: 0.18, unknown: 0.22 })}
}
body.theme-dark {${vars({ assistant: 0.28, user: 0.22, external: 0.26, unknown: 0.32 })}
}`.trim();
}
