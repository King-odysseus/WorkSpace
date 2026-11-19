# ZuriCopilot: Step-by-Step Build Guide

Source: `docs/zuricopilot-plan.md`.

This is a build order derived from the master plan. Each step says what to create. Do not begin the next phase until the previous phase report is accepted.

## Step 1: Create the desktop spike

Create the `desktop/` application with its own `package.json`, Electron main process, one frameless window, one persistent web view, a minimal shell chrome view, and a throwaway Copilot view connected through IPC.

Create the shared-session workspace API client in the main process. Create typed read and write methods, CSRF handling from the shared session cookie, Origin and Referer headers, and configuration for the server URL.

Create the Phase 0 proof report containing the exact non-secret request headers, the read and write results, and the applicable CSRF decision-tree branch. Create no product UI and change no web source files.

## Step 2: Create the shell, access gate, and IPC foundation

Create the Electron window manager, single-instance lock, custom title bar, desktop rail, Workspace mode, ZuriCopilot mode, Dock mode, tray behavior, menu, autostart and keyboard shortcut scaffolding.

Create the `use_copilot` permission in the existing manager permission model. Create its Django tests for owner access, granted manager access, ungranted manager denial, member denial, API toggling, and unchanged existing permission behavior.

Create the typed shared IPC contracts, zod validation, Copilot preload bridge, workspace list screen, sign-out lock behavior, and `safeStorage` smoke test. Create the Phase 1 report and the web-unchanged proof output.

## Step 3: Create the provider and model layer

Create the provider-neutral types and capability schema in `desktop/features/copilot/shared/providers/`.

Create the `AIProvider` interface, provider registry, model capability records, pricing data, token estimation, safe error mapping, and the shared provider contract test suite.

Create the Anthropic adapter, one configurable OpenAI-compatible adapter for OpenAI, DeepSeek, Kimi, Together AI, OpenRouter, LM Studio and custom URLs, and the Ollama adapter.

Create keychain-backed provider account storage, provider discovery, connection testing, the Models settings screen, Cloud and Local badges, and guarded model egress with host classification, redirect checks and audit records.

Create the Phase 2 report. Record real cloud testing only when the owner supplies a key. Record local testing as pending unless Ollama is already installed and approved.

## Step 4: Create businesses, encrypted storage, and chat with memory

Create the encrypted SQLite connection, forward-only migrations, scoped repositories and the local tables for scopes, businesses, threads, messages, memory items, memory summaries, provider accounts, routes, usage, spend limits, proposals and audit logs.

Create the eligible business list from workspaces, business switching, business-local settings, thread list, thread search, pinned threads and streaming chat.

Create model selection, per-message attribution chips, source display, privacy preview, fallback notices, memory extraction, rolling summaries, the Remembered panel, and editable and deletable memory items.

Create proposal cards for natural-language task requests, with Approve, Edit and Reject states but no task execution yet.

Create repository scope tests, chat integration fixtures, restart persistence tests, and cross-business leak tests. Create the Phase 3 report with separate cloud and local evidence.

## Step 5: Create document ingestion and Business DNA

Create the Documents screen with drag and drop, file picker, type tags, status, replace and delete controls.

Create local parsers for PDF, scanned PDF OCR, DOCX, TXT, MD, XLSX, CSV, PPTX and images. Create the worker-backed ingestion jobs, progress states, failure messages, hashing, optional linked-folder watcher and resumable indexing.

Create the chunker, FTS5 index, vector index, local embedding integration, stale-embedding handling and keyword-only notice when no local embedder is available.

Create hybrid retrieval, token-budget selection, source citations, Business DNA generation, editable locked fields, DNA diff proposals, conflict flags and not-covered behavior.

Create the fixed ingestion sample set and the prepared retrieval questions. Create the Phase 4 report with ingestion statuses, retrieval hit rate, locked-field tests and captured cloud payload evidence.

## Step 6: Create routing, fallback, local-only mode and cost controls

Create task-type routing for chat, quick tasks, embeddings, research, email drafts, plan tasks and DNA extraction.

