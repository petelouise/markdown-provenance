/**
 * MDP Auto-Remark extension.
 *
 * When the user types anywhere in a note (except the frontmatter), any
 * newly inserted text is automatically attributed to them:
 *
 *   - Inside a non-user span (%a, %q, %?) → span is split around the
 *     insertion, which is wrapped in %u{...}.
 *   - In bare text where the effective default is non-user → insertion
 *     is wrapped in %u{...}.
 *   - Inside an existing %u{...} span, or bare text with user/null
 *     default → no change.
 *
 * Uses a CM6 transactionFilter so wrapping is atomic with the user's
 * keystroke: a single Ctrl+Z undoes both.
 */

import {
	Annotation,
	EditorState,
	StateField,
	Transaction,
	TransactionSpec,
	ChangeSet,
	EditorSelection,
} from "@codemirror/state";
import { App } from "obsidian";
import {
	ProvenanceWord,
	WORD_TO_LETTER,
	normalizeProvenance,
	effectiveDefault,
} from "./provenance";
import { MDPSettings } from "./settings";

// ---------------------------------------------------------------------------
// Plugin context (matches MDPPluginContext in livePreview.ts)
// ---------------------------------------------------------------------------

export interface AutoRemarkPluginContext {
	app: App;
	settings: MDPSettings;
}

// ---------------------------------------------------------------------------
// Annotation to mark our own transactions — prevents infinite filter loops
// ---------------------------------------------------------------------------

const MDP_OWN = Annotation.define<true>();

// ---------------------------------------------------------------------------
// Span type (mirrors SpanRange in livePreview.ts)
// ---------------------------------------------------------------------------

type SpanRange = { from: number; to: number; provenance: ProvenanceWord };

// ---------------------------------------------------------------------------
// Document state cached in a StateField
// Recomputed whenever the document changes; read from tr.startState in filter.
// ---------------------------------------------------------------------------

interface DocState {
	spans:            SpanRange[];
	effectiveDef:     ProvenanceWord | null;
	frontmatterEnd:   number;   // first doc position AFTER the frontmatter block
}

function computeDocState(
	docText: string,
	pluginDefault: ProvenanceWord | "none"
): DocState {
	const spans: SpanRange[] = [];
	findSpans(docText, 0, spans);

	const frontmatterEnd = detectFrontmatterEnd(docText);
	const frontmatterText = docText.slice(0, frontmatterEnd);
	const fmMatch = frontmatterText.match(/^provenance\s*:\s*(\S+)/m);
	const docDefault = fmMatch ? normalizeProvenance(fmMatch[1]) : null;
	const effectiveDef = effectiveDefault(docDefault, pluginDefault);

	return { spans, effectiveDef, frontmatterEnd };
}

/** Find the position immediately after the closing `---` of YAML frontmatter. */
function detectFrontmatterEnd(text: string): number {
	if (!text.startsWith("---")) return 0;
	const afterOpen = text.indexOf("\n", 3);
	if (afterOpen === -1) return 0;
	// Find the closing ---
	let pos = afterOpen + 1;
	while (pos < text.length) {
		const lineEnd = text.indexOf("\n", pos);
		const line = lineEnd === -1 ? text.slice(pos) : text.slice(pos, lineEnd);
		if (line.trimEnd() === "---") {
			return lineEnd === -1 ? text.length : lineEnd + 1;
		}
		if (lineEnd === -1) break;
		pos = lineEnd + 1;
	}
	return 0;
}

/**
 * Scan `text` for MDP spans, pushing `{from, to, provenance}` into `out`.
 * Mirrors the logic in livePreview.ts / findSpans() but accepts/returns
 * ProvenanceWord values (not letters) for convenience.
 */
function findSpans(text: string, offset: number, out: SpanRange[]): void {
	const SIGILS = new Set(["a", "u", "q", "?", "s"]);
	const WORD: Record<string, ProvenanceWord> = {
		a: "assistant", u: "user", q: "external", "?": "unknown", s: "user",
	};
	let i = 0;
	while (i < text.length) {
		if (text[i] === "\\" && i + 1 < text.length) { i += 2; continue; }
		if (text[i] === "`") { i = skipCodeSpan(text, i); continue; }
		if (
			text[i] === "%" &&
			i + 2 < text.length &&
			SIGILS.has(text[i + 1] ?? "") &&
			text[i + 2] === "{"
		) {
			const sigil = text[i + 1];
			const spanFrom = i;
			let depth = 1;
			let j = i + 3;
			while (j < text.length && depth > 0) {
				if (text[j] === "\\" && j + 1 < text.length) { j += 2; continue; }
				if (text[j] === "{") depth++;
				if (text[j] === "}") depth--;
				j++;
			}
			const spanTo = j;
			const provenance = WORD[sigil ?? ""];
			if (provenance) {
				out.push({ from: offset + spanFrom, to: offset + spanTo, provenance });
				// Recurse into span content to find nested spans
				findSpans(
					text.slice(spanFrom + 3, spanTo - 1),
					offset + spanFrom + 3,
					out
				);
			}
			i = spanTo;
			continue;
		}
		i++;
	}
}

