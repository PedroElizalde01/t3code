# Codex / Claude Code Desktop Chat Architecture Reference

## Purpose

This document is a handoff artifact for building a new desktop application that supports:

- Codex for chat, prompting, tool execution, approvals, and session/thread continuity
- Claude Code for the same user-facing experience as far as each provider allows

The primary architectural reference is this repository, `t3code`, which already implements a production-shaped desktop stack around Codex. The goal of this document is not to restate the UI. The goal is to explain the runtime model, boundaries, invariants, and implementation choices another agent should reuse when building a new app.

This document is written so a different Codex instance can use it as an implementation brief.

## Executive Summary

This repo does **not** let the UI talk directly to Codex.

Instead it uses this layered architecture:

1. A desktop shell starts a local backend process and exposes a WebSocket URL to the renderer.
2. The renderer talks only to the backend through a WebSocket RPC + push channel.
3. The backend owns all provider processes and provider session state.
4. Each provider is wrapped by an adapter that translates provider-native protocol into a canonical runtime event model.
5. A server-side orchestration layer consumes canonical runtime events and projects them into a stable read model:
   - threads
   - messages
   - session status
   - activities / work log
   - proposed plans
   - checkpoints / diffs
   - approvals and user-input prompts
6. The UI renders that read model and dispatches orchestration commands, not provider-native calls.

This separation is the most important design choice to keep.

If the new app must support both Codex and Claude Code, it should preserve this exact boundary:

- provider-native protocol at the edge
- provider-neutral orchestration in the middle
- UI consuming a provider-neutral read model

Do **not** model the app directly around Codex JSON-RPC messages or around Claude SDK stream items.

## This Document Must Be Treated As Standalone

The new project will live in a different repository.

That means the implementing agent must **not** depend on:

- source code from this repo being present
- path names from this repo being reusable as-is
- hidden behavior inferred from implementation details not restated here

Everything important must be specified here explicitly:

- stack
- process topology
- module boundaries
- provider adapter contracts
- canonical event model
- persistence model
- runtime flow
- failure handling
- phased implementation order

If there is any conflict between:

- "how this repo currently names something"
- "what the new project should implement cleanly"

the new project should prefer the cleaner design described in this document.

## Recommended Stack For The New Project

This is the recommended implementation stack. It is intentionally opinionated so another agent can execute without making unnecessary architecture decisions.

### Desktop Shell

- Framework: Electron
- Main process language: TypeScript
- Build/runtime:
  - Node.js for Electron main process
  - Vite for renderer bundling

Reason:

- easiest path to parity with the current architecture
- mature process supervision model
- simple preload bridge
- strong ecosystem for code-editor-adjacent desktop apps

### Renderer

- Framework: React
- Language: TypeScript
- Build tool: Vite
- State:
  - server state from WebSocket snapshot + push replay
  - lightweight local UI state via Zustand or equivalent

Reason:

- fast implementation
- straightforward chat/timeline rendering
- good compatibility with streaming UIs

### Local Backend

- Runtime: Node.js
- Language: TypeScript
- Transport to renderer: WebSocket
- Internal architecture:
  - command/query RPC over WebSocket
  - push event channel over WebSocket

Reason:

- easy child-process management for provider runtimes
- easy integration with Electron shell
- simple local deployment

### Persistence

- Database: SQLite
- Access layer:
  - thin typed repository layer
  - explicit SQL migrations
- Store these classes of data:
  - orchestration events
  - read-model projections
  - provider runtime bindings
  - checkpoints / diff metadata
  - attachments metadata if needed

Reason:

- local desktop-first product
- durable enough for chat/session history
- supports replay and incremental projections

### Logging

- Structured JSON logs for backend
- Rotating file logs for:
  - desktop shell
  - backend process
  - provider-native raw events
  - canonical runtime events

### Testing

- Unit/integration tests: Vitest
- Renderer tests: React Testing Library
- Protocol and adapter tests: integration-style test harnesses with mocked provider streams
- Avoid depending on live provider network in CI

## Recommended New Project Repository Layout

The new project should use a monorepo or clearly separated packages with these logical units:

```text
apps/
  desktop/
    src/main/           Electron main process
    src/preload/        Electron preload bridge
  web/
    src/                React renderer
  backend/
    src/
      server/           WS API, auth, snapshot/replay
      orchestration/    commands, events, decider, projector, reactors
      provider/         provider service, registry, adapters
      persistence/      sqlite repos, migrations, projection stores
      terminal/         optional terminal subsystem
      git/              optional git/checkpoint subsystem

packages/
  contracts/
    src/                shared schemas/types for RPC/events/read model
  shared/
    src/                shared runtime helpers only
```

If a monorepo is not used, preserve the same logical separation.

## Concrete Runtime Topology

The new app should run as four layers:

```text
Electron Main
  -> spawns Local Backend
Renderer React App
  -> connects to Local Backend over authenticated WS
Local Backend
  -> starts Provider Sessions (Codex / Claude)
Provider Session
  -> speaks provider-native protocol
```

### Process Ownership Rules

- Electron main owns backend child process
- Backend owns provider child processes or provider SDK clients
- Renderer owns no provider process
- Renderer owns no provider-native protocol state

## Required Backend Subsystems

The local backend should be split into the following subsystems.

### 1. WebSocket API Layer

Responsibilities:

- authenticate renderer connection
- serve snapshot query
- accept command dispatch
- serve replay/event backfill
- broadcast domain events

Methods to expose:

- `orchestration.getSnapshot`
- `orchestration.dispatchCommand`
- `orchestration.replayEvents`
- optional diff/checkpoint queries

Push channel:

- `orchestration.domainEvent`

### 2. Orchestration Engine

Responsibilities:

