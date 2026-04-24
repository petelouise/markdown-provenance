import { ProvenanceWord } from "./provenance";

export type StatusBarMode = "percent" | "count";

export interface MDPSettings {
	colors: {
		assistant: string;
		user:      string;
		external:  string;
		unknown:   string;
	};
	/**
	 * Optional per-type colours for Obsidian's dark theme.
	 * Only used when separateDarkMode is true.
	 * Absent means dark theme falls back to colors.
	 */
	darkColors?: {
		assistant: string;
		user:      string;
		external:  string;
		unknown:   string;
	};
	/** When true, dark theme uses darkColors instead of colors. */
	separateDarkMode: boolean;
	pluginDefault: ProvenanceWord | "none";
	autoInsertFrontmatter: boolean;
	statusBarStatsEnabled: boolean;
	statusBarStatsMode: StatusBarMode;
	embellishmentVisibility: "always" | "hover";
	embellishmentHoverScope: "mark" | "section";
	showRibbonToggle: boolean;
}

export const DEFAULT_SETTINGS: MDPSettings = {
	colors: {
		assistant: "#6495ed",
		user:      "#a0a0b0",
		external:  "#3cb371",
		unknown:   "#ffc107",
	},
	// darkColors intentionally absent — absent means inherit from colors
	separateDarkMode: false,
	pluginDefault: "user",
	autoInsertFrontmatter: false,
	statusBarStatsEnabled: true,
	statusBarStatsMode: "percent",
	embellishmentVisibility: "hover",
	embellishmentHoverScope: "section",
	showRibbonToggle: true,
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

export function buildDynamicCssProps(settings: MDPSettings): Record<string, string> {
	const lightC = settings.colors;
	const darkC  = (settings.separateDarkMode && settings.darkColors)
		? settings.darkColors
		: settings.colors;
	const fb = DEFAULT_SETTINGS.colors;

	const vars = (
		c: NonNullable<MDPSettings["darkColors"]>,
		bg: { assistant: number; user: number; external: number; unknown: number },
		border: { assistant: number; user: number; external: number; unknown: number },
	) => ({
		"--mdp-color-assistant": hexToRgba(c.assistant ?? fb.assistant, bg.assistant),
		"--mdp-color-user": hexToRgba(c.user ?? fb.user, bg.user),
		"--mdp-color-external": hexToRgba(c.external ?? fb.external, bg.external),
		"--mdp-color-unknown": hexToRgba(c.unknown ?? fb.unknown, bg.unknown),
		"--mdp-border-assistant": hexToRgba(c.assistant ?? fb.assistant, border.assistant),
		"--mdp-border-user": hexToRgba(c.user ?? fb.user, border.user),
		"--mdp-border-external": hexToRgba(c.external ?? fb.external, border.external),
		"--mdp-border-unknown": hexToRgba(c.unknown ?? fb.unknown, border.unknown),
	});

	return document.body.classList.contains("theme-dark")
		? vars(
			darkC,
			{ assistant: 0.28, user: 0.22, external: 0.26, unknown: 0.32 },
			{ assistant: 0.65, user: 0.55, external: 0.65, unknown: 0.70 },
		)
		: vars(
			lightC,
			{ assistant: 0.18, user: 0.15, external: 0.18, unknown: 0.22 },
			{ assistant: 0.50, user: 0.40, external: 0.50, unknown: 0.55 },
		);
}
