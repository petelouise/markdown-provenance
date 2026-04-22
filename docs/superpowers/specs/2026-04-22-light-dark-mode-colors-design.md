# Light/Dark Mode Separate Colours — Design Spec

**Date:** 2026-04-22
**Status:** Approved

---

## Summary

Add a "Separate dark mode colours" toggle to the plugin settings. When off (default), one colour per provenance type applies uniformly to both Obsidian themes. When on, each type exposes a second picker for dark mode, labeled with ☀ / ☾ icons. Users who don't need per-mode colours see no extra complexity.

---

## Data Model (`src/settings.ts`)

Add two fields to `MDPSettings`:

```ts
export interface MDPSettings {
  colors: { assistant: string; user: string; external: string; unknown: string; };
  darkColors?: { assistant: string; user: string; external: string; unknown: string; };
  separateDarkMode: boolean;
  pluginDefault: ProvenanceWord | "none";
  autoInsertFrontmatter: boolean;
}
```

- `separateDarkMode` defaults to `false`.
- `darkColors` is optional. When absent (or `separateDarkMode` is false), both themes use `colors`.
- On first enable: `darkColors` is initialised by copying the current `colors` values before saving.

`DEFAULT_SETTINGS` adds:
```ts
separateDarkMode: false,
// darkColors omitted — absent means inherit from colors
```

### `buildDynamicCSS` update

```ts
const lightC = settings.colors;
const darkC  = (settings.separateDarkMode && settings.darkColors)
  ? settings.darkColors
  : settings.colors;
```

Light-mode opacities apply to `lightC`; dark-mode opacities apply to `darkC`. Existing hardcoded opacity values (light: 0.18/0.15/0.18/0.22, dark: 0.28/0.22/0.26/0.32) are unchanged.

---

## Settings UI (`src/settingsTab.ts`)

### Toggle (top of "Tint colours" section)

```
┌─────────────────────────────────────────────────────────┐
│ Separate dark mode colours                    [ toggle ] │
│ Set different tints for light and dark themes.           │
└─────────────────────────────────────────────────────────┘
```

- Positioned immediately after the `<h3>Tint colours</h3>` heading, before the per-type rows.
- `onChange`: save `separateDarkMode`, initialise `darkColors` from `colors` if not already set, call `applyStyles()`, then call `this.display()` to re-render.

### Colour rows — toggle off (current appearance)

```
Assistant   [■]   AI-generated text (%a{...})
```

### Colour rows — toggle on

```
Assistant   ☀ [■]  ☾ [■]   AI-generated text (%a{...})
User        ☀ [■]  ☾ [■]   Your own writing (%u{...})
External    ☀ [■]  ☾ [■]   Third-party source (%q{...})
Unknown     ☀ [■]  ☾ [■]   Unclear provenance (%?{...})
```

- `☀` picker reads/writes `settings.colors[key]`.
- `☾` picker reads/writes `settings.darkColors[key]`.
- Both pickers fire `applyStyles()` on `input`.

### `addColorSetting` signature change

```ts
private addColorSetting(
  name: string,
  desc: string,
  key: keyof MDPSettings["colors"],
  darkKey?: keyof MDPSettings["colors"]   // only passed when separateDarkMode is true
): void
```

When `darkKey` is provided, the method prepends a ☀ label before the existing picker (no label when `darkKey` is absent) and adds a ☾ label + picker after it, reading from `settings.darkColors`.

---

## Error handling / edge cases

- If `darkColors` is somehow absent when `separateDarkMode` is true (e.g. corrupted data), `buildDynamicCSS` falls back to `colors` for the dark block. No crash.
- Toggling off does not delete `darkColors` — it is merely ignored, so re-enabling restores the user's previous dark choices.
- Migration: existing saved data has neither `separateDarkMode` nor `darkColors`; Obsidian's `loadData` + `Object.assign` defaults handle this safely (`separateDarkMode` defaults to false, `darkColors` remains absent).

---

## Testing

- Toggle on → dark pickers appear pre-filled with current light values.
- Edit ☾ picker → dark tint updates in open note immediately; light tint unchanged.
- Toggle off → single picker; both themes revert to `colors`.
- Re-toggle on → dark pickers restore previously set dark values.
- Reload Obsidian with `separateDarkMode: true` → dark colours persist correctly.
