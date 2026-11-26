# Authoring guide

This guide explains how to write essays for the LifetimeCounter app in Obsidian. Everything in this repository is public once pushed, so write only finished text here. Never put private writing in this repository.

The technical rules are in `CONTENT-CONTRACT.md`. This guide is the short, practical version.

## 1. One essay, one file

Each essay is one Markdown file in `authoring/essays/`. The file name must end in `.md`. Nothing else may be placed in that folder, because the publisher refuses unknown files.

Every file starts with a block of properties between two `---` lines, then the essay text:

```
---
essay_id: my-first-essay
title: The title readers see
set_id: my-first-set
position: 1
publish: true
question: The question this essay explores?
placeholder: false
---

The essay text starts here.
```

All seven properties are required, and no others are allowed.

- `essay_id` and `set_id`: lowercase letters, digits and hyphens only; start with a letter; at most 64 characters. An essay's identity never changes after release.
- `title` and `question`: plain text. No links, web addresses or Obsidian syntax.
- `position`: the essay's place in its set, starting at 1. It must match its place in `authoring/sets.json`.
- `publish`: `true` or `false`, written without quotes.
- `placeholder`: `true` for test content, `false` for real writing, written without quotes.

If you edit these in Obsidian's Properties panel, check afterwards that the true/false values were not turned into text in quotes.

## 2. What you can write

- Paragraphs. A line break inside a paragraph is treated as a space. To start a new paragraph, leave a blank line.
- Headings with `##`, `###` and `####`. Do not use a single `#`; the essay title comes from the properties.
- **Bold** with `**double stars**` and *italic* with `*single stars*`. They can be combined.
- Block quotations: start each quoted paragraph with `>`.
- Simple lists, either bulleted (`-`) or numbered (`1.`). Each item is one paragraph. Lists inside lists are not supported.
- Any language and any Unicode text.

## 3. What is rejected

The publisher stops with a clear message instead of quietly dropping material. These are rejected:

- Links, web addresses, images, `[[wikilinks]]`, embeds and footnotes.
- HTML, code, tables, strikethrough and horizontal lines.
- Nested lists and forced line breaks (two spaces at the end of a line).
- Obsidian-only syntax: `%%comments%%`, `==highlights==` and callouts such as `> [!note]`.

If you want to mention a source, write it as plain text, for example: Further reading: the title and author.

## 4. Sets

Essays are delivered in complete sets, in order. `authoring/sets.json` lists each set, its title, whether it is published, and its essays in order.

Rules that protect readers who already have a set:

- Once a set has been published, its essays and their order never change. To add more, create a new set after the existing ones with new identities.
- Every essay in a published set must have `publish: true`.
- To withdraw an essay, unpublish its whole set by setting that set's `publish` to `false`. New readers will not receive it. Readers who already downloaded it keep it and their read marks. Replacement writing goes into a later set under new identities.
- Old generated files are kept on purpose. Do not delete anything under `public/`.

## 5. Checking and publishing

Run these in the repository folder:

```
npm test
npm run validate
npm run build
```

- `npm run validate` checks everything and changes no files.
- `npm run build` writes the generated files in `public/` and updates `publication-ledger.json`.
- Neither command commits, pushes or deploys. After a build, review the changes in Git, commit them (including `publication-ledger.json`), and push. The app can download the new set only after GitHub Pages has published it.

If a build stops with a message, nothing in `public/` has been replaced. Fix the problem named in the message and run it again. If it reports an existing lock, a previous run was interrupted: check that no other build is running before removing `.publisher.lock`.

## 6. Before you publish real writing

- Set `placeholder: false` only on real essays.
- Reread each essay as it will appear: plain text, headings, bold, italic, quotations and lists.
- Remember that published text becomes part of Git history and cannot be fully erased.