- accept client commands
- validate invariants
- produce domain events
- persist events
- update projections
- trigger provider reactors

This is the app core.

### 3. Provider Service

Responsibilities:

- own provider adapter registry
- resolve active provider binding per thread
- start/recover/stop provider sessions
- route user turn / interrupt / approval / user-input actions
- merge all provider adapters into one canonical runtime stream

### 4. Provider Adapters

One adapter per provider:

- `CodexAdapter`
- `ClaudeCodeAdapter`

Each adapter should:

- manage provider-native transport/session
- emit canonical runtime events
- report provider capabilities

### 5. Runtime Ingestion / Projection

Responsibilities:

- consume canonical provider runtime events
- update thread session state
- build assistant messages from deltas
- build activities from provider runtime actions
- maintain pending approvals and pending user input
- update proposed plans

### 6. Projection Snapshot Query

Responsibilities:

- return the current read model for renderer bootstrap
- support replay after reconnect

### 7. Persistence Layer

Must persist:

- orchestration events
- provider runtime binding records
- projection tables or snapshot rows
- optional checkpoint and diff rows

## Required Read Model For The New App

The renderer should render only this product read model, not provider-native objects.

### Project

Fields:

- `id`
- `title`
- `workspaceRoot`
- `defaultModel`
- optional scripts/actions
- timestamps

### Thread

Fields:

- `id`
- `projectId`
- `title`
- `providerPreference`
- `model`
- `runtimeMode`
- `interactionMode`
- `branch`
- `worktreePath`
- `latestTurn`
- `messages`
- `activities`
- `proposedPlans`
- `session`
- timestamps

### Message

Fields:

- `id`
- `role`
- `text`
- `attachments`
- `turnId`
- `streaming`
- `createdAt`
- `updatedAt`

### Thread Activity

Fields:

- `id`
- `tone`
- `kind`
- `summary`
- `payload`
- `turnId`
- `sequence`
- `createdAt`

### Session

Fields:

- `threadId`
- `status`
- `providerName`
- `runtimeMode`
- `activeTurnId`
- `lastError`
- `updatedAt`

### Latest Turn

Fields:

- `turnId`
- `state`
- `requestedAt`
- `startedAt`
- `completedAt`
- `assistantMessageId`

### Proposed Plan

Fields:

- `id`
- `turnId`
- `planMarkdown`
- `createdAt`
- `updatedAt`

## Required Command Model

The new app should expose these commands from renderer to backend.

### Thread / Session Commands

- create thread
- delete/archive thread
- update thread metadata
- set runtime mode
- set interaction mode
- stop thread session

### Turn Commands

- start turn
- interrupt turn

### Interaction Resolution Commands

- respond to approval
- respond to structured user input

### Optional Extended Commands

- revert checkpoint
- fetch diff
- start review
- fork thread
- resume historical thread into live session

## Concrete Command Payloads Recommended

### `thread.turn.start`

```ts
type ThreadTurnStartCommand = {
  type: "thread.turn.start";
  commandId: string;
  threadId: string;
  message: {
    messageId: string;
    role: "user";
    text: string;
    attachments: ChatAttachment[];
  };
  provider?: "codex" | "claude-code";
  model?: string;
  modelOptions?: ProviderModelOptions;
  providerOptions?: ProviderStartOptions;
  assistantDeliveryMode?: "buffered" | "streaming";
  runtimeMode: "approval-required" | "full-access";
  interactionMode: "default" | "plan";
  createdAt: string;
};
```

### `thread.approval.respond`

```ts
type ThreadApprovalRespondCommand = {
  type: "thread.approval.respond";
  commandId: string;
  threadId: string;
  requestId: string;
  decision: "accept" | "acceptForSession" | "decline" | "cancel";
  createdAt: string;
};
```

### `thread.user-input.respond`

```ts
type ThreadUserInputRespondCommand = {
  type: "thread.user-input.respond";
  commandId: string;
  threadId: string;
  requestId: string;
  answers: Record<string, unknown>;
  createdAt: string;
};
```

## Required Domain Event Model

The orchestration layer should emit domain events roughly like:

- `thread.created`
- `thread.meta-updated`
- `thread.message-sent`
- `thread.turn-start-requested`
- `thread.turn-interrupt-requested`
- `thread.approval-response-requested`
- `thread.user-input-response-requested`
- `thread.session-set`
- `thread.activity-appended`
- `thread.proposed-plan-upserted`
- `thread.turn-diff-completed`

This domain event stream is what the UI subscribes to and what projections use to maintain the read model.

## Required Canonical Provider Runtime Event Model

The new app should implement a canonical provider runtime event union with at least the following families.

### Session Lifecycle

- `session.started`
- `session.state.changed`
- `session.exited`

### Thread Lifecycle

- `thread.started`
- `thread.state.changed`
- `thread.metadata.updated`

### Turn Lifecycle

- `turn.started`
- `turn.completed`
- `turn.aborted`

### Message / Content Streaming

- `content.delta`

Content stream kinds should include:

- `assistant_text`
- `reasoning_text`
- `reasoning_summary_text`
- `plan_text`
- `command_output`
- `file_change_output`

### Item / Tool Lifecycle

- `item.started`
- `item.updated`
- `item.completed`
- `tool.progress`

### Approval / User Input

- `request.opened`
- `request.resolved`
- `user-input.requested`
- `user-input.resolved`

### Product-Level Enrichment

- `turn.plan.updated`
- `turn.proposed.delta`
- `turn.proposed.completed`
- `turn.diff.updated`
- `runtime.warning`
- `runtime.error`

### Required Base Fields On All Runtime Events

Every canonical runtime event should include:

