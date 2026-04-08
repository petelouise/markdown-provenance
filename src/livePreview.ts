/**
 * MDP Live Preview extension.
 *
 * Applies provenance decorations in CodeMirror 6 (Obsidian Live Preview mode)
 * by scanning visible ranges for MDP span syntax and adding Decoration.mark()
 * for each matched range.
 */

import {
	Decoration,
	DecorationSet,
	EditorView,
	ViewPlugin,
	ViewUpdate,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { App } from "obsidian";
import { normalizeFrontmatter, ProvenanceWord } from "./renderer";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildLivePreviewExtension(app: App) {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = buildDecorations(view, app);
			}

			update(update: ViewUpdate) {
				if (update.docChanged || update.viewportChanged || update.selectionSet) {
					this.decorations = buildDecorations(update.view, app);
				}
			}
		},
		{ decorations: (v) => v.decorations }
	);
}

// ---------------------------------------------------------------------------
// Decoration builder
// ---------------------------------------------------------------------------

const LETTER_TO_WORD: Record<string, ProvenanceWord> = {
	a: "assistant",
	s: "self",
	q: "quote",
	u: "unknown",
};

type SpanRange = { from: number; to: number; provenance: ProvenanceWord };
type DecoEntry = { from: number; to: number; deco: Decoration };

const HIDE = Decoration.replace({});

function buildDecorations(view: EditorView, app: App): DecorationSet {
	// Read document default from frontmatter
	const activeFile = app.workspace.getActiveFile();
	const frontmatter = activeFile
		? app.metadataCache.getFileCache(activeFile)?.frontmatter
		: null;
	const docDefault = normalizeFrontmatter(frontmatter?.provenance);

	const spans: SpanRange[] = [];
	for (const { from, to } of view.visibleRanges) {
		const text = view.state.doc.sliceString(from, to);
		findSpans(text, from, spans);
	}
	spans.sort((a, b) => a.from - b.from || b.to - a.to);

	const cursorHead = view.state.selection.main.head;
	const entries: DecoEntry[] = [];

	for (const span of spans) {
		const classes = ["mdp-span"];
		if (span.provenance === docDefault) classes.push("mdp-default");
		const mark = Decoration.mark({
			class: classes.join(" "),
			attributes: { "data-provenance": span.provenance },
		});

		const cursorInSpan = cursorHead >= span.from && cursorHead <= span.to;

		if (cursorInSpan) {
			// Cursor is inside this span — show raw syntax with tint
			entries.push({ from: span.from, to: span.to, deco: mark });
		} else {
			// Cursor is elsewhere — hide %X{ and }, tint only the inner content
			const innerFrom = span.from + 3; // character after {
			const innerTo = span.to - 1;     // the closing }
			entries.push({ from: span.from,  to: span.from + 3, deco: HIDE });
			if (innerFrom < innerTo) {
				entries.push({ from: innerFrom, to: innerTo, deco: mark });
			}
			entries.push({ from: innerTo, to: span.to, deco: HIDE });
		}
	}

	// RangeSetBuilder requires ascending `from`; equal `from` → wider range first
	entries.sort((a, b) => a.from - b.from || b.to - a.to);

	const builder = new RangeSetBuilder<Decoration>();
	for (const { from, to, deco } of entries) {
		builder.add(from, to, deco);
	}
	return builder.finish();
}

// ---------------------------------------------------------------------------
// Position-aware span scanner
// ---------------------------------------------------------------------------

/**
 * Walk `text` (which starts at document position `offset`) and push all MDP
 * span ranges into `out`. Handles nesting and escapes. Does not parse inside
 * backtick code spans.
 */
function findSpans(text: string, offset: number, out: SpanRange[]): void {
	let i = 0;

	while (i < text.length) {
		// Escape sequence: skip two chars
		if (text[i] === "\\" && i + 1 < text.length) {
			i += 2;
			continue;
		}

		// Backtick code span: skip to matching fence
		if (text[i] === "`") {
			i = skipCodeSpan(text, i);
			continue;
		}

		// MDP span opener: %[asqu]{
		if (
			text[i] === "%" &&
			i + 2 < text.length &&
			"asqu".includes(text[i + 1] ?? "") &&
			text[i + 2] === "{"
		) {
			const sigil = text[i + 1] as string;
			const spanFrom = i;
			let depth = 1;
			let j = i + 3;

			while (j < text.length && depth > 0) {
				if (text[j] === "\\" && j + 1 < text.length) {
					j += 2;
					continue;
				}
				if (text[j] === "{") depth++;
				if (text[j] === "}") depth--;
				j++;
			}

			// j is now just past the closing }
			const spanTo = j;

			const provenance = LETTER_TO_WORD[sigil];
			if (!provenance) { i = spanTo; continue; } // unreachable, satisfies TS

			out.push({
				from: offset + spanFrom,
				to: offset + spanTo,
				provenance,
			});

			// Recurse into content between %X{ and } for nested spans
			const innerText = text.slice(spanFrom + 3, spanTo - 1);
			findSpans(innerText, offset + spanFrom + 3, out);

			i = spanTo;
			continue;
		}

		i++;
	}
}

/**
 * Given that text[start] === '`', find the end of the code span and return
 * the index just past it. Handles multi-backtick fences.
 */
function skipCodeSpan(text: string, start: number): number {
	let tickCount = 0;
	let i = start;

	while (i < text.length && text[i] === "`") {
		tickCount++;
		i++;
	}

	const fence = "`".repeat(tickCount);

	while (i < text.length) {
		const closeIdx = text.indexOf(fence, i);
		if (closeIdx === -1) return i; // no closing fence — treat opener as literal
		const afterClose = closeIdx + tickCount;
		if (afterClose >= text.length || text[afterClose] !== "`") {
			return afterClose;
		}
		i = closeIdx + 1;
	}

	return i;
}
