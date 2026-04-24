import { MarkdownView, Notice, Plugin, TFile } from "obsidian";

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
import { normalizeProvenance } from "./provenance";
import { processElement, clearFences } from "./renderer";
import { buildLivePreviewExtension } from "./livePreview";
import { buildAutoRemarkExtension } from "./autoRemark";
import { MDPSettings, DEFAULT_SETTINGS, buildDynamicCssProps } from "./settings";
import { computeProvenanceStats, formatProvenanceStats } from "./stats";
import { MDPSettingTab } from "./settingsTab";

type HoverBounds = { top: number; right: number; bottom: number; left: number };

export default class MDPPlugin extends Plugin {
	settings: MDPSettings;
	private statusBarEl: HTMLElement | null = null;
	private statusBarTimer: number | null = null;
	private statusBarRequest = 0;
	private embVisibilityInverted = false;
	private ribbonToggleEl: HTMLElement | null = null;
	private activeHoverScopeId: string | null = null;
	private activeHoverTargets: HTMLElement[] = [];
	private hoverClearTimer: number | null = null;

	async onload() {
		await this.loadSettings();
		this.applyStyles();
		this.applyEmbellishmentVisibility();

		this.statusBarEl = this.addStatusBarItem();
		this.statusBarEl.addClass("mdp-status-bar");

		this.addCommand({
			id: "toggle-provenance-tints",
			name: "Toggle provenance embellishments",
			callback: () => this.toggleEmbellishmentVisibility(),
		});
		this.syncRibbonToggle();

		// Live Preview (CodeMirror 6) — pass plugin as context
		this.registerEditorExtension(buildLivePreviewExtension(this));

		// Auto-remark: wrap user insertions in %u{...} when they edit non-user content
		this.registerEditorExtension(buildAutoRemarkExtension(this));

		// Reading mode
		this.registerMarkdownPostProcessor((el, ctx) => {
			const abstractFile = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
			const file = abstractFile instanceof TFile ? abstractFile : null;
			const frontmatter = file
				? this.app.metadataCache.getFileCache(file)?.frontmatter
				: null;
			const docDefault = normalizeProvenance(frontmatter?.provenance);
			processElement(
				el,
				docDefault,
				this.settings.pluginDefault,
				this.getHoverScopeId(file, ctx.getSectionInfo(el)?.lineStart),
				ctx.docId || ctx.sourcePath,
				ctx.getSectionInfo(el),
			);
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

		this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
			this.scheduleStatusBarUpdate();
		}));
		this.registerEvent(this.app.workspace.on("editor-change", () => {
			this.scheduleStatusBarUpdate();
		}));
		this.registerEvent(this.app.vault.on("modify", (file) => {
			if (file instanceof TFile && file.extension === "md") {
				this.scheduleStatusBarUpdate();
			}
		}));

