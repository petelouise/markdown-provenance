/**
 * Shared provenance types, constants, and utilities.
 * Imported by renderer.ts, livePreview.ts, settings.ts, and settingsTab.ts.
 */

export type ProvenanceWord   = "assistant" | "self" | "quote" | "unknown";
export type ProvenanceLetter = "a" | "s" | "q" | "u";

export const LETTER_TO_WORD: Record<ProvenanceLetter, ProvenanceWord> = {
	a: "assistant",
	s: "self",
	q: "quote",
	u: "unknown",
};

/** Accepts canonical names + legacy/shorthand aliases. Case-insensitive. */
const ALIASES: Record<string, ProvenanceWord> = {
	// canonical
	assistant: "assistant",
	self:      "self",
	quote:     "quote",
	unknown:   "unknown",
	// aliases
	ai:        "assistant",   // shorthand
	human:     "self",        // original spec term
};

/**
 * Normalise a raw frontmatter or settings value to a ProvenanceWord.
 * Returns null for absent, non-string, or unrecognised values.
 */
export function normalizeProvenance(value: unknown): ProvenanceWord | null {
	if (typeof value !== "string") return null;
	return ALIASES[value.toLowerCase().trim()] ?? null;
}

/**
 * Resolve the effective default provenance for a note.
 *
 * Priority: frontmatter > plugin default > null (no suppression).
 * A plugin default of "none" means "tint everything — no suppression".
 */
export function effectiveDefault(
	docDefault: ProvenanceWord | null,
	pluginDefault: ProvenanceWord | "none"
): ProvenanceWord | null {
	if (docDefault !== null) return docDefault;
	if (pluginDefault !== "none") return pluginDefault as ProvenanceWord;
	return null;
}
