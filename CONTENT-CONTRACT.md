# LC-Essays content contract — version 1

Status: Architect-approved consolidated version-1 contract. Approval defines implementation requirements, not implementation, deployment, or test evidence. The consolidated implementation rules below supersede conflicting earlier wording within this document. No private writing or credentials belong in this public repository.

## Repository layout and publishing

- authoring/essays/*.md: explicitly publication-ready Markdown only.
- authoring/sets.json: complete ordered membership and publication selection.
- scripts/: local publisher and tests.
- public/manifest.json: generated catalogue.
- public/essays/<id>/<revision>.json: generated immutable payloads.

The publisher reads only the explicit authoring paths, never the whole vault or linked notes. A publish flag is not a confidentiality control: any tracked source becomes public when pushed. Preserve README and local exclusions. Serve public/ as an ordinary subdirectory of a root-published Pages site. The intended manifest endpoint is https://jnanacode.github.io/LC-Essays/public/manifest.json. Confirm the actual Pages publishing source before deployment. Do not introduce a custom deployment workflow merely to change the website root. No Pages settings changes are authorized by this contract.

## Authoring frontmatter

Every essay has exactly these required properties: essay_id, title, set_id, position, publish, question, placeholder. IDs match ^[a-z][a-z0-9-]{0,63}$. Strings are nonblank. position is a positive safe integer; publish and placeholder are booleans, not quoted strings. Duplicate or unknown properties fail validation. No dates are required.

Example:

```yaml
---
essay_id: test-essay-001
title: Placeholder essay one
set_id: test-set-001
position: 1
publish: true
question: How does the test reader work?
placeholder: true
---
```

Use a reviewed YAML parser, not an ad-hoc full-YAML parser. Dependency selection and installation remain separately reviewed implementation steps. Reject duplicate keys, aliases, unsupported values, malformed frontmatter, and invalid UTF-8.

## Complete sets

sets.json has shape {contractVersion:1, sets:[{id,title,publish,essayIds:[id,...]}]}. This notation illustrates fields; the actual file is valid JSON. Array order defines set order and essay order. Every set is nonempty. Set IDs and all essay memberships are unique. Each listed essay exists, agrees on set_id and its one-based position, and is published before its published set can be generated. Reject published orphan essays, duplicate essay IDs, missing members, inconsistent positions, and unknown fields. Unpublished sets are omitted from delivery. An empty published catalogue is valid and means no sets are currently available.

First fixture: two sets of two clearly labelled placeholder essays. Placeholder text must not be represented as the Architect's philosophical writing.

## Supported Markdown subset

Support paragraphs, ATX headings levels 2–4, bold, italic, block quotations containing paragraphs, and flat ordered/unordered lists with paragraph items. Support nested bold/italic marks, but not nested lists. Normalize line endings to LF; join soft-wrapped paragraph lines with a space. Reject explicit hard breaks for version 1.

Reject HTML, code, images, links, bare web addresses, wikilinks, embeds, tables, footnotes, strikethrough, horizontal rules, unsupported heading levels, nested lists, and any unsupported parser node. Never silently discard unsupported material. Use a reviewed Markdown parser; dependency installation is separate. Further-reading and related-question links are deferred from version 1 rather than silently ignored.

## Generated essay payload

Each payload is {contractVersion:1,id,title,question,placeholder,blocks}. Inline content is an array of {text,marks}, with nonempty text and marks a unique ordered subset of [bold,italic]. Blocks are:

- {type:paragraph,content:[inline,...]}
- {type:heading,level:2|3|4,content:[inline,...]}
- {type:quote,paragraphs:[[inline,...],...]}
- {type:list,ordered:boolean,start:positiveInteger,items:[[inline,...],...]}

For unordered lists start is 1. All collections shown are nonempty. Field names and block types are literal strings in actual JSON. Reject unknown fields and invalid values at both generation and app-input boundaries.

## Manifest and revision consistency

Manifest shape: {contractVersion:1,sets:[{id,title,essays:[{id,title,revision,placeholder}]}]}. Order comes from sets.json. Revision is a lowercase 64-character SHA-256 digest of the exact generated essay file bytes. Generate deterministic UTF-8 JSON with fixed field order, two-space indentation and one final LF. Payloads do not contain their own revision, avoiding a circular hash.

Clients construct payload paths from validated IDs and revision digests, not arbitrary URLs supplied by content. Verify the digest, payload ID, contract version, title and placeholder flag before accepting a payload. Identity/revision-addressed files are immutable; retain older generated revisions so an older manifest remains retrievable during deployment or caching. Repeated generation of unchanged input must be byte-identical.

## Safe generation and limits

Read and validate every selected source before updating delivery files. Stage output separately; write immutable payloads first and replace the local manifest last. An invalid source changes no published output. File interruption must not produce a manifest that references missing local payloads; atomicity and platform behavior need implementation tests. A GitHub Pages release still requires verification after deployment.

Approved version-1 engineering limits (not GitHub limits or recommended essay lengths): 200 sets, 20 essays per set, 1000 essays total, 256 KiB UTF-8 per Markdown source and generated essay, 1 MiB manifest, 2000 blocks per essay, and 4096 UTF-16 code units per inline run. Enforce counts and byte limits explicitly, including streamed download limits in the future app adapter. App timeouts and retry policy are separate implementation details to fix before network integration.

## Reader retention and withdrawal

The app retains complete delivered sets with metadata and bodies. It does not switch away from a usable current set until the eligible next set is fully validated and persisted. Read marks are explicit; opening is not reading. Previously revealed sets never relock after unmarking. Progress is separate from personal writing and excluded from writing backup version 2.

Architect-approved MVP withdrawal rule: withdrawing one essay unpublishes its entire set for new readers. Published set membership cannot be edited after release. Existing readers retain their already-downloaded set, including its content, metadata, and read marks; new readers skip unpublished sets. No fabricated read mark or partial replacement is permitted. Material replacement essays belong to later sets under new identities. App synchronization must use retained membership and metadata, not erase them when absent from a newer manifest. Approval selects this rule; it does not establish implementation or verification.

## Publisher acceptance checks

Test valid formatting and Unicode; duplicate fields/IDs; missing or unpublished members; ordering; unsupported formatting; empty catalogue; size/count bounds; deterministic generation and hashes; failed generation preserving old output; immutable-revision retention; and invalid membership changes after release. Historical fixture count is not a passing test result.

Publisher implementation does not change LC-Dev, its database, backup, or dependencies. App checks and Android Emulator acceptance are subsequent bounded work.

## Consolidated implementation rules

These rules were explicitly approved with the consolidated version-1 contract and supersede conflicting wording above.

- Use yaml for frontmatter and markdown-it for Markdown token parsing on the author-side publisher only. Check exact releases and pin reviewed versions during implementation; commit package-lock.json. Package installation requires its own approved execution step. Explicitly enforce duplicate-key, alias, schema, and supported-token validation. No app dependency is selected by this publisher decision.
- Keep package.json, package-lock.json, scripts/, authoring/, and public/ in the content repository; preserve the existing README and ignore rules. The ordinary root-served public/ directory needs no new custom deployment workflow.
- Unpublished sets are withheld as a whole even when their member essays retain publish: true. A published essay must belong to a declared set, not necessarily a currently published set. Every member of a published set must itself be published.
- Once generated for publication, retain existing set order and exact membership. Append new sets; do not insert them ahead of released sets or reuse identities. Maintain generated publication-ledger.json outside public/ with original set order and membership, including withdrawn sets. Validate against that ledger before generating changes. The ledger is committed publication bookkeeping, not reader data or evidence of deployment.
- Retain older immutable revision files. The current manifest governs new-reader delivery, not secrecy or erasure from Git history.
- Validate all selected inputs and prepare output before changing delivery files. Write new immutable payloads, verify their contents, save the ledger, and replace the manifest last. Invalid input leaves delivery output unchanged. Interrupted builds may leave unused payloads, but must not activate a manifest referencing missing files. Test recovery and failure paths; do not claim a transaction spanning all files.
- Keep the stated set, essay, byte, block, and text-run limits. Split long inline text into runs no longer than 4096 UTF-16 code units without splitting a Unicode surrogate pair; do not reject a valid paragraph solely because it needs multiple runs.
- Ordinary soft paragraph line breaks become spaces; explicit hard breaks are rejected. Plain-text further-reading references are allowed; interactive references and related-question navigation are deferred.
- Test the ledger across withdrawal and attempted membership/order changes, partial-write failures, retained revisions, long Unicode runs, deterministic output, and the existing acceptance cases. No passing result is claimed by adopting this contract.
- Fix app networking timeouts, storage adapters, and client compatibility before app integration. The approved target is Android Emulator; preserve existing personal writing and writing-backup version 2.