Create per-business overrides, global routes, ordered fallback chains, capability-based selection, prompted structured output with validation and repair retry, and visible fallback attribution.

Create the single egress choke point for model, search, email and OAuth traffic. Create global and per-business local-only controls, explicit cloud-fallback confirmation, usage ledger views, cost estimates, monthly limits, the 80 percent warning and the 100 percent block.

Create encrypted export and restore. Create direct tests that bypass the UI and prove that hostile configuration cannot send cloud traffic in local-only mode.

## Step 7: Create planning, proposals, approvals and scheduling

Create the Dashboard directions view, weekly plan data model, capacity calculator, plan task editor, capacity bars, over-capacity advice and approval bar.

Create the Approvals inbox and proposal state machine for task batches, tasks, reassignment, DNA changes, email drafts and external calls. Create expiry and restore behavior, counts on the rail and dock, approval-time permission rechecks and idempotency keys.

Create task execution through the existing workspace REST endpoints, including duplicate detection and remote task IDs. Create the decision journal entry when a direction is agreed.

Create persisted jobs, schedules, launch catch-up, daily scans, morning briefs, weekly reviews, follow-up checks, document indexing, quiet hours, notification settings and native notifications.

Create capacity, idempotency and fake-clock scheduler tests. Create the Phase 6 acceptance report with a verified approved-task scenario and no-duplicate retry evidence.

## Step 8: Create email drafting and sending

Create the provider-neutral `EmailProvider` interface, account binding, contacts and labels configuration, draft model and sent log.

Create Gmail OAuth with loopback redirect and PKCE, Zoho OAuth with regional endpoints, and Brevo send-only API-key support. Keep tokens in the keychain and refresh them in the main process.

Create brand-voice drafting with sources, exact-draft approval, edit and discard actions, idempotent sending and follow-up rules. Create the recipient validation and prompt-injection tests.

## Step 9: Create market research

Create search capability gating, the research report model, cited report sections, estimate labels, cache and stale-after handling, refresh controls, cost estimates and local-only behavior.

Create the disabled-state behavior when no search-capable route exists. Create tests proving every report claim has a source and stale reports are marked.

## Step 10: Create staff and resource insights

Create code-owned workload, capacity, overdue, stalled-task, cycle-time and similar-work metrics using existing workspace endpoints.

Create the Team insights screen, owner suggestions, pause advice, permanent workload notice, cloud placeholder handling and permission-aware detail views.

Create the comparison test against the web app's reports and tests proving there are no individual performance scores or unauthorized data.

## Step 11: Create strategy and the decision journal

Create the Strategy view with three to five cited directions, risks, resource needs, suggested owners and first steps.

Create one-click proposal conversion to weekly plans, tasks and email drafts. Create 30, 60 and 90 day decision reviews, outcome recording, the assumptions tracker, devil's advocate mode and scenario comparison.

Create the seeded end-to-end scenario that connects documents, chat, research, capacity, directions, agreement, weekly planning and approved tasks.

## Step 12: Create the remaining provider entries and release checks

Create any remaining provider configuration entries or small adapters required by the locked provider list. Create no feature-specific changes for a new provider.

Run the shared provider contract suite for every provider. Create the final release evidence for phases 0 through 5, then phases 6 and 7, then phases 8 through 10, and finally phase 11.

For every phase, create the required unit, contract, integration, safety, Electron end-to-end and evaluation tests that apply to that phase. Create the section 5 web-unchanged proof and the phase report before requesting acceptance.

## Cross-cutting rules to apply while creating each step

- Create all Copilot code under `desktop/`; keep the web app unchanged except for the approved `use_copilot` server permission.
- Create no cloud path that bypasses the egress guard, no action that bypasses the Approvals inbox, and no secret storage outside the OS credential store.
- Create scoped repository methods that always require the server-user scope and, where applicable, the business id.
- Create tests for prompt injection, cross-business isolation, local-only enforcement, secret absence, approval enforcement and safe provider errors.
- Create each phase report with what was built, exact test commands and results, web-unchanged evidence, deviations, and open owner decisions.
