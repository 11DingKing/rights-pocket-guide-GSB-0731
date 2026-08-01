# Rights Pocket Guide

Blank 0-1 baseline for an offline-first, accessible reader of fixed legal-rights content packages. This repo contains no authoring or personal-content system.

## Source material

`materials/content-pack-v1.json` and `materials/content-pack-v2.json` define package versions, stable topic/article IDs, revisions, withdrawals, legal references, and migration cases.

## Required delivery contract

- React, TypeScript strict, Vite, and IndexedDB; no UI library, search library, or state-management library.
- Parsing, indexing, offline storage, and React views are separate; views never access IndexedDB directly.
- Package switches are atomic. Failed updates retain a complete old version without mixing content.
- Native verification: `npm test`, `npm run build`, and `npm run dev`.
- Verify keyboard flow, screen-reader announcements, focus restoration, first offline launch, update failure, rollback, and deep-link migration.

Docker is not required.

