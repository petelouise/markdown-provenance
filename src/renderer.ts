/**
 * MDP renderer — post-processor for Reading mode.
 *
 * Walks the DOM of a rendered Markdown section, finds text nodes containing
 * MDP provenance syntax, and replaces them with styled <span> elements.
 *
 * Also handles block-level markers:
 *   - Per-line: %a> text (each line carries the prefix; rendered as <blockquote>)
 *   - Fenced:   %%%a … %%% (tint only, no blockquote indent)
 */

import { parse, Segment } from "./parser";
import {
	ProvenanceWord,
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

const BLOCK_LINE_RE = /^%(a|u|q|\?)> ?/;
const FENCE_OPEN_RE = /^%%%([auq?])$/;
const FENCE_CLOSE_RE = /^%%%$/;

type BlockSigil = "a" | "u" | "q" | "?";

interface FenceState {
	sigil: BlockSigil;
	elements: HTMLElement[];
}

// Module-level state: one active fence per source path at a time.
const activeFences = new Map<string, FenceState>();

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
	sourcePath = "",
): void {
	const def = effectiveDefault(docDefault, pluginDefault);

	// Inline spans (existing pass — runs first so block stripping sees clean nodes)
	const textNodes = collectTextNodes(el);
	for (const node of textNodes) {
		processTextNode(node, def);
	}

	// Block markers
	processLineBlock(el, def);
	processFencedBlock(el, def, sourcePath);
}

// ---------------------------------------------------------------------------
// Inline helpers (unchanged from original)
// ---------------------------------------------------------------------------

function collectTextNodes(root: HTMLElement): Text[] {
	const results: Text[] = [];
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode(node) {
			let parent = node.parentElement;
			while (parent) {
				const tag = parent.tagName.toLowerCase();
				if (tag === "code" || tag === "pre") return NodeFilter.FILTER_REJECT;
				if (parent === root) break;
				parent = parent.parentElement;
			}
			return NodeFilter.FILTER_ACCEPT;
		},
	});
	let node: Node | null;
	while ((node = walker.nextNode())) results.push(node as Text);
	return results;
}

function processTextNode(node: Text, def: ProvenanceWord | null): void {
	const content = node.textContent ?? "";
	if (!content.includes("%")) return;

	const segments = parse(content);
	if (!segments.some((s) => s.kind === "span")) return;

	node.replaceWith(buildFragment(segments, def));
}

function buildFragment(
	segments: Segment[],
	def: ProvenanceWord | null,
): DocumentFragment {
	const frag = document.createDocumentFragment();
	for (const seg of segments) {
		if (seg.kind === "text") {
			frag.appendChild(document.createTextNode(seg.content));
		} else {
			const word = LETTER_TO_WORD[seg.provenance];
			const span = document.createElement("span");
			span.classList.add("mdp-span");
			span.dataset.provenance = word;
			if (word === def) span.classList.add("mdp-default");
			span.appendChild(buildFragment(seg.children, def));
			frag.appendChild(span);
		}
	}
	return frag;
}

// ---------------------------------------------------------------------------
// Per-line block markers: %a> text
// ---------------------------------------------------------------------------

function processLineBlock(el: HTMLElement, def: ProvenanceWord | null): void {
	const paras: HTMLElement[] =
		el.tagName === "P"
			? [el]
			: Array.from(el.querySelectorAll<HTMLElement>("p"));

	for (const p of paras) {
		const sigil = detectLineBlockSigil(p);
		if (sigil) applyLineBlock(p, sigil, def);
	}
}

/**
 * Returns the block sigil if every non-empty "line" of the paragraph starts
 * with the same %X> prefix, otherwise null.
 *
 * Handles two Obsidian line-break modes:
 *   - <br>-separated lines (strict line breaks enabled)
 *   - space-joined content (default: consecutive lines merged into one paragraph)
 */
function detectLineBlockSigil(p: HTMLElement): BlockSigil | null {
	// Reconstruct virtual lines: treat <br> as \n
	let text = "";
	for (const node of Array.from(p.childNodes)) {
		if (node.nodeType === Node.TEXT_NODE) {
			text += node.textContent ?? "";
		} else if ((node as Element).tagName === "BR") {
			text += "\n";
		}
	}

	const match = text.match(BLOCK_LINE_RE);
	if (!match) return null;
	const sigil = match[1] as BlockSigil;

	// All non-empty lines must start with the same sigil
	const safeS = sigil === "?" ? "\\?" : sigil;
	const lineRe = new RegExp(`^%${safeS}> ?`);
	const allMatch = text
		.split("\n")
		.every((line) => line.trim() === "" || lineRe.test(line));

	return allMatch ? sigil : null;
}

function applyLineBlock(
	p: HTMLElement,
	sigil: BlockSigil,
	def: ProvenanceWord | null,
): void {
	stripLineBlockPrefixes(p, sigil);

	// Swap <p> for <blockquote> so it inherits Obsidian's blockquote styling
	const bq = p.ownerDocument.createElement("blockquote");
	bq.classList.add("mdp-block");
	const word = LETTER_TO_WORD[sigil];
	bq.dataset.provenance = word;
	if (word === def) bq.classList.add("mdp-default");

	while (p.firstChild) bq.appendChild(p.firstChild);
	p.replaceWith(bq);
}

function stripLineBlockPrefixes(el: HTMLElement, sigil: BlockSigil): void {
	const safeS = sigil === "?" ? "\\?" : sigil;
	const startRe = new RegExp(`^%${safeS}> ?`);
	// Space-joined mode: " %X> " in the middle of a single text node
	const midRe = new RegExp(` %${safeS}> ?`, "g");

	let afterLineStart = true;
	for (const node of Array.from(el.childNodes) as ChildNode[]) {
		if (node.nodeType === Node.TEXT_NODE) {
			let text = node.textContent ?? "";
			if (afterLineStart) {
				text = text.replace(startRe, "");
				afterLineStart = false;
			}
			text = text.replace(midRe, " ");
			node.textContent = text;
		} else if ((node as Element).tagName === "BR") {
			afterLineStart = true;
		}
	}
}

// ---------------------------------------------------------------------------
// Fenced block markers: %%%a … %%%
// ---------------------------------------------------------------------------

function processFencedBlock(
	el: HTMLElement,
	def: ProvenanceWord | null,
	sourcePath: string,
): void {
	if (!sourcePath) return;
	const text = el.textContent?.trim() ?? "";
	const fence = activeFences.get(sourcePath);

	// Closing fence: apply provenance to all collected elements
	if (fence && FENCE_CLOSE_RE.test(text)) {
		const word = LETTER_TO_WORD[fence.sigil];
		for (const fenceEl of fence.elements) {
			fenceEl.classList.add("mdp-block");
			fenceEl.dataset.provenance = word;
			if (word === def) fenceEl.classList.add("mdp-default");
		}
		el.style.display = "none";
		activeFences.delete(sourcePath);
		return;
	}

	// Inside an active fence: collect this element for deferred styling
	if (fence) {
		fence.elements.push(el);
		return;
	}

	// Opening fence: begin tracking
	const openMatch = text.match(FENCE_OPEN_RE);
	if (openMatch) {
		const sigil = openMatch[1] as BlockSigil;
		activeFences.set(sourcePath, { sigil, elements: [] });
		el.style.display = "none";
	}
}
