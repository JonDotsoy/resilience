# AGENTS.md

Guidelines for AI agents and contributors working on this repository.

## Language

All documentation must be written in English. This includes:

- `README.md` and any other Markdown file in the repository.
- `AGENTS.md`, guides, changelogs and release notes.
- The `description` and other human-readable fields in `package.json`.

When you add or change documentation, write it in English. If you touch a document that is still in another language, translate it to English as part of the change.

### Docs site translations

The docs site in `.github/page/` is the one exception: it is published in English (`index.html`) and Spanish (`es/index.html`). Both pages share `assets/site.css` and `assets/site.js`.

- When you change the content of one page, make the same change in the other, keeping the same markup and section ids so the language switch lands on the same section.
- Text produced by `assets/site.js` (playground messages, labels) goes through `t("English", "Español")`, which picks the language from `<html lang>`.
- Each page keeps its own `<title>`, descriptions, `canonical`, `og:locale` and the `hreflang` alternates pointing at both versions.
