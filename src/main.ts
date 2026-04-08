import { Plugin, TFile } from "obsidian";
import { normalizeFrontmatter, processElement } from "./renderer";

export default class MDPPlugin extends Plugin {
  async onload() {
    this.registerMarkdownPostProcessor((el, ctx) => {
      const abstractFile = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
      const file = abstractFile instanceof TFile ? abstractFile : null;

      const frontmatter = file
        ? this.app.metadataCache.getFileCache(file)?.frontmatter
        : null;

      const documentDefault = normalizeFrontmatter(frontmatter?.provenance);

      processElement(el as HTMLElement, documentDefault);
    });
  }

  onunload() {}
}
