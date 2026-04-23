/**
 * MDP renderer — post-processor for Reading mode.
 *
 * Walks the DOM of a rendered Markdown section, finds text nodes containing
 * MDP provenance syntax, and replaces them with styled <span> elements.
 *
 * Also handles block-level markers:
 *   - Per-line: %a> text (each line carries the prefix; rendered as <blockquote>)
 *   - Fenced:   %a>>> … %>>> (embellishment only, no blockquote indent)
 */

import {
	ProvenanceWord,
	ProvenanceLetter,
	LETTER_TO_WORD,
	normalizeProvenance,
	effectiveDefault,
} from "./provenance";
import { MDPSettings } from "./settings";

// Re-export for callers that previously imported from here
export type { ProvenanceWord };
export { normalizeProvenance };

// ---------------------------------------------------------------------------
// Block-marker regexes
// ---------------------------------------------------------------------------

// Space after > is optional, matching CommonMark's blockquote rule (both
// `> text` and `>text` are valid). The regex mirrors that behaviour.
const BLOCK_LINE_RE = /^%(a|u|q|\?)>(?!>) ?/;
const FENCE_OPEN_RE = /^%([auq?])>>>$/;
const FENCE_CLOSE_RE = /^%>>>$/;

type BlockSigil = "a" | "u" | "q" | "?";

const MARKDOWN_BLOCK_TAGS = new Set([
	"BLOCKQUOTE",
	"H1",
	"H2",
	"H3",
	"H4",
	"H5",
	"H6",
	"HR",
	"OL",
	"P",
	"PRE",
	"TABLE",
	"UL",
]);

// Pre-built per-sigil regexes — avoids per-call RegExp allocation.
// SIGIL_LINE_RE: anchored (no g flag) — safe for .test() calls.
// SIGIL_BOUNDARY_RE: global — safe for .replace() calls (replace() resets lastIndex).
const SIGIL_LINE_RE: Readonly<Record<BlockSigil, RegExp>> = {
	a:   /^%a>(?!>) ?/,
	u:   /^%u>(?!>) ?/,
	q:   /^%q>(?!>) ?/,
	"?": /^%\?>(?!>) ?/,
};

const SIGIL_BOUNDARY_RE: Readonly<Record<BlockSigil, RegExp>> = {
	a:   /([\n ])%a>(?!>) ?/g,
	u:   /([\n ])%u>(?!>) ?/g,
	q:   /([\n ])%q>(?!>) ?/g,
	"?": /([\n ])%\?>(?!>) ?/g,
};

interface FenceState {
	sigil: BlockSigil;
}

interface RenderSectionInfo {
	lineStart: number;
}

// Module-level state: one active fence per rendered document at a time.
// Relies on Obsidian calling post-processors in document order (top to bottom).
// Call clearFences() from the plugin's onunload() to avoid accumulating
// stale entries from renamed or deleted files.
const activeFences = new Map<string, FenceState>();

