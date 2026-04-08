/**
 * MDP renderer — post-processor for Reading mode.
 *
 * Walks the DOM of a rendered Markdown section, finds text nodes containing
 * MDP provenance syntax, and replaces them with styled <span> elements.
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
// Public API
// ---------------------------------------------------------------------------

/**
 * Walk all text nodes in `el`, parse MDP syntax, and replace any that contain
 * provenance spans with the corresponding DOM structure.
 *
 * @param el             Section element from Obsidian's post-processor.
 * @param docDefault     Provenance declared in the note's frontmatter, or null.
 * @param pluginDefault  Plugin-level fallback from settings.
 */
export function processElement(
	el: HTMLElement,
	docDefault: ProvenanceWord | null,
	pluginDefault: MDPSettings["pluginDefault"]
): void {
	const def = effectiveDefault(docDefault, pluginDefault);
	const textNodes = collectTextNodes(el);
	for (const node of textNodes) {
		processTextNode(node, def);
	}
}

// ---------------------------------------------------------------------------
// DOM helpers
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
	def: ProvenanceWord | null
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
