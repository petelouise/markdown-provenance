import { Plugin, TFile } from "obsidian";

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
import { normalizeProvenance } from "./provenance";
import { processElement } from "./renderer";
import { buildLivePreviewExtension } from "./livePreview";
import { MDPSettings, DEFAULT_SETTINGS, buildDynamicCSS } from "./settings";
import { MDPSettingTab } from "./settingsTab";

const STYLE_EL_ID = "mdp-dynamic-styles";

export default class MDPPlugin extends Plugin {
	settings: MDPSettings;

	async onload() {
		await this.loadSettings();
		this.applyStyles();

		// Live Preview (CodeMirror 6) — pass plugin as context
		this.registerEditorExtension(buildLivePreviewExtension(this));

		// Reading mode
		this.registerMarkdownPostProcessor((el, ctx) => {
			const abstractFile = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
			const file = abstractFile instanceof TFile ? abstractFile : null;
			const frontmatter = file
				? this.app.metadataCache.getFileCache(file)?.frontmatter
				: null;
			const docDefault = normalizeProvenance(frontmatter?.provenance);
			processElement(el as HTMLElement, docDefault, this.settings.pluginDefault);
		});

		// Auto-insert frontmatter into new notes
		this.registerEvent(
			this.app.vault.on("create", async (file) => {
				if (!(file instanceof TFile) || file.extension !== "md") return;
				if (!this.settings.autoInsertFrontmatter) return;
				if (this.settings.pluginDefault === "none") return;
				// Brief delay for Obsidian to finish writing the file
				await sleep(50);
				const content = await this.app.vault.read(file);
				if (content.startsWith("---")) return; // already has frontmatter
				await this.app.vault.modify(
					file,
					`---\nprovenance: ${this.settings.pluginDefault}\n---\n${content}`
				);
			})
		);

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
		// Deep-merge nested colors so missing keys fall back to defaults
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
