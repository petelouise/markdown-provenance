# Markdown Provenance (MDP)

An [Obsidian](https://obsidian.md) plugin that lets you mark the provenance of text in your notes — who wrote what, and where it came from.

```markdown
The draft began as %a{AI-generated boilerplate, which I then shaped into something real.}
I added my own framing, and pulled in %q{this passage from the original paper} for context.
```

Marked text gets a subtle background tint in both Live Preview and Reading mode. Everything else is standard Markdown — it degrades gracefully in any editor that doesn't have the plugin.

---

## Why

Notes increasingly contain a mix of things: text you wrote, text an AI drafted, text quoted from elsewhere. MDP makes that visible without cluttering the document. When you return to a note later, you can see at a glance what came from where.

It's also useful for AI agents writing *into* your notes. The included [agent guide](docs/skill.md) tells an AI assistant exactly how to apply markers, so it can annotate its own output as it goes.

---

## The four sigils

| Sigil | Name | Default tint | Use for |
|-------|------|-------------|---------|
| `%a`  | assistant | blue | Text written by an AI assistant |
| `%u`  | user | none (baseline) | Text written by you |
| `%q`  | external | green | Text quoted or reproduced from a source |
| `%?`  | unknown | amber | Text whose origin is unclear |

The vocabulary mirrors LLM prompt conventions (`assistant`, `user`), making it generic across tools. Future dot-notation — `%u.alice`, `%u.bob` — will distinguish individual contributors without needing new sigils.

---

## Syntax

### Inline spans

```markdown
%a{The assistant wrote this sentence.}
%u{I wrote this one.}
%q{Copied verbatim from the source document.}
%?{Not sure where this came from.}
```

Spans can nest. The inner sigil overrides the outer for its content:

```markdown
%a{The assistant drafted this, but %u{I rewrote this part} before publishing.}
```

Escape a literal `%` with `\%`. Escape `}` inside a span with `\}`.

### Document default (frontmatter)

Set a default for the whole note so you only need to mark the exceptions:

```yaml
---
provenance: assistant
---

Everything here is AI-generated and needs no marker.

%u{Except this — I wrote this myself.}
```

Valid values: `assistant`, `user`, `external`, `unknown`.

### Plugin-level default

In Settings → Markdown Provenance, choose a default that applies to notes without a frontmatter key. Set it to `user` for a personal vault where most text is yours — unmarked text renders without any tint, and only AI-generated spans stand out.

---

## Installation

The plugin is not yet in the Obsidian community plugin directory. Install manually:

1. Download the latest release from [GitHub Releases](https://github.com/petelouise/markdown-provenance-obsidian/releases)
2. Unzip into your vault's `.obsidian/plugins/markdown-provenance/` folder
3. Reload Obsidian and enable the plugin in Settings → Community Plugins

Or clone the repo and build from source:

```sh
git clone https://github.com/petelouise/markdown-provenance-obsidian
cd markdown-provenance-obsidian
npm install
npm run build
```

Then copy `main.js`, `manifest.json`, and `styles.css` into `.obsidian/plugins/markdown-provenance/`.

---

## Settings

| Setting | Description |
|---------|-------------|
| **Tint colours** | Customize the background color for each provenance type |
| **Default provenance type** | Fallback for notes without a frontmatter key; the matching type renders without tint |
| **Auto-add provenance to new notes** | Automatically insert a `provenance:` key into newly created notes |

---

## For AI agents

If you use an AI agent to write into your notes, point it at [`docs/skill.md`](docs/skill.md). It describes the sigils, the boundary rules (who produced the text, not just its relationship to a source), and how to handle existing markup. Add it to your `CLAUDE.md` or equivalent project instruction file.

---

## Backward compatibility

If your notes contain `%s{...}` spans from an earlier version of this plugin (when the sigil was called "self"), they will continue to render correctly — `%s` is a permanent alias for `%u`.

---

## License

[0BSD](LICENSE) — do what you want with it.
