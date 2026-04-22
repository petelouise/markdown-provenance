# Light/Dark Mode Separate Colours — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Separate dark mode colours" toggle so users can optionally pick different tint colours for Obsidian's light and dark themes.

**Architecture:** Two small changes — extend the data model and CSS builder in `settings.ts` to accept an optional `darkColors` map, then update `settingsTab.ts` to render a toggle and dual pickers when enabled. No new files needed.

**Tech Stack:** TypeScript, Obsidian plugin API (`Setting`, `PluginSettingTab`), esbuild.

---

## File Map

| File | Change |
|---|---|
| `src/settings.ts` | Add `darkColors?` + `separateDarkMode` to `MDPSettings`; update `DEFAULT_SETTINGS`; refactor `buildDynamicCSS` to use separate colour maps per theme block |
| `src/settingsTab.ts` | Add toggle at top of colour section; update `addColorSetting` to optionally render a second ☾ picker; pass `darkMode` flag from caller |

---

## Task 1: Extend data model and CSS builder (`src/settings.ts`)

**Files:**
- Modify: `src/settings.ts`

- [ ] **Step 1: Update `MDPSettings` interface**

Replace the existing interface (lines 3–14) with:

```ts
export interface MDPSettings {
	colors: {
		assistant: string;
		user:      string;
		external:  string;
		unknown:   string;
	};
	/**
	 * Optional per-type colours for Obsidian's dark theme.
	 * Only used when separateDarkMode is true.
	 * Absent means dark theme falls back to colors.
	 */
	darkColors?: {
		assistant: string;
		user:      string;
		external:  string;
		unknown:   string;
	};
	/** When true, dark theme uses darkColors instead of colors. */
	separateDarkMode: boolean;
	pluginDefault: ProvenanceWord | "none";
	autoInsertFrontmatter: boolean;
}
```

- [ ] **Step 2: Update `DEFAULT_SETTINGS`**

Replace the existing `DEFAULT_SETTINGS` (lines 16–25) with:

```ts
export const DEFAULT_SETTINGS: MDPSettings = {
	colors: {
		assistant: "#6495ed",
		user:      "#a0a0b0",
		external:  "#3cb371",
		unknown:   "#ffc107",
	},
	// darkColors intentionally absent — absent means inherit from colors
	separateDarkMode: false,
	pluginDefault: "user",
	autoInsertFrontmatter: false,
};
```

- [ ] **Step 3: Refactor `buildDynamicCSS` to use separate colour sources**

Replace the entire `buildDynamicCSS` function (lines 45–60) with:

```ts
export function buildDynamicCSS(settings: MDPSettings): string {
	const lightC = settings.colors;
	const darkC  = (settings.separateDarkMode && settings.darkColors)
		? settings.darkColors
		: settings.colors;
	const fb = DEFAULT_SETTINGS.colors;

	const vars = (
		c: NonNullable<MDPSettings["darkColors"]>,
		alpha: { assistant: number; user: number; external: number; unknown: number }
	) => `
  --mdp-color-assistant: ${hexToRgba(c.assistant ?? fb.assistant, alpha.assistant)};
  --mdp-color-user:      ${hexToRgba(c.user      ?? fb.user,      alpha.user)};
  --mdp-color-external:  ${hexToRgba(c.external  ?? fb.external,  alpha.external)};
  --mdp-color-unknown:   ${hexToRgba(c.unknown   ?? fb.unknown,   alpha.unknown)};`.trimEnd();

	return `
body.theme-light {${vars(lightC, { assistant: 0.18, user: 0.15, external: 0.18, unknown: 0.22 })}
}
body.theme-dark {${vars(darkC,  { assistant: 0.28, user: 0.22, external: 0.26, unknown: 0.32 })}
}`.trim();
}
```

Note: `NonNullable<MDPSettings["darkColors"]>` is the same shape as `MDPSettings["colors"]`; this just avoids the optional marker.

- [ ] **Step 4: Verify TypeScript compiles cleanly**

```bash
npm run build
```

Expected: build succeeds, no TypeScript errors. (esbuild warnings about bundle size are normal.)

- [ ] **Step 5: Commit**

```bash
git add src/settings.ts
git commit -m "feat: add separateDarkMode + darkColors to MDPSettings and buildDynamicCSS"
```

---

## Task 2: Add toggle and dual pickers to settings UI (`src/settingsTab.ts`)

**Files:**
- Modify: `src/settingsTab.ts`

