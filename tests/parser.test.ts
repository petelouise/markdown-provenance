import { describe, expect, it } from "vitest";

import { hasSpans, parse } from "../src/parser";

describe("parse", () => {
	it("parses nested spans and the legacy user alias", () => {
		expect(parse("%a{outer %s{inner} tail}")).toEqual([
			{
				kind: "span",
				provenance: "a",
				children: [
					{ kind: "text", content: "outer " },
					{
						kind: "span",
						provenance: "s",
						children: [{ kind: "text", content: "inner" }],
					},
					{ kind: "text", content: " tail" },
				],
			},
		]);
	});

	it("treats escaped delimiters as literal text inside spans", () => {
		expect(parse("%q{100\\% sourced \\} safely}")).toEqual([
			{
				kind: "span",
				provenance: "q",
				children: [{ kind: "text", content: "100% sourced } safely" }],
			},
		]);
	});

	it("leaves code spans and unknown sigils as plain text", () => {
		const segments = parse("Use `%a{literal}` before %x{ignored}.");

		expect(segments).toEqual([
			{ kind: "text", content: "Use `%a{literal}` before %x{ignored}." },
		]);
		expect(hasSpans(segments)).toBe(false);
	});
});