- `eventId`
- `provider`
- `threadId`
- `createdAt`
- optional `turnId`
- optional `itemId`
- optional `requestId`
- optional provider refs
- optional raw provider payload

## Provider Capability Matrix

The new app must implement an explicit capability model.

Suggested capability contract:

```ts
type ProviderCapabilities = {
  sessionModelSwitch: "in-session" | "restart-session" | "unsupported";
  supportsResume: boolean;
  supportsInterrupt: boolean;
  supportsApprovals: boolean;
  supportsStructuredUserInput: boolean;
  supportsReadThread: boolean;
  supportsRollback: boolean;
  supportsPlanStreaming: boolean;
  supportsDiffStreaming: boolean;
  supportsDetachedReview: boolean;
};
```

The UI and orchestration layer must degrade behavior based on capabilities instead of assuming Codex parity.

## Codex Adapter Specification

The Codex adapter should use:

- `codex app-server` over stdio
- newline-delimited JSON messages
- JSON-RPC request/response bookkeeping

### Codex Session Lifecycle

On session start:

1. validate CLI version
2. spawn `codex app-server`
3. send `initialize`
4. send `initialized`
5. optionally call `model/list`
6. optionally call `account/read`
7. decide whether to `thread/start` or `thread/resume`
8. persist provider thread id inside opaque `resumeCursor`
9. emit canonical session lifecycle events

### Codex Turn Lifecycle

On turn start:

1. build `turn/start` payload from product turn command
2. include text and image attachments
3. include model override if needed
4. include provider-specific mode settings:
   - approval policy
   - sandbox mode
   - collaboration mode
5. start turn
6. consume notifications until completion/interruption
7. map provider-native notifications into canonical runtime events

### Codex Approval Handling

When the app-server sends:

- `item/commandExecution/requestApproval`
- `item/fileRead/requestApproval`
- `item/fileChange/requestApproval`

the adapter should:

1. allocate stable request id in app space
2. store pending request bookkeeping
3. emit canonical `request.opened`
4. wait for orchestration/user response
5. answer the original JSON-RPC request
6. emit canonical `request.resolved`

### Codex Structured User Input Handling

When the app-server sends:

- `item/tool/requestUserInput`

the adapter should:

1. allocate stable request id
2. capture questions
3. emit `user-input.requested`
4. wait for response
5. answer the original provider request
6. emit `user-input.resolved`

### Codex Resume Rules

- orchestration thread id is app-owned
- provider thread id is Codex-owned
- persist provider thread id in `resumeCursor`
- on recovery try `thread/resume`
- if resume fails in a known recoverable way, fall back to `thread/start`
- if resume fails non-recoverably, surface failure

## Claude Code Adapter Specification

The Claude adapter should be implemented as a separate provider runtime, not a Codex compatibility layer.

### High-Level Requirement

Take Claude-native session/message/tool events and map them into the same canonical runtime event model.

### Claude Session Lifecycle

The adapter should:

1. create a provider-native session or query context
2. persist provider-native continuation identifier as `resumeCursor`
3. emit canonical session started/state events
4. support resume if the provider SDK supports continuation

### Claude Turn Lifecycle

On turn start:

1. convert product command to Claude-native prompt/request
2. stream provider-native events/items
3. map assistant text chunks to `content.delta`
4. map tool execution begin/update/end to item/tool lifecycle events
5. map permissions or confirmation requests to canonical approval/user-input events if possible
6. emit `turn.completed` when the provider run ends

### Claude-Specific Constraints

Expected differences versus Codex:

- session identifier may not be the same as "thread id"
- provider may not expose a separate persisted thread history API
- plan updates may be embedded in assistant text rather than as distinct structured events
- approval semantics may be closer to permission modes than JSON-RPC request/response
- rollback may be unsupported

### Claude Fallback Rules

If Claude lacks a direct equivalent:

- no rollback -> capability false
- no plan stream -> parse only final plan if product chooses, otherwise capability false
- no structured user-input request -> capability false
- no diff stream -> capability false

Do not fake unsupported capabilities as if they are native.

## Recommended Persistence Schema

The new project should use explicit tables.

### `orchestration_events`

Fields:

- `sequence` integer primary key autoincrement
- `event_id` text unique
- `aggregate_kind` text
- `aggregate_id` text
- `event_type` text
- `occurred_at` text
- `command_id` text nullable
- `causation_event_id` text nullable
- `correlation_id` text nullable
- `metadata_json` text
- `payload_json` text

### `provider_session_runtime`

Fields:

- `thread_id` text primary key
- `provider` text
- `runtime_mode` text
- `status` text
- `resume_cursor_json` text nullable
- `runtime_payload_json` text nullable
- `updated_at` text

### Projection Tables

Recommended projection tables:

- `projection_projects`
- `projection_threads`
- `projection_thread_messages`
- `projection_thread_sessions`
- `projection_thread_activities`
- `projection_thread_proposed_plans`
- `projection_checkpoints`
- `projection_pending_approvals`

### Optional Attachment Store

If image attachments are supported:

- store files under state dir
- persist attachment metadata in projection or auxiliary table
- use app-generated attachment ids

## Required Projection Logic

The implementing agent should create a projection pipeline that maintains:

### Threads Projection

Must update:

- title
- model
- runtime mode
- interaction mode
- branch/worktree metadata
- latest turn summary
- session state

### Messages Projection

Must support:

- append user message on `thread.message-sent`
- append assistant deltas
- mark assistant message complete
- keep streaming state correct

### Activities Projection

Must append normalized activities for:

- approvals
- user input requests
- tool starts/updates/completions
- runtime warnings/errors
- plan updates
- task progress

### Proposed Plans Projection

Must upsert final proposed plan markdown by plan id.

## Required Streaming Rules

