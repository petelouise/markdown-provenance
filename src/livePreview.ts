/**
 * MDP Live Preview extension.
 *
 * Applies provenance decorations in CodeMirror 6 (Obsidian Live Preview mode)
 * by scanning visible ranges for MDP span syntax and adding Decoration.mark()
 * for each matched range. Syntax delimiters are hidden when the cursor is
 * outside a span.
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
import {
	ProvenanceWord,
	ProvenanceLetter,
	LETTER_TO_WORD,
	normalizeProvenance,
	effectiveDefault,
} from "./provenance";
import { MDPSettings } from "./settings";

// ---------------------------------------------------------------------------
// Context interface (avoids circular import with main.ts)
// ---------------------------------------------------------------------------

export interface MDPPluginContext {
	app: App;
	settings: MDPSettings;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildLivePreviewExtension(plugin: MDPPluginContext) {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = buildDecorations(view, plugin);
			}

			update(update: ViewUpdate) {
				if (update.docChanged || update.viewportChanged || update.selectionSet) {
					this.decorations = buildDecorations(update.view, plugin);
				}
			}
		},
		{ decorations: (v) => v.decorations }
	);
}

// ---------------------------------------------------------------------------
// Decoration builder
// ---------------------------------------------------------------------------

type SpanRange = { from: number; to: number; provenance: ProvenanceWord };
type DecoEntry = { from: number; to: number; deco: Decoration };

const HIDE = Decoration.replace({});

function buildDecorations(view: EditorView, plugin: MDPPluginContext): DecorationSet {
	const activeFile = plugin.app.workspace.getActiveFile();
	const frontmatter = activeFile
		? plugin.app.metadataCache.getFileCache(activeFile)?.frontmatter
		: null;

	const docDefault    = normalizeProvenance(frontmatter?.provenance);
	const def           = effectiveDefault(docDefault, plugin.settings.pluginDefault);

	const spans: SpanRange[] = [];
	for (const { from, to } of view.visibleRanges) {
		findSpans(view.state.doc.sliceString(from, to), from, spans);
	}
	spans.sort((a, b) => a.from - b.from || b.to - a.to);

	const cursorHead = view.state.selection.main.head;
	const entries: DecoEntry[] = [];

	for (const span of spans) {
		const classes = ["mdp-span"];
		if (span.provenance === def) classes.push("mdp-default");
		const mark = Decoration.mark({
			class: classes.join(" "),
			attributes: { "data-provenance": span.provenance },
		});

		const cursorInSpan = cursorHead >= span.from && cursorHead <= span.to;

		if (cursorInSpan) {
			entries.push({ from: span.from, to: span.to, deco: mark });
		} else {
			const innerFrom = span.from + 3;
			const innerTo   = span.to - 1;
			entries.push({ from: span.from,  to: span.from + 3, deco: HIDE });
			if (innerFrom < innerTo) {
				entries.push({ from: innerFrom, to: innerTo, deco: mark });
			}
			entries.push({ from: innerTo, to: span.to, deco: HIDE });
		}
	}

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

function findSpans(text: string, offset: number, out: SpanRange[]): void {
	let i = 0;
	while (i < text.length) {
		if (text[i] === "\\" && i + 1 < text.length) { i += 2; continue; }
		if (text[i] === "`") { i = skipCodeSpan(text, i); continue; }

		if (
			text[i] === "%" &&
			i + 2 < text.length &&
			"asqu".includes(text[i + 1] ?? "") &&
			text[i + 2] === "{"
		) {
			const sigil    = text[i + 1] as ProvenanceLetter;
			const spanFrom = i;
			let depth = 1;
			let j = i + 3;

			while (j < text.length && depth > 0) {
				if (text[j] === "\\" && j + 1 < text.length) { j += 2; continue; }
				if (text[j] === "{") depth++;
				if (text[j] === "}") depth--;
				j++;
			}

			const spanTo    = j;
			const provenance = LETTER_TO_WORD[sigil];
			if (!provenance) { i = spanTo; continue; }

			out.push({ from: offset + spanFrom, to: offset + spanTo, provenance });
			findSpans(text.slice(spanFrom + 3, spanTo - 1), offset + spanFrom + 3, out);
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
