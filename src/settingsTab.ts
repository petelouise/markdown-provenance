import { App, PluginSettingTab, Setting } from "obsidian";
import { ProvenanceWord } from "./provenance";
import { MDPSettings, StatusBarMode } from "./settings";

interface MDPPluginHost {
	app: App;
	settings: MDPSettings;
	saveSettings(): Promise<void>;
	applyStyles(): void;
	updateStatusBar(): Promise<void>;
	applyEmbellishmentVisibility(): void;
	resetEmbellishmentVisibilityOverride(): void;
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

		new Setting(containerEl)
			.setName("Embellishment colours")
			.setDesc("Base embellishment colour for each provenance type. Changes take effect immediately.")
			.setHeading();

		new Setting(containerEl)
			.setName("Separate dark mode colours")
			.setDesc("Set different embellishment colours for Obsidian's light and dark themes.")
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
		new Setting(containerEl).setName("Embellishment visibility").setHeading();

		new Setting(containerEl)
			.setName("Default embellishment visibility")
			.setDesc(
				"Choose whether provenance embellishments are visible while you write, or " +
				"only appear when you hover over marked text. The command palette " +
				"toggle temporarily flips this behavior."
			)
			.addDropdown(drop => {
				drop
					.addOption("always", "Always show embellishments")
					.addOption("hover", "Show on hover")
					.setValue(this.plugin.settings.embellishmentVisibility)
					.onChange((value) => {
						void (async () => {
							this.plugin.settings.embellishmentVisibility = value as MDPSettings["embellishmentVisibility"];
							await this.plugin.saveSettings();
							this.plugin.resetEmbellishmentVisibilityOverride();
						})();
					});
			});

		new Setting(containerEl)
			.setName("Hover reveal scope")
			.setDesc(
				"Choose whether hover reveals only the hovered mark, or every embellishment " +
				"in the current markdown section."
			)
			.addDropdown(drop => {
				drop
					.addOption("mark", "Just the hovered mark")
					.addOption("section", "Current section")
					.setValue(this.plugin.settings.embellishmentHoverScope)
					.onChange((value) => {
						void (async () => {
							this.plugin.settings.embellishmentHoverScope = value as MDPSettings["embellishmentHoverScope"];
							await this.plugin.saveSettings();
							this.plugin.applyEmbellishmentVisibility();
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

		new Setting(containerEl)
			.setName("Default provenance")
			.setHeading();

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
					.addOption("none",      "None — embellish everything")
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
			.setDesc("Show compact provenance statistics for the active Markdown file.")
			.setHeading();

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
			text.inputEl.type = "color";
			text.inputEl.value = this.plugin.settings.colors[key];
			text.inputEl.addClass("mdp-settings-color-input");
			if (darkMode) text.inputEl.addClass("mdp-settings-color-input--light");
			text.inputEl.addEventListener("input", () => {
				void this.handleColorInput(key, text.inputEl.value, false);
			});
		});

		if (darkMode) {
			setting.controlEl.createSpan({ text: "☾", attr: { title: "Dark mode" } });

			setting.addText((text) => {
				text.inputEl.type = "color";
				text.inputEl.value = this.plugin.settings.darkColors![key];
				text.inputEl.addClass("mdp-settings-color-input");
				text.inputEl.addEventListener("input", () => {
					void this.handleColorInput(key, text.inputEl.value, true);
				});
			});
		}
	}

	private async handleColorInput(
		key: keyof MDPSettings["colors"],
		value: string,
		darkMode: boolean,
	): Promise<void> {
		if (darkMode) {
			this.plugin.settings.darkColors![key] = value;
		} else {
			this.plugin.settings.colors[key] = value;
		}
		await this.plugin.saveSettings();
		this.plugin.applyStyles();
	}
}
