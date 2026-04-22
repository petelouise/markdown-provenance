/**
 * Shared provenance types, constants, and utilities.
 * Imported by renderer.ts, livePreview.ts, settings.ts, and settingsTab.ts.
 */

export type ProvenanceWord   = "assistant" | "user" | "external" | "unknown";
export type ProvenanceLetter = "a" | "u" | "q" | "?" | "s";

export const LETTER_TO_WORD: Record<ProvenanceLetter, ProvenanceWord> = {
	a:   "assistant",
	u:   "user",       // canonical user sigil
	q:   "external",
	"?": "unknown",
	s:   "user",       // backward-compat alias for old %s (self)
};

/** Reverse map: canonical word → canonical sigil letter (for inserting new spans). */
export const WORD_TO_LETTER: Record<ProvenanceWord, string> = {
	assistant: "a",
	user:      "u",
	external:  "q",
	unknown:   "?",
};

/** Accepts canonical names + legacy/shorthand aliases. Case-insensitive. */
const ALIASES: Record<string, ProvenanceWord> = {
	// canonical
	assistant: "assistant",
	user:      "user",
	external:  "external",
	unknown:   "unknown",
	// aliases
	ai:        "assistant",   // shorthand
	human:     "user",        // original spec term
	self:      "user",        // previous plugin term
	quote:     "external",    // previous plugin term
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
