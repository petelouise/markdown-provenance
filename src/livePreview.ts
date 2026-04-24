/**
 * MDP Live Preview extension.
 *
 * Applies provenance decorations in CodeMirror 6 (Obsidian Live Preview mode)
 * by scanning for MDP span and block syntax. Inline spans use Decoration.mark();
 * block markers use Decoration.line() so whole editor lines can carry
 * provenance embellishment. Syntax delimiters are hidden when the cursor is outside
 * the marked range.
 */

import {
	Decoration,
	DecorationSet,
	EditorView,
	ViewPlugin,
	ViewUpdate,
} from "@codemirror/view";
import { App } from "obsidian";
import {
	ProvenanceWord,
	ProvenanceLetter,
	LETTER_TO_WORD,
	PROVENANCE_LABEL,
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

type SpanRange = {
	from: number;
	to: number;
	provenance: ProvenanceWord;
	hoverScopeId: string;
};
type DecoEntry = { from: number; to: number; deco: Decoration };

const HIDE = Decoration.replace({});
const BLOCK_LINE_RE = /^%(a|u|q|\?)>(?!>) ?/;
const FENCE_OPEN_RE = /^%([auq?])>>>$/;
const FENCE_CLOSE_RE = /^%>>>$/;

function buildDecorations(view: EditorView, plugin: MDPPluginContext): DecorationSet {
	const activeFile = plugin.app.workspace.getActiveFile();
	const frontmatter = activeFile
		? plugin.app.metadataCache.getFileCache(activeFile)?.frontmatter
		: null;

	const docDefault    = normalizeProvenance(frontmatter?.provenance);
	const def           = effectiveDefault(docDefault, plugin.settings.pluginDefault);
	const hoverScopeIds = buildHoverScopeIds(view, activeFile?.path ?? "active-note");

	const spans: SpanRange[] = [];
	for (const { from, to } of view.visibleRanges) {
		findSpans(view.state.doc.sliceString(from, to), from, spans, hoverScopeIds, view);
	}
	spans.sort((a, b) => a.from - b.from || b.to - a.to);

	const cursorHead = view.state.selection.main.head;
	const entries: DecoEntry[] = [];

	addHoverAnchors(view, hoverScopeIds, entries);
	addBlockDecorations(view, def, cursorHead, hoverScopeIds, entries);

	for (const span of spans) {
		const classes = ["mdp-span", "mdp-hover-target"];
		if (span.provenance === def) classes.push("mdp-default");
		const cursorInSpan = cursorHead >= span.from && cursorHead <= span.to;
		if (cursorInSpan) classes.push("mdp-active");
		const mark = Decoration.mark({
			class: classes.join(" "),
			attributes: {
				"data-provenance": span.provenance,
				"data-provenance-label": PROVENANCE_LABEL[span.provenance],
				"data-mdp-hover-scope": span.hoverScopeId,
				"title": `Provenance: ${span.provenance}`,
			},
		});

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
	return Decoration.set(
		entries.map(({ from, to, deco }) => deco.range(from, to)),
		true,
	);
}

// ---------------------------------------------------------------------------
// Position-aware block marker scanner
// ---------------------------------------------------------------------------

function addBlockDecorations(
	view: EditorView,
	def: ProvenanceWord | null,
	cursorHead: number,
	hoverScopeIds: string[],
	entries: DecoEntry[],
): void {
	const doc = view.state.doc;
	let activeFence: ProvenanceWord | null = null;

	for (let lineNo = 1; lineNo <= doc.lines; lineNo++) {
		const line = doc.line(lineNo);
		const trimmed = line.text.trim();

		if (activeFence) {
			if (FENCE_CLOSE_RE.test(trimmed)) {
				if (isLineVisible(view, line.from, line.to) && !cursorOnLine(cursorHead, line.from, line.to)) {
					entries.push({ from: line.from, to: line.to, deco: HIDE });
				}
				activeFence = null;
				continue;
			}

			if (isLineVisible(view, line.from, line.to)) {
				entries.push({
					from: line.from,
					to: line.from,
					deco: blockLineDecoration(
						activeFence,
						def,
						"mdp-block-fenced",
						cursorOnLine(cursorHead, line.from, line.to),
						hoverScopeIds[line.number] ?? hoverScopeIds[0] ?? "active-note:root",
					),
				});
			}
			continue;
		}

		const openMatch = trimmed.match(FENCE_OPEN_RE);
		if (openMatch) {
			const provenance = LETTER_TO_WORD[openMatch[1] as ProvenanceLetter];
			if (isLineVisible(view, line.from, line.to) && !cursorOnLine(cursorHead, line.from, line.to)) {
				entries.push({ from: line.from, to: line.to, deco: HIDE });
			}
			activeFence = provenance;
			continue;
		}

		const lineMatch = line.text.match(BLOCK_LINE_RE);
		if (!lineMatch) continue;

		const provenance = LETTER_TO_WORD[lineMatch[1] as ProvenanceLetter];
		if (!isLineVisible(view, line.from, line.to)) continue;

		entries.push({
			from: line.from,
			to: line.from,
			deco: blockLineDecoration(
				provenance,
				def,
				"mdp-block-line",
				cursorOnLine(cursorHead, line.from, line.to),
				hoverScopeIds[line.number] ?? hoverScopeIds[0] ?? "active-note:root",
			),
		});
		if (!cursorOnLine(cursorHead, line.from, line.to)) {
			entries.push({ from: line.from, to: line.from + lineMatch[0].length, deco: HIDE });
		}
	}
}

function blockLineDecoration(
	provenance: ProvenanceWord,
	def: ProvenanceWord | null,
	extraClass: string,
	active: boolean,
	hoverScopeId: string,
): Decoration {
	const classes = ["mdp-block", "mdp-hover-target", extraClass];
	if (provenance === def) classes.push("mdp-default");
	if (active) classes.push("mdp-active");
	return Decoration.line({
		class: classes.join(" "),
		attributes: {
			"data-provenance": provenance,
			"data-provenance-label": PROVENANCE_LABEL[provenance],
			"data-mdp-hover-scope": hoverScopeId,
			"title": `Provenance: ${provenance}`,
		},
	});
}

function addHoverAnchors(
	view: EditorView,
	hoverScopeIds: string[],
	entries: DecoEntry[],
): void {
	for (let lineNo = 1; lineNo <= view.state.doc.lines; lineNo++) {
		const line = view.state.doc.line(lineNo);
		if (!isLineVisible(view, line.from, line.to)) continue;
		entries.push({
			from: line.from,
			to: line.from,
			deco: Decoration.line({
				class: "mdp-hover-anchor",
				attributes: {
					"data-mdp-hover-scope": hoverScopeIds[line.number] ?? hoverScopeIds[0] ?? "active-note:root",
				},
			}),
		});
	}
}

function isLineVisible(view: EditorView, from: number, to: number): boolean {
	return view.visibleRanges.some((range) => from <= range.to && to >= range.from);
}

function cursorOnLine(cursorHead: number, from: number, to: number): boolean {
	return cursorHead >= from && cursorHead <= to;
}

// ---------------------------------------------------------------------------
// Position-aware span scanner
// ---------------------------------------------------------------------------

function findSpans(
	text: string,
	offset: number,
	out: SpanRange[],
	hoverScopeIds: string[],
	view: EditorView,
): void {
	let i = 0;
	while (i < text.length) {
		if (text[i] === "\\" && i + 1 < text.length) { i += 2; continue; }
		if (text[i] === "`") { i = skipCodeSpan(text, i); continue; }

		if (
			text[i] === "%" &&
			i + 2 < text.length &&
			"auqs?".includes(text[i + 1] ?? "") &&
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
			const hoverScopeId = hoverScopeIds[view.state.doc.lineAt(offset + spanFrom).number]
				?? hoverScopeIds[0]
				?? "active-note:root";

			out.push({ from: offset + spanFrom, to: offset + spanTo, provenance, hoverScopeId });
			findSpans(text.slice(spanFrom + 3, spanTo - 1), offset + spanFrom + 3, out, hoverScopeIds, view);
			i = spanTo;
			continue;
		}
		i++;
	}
}

function buildHoverScopeIds(view: EditorView, sourceKey: string): string[] {
	const scopeIds = new Array<string>(view.state.doc.lines + 1);
	let currentScopeId = `${sourceKey}:root`;
	let inCodeFence = false;

	for (let lineNo = 1; lineNo <= view.state.doc.lines; lineNo++) {
		const line = view.state.doc.line(lineNo);
		const trimmed = line.text.trim();

		if (/^```/.test(trimmed)) {
			inCodeFence = !inCodeFence;
			scopeIds[lineNo] = currentScopeId;
			continue;
		}

		if (!inCodeFence && /^#{1,6}\s/.test(trimmed)) {
			currentScopeId = `${sourceKey}:section:${lineNo}`;
		}

		scopeIds[lineNo] = currentScopeId;
	}

	return scopeIds;
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