- [ ] **Step 1: Update `addColorSetting` signature and body**

Replace the entire `addColorSetting` method (lines 83–103) with:

```ts
private addColorSetting(
	name: string,
	desc: string,
	key: keyof MDPSettings["colors"],
	darkMode: boolean
): void {
	const setting = new Setting(this.containerEl)
		.setName(name)
		.setDesc(desc);

	if (darkMode) {
		// ☀ light picker label
		setting.controlEl.createSpan({ text: "☀", attr: { title: "Light mode" } });
	}

	// Primary (light / unified) colour picker
	setting.addText((text) => {
		text.inputEl.type    = "color";
		text.inputEl.value   = this.plugin.settings.colors[key];
		text.inputEl.style.width   = "4rem";
		text.inputEl.style.padding = "0";
		text.inputEl.style.cursor  = "pointer";
		if (darkMode) text.inputEl.style.marginRight = "0.5rem";
		text.inputEl.addEventListener("input", async () => {
			this.plugin.settings.colors[key] = text.inputEl.value;
			await this.plugin.saveSettings();
			this.plugin.applyStyles();
		});
	});

	if (darkMode) {
		// ☾ dark picker label
		setting.controlEl.createSpan({ text: "☾", attr: { title: "Dark mode" } });

		// Dark colour picker — reads/writes darkColors
		setting.addText((text) => {
			text.inputEl.type    = "color";
			text.inputEl.value   = this.plugin.settings.darkColors![key];
			text.inputEl.style.width   = "4rem";
			text.inputEl.style.padding = "0";
			text.inputEl.style.cursor  = "pointer";
			text.inputEl.addEventListener("input", async () => {
				this.plugin.settings.darkColors![key] = text.inputEl.value;
				await this.plugin.saveSettings();
				this.plugin.applyStyles();
			});
		});
	}
}
```

- [ ] **Step 2: Add the toggle and update colour-row calls in `display()`**

Replace the colours section of `display()` — from `containerEl.createEl("h3", { text: "Tint colours" })` through the four `addColorSetting` calls — with:

```ts
// ── Colours ───────────────────────────────────────────────────────────
containerEl.createEl("h3", { text: "Tint colours" });
containerEl.createEl("p", {
	text: "Background tint applied to each provenance type. Changes take effect immediately.",
	cls: "setting-item-description",
});

new Setting(containerEl)
	.setName("Separate dark mode colours")
	.setDesc("Set different tints for Obsidian's light and dark themes.")
	.addToggle(toggle => {
		toggle
			.setValue(this.plugin.settings.separateDarkMode)
			.onChange(async (value) => {
				if (value && !this.plugin.settings.darkColors) {
					// First enable: copy current colours as dark defaults
					this.plugin.settings.darkColors = { ...this.plugin.settings.colors };
				}
				this.plugin.settings.separateDarkMode = value;
				await this.plugin.saveSettings();
				this.plugin.applyStyles();
				this.display();
			});
	});

const dm = this.plugin.settings.separateDarkMode;
this.addColorSetting("User",      "Your own writing  (%u{...})",               "user",      dm);
this.addColorSetting("Assistant", "AI-generated text  (%a{...})",              "assistant", dm);
this.addColorSetting("External",  "Third-party source  (%q{...})",             "external",  dm);
this.addColorSetting("Unknown",   "Unclear provenance  (%?{...})",             "unknown",   dm);
```

- [ ] **Step 3: Build and verify no TypeScript errors**

```bash
npm run build
```

Expected: build succeeds cleanly.

- [ ] **Step 4: Manual smoke test in Obsidian**

Load the plugin in Obsidian (copy `main.js` to your test vault's `.obsidian/plugins/markdown-provenance/`). Open Settings → Markdown Provenance.

Verify:
1. "Separate dark mode colours" toggle is off by default — four rows each show one colour picker.
2. Toggle on → each row now shows ☀ `[picker]` ☾ `[picker]`, pre-filled with matching colours.
3. Change a ☾ picker → switch Obsidian to dark mode → tint updates immediately in open notes.
4. Change a ☀ picker → switch to light mode → light tint updates; dark tint unchanged.
5. Toggle off → single picker; both themes use `colors`.
6. Toggle back on → dark pickers restore previously set values (not reset to light values).
7. Reload Obsidian → dark colours persist.

- [ ] **Step 5: Commit**

```bash
git add src/settingsTab.ts
git commit -m "feat: add Separate dark mode colours toggle and dual colour pickers"
```
