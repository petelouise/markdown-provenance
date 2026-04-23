import { parse, Segment } from "./parser";
import {
	effectiveDefault,
	LETTER_TO_WORD,
	normalizeProvenance,
	ProvenanceWord,
} from "./provenance";
import { StatusBarMode } from "./settings";

export interface ProvenanceStats {
	counts: Record<ProvenanceWord, number>;
	total: number;
}

const PROVENANCE_ORDER: ProvenanceWord[] = [
	"assistant",
	"user",
	"external",
	"unknown",
];

const PROVENANCE_SHORT: Record<ProvenanceWord, string> = {
	assistant: "A",
	user: "U",
	external: "Q",
	unknown: "?",
};

const BLOCK_LINE_RE = /^%(a|u|q|\?)>(?!>) ?/;
const FENCE_OPEN_RE = /^%([auq?])>>>$/;
const FENCE_CLOSE_RE = /^%>>>$/;

export function computeProvenanceStats(
	rawText: string,
	pluginDefault: ProvenanceWord | "none",
): ProvenanceStats {
	const body = stripFrontmatter(rawText);
	const frontmatterDefault = extractFrontmatterDefault(rawText);
	const defaultProvenance = effectiveDefault(frontmatterDefault, pluginDefault);

	const counts = zeroCounts();
	for (const block of collectProvenanceBlocks(body, defaultProvenance)) {
		for (const segment of parse(block.text)) {
			accumulateSegment(segment, block.provenance, counts);
		}
	}

	const total = PROVENANCE_ORDER.reduce((sum, key) => sum + counts[key], 0);
	return { counts, total };
}

export function formatProvenanceStats(
	stats: ProvenanceStats,
	mode: StatusBarMode,
): string {
	const pieces: string[] = [];

	for (const provenance of PROVENANCE_ORDER) {
		const value = stats.counts[provenance];
		if (value === 0) continue;

		if (mode === "percent") {
			const pct = stats.total === 0 ? 0 : Math.round((value * 100) / stats.total);
			pieces.push(`${PROVENANCE_SHORT[provenance]} ${pct}%`);
		} else {
			pieces.push(`${PROVENANCE_SHORT[provenance]} ${value.toLocaleString()}`);
		}
	}

	if (pieces.length === 0) {
		return mode === "percent" ? "MDP 0%" : "MDP 0";
	}

	return `MDP ${pieces.join(" ")}`;
}

function zeroCounts(): Record<ProvenanceWord, number> {
	return {
		assistant: 0,
		user: 0,
		external: 0,
		unknown: 0,
	};
}

function collectProvenanceBlocks(
	text: string,
	defaultProvenance: ProvenanceWord | null,
): { text: string; provenance: ProvenanceWord | null }[] {
	const blocks: { text: string; provenance: ProvenanceWord | null }[] = [];
	const lines = text.split("\n");
	let activeFence: ProvenanceWord | null = null;
	let bufferedDefault: string[] = [];

	const flushDefault = () => {
		if (bufferedDefault.length === 0) return;
		blocks.push({
			text: bufferedDefault.join("\n"),
			provenance: defaultProvenance,
		});
		bufferedDefault = [];
	};

	for (const line of lines) {
		if (activeFence) {
			if (FENCE_CLOSE_RE.test(line.trim())) {
				activeFence = null;
				continue;
			}
			blocks.push({ text: line, provenance: activeFence });
			continue;
		}

		const fenceMatch = line.trim().match(FENCE_OPEN_RE);
		if (fenceMatch) {
			flushDefault();
			activeFence = LETTER_TO_WORD[fenceMatch[1] as keyof typeof LETTER_TO_WORD];
			continue;
		}

		const blockLineMatch = line.match(BLOCK_LINE_RE);
		if (blockLineMatch) {
			flushDefault();
			const provenance = LETTER_TO_WORD[blockLineMatch[1] as keyof typeof LETTER_TO_WORD];
			blocks.push({
				text: line.slice(blockLineMatch[0].length),
				provenance,
			});
			continue;
		}

		bufferedDefault.push(line);
	}

	flushDefault();
	return blocks;
}

function accumulateSegment(
	segment: Segment,
	current: ProvenanceWord | null,
	counts: Record<ProvenanceWord, number>,
): void {
	if (segment.kind === "text") {
		if (current) counts[current] += segment.content.length;
		return;
	}

	const next = LETTER_TO_WORD[segment.provenance];
	for (const child of segment.children) {
		accumulateSegment(child, next, counts);
	}
}

function stripFrontmatter(text: string): string {
	const frontmatterEnd = detectFrontmatterEnd(text);
	return frontmatterEnd > 0 ? text.slice(frontmatterEnd) : text;
}

function extractFrontmatterDefault(text: string): ProvenanceWord | null {
	const frontmatterEnd = detectFrontmatterEnd(text);
	if (frontmatterEnd === 0) return null;

	const frontmatterText = text.slice(0, frontmatterEnd);
	const match = frontmatterText.match(/^provenance\s*:\s*(\S+)/m);
	return match ? normalizeProvenance(match[1]) : null;
}

function detectFrontmatterEnd(text: string): number {
	if (!text.startsWith("---")) return 0;

	const afterOpen = text.indexOf("\n", 3);
	if (afterOpen === -1) return 0;

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
