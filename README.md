# Markdown Provenance (MDP)

An [Obsidian](https://obsidian.md) plugin that lets you mark the provenance of text in your notes — who wrote what, and where it came from.

```markdown
The draft began as %a{AI-generated boilerplate, which I then shaped into something real.}
I added my own framing, and pulled in %q{this passage from the original paper} for context.
```

Marked text gets a subtle background embellishment in both Live Preview and Reading mode. Everything else is standard Markdown — it degrades gracefully in any editor that doesn't have the plugin.

---

## Why

Notes increasingly contain a mix of things: text you wrote, text an AI drafted, text quoted from elsewhere. MDP makes that visible without cluttering the document. When you return to a note later, you can see at a glance what came from where.

It's also useful for AI agents writing *into* your notes. The included [agent guide](docs/skill.md) tells an AI assistant exactly how to apply markers, so it can annotate its own output as it goes.

---

## The four sigils

| Sigil | Name | Default emb | Use for |
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

### Block markers

When a full paragraph or section shares one provenance, use block syntax instead
of wrapping each sentence inline:

```markdown
%a> This whole paragraph was drafted by the assistant.

%a>>>
This section is AI-generated.

It can span multiple paragraphs.
%>>>
```

Inline spans still work inside blocks and override the surrounding block
provenance for that span.

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

In Settings → Markdown Provenance, choose a default that applies to notes without a frontmatter key. Set it to `user` for a personal vault where most text is yours — unmarked text renders without any embellishment, and only AI-generated spans stand out.

---

## Installation

The plugin is not yet in the Obsidian community plugin directory.

### Via BRAT

This is the easiest way to install it in multiple vaults and pull updates later:

1. Install the BRAT community plugin in Obsidian.
2. Open Settings → BRAT → **Add Beta plugin**.
3. Enter this repo: `petelouise/markdown-provenance`
4. Install and enable **Markdown Provenance**.
5. Later, use BRAT's **Check for updates** action to pull the latest GitHub release into that vault.

BRAT installs from GitHub releases, so each release should include `manifest.json`, `main.js`, `styles.css`, and `versions.json`.

### Manual install

Install manually if you prefer:

1. Download the latest release from [GitHub Releases](https://github.com/petelouise/markdown-provenance/releases)
2. Unzip into your vault's `.obsidian/plugins/markdown-provenance/` folder
3. Reload Obsidian and enable the plugin in Settings → Community Plugins

Or clone the repo and build from source:

```sh
git clone https://github.com/petelouise/markdown-provenance
cd markdown-provenance
npm install
npm run build
```

Then copy `main.js`, `manifest.json`, and `styles.css` into `.obsidian/plugins/markdown-provenance/`.

---

## Settings

| Setting | Description |
|---------|-------------|
| **Embellishment colours** | Customize the base embellishment color for each provenance type, with an optional separate dark-mode palette |
| **Default embellishment visibility** | Show embellishments all the time, or only reveal them on hover |
| **Show provenance labels** | Display compact text labels on marked provenance so colour is not the only cue |
| **Provenance label gutter** | Choose whether block provenance labels appear in the right or left gutter |
| **Hover reveal scope** | In hover mode, reveal just the hovered mark or the whole current section |
| **Show ribbon toggle** | Add a left-ribbon button that temporarily flips embellishment visibility |
| **Default provenance type** | Fallback for notes without a frontmatter key; the matching type renders without embellishment |
| **Auto-add provenance to new notes** | Automatically insert a `provenance:` key into newly created notes |
| **Show provenance stats** | Display compact current-note provenance statistics in the status bar |
| **Status bar format** | Show the status summary as percentages or raw character counts |

Use the **Toggle provenance embellishments** command from the command palette or Obsidian's Hotkeys settings to bind your own shortcut.

See [docs/future-ideas.md](docs/future-ideas.md) for the current roadmap and next priorities.

---

## For AI agents

If you use an AI agent to write into your notes, point it at [`docs/skill.md`](docs/skill.md). It describes the sigils, the boundary rules (who produced the text, not just its relationship to a source), and how to handle existing markup. Add it to your `CLAUDE.md` or equivalent project instruction file.

---

## Backward compatibility

If your notes contain `%s{...}` spans from an earlier version of this plugin (when the sigil was called "self"), they will continue to render correctly — `%s` is a permanent alias for `%u`.

---

## License

[0BSD](LICENSE) — do what you want with it.