/** Release all fence state — call from the plugin's onunload(). */
export function clearFences(): void {
	activeFences.clear();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Process a rendered section element: inline spans + block markers.
 *
 * @param el             Section element from Obsidian's post-processor.
 * @param docDefault     Provenance declared in the note's frontmatter, or null.
 * @param pluginDefault  Plugin-level fallback from settings.
 * @param sourcePath     Vault path of the note (used for cross-section fence state).
 */
export function processElement(
	el: HTMLElement,
	docDefault: ProvenanceWord | null,
	pluginDefault: MDPSettings["pluginDefault"],
	hoverScopeId: string,
	renderKey = "",
	sectionInfo?: RenderSectionInfo | null,
): void {
	const def = effectiveDefault(docDefault, pluginDefault);
	applyHoverScope(el, hoverScopeId);

	if (renderKey && sectionInfo?.lineStart === 0) {
		activeFences.delete(renderKey);
	}

	// Fences may share a rendered paragraph with their content, so strip fence
	// delimiters before inline processing. Inline spans inside the remaining
	// fenced content are then parsed normally by the text-node pass below.
	processFencedBlock(el, def, hoverScopeId, renderKey);

	// Inline spans
	processInlineMarkup(el, def, hoverScopeId);

	// Per-line block markers. Fences must be handled first because `%a>>>`
	// starts with the `%a>` line-marker prefix.
	processLineBlock(el, def, hoverScopeId, renderKey);
}

// ---------------------------------------------------------------------------
// Inline helpers
// ---------------------------------------------------------------------------

const INLINE_SIGILS = new Set<ProvenanceLetter>(["a", "u", "q", "?", "s"]);

function processInlineMarkup(
	root: HTMLElement,
	def: ProvenanceWord | null,
	hoverScopeId: string,
): void {
	if (!root.textContent?.includes("%")) return;

	const frag = document.createDocumentFragment();
	const spanStack: HTMLSpanElement[] = [];
	const didRewrite = rewriteInlineNodes(
		Array.from(root.childNodes),
		frag,
		spanStack,
		def,
		hoverScopeId,
	);

	// Leave malformed spans untouched rather than stripping their delimiters.
	if (!didRewrite || spanStack.length > 0) return;
	root.replaceChildren(frag);
}

function rewriteInlineNodes(
	nodes: ChildNode[],
	parent: Node,
	spanStack: HTMLSpanElement[],
	def: ProvenanceWord | null,
	hoverScopeId: string,
): boolean {
	let didRewrite = false;

	for (const node of nodes) {
		if (node.nodeType === Node.TEXT_NODE) {
			didRewrite = rewriteInlineText(
				node.textContent ?? "",
				parent,
				spanStack,
				def,
				hoverScopeId,
			) || didRewrite;
			continue;
		}

		if (!(node instanceof HTMLElement)) {
			appendInlineNode(parent, spanStack, node.cloneNode(true));
			continue;
		}

		const tag = node.tagName.toLowerCase();
		if (tag === "code" || tag === "pre") {
			appendInlineNode(parent, spanStack, node.cloneNode(true));
			continue;
		}

		const clone = node.cloneNode(false);
		appendInlineNode(parent, spanStack, clone);
		didRewrite = rewriteInlineNodes(
			Array.from(node.childNodes),
			clone,
			spanStack,
			def,
			hoverScopeId,
		) || didRewrite;
	}

	return didRewrite;
}

function rewriteInlineText(
	text: string,
	parent: Node,
	spanStack: HTMLSpanElement[],
	def: ProvenanceWord | null,
	hoverScopeId: string,
): boolean {
	let didRewrite = false;
	let buffer = "";

	const flushBuffer = () => {
		if (!buffer) return;
		appendInlineText(parent, spanStack, buffer);
		buffer = "";
	};

	for (let i = 0; i < text.length; i++) {
		const ch = text[i] ?? "";
		const next = text[i + 1] ?? "";
		const afterNext = text[i + 2] ?? "";

		if (ch === "\\" && (next === "%" || next === "}")) {
			buffer += next;
			i++;
			continue;
		}

		if (ch === "%" && INLINE_SIGILS.has(next as ProvenanceLetter) && afterNext === "{") {
			flushBuffer();
			openInlineSpan(parent, spanStack, next as ProvenanceLetter, def, hoverScopeId);
			didRewrite = true;
			i += 2;
			continue;
		}

		if (ch === "}" && spanStack.length > 0) {
			flushBuffer();
			spanStack.pop();
			didRewrite = true;
			continue;
		}

		buffer += ch;
	}

	flushBuffer();
	return didRewrite;
}

function appendInlineText(
	parent: Node,
	spanStack: HTMLSpanElement[],
	text: string,
): void {
	appendInlineNode(parent, spanStack, getNodeDocument(parent).createTextNode(text));
}

function appendInlineNode(
	parent: Node,
	spanStack: HTMLSpanElement[],
	node: Node,
): void {
	const target = spanStack[spanStack.length - 1] ?? parent;
	target.appendChild(node);
}

function openInlineSpan(
	parent: Node,
	spanStack: HTMLSpanElement[],
	sigil: ProvenanceLetter,
	def: ProvenanceWord | null,
	hoverScopeId: string,
): void {
	const span = getNodeDocument(parent).createElement("span");
	const word = LETTER_TO_WORD[sigil];
	span.classList.add("mdp-span");
	span.dataset.provenance = word;
	applyHoverScope(span, hoverScopeId, true);
	if (word === def) span.classList.add("mdp-default");
	appendInlineNode(parent, spanStack, span);
	spanStack.push(span);
}

function getNodeDocument(node: Node): Document {
	return node.ownerDocument ?? document;
}

// ---------------------------------------------------------------------------
// Per-line block markers: %a> text
// ---------------------------------------------------------------------------

function processLineBlock(
	el: HTMLElement,
	def: ProvenanceWord | null,
	hoverScopeId: string,
	sourcePath: string,
): void {
	// Skip if this section is already claimed by an open fenced block — the
	// fence's provenance is authoritative and we don't want double-styling.
	if (sourcePath && activeFences.has(sourcePath)) return;

	const paras: HTMLElement[] =
		el.tagName === "P"
			? [el]
			: Array.from(el.querySelectorAll<HTMLElement>("p"));
	if (paras.length === 0) paras.push(el);

	for (const p of paras) {
		const sigil = detectLineBlockSigil(p);
		if (sigil) applyLineBlock(p, sigil, def, hoverScopeId);
	}
}

/**
 * Returns the block sigil if every non-empty "line" of the paragraph starts
 * with the same %X> prefix (space required), otherwise null.
 *
 * Handles two Obsidian line-break modes:
 *   - <br>-separated lines (strict line breaks enabled)
 *   - space-joined content (default: consecutive lines merged into one paragraph)
 */
function detectLineBlockSigil(p: HTMLElement): BlockSigil | null {
	// Reconstruct virtual lines: treat <br> as \n
	const text = getTextWithBreaks(p);

	const match = text.match(BLOCK_LINE_RE);
	if (!match) return null;
	const sigil = match[1] as BlockSigil;

	// All non-empty lines must start with the same sigil (using pre-built regex)
	const lineRe = SIGIL_LINE_RE[sigil];
	const allMatch = text
		.split("\n")
		.every((line) => line.trim() === "" || lineRe.test(line));

	return allMatch ? sigil : null;
}

function applyLineBlock(
	p: HTMLElement,
	sigil: BlockSigil,
	def: ProvenanceWord | null,
	hoverScopeId: string,
): void {
	stripLineBlockPrefixes(p, sigil);

	// Swap <p> for <blockquote> so it inherits Obsidian's blockquote styling
	const bq = p.ownerDocument.createElement("blockquote");
	bq.classList.add("mdp-block");
	const word = LETTER_TO_WORD[sigil];
	bq.dataset.provenance = word;
	applyHoverScope(bq, hoverScopeId, true);
	if (word === def) bq.classList.add("mdp-default");

	while (p.firstChild) bq.appendChild(p.firstChild);
	p.replaceWith(bq);
}

function stripLineBlockPrefixes(el: HTMLElement, sigil: BlockSigil): void {
	const startRe = SIGIL_LINE_RE[sigil];
	const boundaryRe = SIGIL_BOUNDARY_RE[sigil];

	let afterLineStart = true;
	for (const node of iterateTextAndBreakNodes(el)) {
		if (node.nodeType === Node.TEXT_NODE) {
			let text = node.textContent ?? "";
			if (afterLineStart) {
				text = text.replace(startRe, "");
				afterLineStart = false;
			}
			// Obsidian may keep consecutive source lines as "\n%X>" inside
			// one text node, or join them as " %X>" in Reading mode.
			text = text.replace(boundaryRe, "$1");
			afterLineStart = text.endsWith("\n");
			node.textContent = text;
		} else if ((node as Element).tagName === "BR") {
			afterLineStart = true;
		}
	}
}

function getTextWithBreaks(el: HTMLElement): string {
	let text = "";
	for (const node of iterateTextAndBreakNodes(el)) {
		if (node.nodeType === Node.TEXT_NODE) {
			text += node.textContent ?? "";
		} else {
			text += "\n";
		}
	}
	return text;
}

function iterateTextAndBreakNodes(el: HTMLElement): ChildNode[] {
	const nodes: ChildNode[] = [];
	const visit = (node: ChildNode) => {
		if (node.nodeType === Node.TEXT_NODE) {
			nodes.push(node);
			return;
		}
		if ((node as Element).tagName === "BR") {
			nodes.push(node);
			return;
		}
		for (const child of Array.from(node.childNodes)) visit(child);
	};
	for (const child of Array.from(el.childNodes)) visit(child);
	return nodes;
}

// ---------------------------------------------------------------------------
// Fenced block markers: %a>>> … %>>>
// ---------------------------------------------------------------------------

/**
 * Returns true only when el is (or wraps) a single paragraph whose sole text
 * content could be a fence marker — prevents false positives on containers.
 */
function isFenceCandidate(el: HTMLElement): boolean {
	if (el.tagName === "P") return true;
	if (el.children.length === 1 && el.firstElementChild?.tagName === "P") return true;
	// Bare text node with no element children (unusual but possible)
	if (el.children.length === 0 && el.childNodes.length > 0) return true;
	return false;
}

function processFencedBlock(
	el: HTMLElement,
	def: ProvenanceWord | null,
	hoverScopeId: string,
	sourcePath: string,
): void {
	if (!sourcePath) return;

	for (const blockEl of collectFenceBlocks(el)) {
		const fence = activeFences.get(sourcePath);
		const text = getTextWithBreaks(blockEl).trim();
		const lines = getFenceLines(blockEl);

		// Closing fence: hide the delimiter and end the active region.
		if (fence && isFenceCandidate(blockEl) && isFenceCloseOnly(lines)) {
			blockEl.classList.add("mdp-hidden");
			activeFences.delete(sourcePath);
			continue;
		}

		if (fence) {
			const closeIndex = lines.findIndex((line) => FENCE_CLOSE_RE.test(line.trim()));
			if (closeIndex >= 0) {
				const beforeClose = lines.slice(0, closeIndex).join("\n").trim();
				if (beforeClose) {
					blockEl.textContent = beforeClose;
					applyFenceBlock(blockEl, fence.sigil, def, hoverScopeId);
				} else {
					blockEl.classList.add("mdp-hidden");
				}
				activeFences.delete(sourcePath);
				continue;
			}
		}

		// Inside an active fence: style immediately. Deferring until the closing
		// delimiter is brittle because Obsidian may rerender only part of a note.
		if (fence) {
			applyFenceBlock(blockEl, fence.sigil, def, hoverScopeId);
			continue;
		}

		const openIndex = lines.findIndex((line) => FENCE_OPEN_RE.test(line.trim()));
		if (openIndex >= 0) {
			const openMatch = lines[openIndex]?.trim().match(FENCE_OPEN_RE);
			if (!openMatch) continue;
			const sigil = openMatch[1] as BlockSigil;
			const closeIndex = lines.findIndex((line, index) =>
				index > openIndex && FENCE_CLOSE_RE.test(line.trim()),
			);
			const contentLines =
				closeIndex >= 0
					? lines.slice(openIndex + 1, closeIndex)
					: lines.slice(openIndex + 1);
			const content = contentLines.join("\n").trim();

			if (content) {
				blockEl.textContent = content;
				applyFenceBlock(blockEl, sigil, def, hoverScopeId);
			} else {
				blockEl.classList.add("mdp-hidden");
			}
			if (closeIndex < 0) activeFences.set(sourcePath, { sigil });
			continue;
		}

		// Opening fence as the only content: begin tracking.
		if (isFenceCandidate(blockEl)) {
			const openMatch = text.match(FENCE_OPEN_RE);
			if (openMatch) {
				const sigil = openMatch[1] as BlockSigil;
				activeFences.set(sourcePath, { sigil });
				blockEl.classList.add("mdp-hidden");
			}
		}
	}
}

function getFenceLines(el: HTMLElement): string[] {
	return getTextWithBreaks(el)
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

function isFenceCloseOnly(lines: string[]): boolean {
	return lines.length === 1 && FENCE_CLOSE_RE.test(lines[0] ?? "");
}

function collectFenceBlocks(el: HTMLElement): HTMLElement[] {
	if (isFenceCandidate(el)) return [el];
	const blocks: HTMLElement[] = [];
	const visit = (node: Element) => {
		if (!(node instanceof HTMLElement)) return;
		if (node !== el && (isFenceCandidate(node) || MARKDOWN_BLOCK_TAGS.has(node.tagName))) {
			blocks.push(node);
			return;
		}
		for (const child of Array.from(node.children)) visit(child);
	};
	visit(el);
	return blocks.length > 0 ? blocks : [el];
}

function applyFenceBlock(
	el: HTMLElement,
	sigil: BlockSigil,
	def: ProvenanceWord | null,
	hoverScopeId = "",
): void {
	const word = LETTER_TO_WORD[sigil];
	el.classList.add("mdp-block");
	el.dataset.provenance = word;
	applyHoverScope(el, hoverScopeId, true);
	if (word === def) el.classList.add("mdp-default");
}

function applyHoverScope(
	el: HTMLElement,
	hoverScopeId: string,
	isTarget = false,
): void {
	if (!hoverScopeId) return;
	el.dataset.mdpHoverScope = hoverScopeId;
	el.classList.add("mdp-hover-anchor");
	if (isTarget) el.classList.add("mdp-hover-target");
}
