/**
 * MDP inline provenance parser.
 *
 * Recognises spans of the form  %a{...}  %s{...}  %q{...}  %u{...}
 * Handles:
 *   - Nesting: %a{outer %s{inner} back}
 *   - Escaping: \% → literal %, \} → literal } inside a span
 *   - Unrecognised sigils (%x, %1, …) → emitted as plain text
 *   - Code spans (backticks) → passed through verbatim, no provenance parsing inside
 */

export type ProvenanceLetter = "a" | "s" | "q" | "u";

export type Segment =
  | { kind: "text"; content: string }
  | { kind: "span"; provenance: ProvenanceLetter; children: Segment[] };

const KNOWN_SIGILS = new Set<string>(["a", "s", "q", "u"]);

/**
 * Parse a string into a flat-or-nested list of Segments.
 * Call this on the text content of a DOM text node.
 */
export function parse(input: string): Segment[] {
  const parser = new Parser(input);
  return parser.parseSegments(false);
}

/** Returns true if the segment list contains at least one span. */
export function hasSpans(segments: Segment[]): boolean {
  return segments.some(
    (s) => s.kind === "span" || (s.kind === "text" && false) // always false, just for type narrowing
  );
}

// ---------------------------------------------------------------------------

class Parser {
  private pos = 0;

  constructor(private input: string) {}

  /** Parse until end-of-input or (if insideSpan) an unescaped closing brace. */
  parseSegments(insideSpan: boolean): Segment[] {
    const segments: Segment[] = [];
    let text = "";

    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];

      // ── Closing brace: end of enclosing span ──────────────────────────────
      if (insideSpan && ch === "}") {
        this.pos++; // consume the }
        if (text) segments.push({ kind: "text", content: text });
        return segments;
      }

      // ── Escape sequences ─────────────────────────────────────────────────
      if (ch === "\\" && this.pos + 1 < this.input.length) {
        const next = this.input[this.pos + 1];
        if (next === "%" || (insideSpan && next === "}")) {
          text += next;
          this.pos += 2;
          continue;
        }
      }

      // ── Code span: pass through verbatim ─────────────────────────────────
      if (ch === "`") {
        const codeSpan = this.consumeCodeSpan();
        text += codeSpan;
        continue;
      }

      // ── Provenance span opener: %X{ ───────────────────────────────────────
      if (ch === "%" && this.pos + 2 < this.input.length) {
        const sigil = this.input[this.pos + 1] ?? "";
        const brace = this.input[this.pos + 2] ?? "";
        if (KNOWN_SIGILS.has(sigil) && brace === "{") {
          // Flush accumulated text
          if (text) segments.push({ kind: "text", content: text });
          text = "";
          this.pos += 3; // skip %X{
          const children = this.parseSegments(true); // recurse
          segments.push({
            kind: "span",
            provenance: sigil as ProvenanceLetter,
            children,
          });
          continue;
        }
      }

      // ── Ordinary character ────────────────────────────────────────────────
      text += ch;
      this.pos++;
    }

    if (text) segments.push({ kind: "text", content: text });
    return segments;
  }

  /**
   * Consume a backtick-delimited code span (single or multiple backticks)
   * and return the raw string including the surrounding backticks.
   */
  private consumeCodeSpan(): string {
    let tickCount = 0;
    const start = this.pos;

    while (this.pos < this.input.length && this.input[this.pos] === "`") {
      tickCount++;
      this.pos++;
    }

    const fence = "`".repeat(tickCount);

    // Find the matching closing fence
    while (this.pos < this.input.length) {
      const closeIdx = this.input.indexOf(fence, this.pos);
      if (closeIdx === -1) {
        // No closing fence — treat the opener as literal text
        return this.input.slice(start, this.pos);
      }
      // Make sure the closing fence isn't longer (e.g. ``` closing ``)
      const afterClose = closeIdx + tickCount;
      if (
        afterClose >= this.input.length ||
        this.input[afterClose] !== "`"
      ) {
        this.pos = afterClose;
        return this.input.slice(start, this.pos);
      }
      // Longer fence — keep scanning
      this.pos = closeIdx + 1;
    }

    return this.input.slice(start, this.pos);
  }
}