		this.addSettingTab(new MDPSettingTab(this.app, this));
		this.registerDomEvent(document, "mouseover", (event) => {
			this.updateActiveHoverScope(event.target, event.clientX, event.clientY);
		});
		this.registerDomEvent(document, "mousemove", (event) => {
			this.updateActiveHoverScope(event.target, event.clientX, event.clientY);
		});
		this.registerDomEvent(document, "focusin", (event) => {
			this.updateActiveHoverScope(event.target);
		});
		this.app.workspace.onLayoutReady(() => {
			this.scheduleStatusBarUpdate(0);
		});
	}

	onunload() {
		if (this.statusBarTimer !== null) window.clearTimeout(this.statusBarTimer);
		if (this.hoverClearTimer !== null) window.clearTimeout(this.hoverClearTimer);
		this.statusBarEl?.remove();
		document.body.classList.remove(
			"mdp-embs-hover-only",
			"mdp-embs-force-visible",
			"mdp-embs-force-hidden",
			"mdp-provenance-labels-hidden",
			"mdp-provenance-labels-left",
			"mdp-provenance-labels-right",
		);
		this.clearStyleProps();
		this.clearActiveHoverScope();
		clearFences();
	}

	async loadSettings() {
		// Load raw data first so we can migrate old key names before merging
		const rawData: unknown = await this.loadData();
		const raw: Record<string, unknown> = isRecord(rawData) ? rawData : {};

		// One-time migration: self → user, quote → external (v0.1 → v0.2)
		if (raw.colors && typeof raw.colors === "object") {
			const c = raw.colors as Record<string, unknown>;
			if ("self" in c && !("user" in c))         c.user     = c.self;
			if ("quote" in c && !("external" in c))    c.external = c.quote;
		}
		if (raw.pluginDefault === "self")  raw.pluginDefault = "user";
		if (raw.pluginDefault === "quote") raw.pluginDefault = "external";
		if (raw.tintVisibility && !raw.embellishmentVisibility) {
			raw.embellishmentVisibility = raw.tintVisibility;
		}

		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			raw as Partial<MDPSettings>
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
		document.body.setCssProps(buildDynamicCssProps(this.settings));
	}

	scheduleStatusBarUpdate(delay = 75): void {
		if (!this.statusBarEl) return;
		if (this.statusBarTimer !== null) window.clearTimeout(this.statusBarTimer);
		this.statusBarTimer = window.setTimeout(() => {
			this.statusBarTimer = null;
			void this.updateStatusBar();
		}, delay);
	}

	async updateStatusBar(): Promise<void> {
		const item = this.statusBarEl;
		if (!item) return;

		const requestId = ++this.statusBarRequest;
		if (!this.settings.statusBarStatsEnabled) {
			item.hide();
			item.setText("");
			return;
		}

		const file = this.app.workspace.getActiveFile();
		if (!(file instanceof TFile) || file.extension !== "md") {
			item.hide();
			item.setText("");
			return;
		}

		let rawText = "";
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView?.file?.path === file.path && activeView.editor) {
			rawText = activeView.editor.getValue();
		} else {
			rawText = await this.app.vault.read(file);
		}

		if (requestId !== this.statusBarRequest) return;

		const stats = computeProvenanceStats(rawText, this.settings.pluginDefault);
		const label = formatProvenanceStats(stats, this.settings.statusBarStatsMode);
		item.setText(label);
		item.setAttr("title", `${file.path} • ${label}`);
		item.show();
	}

	applyEmbellishmentVisibility() {
		document.body.classList.toggle(
			"mdp-embs-hover-only",
			this.settings.embellishmentVisibility === "hover",
		);
		document.body.classList.toggle(
			"mdp-embs-force-visible",
			this.settings.embellishmentVisibility === "hover" && this.embVisibilityInverted,
		);
		document.body.classList.toggle(
			"mdp-embs-force-hidden",
			this.settings.embellishmentVisibility === "always" && this.embVisibilityInverted,
		);
		document.body.classList.toggle(
			"mdp-provenance-labels-hidden",
			!this.settings.showProvenanceLabels,
		);
		document.body.classList.toggle(
			"mdp-provenance-labels-left",
			this.settings.provenanceLabelGutter === "left",
		);
		document.body.classList.toggle(
			"mdp-provenance-labels-right",
			this.settings.provenanceLabelGutter !== "left",
		);
		if (
			this.settings.embellishmentVisibility !== "hover" ||
			this.settings.embellishmentHoverScope !== "section" ||
			this.embVisibilityInverted
		) {
			this.clearActiveHoverScope();
		}
		this.updateRibbonToggleLabel();
	}

	resetEmbellishmentVisibilityOverride() {
		this.embVisibilityInverted = false;
		this.applyEmbellishmentVisibility();
	}

	syncRibbonToggle() {
		if (!this.settings.showRibbonToggle) {
			this.ribbonToggleEl?.remove();
			this.ribbonToggleEl = null;
			return;
		}
		if (this.ribbonToggleEl) {
			this.updateRibbonToggleLabel();
			return;
		}
		this.ribbonToggleEl = this.addRibbonIcon(
			"eye",
			"Toggle provenance embellishments",
			() => this.toggleEmbellishmentVisibility(),
		);
		this.ribbonToggleEl.classList.add("mdp-ribbon-toggle");
		this.updateRibbonToggleLabel();
	}

	private toggleEmbellishmentVisibility() {
		this.embVisibilityInverted = !this.embVisibilityInverted;
		this.applyEmbellishmentVisibility();
		new Notice(this.currentEmbellishmentVisibilityLabel());
	}

	private updateRibbonToggleLabel() {
		if (!this.ribbonToggleEl) return;
		this.ribbonToggleEl.setAttribute("aria-label", this.currentEmbellishmentVisibilityLabel());
		this.ribbonToggleEl.setAttribute("title", this.currentEmbellishmentVisibilityLabel());
		this.ribbonToggleEl.classList.toggle("is-active", this.embVisibilityInverted);
	}

	private currentEmbellishmentVisibilityLabel(): string {
		if (this.settings.embellishmentVisibility === "hover") {
			return this.embVisibilityInverted
				? "Provenance embellishments revealed"
				: "Provenance embellishments revealed on section hover";
		}
		return this.embVisibilityInverted
			? "Provenance embellishments hidden"
			: "Provenance embellishments visible";
	}

	private updateActiveHoverScope(target: EventTarget | null, clientX?: number, clientY?: number) {
		if (
			this.settings.embellishmentVisibility !== "hover" ||
			this.settings.embellishmentHoverScope !== "section" ||
			this.embVisibilityInverted
		) {
			this.clearActiveHoverScope();
			return;
		}

		const hoverAnchor = target instanceof Element
			? target.closest<HTMLElement>(".mdp-hover-anchor, [data-mdp-hover-scope]")
			: null;
		const hoverScopeId = hoverAnchor?.dataset.mdpHoverScope
			?? this.getHoverScopeAtPoint(clientX, clientY);

		if (hoverScopeId === this.activeHoverScopeId) {
			if (hoverScopeId) this.cancelHoverScopeClear();
			return;
		}
		if (!hoverScopeId) {
			this.scheduleHoverScopeClear();
			return;
		}

		this.cancelHoverScopeClear();
		this.clearActiveHoverScope();
		this.activeHoverScopeId = hoverScopeId;
		for (const element of Array.from(document.querySelectorAll<HTMLElement>(".mdp-hover-target"))) {
			if (element.dataset.mdpHoverScope !== hoverScopeId) continue;
			element.classList.add("mdp-hover-active");
			this.activeHoverTargets.push(element);
		}
	}

	private getHoverScopeAtPoint(clientX?: number, clientY?: number): string | null {
		if (clientX === undefined || clientY === undefined) return null;

		const scopes = new Map<string, { rects: DOMRect[]; anchors: HTMLElement[] }>();
		for (const element of Array.from(document.querySelectorAll<HTMLElement>(".mdp-hover-anchor"))) {
			const hoverScopeId = element.dataset.mdpHoverScope;
			if (!hoverScopeId) continue;
			const rect = element.getBoundingClientRect();
			if (rect.width === 0 && rect.height === 0) continue;
			const scope = scopes.get(hoverScopeId) ?? { rects: [], anchors: [] };
			scope.rects.push(rect);
			scope.anchors.push(element);
			scopes.set(hoverScopeId, scope);
		}

		let best: { hoverScopeId: string; distance: number } | null = null;
		for (const [hoverScopeId, scope] of scopes) {
			const bounds = this.getHoverScopeBounds(scope.rects, scope.anchors);
			if (!bounds) continue;
			if (
				clientY < bounds.top ||
				clientY > bounds.bottom ||
				clientX < bounds.left ||
				clientX > bounds.right
			) {
				continue;
			}

			const centerY = (bounds.top + bounds.bottom) / 2;
			const distance = Math.abs(clientY - centerY);
			if (!best || distance < best.distance) {
				best = { hoverScopeId, distance };
			}
		}

		return best?.hoverScopeId ?? null;
	}

	private getHoverScopeBounds(rects: DOMRect[], anchors: HTMLElement[]): HoverBounds | null {
		if (rects.length === 0) return null;
		const top = Math.min(...rects.map((rect) => rect.top)) - 8;
		const bottom = Math.max(...rects.map((rect) => rect.bottom)) + 8;
		const contentRect = this.getHoverContentRect(anchors);
		const left = contentRect?.left ?? Math.max(0, Math.min(...rects.map((rect) => rect.left)) - 96);
		const right = contentRect?.right ?? Math.min(window.innerWidth, Math.max(...rects.map((rect) => rect.right)) + 96);

		return { top, right, bottom, left };
	}

	private getHoverContentRect(anchors: HTMLElement[]): DOMRect | null {
		for (const anchor of anchors) {
			const container = anchor.closest<HTMLElement>(
				".markdown-preview-view, .markdown-source-view, .cm-editor, .workspace-leaf-content",
			);
			const rect = container?.getBoundingClientRect();
			if (rect && rect.width > 0 && rect.height > 0) return rect;
		}
		return null;
	}

	private scheduleHoverScopeClear() {
		if (this.hoverClearTimer !== null) return;
		this.hoverClearTimer = window.setTimeout(() => {
			this.hoverClearTimer = null;
			this.clearActiveHoverScope();
		}, 160);
	}

	private cancelHoverScopeClear() {
		if (this.hoverClearTimer === null) return;
		window.clearTimeout(this.hoverClearTimer);
		this.hoverClearTimer = null;
	}

	private clearActiveHoverScope() {
		this.cancelHoverScopeClear();
		for (const element of this.activeHoverTargets) {
			element.classList.remove("mdp-hover-active");
		}
		this.activeHoverTargets = [];
		this.activeHoverScopeId = null;
	}

	private getHoverScopeId(file: TFile | null, lineStart?: number): string {
		if (!file) return "active-note:root";
		if (lineStart === undefined || lineStart === null) return `${file.path}:root`;

		const headings = this.app.metadataCache.getFileCache(file)?.headings ?? [];
		let currentHeadingLine: number | null = null;
		for (const heading of headings) {
			if (heading.position.start.line > lineStart) break;
			currentHeadingLine = heading.position.start.line;
		}

		return currentHeadingLine === null
			? `${file.path}:root`
			: `${file.path}:section:${currentHeadingLine}`;
	}

	private clearStyleProps(): void {
		for (const property of Object.keys(buildDynamicCssProps(DEFAULT_SETTINGS))) {
			document.body.style.removeProperty(property);
		}
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
