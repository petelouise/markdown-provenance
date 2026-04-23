import { App, PluginSettingTab, Setting } from "obsidian";
import { ProvenanceWord } from "./provenance";
import { MDPSettings, StatusBarMode } from "./settings";

interface MDPPluginHost {
	app: App;
	settings: MDPSettings;
	saveSettings(): Promise<void>;
	applyStyles(): void;
	updateStatusBar(): Promise<void>;
	applyTintVisibility(): void;
	resetTintVisibilityOverride(): void;
	syncRibbonToggle(): void;
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

		new Setting(containerEl)
			.setName("Separate dark mode colours")
			.setDesc("Set different tints for Obsidian's light and dark themes.")
			.addToggle(toggle => {
				toggle
					.setValue(this.plugin.settings.separateDarkMode)
					.onChange(async (value) => {
						if (value === this.plugin.settings.separateDarkMode) return;
						if (value && !this.plugin.settings.darkColors) {
							this.plugin.settings.darkColors = { ...this.plugin.settings.colors };
						}
						this.plugin.settings.separateDarkMode = value;
						await this.plugin.saveSettings();
						this.display();
					});
			});

		if (this.plugin.settings.separateDarkMode && !this.plugin.settings.darkColors) {
			this.plugin.settings.darkColors = { ...this.plugin.settings.colors };
		}
		const dm = this.plugin.settings.separateDarkMode;
		this.addColorSetting("User",      "Your own writing  (%u{...})",               "user",      dm);
		this.addColorSetting("Assistant", "AI-generated text  (%a{...})",              "assistant", dm);
		this.addColorSetting("External",  "Third-party source  (%q{...})",             "external",  dm);
		this.addColorSetting("Unknown",   "Unclear provenance  (%?{...})",             "unknown",   dm);

		// ── Visibility ────────────────────────────────────────────────────────
		new Setting(containerEl).setName("Tint visibility").setHeading();

		new Setting(containerEl)
			.setName("Default tint visibility")
			.setDesc(
				"Choose whether provenance tints are visible while you write, or " +
				"only appear when you hover over marked text. The command palette " +
				"toggle temporarily flips this behavior."
			)
			.addDropdown(drop => {
				drop
					.addOption("always", "Always show tints")
					.addOption("hover", "Show on hover")
					.setValue(this.plugin.settings.tintVisibility)
					.onChange((value) => {
						void (async () => {
							this.plugin.settings.tintVisibility = value as MDPSettings["tintVisibility"];
							await this.plugin.saveSettings();
							this.plugin.resetTintVisibilityOverride();
						})();
					});
			});

		new Setting(containerEl)
			.setName("Show ribbon toggle")
			.setDesc(
				"Add a left-ribbon button for quickly switching between the default " +
				"visibility mode and the temporary audit view."
			)
			.addToggle(toggle => {
				toggle
					.setValue(this.plugin.settings.showRibbonToggle)
					.onChange((value) => {
						void (async () => {
							this.plugin.settings.showRibbonToggle = value;
							await this.plugin.saveSettings();
							this.plugin.syncRibbonToggle();
						})();
					});
			});

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
					.addOption("user",      "User")
					.addOption("assistant", "Assistant")
					.addOption("external",  "External")
					.addOption("unknown",   "Unknown")
					.setValue(this.plugin.settings.pluginDefault)
					.onChange(async (value) => {
						this.plugin.settings.pluginDefault = value as ProvenanceWord | "none";
						await this.plugin.saveSettings();
						void this.plugin.updateStatusBar();
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

		// ── Status bar ───────────────────────────────────────────────────────
		new Setting(containerEl)
			.setName("Status bar")
			.setHeading();
		containerEl.createEl("p", {
			text: "Show compact provenance statistics for the active Markdown file.",
			cls: "setting-item-description",
		});

		new Setting(containerEl)
			.setName("Show provenance stats")
			.setDesc("Display a compact provenance summary in the status bar.")
			.addToggle(toggle => {
				toggle
					.setValue(this.plugin.settings.statusBarStatsEnabled)
					.onChange(async (value) => {
						this.plugin.settings.statusBarStatsEnabled = value;
						await this.plugin.saveSettings();
						void this.plugin.updateStatusBar();
					});
			});

		new Setting(containerEl)
			.setName("Status bar format")
			.setDesc("Choose whether the summary shows percentages or raw counts.")
			.addDropdown(drop => {
				drop
					.addOption("percent", "Percentages")
					.addOption("count", "Counts")
					.setValue(this.plugin.settings.statusBarStatsMode)
					.onChange(async (value) => {
						this.plugin.settings.statusBarStatsMode = value as StatusBarMode;
						await this.plugin.saveSettings();
						void this.plugin.updateStatusBar();
					});
			});
	}

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
			setting.controlEl.createSpan({ text: "☾", attr: { title: "Dark mode" } });

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
}
