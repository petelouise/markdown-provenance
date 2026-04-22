# Changelog

## [0.2.0] — 2026-04-12

### Breaking

- **`%u` now means `user`** (previously it meant `unknown`). If your notes contain `%u{...}` spans from version 0.1, those spans will now render with the user tint instead of the unknown/amber tint. Replace them with `%?{...}` to restore the original meaning.

### Added

- **`%?` sigil** for unknown provenance. This was already in the original spec grammar and is now implemented.
- **`%u` sigil** for user (human author). Replaces `%s` as the canonical sigil for user-authored text.

### Changed

- Renamed provenance type `self` → `user` throughout: settings keys, CSS custom properties, frontmatter values, settings UI labels.
- Renamed provenance type `quote` → `external` throughout.
- Default plugin provenance updated from `"self"` to `"user"`.
- Spec (`mdp-spec.md`) rewritten to match the current implementation. The previous draft used `%h`/`%o` sigils that were never implemented; the spec now reflects `%a`/`%u`/`%q`/`%?`.

### Backward compatible

- `%s{...}` continues to work as an alias for `%u` (user). Existing notes with `%s` spans need no changes.
- `"self"` and `"human"` remain valid in frontmatter (`provenance: self`) — both resolve to `user`.
- `"quote"` remains valid in frontmatter — resolves to `external`.
- Existing custom colors are migrated automatically on first load.

---

## [0.1.0] — 2026-04-08

Initial release.

- Inline provenance spans: `%a{...}`, `%s{...}`, `%q{...}`, `%u{...}`
- Live Preview decorations (CodeMirror 6)
- Reading mode post-processor
- Configurable tint colors per provenance type (light/dark theme aware)
- Plugin-level default provenance with "none" option
- Document-level default via frontmatter `provenance:` key
- Auto-insert frontmatter into new notes (opt-in)