function skipCodeSpan(text: string, start: number): number {
	let tickCount = 0;
	let i = start;
	while (i < text.length && text[i] === "`") { tickCount++; i++; }
	const fence = "`".repeat(tickCount);
	while (i < text.length) {
		const closeIdx = text.indexOf(fence, i);
		if (closeIdx === -1) return i;
		const afterClose = closeIdx + tickCount;
		if (afterClose >= text.length || text[afterClose] !== "`") return afterClose;
		i = closeIdx + 1;
	}
	return i;
}

/** Return the innermost span containing `pos` (exclusive of sigil/brace chars), or null. */
function innermostSpanAt(spans: SpanRange[], pos: number): SpanRange | null {
	// Content of a span starts 3 chars in (after %X{) and ends 1 char before to (before })
	const containing = spans.filter(s => pos > s.from + 2 && pos < s.to);
	if (containing.length === 0) return null;
	// Innermost = smallest range
	return containing.reduce((a, b) => (a.to - a.from) <= (b.to - b.from) ? a : b);
}

// ---------------------------------------------------------------------------
// StateField: cached DocState, updated per transaction
// ---------------------------------------------------------------------------

function buildDocStateField(plugin: AutoRemarkPluginContext): StateField<DocState> {
	return StateField.define<DocState>({
		create(state) {
			return computeDocState(
				state.doc.sliceString(0, state.doc.length),
				plugin.settings.pluginDefault
			);
		},
		update(prev, tr) {
			if (!tr.docChanged) return prev;
			return computeDocState(
				tr.newDoc.sliceString(0, tr.newDoc.length),
				plugin.settings.pluginDefault
			);
		},
	});
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildAutoRemarkExtension(plugin: AutoRemarkPluginContext) {
	const docStateField = buildDocStateField(plugin);

	const filter = EditorState.transactionFilter.of((tr) => {
		// Only process user input (typing, paste, compose). Not deletions, not our own.
		if (!tr.isUserEvent("input")) return tr;
		if (tr.annotation(MDP_OWN))   return tr;

		const { spans, effectiveDef, frontmatterEnd } =
			tr.startState.field(docStateField);

		// Collect extra changes to apply to the post-transaction document.
		// Each entry is { from, to, insert } in post-transaction (tr.newDoc) coordinates.
		const extraChanges: { from: number; to: number; insert: string }[] = [];
		let cursorAfter: number | null = null;

		tr.changes.iterChanges((fromA, _toA, fromB, toB, inserted) => {
			// Skip deletions (no inserted text) and frontmatter edits
			if (inserted.length === 0) return;
			if (fromA < frontmatterEnd) return;

			const innerSpan = innermostSpanAt(spans, fromA);

			if (innerSpan) {
				// ── Case A: insertion inside an explicit span ──────────────────────
				if (innerSpan.provenance === "user") return; // already user — done

				const sigil = WORD_TO_LETTER[innerSpan.provenance] ?? "a";
				const spanContentEnd = innerSpan.to - 1; // position of closing }

				// Insert `}%u{` before the inserted text and `}%X{` after it.
				// The original closing } of the outer span still closes the last piece.
				extraChanges.push({ from: fromB, to: fromB, insert: "}%u{" });
				if (fromA < spanContentEnd) {
					extraChanges.push({ from: toB, to: toB, insert: `}%${sigil}{` });
				}
				// Cursor goes inside the new %u{...} span (after the `}%u{` insertion)
				cursorAfter = fromB + 3 + (toB - fromB);

			} else {
				// ── Case B: insertion in bare text ─────────────────────────────────
				if (!effectiveDef || effectiveDef === "user") return;

				extraChanges.push({ from: fromB, to: fromB, insert: "%u{" });
				extraChanges.push({ from: toB,   to: toB,   insert: "}" });
				// Cursor goes after the inserted text, inside %u{...} (before the `}`)
				cursorAfter = fromB + 3 + (toB - fromB);
			}
		});

		if (extraChanges.length === 0) return tr;

		// Sort changes by position (required by ChangeSet.of)
		extraChanges.sort((a, b) => a.from - b.from);

		const newDocLen = tr.newDoc.length;
		const wrappingChanges = ChangeSet.of(extraChanges, newDocLen);

		const spec: TransactionSpec = {
			changes:     wrappingChanges,
			annotations: MDP_OWN.of(true),
			...(cursorAfter !== null && {
				selection: EditorSelection.cursor(
					wrappingChanges.mapPos(cursorAfter, -1)
				),
			}),
		};

		return [tr, spec] as readonly TransactionSpec[];
	});

	return [docStateField, filter];
}
