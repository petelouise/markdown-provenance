/**
 * MDP renderer.
 *
 * Walks the DOM of a rendered Markdown section, finds text nodes that contain
 * MDP provenance syntax, and replaces them with styled <span> elements.
 */

import { parse, Segment } from "./parser";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProvenanceWord = "assistant" | "self" | "quote" | "unknown";

const LETTER_TO_WORD: Record<string, ProvenanceWord> = {
  a: "assistant",
  s: "self",
  q: "quote",
  u: "unknown",
};

const WORD_TO_WORD = new Set<string>(Object.values(LETTER_TO_WORD));

/**
 * Normalise a raw frontmatter value (e.g. "self", "assistant") to a
 * ProvenanceWord.  Returns null for absent/unrecognised values.
 */
export function normalizeFrontmatter(
  value: unknown
): ProvenanceWord | null {
  if (typeof value === "string" && WORD_TO_WORD.has(value)) {
    return value as ProvenanceWord;
  }
  return null;
}

// ---------------------------------------------------------------------------
// DOM processing
// ---------------------------------------------------------------------------

/**
 * Walk all text nodes in `el`, parse MDP syntax, and replace any that contain
 * provenance spans with the corresponding DOM structure.
 *
 * @param el            The section element provided by Obsidian's post-processor.
 * @param documentDefault  The note's frontmatter provenance default, or null.
 */
export function processElement(
  el: HTMLElement,
  documentDefault: ProvenanceWord | null
): void {
  // Collect text nodes up-front to avoid mutation during traversal
  const textNodes = collectTextNodes(el);
  for (const node of textNodes) {
    processTextNode(node, documentDefault);
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Collect all TEXT_NODEs in `root`, skipping <code> and <pre> subtrees. */
function collectTextNodes(root: HTMLElement): Text[] {
  const results: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      // Skip content inside <code> or <pre>
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
  while ((node = walker.nextNode())) {
    results.push(node as Text);
  }
  return results;
}

/** Parse a single text node and replace it if it contains any MDP spans. */
function processTextNode(
  node: Text,
  documentDefault: ProvenanceWord | null
): void {
  const content = node.textContent ?? "";
  if (!content.includes("%")) return; // fast bail-out

  const segments = parse(content);
  const hasAnySpan = segments.some((s) => s.kind === "span");
  if (!hasAnySpan) return;

  const fragment = buildFragment(segments, documentDefault);
  node.replaceWith(fragment);
}

/** Recursively convert a Segment tree into DOM nodes. */
function buildFragment(
  segments: Segment[],
  documentDefault: ProvenanceWord | null
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
      if (word === documentDefault) {
        span.classList.add("mdp-default");
      }
      // Recurse into children
      span.appendChild(buildFragment(seg.children, documentDefault));
      frag.appendChild(span);
    }
  }
  return frag;
}