The new app must not naively write each provider delta straight into the final state without control.

### Assistant Streaming

Implement:

- message id derivation strategy
- per-message buffer
- max buffered size
- spill behavior if needed
- explicit finalization on:
  - item completion
  - turn completion
  - session exit cleanup

### Plan Streaming

Implement:

- separate plan buffer keyed by plan id
- explicit finalization on proposed-plan completion or turn completion

### Out-Of-Order Event Guarding

Implement guards so:

- a completion event for a non-active turn does not clear the current turn
- thread/session started events do not erase active running turn state
- events missing turn id do not corrupt active turn state

## Required Failure Handling

The implementing agent must implement these failure behaviors explicitly.

### Backend Crash / Restart

- desktop shell restarts backend with exponential backoff
- renderer reconnects and reloads snapshot
- backend restores projection state from persistence

### Provider Process Exit

- adapter emits session/runtime error
- orchestration updates session state
- buffered stream state is cleaned
- user-visible activity is appended if needed

### Provider Request Failure

For failures like:

- turn start failed
- interrupt failed
- approval response failed
- user input response failed

append an activity entry into the thread timeline.

### Resume Failure

- if recoverable: fallback according to provider rules
- if unrecoverable: mark session error and surface it

## Required Renderer Behavior

The renderer should follow these rules.

### Boot

1. connect to backend WebSocket
2. request snapshot
3. subscribe to domain events
4. optionally request replay from last seen sequence after reconnect

### Rendering

Render from read model only:

- thread list from snapshot
- message timeline from thread messages + proposed plans + activities
- session badge from thread session
- pending approvals derived from activities
- pending user input derived from activities

### Sending User Turn

The renderer should:

1. create thread if needed
2. dispatch `thread.turn.start`
3. optimistically show user message only if orchestration semantics guarantee it, otherwise wait for snapshot/event update

### Approvals / User Input

The renderer should:

- derive current unresolved requests from activities
- submit responses through orchestration commands
- not call provider adapters directly

## Recommended UI Product Semantics

These user-facing concepts should exist regardless of provider:

- "New thread"
- "Send prompt"
- "Interrupt"
- "Pending approval"
- "Need your input"
- "Work log"
- "Plan"
- "Session status"

These should be product semantics. The provider adapter decides how to back them.

## Recommended Runtime Modes

Use product-level runtime modes:

- `approval-required`
- `full-access`

Map them per provider:

### Codex

- `approval-required`
  - approval policy: `on-request`
  - sandbox: `workspace-write`
- `full-access`
  - approval policy: `never`
  - sandbox: `danger-full-access`

### Claude

Map to Claude-native permission/tool modes as closely as possible and record capability differences.

## Recommended Interaction Modes

Use product-level interaction modes:

- `default`
- `plan`

Map per provider:

### Codex

Map to collaboration mode or equivalent provider settings.

### Claude

If native support exists, use it.
If not, inject provider-specific system/developer instructions that emulate the behavior while keeping the product-level meaning the same.

## Recommended Milestone Plan For The New Project

### Milestone 1: Product Skeleton

Build:

- Electron shell
- backend process
- authenticated WebSocket
- snapshot + command dispatch + domain event push
- SQLite event store

### Milestone 2: Orchestration Core

Build:

- command schemas
- domain event schemas
- read model
- projection pipeline
- replay support

### Milestone 3: Codex Adapter

Build:

- stdio manager
- session start/resume
- turn start
- interrupt
- approvals
- user input requests
- canonical runtime event mapping

### Milestone 4: Chat UI

Build:

- thread list
- composer
- timeline
- pending approval UI
- pending user input UI
- session state display

### Milestone 5: Claude Adapter

Build:

- Claude session handling
- canonical stream mapping
- capability reporting
- graceful degradation in UI

### Milestone 6: Reliability Features

Build:

- replay/reconnect
- backend restart recovery
- native/canonical/orchestration event logs
- integration tests

## Why This Repo Is The Right Reference

This repo already solves the hard parts that matter for a serious code-agent desktop app:

- local desktop shell + backend process model
- provider session ownership on the server
- resumable thread/session handling
- approvals and structured user input
- streaming assistant content
- plan/proposed-plan handling
- failure-aware lifecycle projection
- session recovery from persisted runtime bindings
- deterministic UI state from an event-sourced read model

The current implementation is still Codex-first and not fully provider-neutral yet, but the architecture is already close to what a multi-provider desktop app needs.

## Source Map

### Desktop Shell

- Electron main process starts and supervises the backend:
  - `apps/desktop/src/main.ts`
- Electron preload exposes bridge APIs:
  - `apps/desktop/src/preload.ts`

### Web Client

- Native API wrapper over WebSocket transport:
  - `apps/web/src/wsNativeApi.ts`
- UI state and projections:
  - `apps/web/src/store.ts`
  - `apps/web/src/session-logic.ts`
- Main chat UI:
  - `apps/web/src/components/ChatView.tsx`

### Backend Server

- HTTP + WebSocket server:
  - `apps/server/src/wsServer.ts`
- Service graph wiring:
  - `apps/server/src/serverLayers.ts`

### Provider Runtime Layer

- Provider service facade:
  - `apps/server/src/provider/Layers/ProviderService.ts`
- Provider registry:
  - `apps/server/src/provider/Layers/ProviderAdapterRegistry.ts`
- Codex adapter:
  - `apps/server/src/provider/Layers/CodexAdapter.ts`
- Raw Codex app-server process manager:
  - `apps/server/src/codexAppServerManager.ts`

### Orchestration Layer

