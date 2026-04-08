import { Plugin, TFile } from "obsidian";
import { normalizeFrontmatter, processElement } from "./renderer";
import { buildLivePreviewExtension } from "./livePreview";
import { MDPSettings, DEFAULT_SETTINGS, buildDynamicCSS } from "./settings";
import { MDPSettingTab } from "./settingsTab";

const STYLE_EL_ID = "mdp-dynamic-styles";

export default class MDPPlugin extends Plugin {
	settings: MDPSettings;

	async onload() {
		await this.loadSettings();
		this.applyStyles();

		// Live Preview (CodeMirror 6)
		this.registerEditorExtension(buildLivePreviewExtension(this.app));

		// Reading mode
		this.registerMarkdownPostProcessor((el, ctx) => {
			const abstractFile = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
			const file = abstractFile instanceof TFile ? abstractFile : null;

			const frontmatter = file
				? this.app.metadataCache.getFileCache(file)?.frontmatter
				: null;

			const documentDefault = normalizeFrontmatter(frontmatter?.provenance);
			processElement(el as HTMLElement, documentDefault);
		});

		this.addSettingTab(new MDPSettingTab(this.app, this));
	}

	onunload() {
		document.getElementById(STYLE_EL_ID)?.remove();
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData() as Partial<MDPSettings>
		);
		// Ensure nested colors object is fully merged
		this.settings.colors = Object.assign(
			{},
			DEFAULT_SETTINGS.colors,
			this.settings.colors
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	applyStyles() {
		let styleEl = document.getElementById(STYLE_EL_ID);
		if (!styleEl) {
			styleEl = document.createElement("style");
			styleEl.id = STYLE_EL_ID;
			document.head.appendChild(styleEl);
		}
		styleEl.textContent = buildDynamicCSS(this.settings);
	}
}
