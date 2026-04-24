import { describe, expect, it } from "vitest";

import { computeProvenanceStats, formatProvenanceStats } from "../src/stats";

describe("computeProvenanceStats", () => {
	it("uses frontmatter defaults and lets inline spans override them", () => {
		const stats = computeProvenanceStats(
			[
				"---",
				"provenance: external",
				"---",
				"Alpha %a{beta} gamma",
			].join("\n"),
			"user",
		);

		expect(stats).toEqual({
			counts: {
				assistant: 4,
				user: 0,
				external: 12,
				unknown: 0,
			},
			total: 16,
		});
	});

	it("counts block markers and fenced provenance sections separately from default text", () => {
		const stats = computeProvenanceStats(
			[
				"Base",
				"%a>Help",
				"%q>>>",
				"Quote",
				"%>>>",
				"Tail",
			].join("\n"),
			"none",
		);

		expect(stats).toEqual({
			counts: {
				assistant: 4,
				user: 0,
				external: 5,
				unknown: 0,
			},
			total: 9,
		});
	});
});

describe("formatProvenanceStats", () => {
	it("formats non-zero counts in provenance order", () => {
		expect(
			formatProvenanceStats(
				{
					counts: {
						assistant: 4,
						user: 0,
						external: 12,
						unknown: 0,
					},
					total: 16,
				},
				"count",
			),
		).toBe("MDP A 4 Q 12");
	});

	it("formats percentage mode with rounded values", () => {
		expect(
			formatProvenanceStats(
				{
					counts: {
						assistant: 1,
						user: 1,
						external: 1,
						unknown: 0,
					},
					total: 3,
				},
				"percent",
			),
		).toBe("MDP A 33% U 33% Q 33%");
	});
});