- Provider command execution:
  - `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
- Provider runtime ingestion:
  - `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`
- Event engine / projections:
  - `apps/server/src/orchestration/Layers/OrchestrationEngine.ts`
  - `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`
  - `apps/server/src/orchestration/decider.ts`
  - `apps/server/src/orchestration/projector.ts`

### Shared Contracts

- Orchestration commands, events, read model:
  - `packages/contracts/src/orchestration.ts`
- Provider session/event contracts:
  - `packages/contracts/src/provider.ts`
- Canonical provider runtime events:
  - `packages/contracts/src/providerRuntime.ts`

## Current End-To-End Flow In This Repo

### 1. Desktop Boot

The Electron main process:

- reserves a loopback port
- generates backend auth token
- spawns the backend as a child Node process
- restarts the backend with exponential backoff if it exits unexpectedly
- passes the WebSocket endpoint to the renderer through preload

Relevant implementation:

- `apps/desktop/src/main.ts`
- `apps/desktop/src/preload.ts`

Important properties:

- backend is a separate process, not embedded business logic in Electron main
- restart policy is explicit
- backend auth token is injected
- desktop shell remains thin

This is a strong pattern for a new app too.

### 2. Renderer Communication Model

The renderer does not call providers directly. It uses:

- request/response WebSocket RPC for commands and queries
- push subscription for orchestration domain events

The renderer asks for:

- snapshot of the read model
- dispatch of orchestration commands
- diffs / replay data

It subscribes to:

- `orchestration.domainEvent`

This is critical. The renderer is coupled to the orchestration domain, not to provider transport.

### 3. Provider Sessions Live On The Backend

Provider ownership is backend-only.

The backend:

- starts provider sessions
- persists runtime bindings
- recovers sessions when needed
- routes commands to the correct provider adapter
- exposes one canonical runtime event stream

This responsibility sits mainly in:

- `ProviderService`
- `ProviderSessionDirectory`
- provider adapters

### 4. Codex Session Startup

The Codex process manager does the following:

1. validates Codex CLI version
2. spawns `codex app-server`
3. performs JSON-RPC `initialize`
4. sends `initialized`
5. optionally reads `model/list` and `account/read`
6. chooses thread open strategy:
   - `thread/start`
   - `thread/resume`
   - resume fallback to fresh start when recoverable
7. stores `resumeCursor` containing provider thread id

It also translates app runtime mode to Codex runtime settings:

- `approval-required` -> `approvalPolicy: on-request`, `sandbox: workspace-write`
- `full-access` -> `approvalPolicy: never`, `sandbox: danger-full-access`

It also injects collaboration mode for plan/default interaction modes by setting Codex `collaborationMode` with explicit developer instructions.

Important consequence:

This repo uses Codex app-server as an execution/runtime backend, but it overlays its own product semantics:

- runtime mode
- interaction mode
- model normalization
- account-based model fallback

The new app should preserve that overlay concept.

## Codex App-Server Behavior This Repo Depends On

Codex app-server is the protocol truth source for the current implementation.

Important protocol facts used here:

- transport is stdio JSONL
- protocol is bidirectional JSON-RPC 2.0 style, without `jsonrpc` field on the wire
- session requires `initialize` then `initialized`
- conversation model is `thread -> turn -> item`
- main turn lifecycle:
  - `thread/start` or `thread/resume`
  - `turn/start`
  - streaming notifications
  - `turn/completed`
- approvals come in as server requests
- structured user input also comes in as server requests
- thread history can be read and rolled back

Examples of provider-native methods this repo handles:

- `thread/start`
- `thread/resume`
- `thread/read`
- `thread/rollback`
- `turn/start`
- `turn/interrupt`
- `item/commandExecution/requestApproval`
- `item/fileRead/requestApproval`
- `item/fileChange/requestApproval`
- `item/tool/requestUserInput`
- `item/agentMessage/delta`
- `turn/plan/updated`
- `turn/diff/updated`
- `item/started`
- `item/completed`
- `turn/completed`

The official references used for this document:

- OpenAI Codex app-server README:
  - https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md
- OpenAI developer docs:
  - https://developers.openai.com/codex/sdk/#app-server

## Canonical Runtime Event Model

This repo does not let provider-native events leak past the adapter boundary.

Instead it maps everything into `ProviderRuntimeEvent`.

That canonical event space includes:

- session lifecycle
- thread lifecycle
- turn lifecycle
- item lifecycle
- content streaming
- approvals
- structured user input
- tasks
- warnings/errors
- model reroute / config warnings / account changes / MCP state

Representative event types:

- `session.state.changed`
- `session.exited`
- `thread.started`
- `turn.started`
- `turn.completed`
- `turn.plan.updated`
- `turn.proposed.delta`
- `turn.proposed.completed`
- `turn.diff.updated`
- `item.started`
- `item.updated`
- `item.completed`
- `content.delta`
- `request.opened`
- `request.resolved`
- `user-input.requested`
- `user-input.resolved`
- `task.started`
- `task.progress`
- `task.completed`
- `runtime.warning`
- `runtime.error`

Why this matters:

Codex and Claude will produce very different native event streams. The new app needs a canonical vocabulary like this so the orchestration and UI layers remain stable.

## How Native Codex Events Are Mapped

`CodexAdapter` is the bridge from raw `ProviderEvent` to canonical `ProviderRuntimeEvent`.

Core mapping patterns:

- raw approval requests -> `request.opened`
- approval response -> `request.resolved`
- `item/tool/requestUserInput` -> `user-input.requested`
- user-input answer -> `user-input.resolved`
- `item/agentMessage/delta` -> `content.delta` with `assistant_text`
- reasoning deltas -> `content.delta` with reasoning stream kinds
- `item/plan/delta` -> `turn.proposed.delta`
- plan completion -> `turn.proposed.completed`
- `item/started` / `item/completed` -> canonical item lifecycle
- `turn/plan/updated` -> `turn.plan.updated`
- `turn/diff/updated` -> `turn.diff.updated`
- `turn/completed` -> canonical turn completion with usage / stop reason / model usage / cost
- stderr/provider errors -> `runtime.error` or warning-shaped events

The adapter is doing two jobs:

1. protocol handling
2. semantic normalization

For the new app, keep that split explicit.

Recommended implementation rule:

- provider manager handles transport and request bookkeeping
- provider adapter handles semantic mapping

## Orchestration Model

This repo is effectively event-sourced.

The orchestration layer accepts commands, emits domain events, and maintains a projected read model.

### Client Commands

Examples:

- `thread.create`
- `thread.turn.start`
- `thread.turn.interrupt`
- `thread.approval.respond`
- `thread.user-input.respond`
- `thread.runtime-mode.set`
- `thread.interaction-mode.set`
- `thread.session.stop`
- `thread.checkpoint.revert`

### Internal Commands

Examples:

- `thread.session.set`
- `thread.message.assistant.delta`
- `thread.message.assistant.complete`
- `thread.proposed-plan.upsert`
- `thread.activity.append`
- `thread.turn.diff.complete`

### Domain Events

Examples:

- `thread.message-sent`
- `thread.turn-start-requested`
- `thread.turn-interrupt-requested`
- `thread.approval-response-requested`
- `thread.user-input-response-requested`
- `thread.session-set`
- `thread.activity-appended`
- `thread.proposed-plan-upserted`

The UI does not care which provider produced the output. It reacts to orchestration events and orchestration snapshots.

## Provider Command Reactor

`ProviderCommandReactor` is where orchestration commands become provider actions.

Its responsibilities:

- ensure a provider session exists before sending a turn
- restart or recover session if runtime mode/provider/model changes require it
- resolve working directory from thread/project state
- send turns via `ProviderService`
- interrupt turns
- forward approval responses
- forward user-input responses
- stop provider sessions

It also adds failure activities back into orchestration when provider actions fail.

This is important because it keeps provider failures visible in the same timeline model the UI already understands.

For the new app, a similar reactor should exist even if the internal architecture changes.

## Provider Runtime Ingestion

`ProviderRuntimeIngestion` is one of the most important parts of the system.

It consumes canonical runtime events and turns them into stable chat/session state.

Responsibilities include:

- update thread session lifecycle
- buffer and flush assistant deltas
- finalize assistant messages
- guard against wrong-turn lifecycle events
- accumulate proposed plan markdown from deltas
- finalize plans on completion or turn end
- convert runtime events into user-facing activities
- clear buffered state when sessions exit

### Assistant Message Strategy

Assistant text is not blindly appended to the UI on every provider delta.

This repo supports two delivery modes:

- `buffered`
- `streaming`

In buffered mode:

- deltas are accumulated in memory
- large buffers can spill
- final message completion flushes any remaining text

This is done to keep UI behavior predictable and memory bounded.

### Lifecycle Guarding

The ingestion layer explicitly prevents lifecycle corruption when:

- a completion event arrives for a non-active turn
- thread/session lifecycle events arrive mid-turn
- provider omits turn id in some cases

This is a sign of a robust implementation and should be preserved.

### Plan Handling

Plans are modeled separately from assistant text:

- plan deltas are buffered
- finalized plan markdown becomes `proposedPlans`
- live plan step updates become `activities`

That is a good design for any code-agent app where planning and answer text should both be visible.

## Read Model Exposed To The UI

The stable read model contains:

- projects
- threads
- messages
- proposed plans
- activities
- checkpoints
- session
- latest turn metadata

This model is intentionally richer than provider-native threads because it mixes:

- persisted product state
- normalized provider runtime state
- app-level metadata like worktrees and checkpoints

In a new app, the read model should be treated as the product state contract.

## UI Behavior Derived From Activities

The frontend derives several critical UX states from thread activities instead of calling provider APIs directly.

Examples:

- open approvals
- unresolved structured user input
- active plan state
- work log / reasoning timeline
- latest proposed plan

This is a strong design because:

- reconnects are simpler
- UI logic is deterministic
- state is replayable
- provider differences stay backend-only

## Reliability and Failure Invariants

This repo consistently prefers correctness and predictable recovery over convenience.

Important invariants to preserve:

### 1. Backend Owns Provider Lifetime

Never let the renderer own provider child processes or provider-native session state.

### 2. Resume Cursor Is Provider-Specific

The orchestration thread id is not the provider thread id.

The provider session stores a `resumeCursor`, and the provider adapter understands how to use it.

This is mandatory for a multi-provider app.

### 3. Session Recovery Is Explicit

`ProviderService` can:

- adopt an existing live provider session
- restart from persisted `resumeCursor`
- reject impossible recovery

### 4. Provider Failures Become User-Visible Activities

Errors like failed approval replies or failed turn starts are projected into activities instead of disappearing into logs.

### 5. Streaming State Must Be Bounded

Assistant and plan buffering has caps and cleanup behavior.

### 6. Lifecycle Is Guarded Against Out-Of-Order Events

The ingestion layer protects active-turn semantics even when provider event ordering is imperfect.

### 7. Desktop Shell Can Restart Backend

A local desktop app should expect crashes and restarts.

## Current Architecture Limitations

These are important because a new project should fix them deliberately rather than accidentally copying them.

### 1. Provider Kind Is Still Effectively Codex-Only

In contracts:

- `ProviderKind` is currently `Schema.Literal("codex")`

There are UI placeholders for `claudeCode` and `cursor`, but they are not part of the actual backend contracts yet.

### 2. Runtime Mapping Is Codex-Shaped

Many current canonical events are derived specifically from Codex app-server method names and item types.

That is acceptable today, but a new multi-provider implementation should audit which canonical events are truly provider-neutral.

### 3. Interaction Mode Is Implemented Through Codex Collaboration Mode

Current `default` / `plan` interaction mode is encoded by building Codex collaboration-mode payloads plus custom developer instructions.

That is useful, but it is provider-specific behavior hidden behind a provider-neutral name.

For a multi-provider app, preserve the product concept but implement it per-provider.

### 4. Some Features Depend On Codex-Only Operations

Examples:

- rollback through `thread/rollback`
- app-server-native approvals
- app-server-native structured user input
- Codex-specific account and model metadata

A new app must decide which features are:

- universal
- degraded on Claude
- provider-exclusive

## What To Reuse In A New App

These ideas should be reused almost directly:

### A. Process Topology

- desktop shell
- local backend
- renderer over WebSocket RPC + push
- provider child processes owned by backend

### B. Provider Abstraction

- provider manager / session manager
- provider adapter registry
- provider-specific runtime adapter
- provider-neutral canonical event stream

### C. Event-Sourced Orchestration

- commands
- domain events
- projections
- snapshot query
- event replay

### D. UI Data Contract

- UI built on read model, not provider stream
- approvals/user-input/work-log derived from activities

### E. Reliability Bias

- session recovery
- guarded lifecycle
- bounded buffers
- surfaced errors

## What Should Change In The New App

### 1. Make ProviderKind Truly Multi-Provider

Change the provider contract model from Codex-only to something like:

- `codex`
- `claude-code`

Potentially later:

- `cursor`
- `gemini-cli`
- internal adapters

### 2. Separate Product Concepts From Provider Concepts

Product-level concepts:

- thread
- turn
- approval
- user input request
- message stream
- plan
- work log
- interrupt
- session

Provider-level concepts:

- Codex app-server thread/turn/item
- Claude SDK session / query / tool permission / response item stream

The new app should map provider semantics into product semantics.

### 3. Build A Capability Matrix

Every provider adapter should expose capabilities such as:

- session model switch mode
- interrupt support
- resume support
- approval request support
- structured user input support
- rollback support
- plan stream support
- diff stream support
- detached review support

Then orchestration and UI can degrade gracefully.

### 4. Keep Native Event Logs

This repo logs native and canonical events separately. That is valuable for debugging protocol drift and provider bugs.

A new app should keep:

- provider-native event logs
- canonical runtime event logs
- orchestration event log

## Recommended Target Architecture For The New App

This section is the recommended design, using this repo as reference but adjusting for Codex + Claude Code.

### Layer 1: Desktop Runtime

Responsibilities:

- launch local backend
- supervise and restart backend
- expose backend connection info to renderer
- provide OS integrations

Keep this thin.

### Layer 2: Backend API

Expose only:

- command/query RPC
- event subscriptions
- file/terminal/git helpers as needed

Do not expose raw provider transport directly to the renderer.

### Layer 3: Orchestration Core

Core domains:

- projects/workspaces
- threads
- turns
- provider sessions
- timeline activities
- plans
- approvals
- checkpoints / diffs

Responsibilities:

- accept UI commands
- persist events
- drive provider actions
- build read model
- replay history

### Layer 4: Provider Runtime Adapters

Per provider:

- native transport management
- native request bookkeeping
- provider-native resume mechanics
- canonical runtime event mapping
- capability reporting

### Layer 5: Projection / UX State

Responsibilities:

- transform runtime events into product state
- enforce lifecycle invariants
- derive pending approvals and pending user input
- buffer stream content
- expose stable thread/session/timeline view

## Codex Adapter Requirements For New App

The Codex adapter should implement behavior equivalent to the current repo:

- spawn `codex app-server`
- initialize and acknowledge handshake
- start/resume/fork threads
- send turns with text and image attachments
- support interrupt
- support approval responses
- support structured user input responses
- support thread read
- support rollback if product wants it
- normalize model and service tier
- support plan/default interaction modes through provider-specific collaboration mode
- capture stderr and classify errors
- persist provider resume cursor

## Claude Code Adapter Requirements For New App

Claude Code should **not** be forced into the Codex protocol shape at the transport layer.

Instead:

- implement a Claude-specific adapter
- expose the same canonical runtime event model
- report its true capabilities

At minimum the Claude adapter should aim to support:

- start/resume session
- send prompt/user turn
- stream assistant content
- interrupt/cancel if supported
- permission gating / tool authorization if supported
- map tool activity into work-log/tool lifecycle events
- map session continuity into provider `resumeCursor`

Expected differences from Codex:

- no app-server thread/turn/item protocol parity
- different approval semantics
- potentially different structure for tool permission and streaming items
- possibly no exact equivalent for rollback, plan events, or thread read

Because of this, the adapter must translate native Claude SDK responses into canonical events such as:

- `session.state.changed`
- `turn.started`
- `content.delta`
- `item.started`
- `item.completed`
- `request.opened`
- `request.resolved`
- `runtime.error`

If Claude cannot produce some concepts directly, the adapter or orchestration layer may synthesize minimal equivalents where appropriate.

## Canonical Concepts The New App Should Keep

These concepts are worth keeping exactly because they are product-level and provider-neutral:

### Thread

User-facing conversation identity owned by the app.

### Provider Session

Runtime binding between app thread and provider-native session/thread identity.

### Resume Cursor

Opaque provider-owned continuation token or session/thread identifier.

### Turn

One user prompt and resulting agent work.

### Message

Rendered chat text from user or assistant.

### Activity

Non-message work timeline entry:

- tool started
- tool updated
- approval requested
- user input requested
- runtime warning
- runtime error
- plan updated
- task progress

### Proposed Plan

Markdown artifact representing plan/proposal output separate from assistant answer text.

### Checkpoint / Diff

Optional but useful if the product includes git/worktree awareness.

## Suggested Contracts For The New App

The new app should define these layers explicitly:

### Provider Session Contract

Fields:

- provider
- session status
- workspace cwd
- chosen model
- provider resume cursor
- active provider turn/session run id
- last error
- capabilities snapshot if useful

### Provider Adapter Contract

Methods:

- `startSession`
- `sendTurn`
- `interruptTurn`
- `respondToRequest`
- `respondToUserInput`
- `stopSession`
- `listSessions`
- `hasSession`
- optional `readThread`
- optional `rollbackThread`
- `streamEvents`
- `getCapabilities`

### Canonical Runtime Event Contract

Must cover:

- session lifecycle
- turn lifecycle
- content stream
- tool lifecycle
- approvals
- user input
- provider warnings/errors

Avoid leaking provider-native names into the canonical type system except as optional raw metadata.

### Orchestration Commands

Keep high-level commands like:

- create thread
- send user turn
- interrupt active turn
- answer approval
- answer user input
- change runtime mode
- change interaction mode
- stop session

### Read Model

The renderer should consume:

- thread list
- thread details
- messages
- activities
- proposed plans
- pending approvals
- pending user input
- current session status
- current turn timing

## Implementation Sequence Recommended For A New Project

### Phase 1: Codex-Only Skeleton With Correct Boundaries

Implement:

- desktop shell
- backend transport
- orchestration command/query/event model
- Codex adapter
- basic read model
- chat UI

Do this first so the architecture is proven before multi-provider work.

### Phase 2: Generalize Provider Contracts

Refactor:

- `ProviderKind`
- provider capabilities
- canonical runtime event payload assumptions
- session persistence schema

This should happen before adding Claude.

### Phase 3: Claude Code Adapter

Implement Claude-specific adapter with capability-based degradation.

### Phase 4: Product Features

Add only after both adapters are stable:

- richer plans
- reviews
- worktrees
- checkpoints
- diff UX
- remote backend / daemon mode

## Non-Negotiable Design Rules For The New App

1. Do not couple UI to provider-native protocol.
2. Do not let provider child processes be owned by the renderer.
3. Do not assume orchestration thread ids equal provider thread ids.
4. Do not assume all providers support the same interruption/resume/approval model.
5. Do not stream raw deltas straight to product state without bounded buffering and completion logic.
6. Do not hide provider failures in logs only; project them into user-visible activity state.
7. Do not make provider-specific fields first-class in the read model unless they are clearly namespaced metadata.

## Concrete Lessons From CodexMonitor

CodexMonitor is a useful reference for desktop product shape, not for protocol truth.

Useful takeaways:

- desktop-native app framing
- workspace-centric organization
- multiple thread/session management
- approvals and stream/event UX patterns
- explicit app-server event coverage tracking

Less useful as direct protocol source:

- it intentionally supports only a subset of Codex app-server
- it uses its own Tauri/Rust stack and product assumptions

Use it as a UX / packaging reference, not as the main protocol authority.

Reference:

- https://github.com/Dimillian/CodexMonitor

## External References Another Agent Should Read

### Codex

- Official app-server docs:
  - https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md
- OpenAI Codex repo:
  - https://github.com/openai/codex
- OpenAI developer docs:
  - https://developers.openai.com/codex/sdk/#app-server

### Claude Code / Agent SDK

- Claude Agent SDK docs:
  - https://platform.claude.com/docs/en/agent-sdk/typescript
- Claude Code SDK docs entry:
  - https://docs.anthropic.com/en/docs/claude-code/sdk

The implementation should treat these as provider-specific input documents, not as the app architecture.

## Direct Instructions To A Future Implementing Agent

If you are using this document to build the new app:

1. Recreate the boundary structure first:
   - desktop shell
   - backend service
   - provider adapters
   - orchestration core
   - read model
   - renderer
2. Implement Codex first using the current repo as the strongest runtime reference.
3. Generalize contracts before adding Claude.
4. Add Claude as a separate adapter, not as a fake Codex transport.
5. Preserve the canonical runtime event model and projection pipeline idea even if names change.
6. Keep logs and replayability.
7. Prefer correctness and deterministic recovery over optimistic streaming shortcuts.

## Practical Mapping From This Repo To A New Multi-Provider App

### Reuse Conceptually

- `apps/desktop/src/main.ts`
  - backend supervision model
- `apps/server/src/codexAppServerManager.ts`
  - provider process and JSON-RPC bookkeeping model
- `apps/server/src/provider/Layers/CodexAdapter.ts`
  - native-to-canonical mapping pattern
- `apps/server/src/provider/Layers/ProviderService.ts`
  - session routing / recovery model
- `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
  - command-to-provider routing model
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`
  - stream buffering and lifecycle projection model
- `packages/contracts/src/providerRuntime.ts`
  - canonical event vocabulary
- `packages/contracts/src/orchestration.ts`
  - command/event/read-model model

### Do Not Reuse Literally Without Refactor

- `ProviderKind` as Codex-only literal
- Codex-specific model normalization assumptions
- Codex-specific interaction mode implementation details
- any place where provider-native names are treated as universal product concepts

## Final Recommendation

The best way to build the new app is:

- copy the architecture shape of this repo
- keep orchestration and read model as the product core
- treat Codex and Claude Code as interchangeable backends behind adapters
- allow provider capability differences explicitly instead of hiding them

That approach will make the app:

- easier to extend
- easier to debug
- more reliable under reconnects and crashes
- less likely to become permanently coupled to Codex-specific transport semantics
