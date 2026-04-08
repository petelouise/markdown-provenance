import { App, PluginSettingTab, Setting } from "obsidian";
import { ProvenanceWord } from "./provenance";
import { MDPSettings } from "./settings";

interface MDPPluginHost {
	app: App;
	settings: MDPSettings;
	saveSettings(): Promise<void>;
	applyStyles(): void;
}

export class MDPSettingTab extends PluginSettingTab {
	plugin: MDPPluginHost;

	constructor(app: App, plugin: MDPPluginHost) {
		super(app, plugin as never);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// ── Colours ───────────────────────────────────────────────────────────
		containerEl.createEl("h3", { text: "Tint colours" });
		containerEl.createEl("p", {
			text: "Background tint applied to each provenance type. Changes take effect immediately.",
			cls: "setting-item-description",
		});

		this.addColorSetting("Self",      "Your own writing  (%s{...})",               "self");
		this.addColorSetting("Assistant", "AI-generated text  (%a{...})",              "assistant");
		this.addColorSetting("Quote",     "Third-party source  (%q{...})",             "quote");
		this.addColorSetting("Unknown",   "Unclear provenance  (%u{...})",             "unknown");

		// ── Default provenance ────────────────────────────────────────────────
		containerEl.createEl("h3", { text: "Default provenance" });

		let autoInsertSetting: Setting;

		new Setting(containerEl)
			.setName("Default provenance type")
			.setDesc(
				"Used as the rendering fallback for notes that have no frontmatter " +
				"provenance key. The matching type is shown unstyled (it's the baseline). " +
				"Also used when auto-inserting frontmatter into new notes."
			)
			.addDropdown(drop => {
				drop
					.addOption("none",      "None — tint everything")
					.addOption("self",      "Self")
					.addOption("assistant", "Assistant")
					.addOption("quote",     "Quote")
					.addOption("unknown",   "Unknown")
					.setValue(this.plugin.settings.pluginDefault)
					.onChange(async (value) => {
						this.plugin.settings.pluginDefault = value as ProvenanceWord | "none";
						await this.plugin.saveSettings();
						// Grey out auto-insert when default is "none"
						autoInsertSetting.setDisabled(value === "none");
					});
			});

		autoInsertSetting = new Setting(containerEl)
			.setName("Auto-add provenance to new notes")
			.setDesc(
				"When enabled, newly created Markdown files automatically receive a " +
				"frontmatter provenance key matching the default type above."
			)
			.addToggle(toggle => {
				toggle
					.setValue(this.plugin.settings.autoInsertFrontmatter)
					.onChange(async (value) => {
						this.plugin.settings.autoInsertFrontmatter = value;
						await this.plugin.saveSettings();
					});
			});

		// Reflect initial disabled state
		autoInsertSetting.setDisabled(this.plugin.settings.pluginDefault === "none");
	}

	private addColorSetting(
		name: string,
		desc: string,
		key: keyof MDPSettings["colors"]
	): void {
		new Setting(this.containerEl)
			.setName(name)
			.setDesc(desc)
			.addText((text) => {
				text.inputEl.type = "color";
				text.inputEl.value = this.plugin.settings.colors[key];
				text.inputEl.style.width  = "4rem";
				text.inputEl.style.padding = "0";
				text.inputEl.style.cursor  = "pointer";
				text.inputEl.addEventListener("input", async () => {
					this.plugin.settings.colors[key] = text.inputEl.value;
					await this.plugin.saveSettings();
					this.plugin.applyStyles();
				});
			});
	}
}
