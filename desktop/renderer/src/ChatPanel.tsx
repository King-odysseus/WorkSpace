/*
 * The conversation: one business's threads, its replies, and what the assistant has
 * been told about it.
 *
 * The screen is an arrangement. Every sentence a person reads that could be wrong -
 * which model an answer is attributed to, whether a cloud request was rewritten, what
 * a failure means, what order remembered items are shown in - is decided in
 * `chat-screen.ts`, where it is tested without a browser. This file decides only
 * layout, which call goes where, and when.
 *
 * Five rules are load-bearing and easy to lose in a rewrite.
 *
 * 1. *A business switch empties the screen before it fetches.* Clearing and then
 *    loading, rather than loading and then replacing, is what stops one business's
 *    conversation being on screen while another business's rows arrive. The clear is
 *    synchronous, in the same event that sees the new workspace id.
 *
 * 2. *An event is appended only to the turn and thread it belongs to.* A reply that
 *    outlives a business switch still carries the old thread's id, so `eventBelongsTo`
 *    is asked about both before anything is appended. The main process already
 *    refuses to publish such an event; this is the second half of the same rule, at
 *    the point where a list is appended to.
 *
 * 3. *The composer's availability comes from one function.* Four reasons, in the
 *    order a person meets them, produced by `composerState`. A button drawn from four
 *    inline conditions eventually disagrees with its own explanation.
 *
 * 4. *A draft is not an action.* The cards offer approve, edit and reject, and the
 *    note under every card says what approving does: records a decision. There is no
 *    call on this screen that creates, sends or schedules anything, and no import
 *    here that could make one.
 *
 * 5. *Nothing is claimed that was not recorded.* Attribution comes from the stored
 *    row, the fallback line says none is configured, and sources say there are none
 *    yet. Each of those is a true sentence about this phase; a screen that stayed
 *    silent about them would read as though the question did not apply.
 *
 * The stylesheet is shared and this screen only adds geometry to it, scoped by
 * `data-shell`, because the application's token sheet pins control shapes with
 * `!important` and the chat surface is drawn as pills and rounded bubbles.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import type { AccessState } from '../../features/copilot/shared/access-contract.js'
import type { ChatEvent, PayloadPreviewReply } from '../../features/copilot/shared/chat-contract.js'
import { CHAT_FAILURE_MESSAGES } from '../../features/copilot/shared/chat-contract.js'
import type {
  MemoryRow,
  MessageRow,
  ProposalRow,
  ThreadRow,
} from '../../features/copilot/shared/storage-contract.js'
import type { ProviderEntry } from '../../features/copilot/shared/providers/settings-contract.js'
import type { ModelInfo } from '../../features/copilot/shared/providers/types.js'
import {
  answerAttribution,
  chosenModelLabel,
  composerState,
  eventBelongsTo,
  failureSentence,
  isEditedItem,
  MEMORY_LOCALITY_NOTE,
  memoryCount,
  memorySections,
  NO_FALLBACK_NOTE,
  NO_MODEL_CHOSEN,
  NO_SOURCES_NOTE,
  pickerModels,
  privacyView,
  proposalCard,
  pendingProposals,
  threadRows,
  type PickerModel,
  type TurnState,
} from '../../features/copilot/shared/chat-screen.js'

/** What the preload's replies look like: a value, or a refusal with a token. */
interface Refusal {
  readonly failure: string
  readonly message: string
}

/** The bridge as this file uses it. Optional, because a browser has none. */
function chatBridge (): Window['zuriChats'] {
  return typeof window === 'undefined' ? undefined : window.zuriChats
}

function providerBridge (): Window['zuriProviders'] {
  return typeof window === 'undefined' ? undefined : window.zuriProviders
}

/**
 * A reply, or the refusal it carries.
 *
 * A successful reply is the value itself; a refused one has `ok: false` and a token.
 * Strict schemas on both sides mean a success never carries an `ok` field, so this
 * one check is enough to tell them apart without narrowing a union the renderer does
 * not otherwise parse.
 */
function refusalOf (reply: unknown): Refusal | null {
  if (reply === null || typeof reply !== 'object') return null
  const candidate = reply as { ok?: unknown; failure?: unknown; message?: unknown }
  if (candidate.ok !== false) return null
  return {
    failure: typeof candidate.failure === 'string' ? candidate.failure : 'invalid_request',
    message: typeof candidate.message === 'string' ? candidate.message : '',
  }
}

/** The failure sentence for a token, from the contract's own table. */
function sentenceFor (token: string): string {
  return failureSentence(CHAT_FAILURE_MESSAGES as unknown as Record<string, string>, token)
}

/* ------------------------------------------------------------------ *
 * Small pieces
 * ------------------------------------------------------------------ */

function SendIcon () {
  return (
    <Glyph>
      <path d="M4 20 20 12 4 4l3 8-3 8Z" />
    </Glyph>
  )
}

function StopIcon () {
  return (
    <Glyph>
      <rect x="6" y="6" width="12" height="12" />
    </Glyph>
  )
}

function SearchIcon () {
  return (
    <Glyph>
      <circle cx="11" cy="11" r="6" />
      <path d="m16 16 4 4" />
    </Glyph>
  )
}

function PinIcon ({ filled }: { filled: boolean }) {
  return (
    <Glyph>
      <path d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5Z" fill={filled ? 'currentColor' : 'none'} />
      <path d="M12 14v6" />
    </Glyph>
  )
}

function Glyph ({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}

/**
 * One button on this screen.
 *
 * `data-icon-only` is stated rather than guessed: the stylesheet draws an icon-only
 * button as a circle and a labelled one as a pill, and a glyph can come from a font, a
 * span or an svg, so "has no text child" is not a way to ask.
 */
function ActionButton ({
  children,
  onClick,
  disabled,
  iconOnly,
  title,
  primary,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  iconOnly?: boolean
  title?: string
  primary?: boolean
}) {
  const shape = iconOnly === true ? 'h-9 w-9' : 'px-4 py-2 text-sm font-medium'
  const tone = primary
    ? 'bg-navy text-text-on-navy hover:bg-navy-hover'
    : 'bg-surface-secondary text-text-primary hover:bg-surface-hover'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled === true}
      title={title}
      aria-label={iconOnly === true ? title : undefined}
      data-icon-only={iconOnly === true ? 'true' : 'false'}
      className={`inline-flex shrink-0 items-center justify-center gap-2 ${shape} ${tone} disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {children}
    </button>
  )
}

/** A heading over a group of things, with a count so the group's size is visible. */
function GroupHeading ({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
      {children}
      {count === undefined ? null : <span className="ml-1 font-normal">({count})</span>}
    </p>
  )
}

/* ------------------------------------------------------------------ *
 * The screen
 * ------------------------------------------------------------------ */

export interface ChatPanelProps {
  /** Who is signed in and which businesses they may use, from the access store. */
  readonly access: AccessState
  /** Switch the assistant to another business, through the access bridge. */
  readonly onSelectWorkspace: (workspaceId: number) => void
  /** True in the 360px dock, where the side panels become toggles. */
  readonly compact: boolean
}

export function ChatPanel ({ access, onSelectWorkspace, compact }: ChatPanelProps) {
  const signedIn = access.status === 'ready' && access.selectedWorkspaceId !== null

  const [threads, setThreads] = useState<ThreadRow[]>([])
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [memory, setMemory] = useState<MemoryRow[]>([])
  const [proposals, setProposals] = useState<ProposalRow[]>([])
  const [search, setSearch] = useState('')

  const [providers, setProviders] = useState<ProviderEntry[]>([])
  const [presetId, setPresetId] = useState<string | null>(null)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [modelId, setModelId] = useState<string | null>(null)
  const [modelsFailure, setModelsFailure] = useState<string | null>(null)

  const [text, setText] = useState('')
  const [turn, setTurn] = useState<TurnState | null>(null)
  const [streamed, setStreamed] = useState('')
  const [failure, setFailure] = useState<Refusal | null>(null)
  const [retryText, setRetryText] = useState<string | null>(null)
  const [preview, setPreview] = useState<PayloadPreviewReply | null>(null)
  const [closing, setClosing] = useState(false)

  const [editingMemory, setEditingMemory] = useState<string | null>(null)
  const [memoryDraft, setMemoryDraft] = useState('')
  const [editingProposal, setEditingProposal] = useState<string | null>(null)
  const [proposalTitle, setProposalTitle] = useState('')
  const [proposalNotes, setProposalNotes] = useState('')
  const [proposalDue, setProposalDue] = useState('')

  const [memoryOpen, setMemoryOpen] = useState(!compact)

  /** Which workspace the rows on screen belong to, so a late reply can be told apart. */
  const loadedWorkspace = useRef<number | null>(null)
  const turnRef = useRef<TurnState | null>(null)
  turnRef.current = turn

  const workspaceId = access.selectedWorkspaceId
  const usable = useMemo(
    () => access.workspaces.filter(workspace => workspace.granted),
    [access.workspaces],
  )

  /** Everything that belongs to the business currently on screen. */
  const clearBusiness = useCallback(() => {
    setThreads([])
    setSelectedThreadId(null)
    setMessages([])
    setMemory([])
    setProposals([])
    setFailure(null)
    setRetryText(null)
    setPreview(null)
    setTurn(null)
    setStreamed('')
    setEditingMemory(null)
    setEditingProposal(null)
  }, [])

  /* ---------------------------------------------------------------- *
   * Loading
   * ---------------------------------------------------------------- */

  const loadThreads = useCallback(async (needle: string) => {
    const bridge = chatBridge()
    if (bridge === undefined) return
    const reply = await bridge.listThreads(needle.trim().length > 0 ? { search: needle.trim() } : {})
    if (refusalOf(reply) !== null) return
    const rows = (reply as { threads?: ThreadRow[] }).threads ?? []
    setThreads(rows)
    // Keep the open thread open if it survived the search, and otherwise open the
    // newest one: a screen that jumped to "no conversation" on every search would
    // lose the place the person was reading.
    setSelectedThreadId(current => {
      if (current !== null && rows.some(row => row.id === current)) return current
      return rows.length > 0 ? (rows[0]?.id ?? null) : null
    })
  }, [])

  const loadMemory = useCallback(async () => {
    const bridge = chatBridge()
    if (bridge === undefined) return
    const reply = await bridge.listMemory({})
    if (refusalOf(reply) !== null) return
    setMemory((reply as { memory?: MemoryRow[] }).memory ?? [])
  }, [])

  const loadProposals = useCallback(async () => {
    const bridge = chatBridge()
    if (bridge === undefined) return
    const reply = await bridge.listProposals({})
    if (refusalOf(reply) !== null) return
    setProposals((reply as { proposals?: ProposalRow[] }).proposals ?? [])
  }, [])

  const loadMessages = useCallback(async (threadId: string) => {
    const bridge = chatBridge()
    if (bridge === undefined) return
    const reply = await bridge.listMessages({ threadId })
    if (refusalOf(reply) !== null) {
      setMessages([])
      return
    }
    setMessages((reply as { messages?: MessageRow[] }).messages ?? [])
  }, [])

  const loadProviders = useCallback(async (identityId: number) => {
    const bridge = providerBridge()
    if (bridge === undefined) return
    const reply = await bridge.readState()
    if (reply === null || typeof reply !== 'object' || (reply as { ok?: unknown }).ok !== true) return
    const value = (reply as { value?: { providers?: ProviderEntry[] } }).value
    const entries = value?.providers ?? []
    setProviders(entries)
    /*
     * The first provider that could actually answer is chosen, and only one is
     * loaded: listing every configured endpoint's models on mount would be one
     * network call per provider every time the screen opens.
     */
    const usableEntry = entries.find(entry => entry.baseUrl.trim().length > 0 && (!entry.requiresKey || entry.hasCredential))
    if (usableEntry === undefined) {
      setPresetId(null)
      setModels([])
      setModelId(null)
      return
    }
    setPresetId(usableEntry.presetId)
    setModelId(usableEntry.defaultModel.trim().length > 0 ? usableEntry.defaultModel : null)
    void loadModels(usableEntry.presetId, identityId)
  }, [])

  const loadModels = useCallback(async (preset: string, _identityId: number) => {
    const bridge = providerBridge()
    if (bridge === undefined) return
    setModelsFailure(null)
    const reply = await bridge.listModels(preset)
    if (reply === null || typeof reply !== 'object' || (reply as { ok?: unknown }).ok !== true) {
      setModels([])
      setModelsFailure('The model list could not be read. Open Models to check this provider.')
      return
    }
    const value = (reply as { value?: { models?: ModelInfo[] } }).value
    const listed = value?.models ?? []
    setModels(listed)
    setModelId(current => {
      if (current !== null && listed.some(model => model.id === current)) return current
      return listed.length > 0 ? (listed[0]?.id ?? null) : null
    })
  }, [])

  /* A business switch empties the screen first, then loads what belongs to the new
   * one. The clear is synchronous, so there is no frame where the previous business's
   * conversation is drawn under the new business's name. */
  useEffect(() => {
    if (!signedIn || workspaceId === null) {
      loadedWorkspace.current = null
      clearBusiness()
      setProviders([])
      setPresetId(null)
      setModels([])
      setModelId(null)
      return
    }
    if (loadedWorkspace.current === workspaceId) return
    loadedWorkspace.current = workspaceId
    clearBusiness()
    void loadThreads('')
    void loadMemory()
    void loadProposals()
  }, [signedIn, workspaceId, clearBusiness, loadThreads, loadMemory, loadProposals])

  /* Providers are the person's, not the business's, so they are read when the signed
   * in person changes rather than on every switch. */
  const identityId = access.identity?.id ?? null
  useEffect(() => {
    if (!signedIn || identityId === null) {
      setProviders([])
      setPresetId(null)
      setModels([])
      setModelId(null)
      return
    }
    void loadProviders(identityId)
  }, [signedIn, identityId, loadProviders])

  /* Search is applied on a short delay so a typed word does not cost a request per
   * keystroke, while still feeling immediate. */
  useEffect(() => {
    if (!signedIn || workspaceId === null) return
    const handle = setTimeout(() => { void loadThreads(search) }, 200)
    return () => clearTimeout(handle)
  }, [search, signedIn, workspaceId, loadThreads])

  useEffect(() => {
    if (selectedThreadId === null) {
      setMessages([])
      return
    }
    void loadMessages(selectedThreadId)
  }, [selectedThreadId, loadMessages])

  /* ---------------------------------------------------------------- *
   * Events
   * ---------------------------------------------------------------- */

  useEffect(() => {
    const bridge = chatBridge()
    if (bridge === undefined) return
    const stop = bridge.onEvent((raw) => {
      const event = raw as ChatEvent
      const current = turnRef.current
      /* The thread check is what stops a reply from the business that was left from
       * being appended to the business now on screen. */
      if (!eventBelongsTo(current, selectedThreadId ?? '', event)) return

      if (event.type === 'delta') {
        setStreamed(previous => previous + event.text)
        return
      }

      if (event.type === 'done') {
        setMessages(previous => [...previous, event.message])
        setStreamed('')
        setTurn(null)
        setFailure(null)
        setRetryText(null)
        void loadThreads(search)
        void loadMemory()
        void loadProposals()
        return
      }

      setStreamed('')
      setTurn(null)
      setFailure({ failure: event.failure, message: sentenceFor(event.failure) })
      /*
       * The words of the turn that was running, not the composer's contents.
       *
       * The composer was emptied when the turn was sent, so reading `text` here gave
       * an empty string and "Try again" called send(''), which quietly did nothing.
       * `current` is the turn captured above, before it was cleared, so its own text
       * is the only reliable record of what the person asked.
       */
      setRetryText(event.retryable ? (current?.text ?? null) : null)
    })
    return stop
    /* `text` is deliberately absent: the handler now reads the failed turn, so
     * depending on the composer would re-subscribe on every keystroke. */
  }, [selectedThreadId, search, loadThreads, loadMemory, loadProposals])

  /* ---------------------------------------------------------------- *
   * What a cloud request would send
   * ---------------------------------------------------------------- */

  useEffect(() => {
    const bridge = chatBridge()
    if (bridge === undefined) return
    /*
     * The same two values the send uses: the composer's words trimmed, and the model
     * that would answer. A preview taken from untrimmed text, or without the model,
     * describes a request the send does not make - the budget is sized from the
     * model, and a leading newline is part of the text that leaves.
     */
    const body = text.trim()
    if (selectedThreadId === null || presetId === null || body.length === 0) {
      setPreview(null)
      return
    }
    let live = true
    const handle = setTimeout(() => {
      void bridge.payloadPreview({
        threadId: selectedThreadId,
        presetId,
        text: body,
        ...(modelId === null ? {} : { modelId }),
      })
        .then((reply) => {
          if (!live) return
          if (refusalOf(reply) !== null) {
            setPreview(null)
            return
          }
          setPreview(reply as PayloadPreviewReply)
        })
    }, 250)
    return () => {
      live = false
      clearTimeout(handle)
    }
    /* `modelId` is a dependency because it changes the budget, and a budget change
     * changes the list. */
  }, [selectedThreadId, presetId, modelId, text])

  /* ---------------------------------------------------------------- *
   * Actions
   * ---------------------------------------------------------------- */

  const chosenModel = useMemo<PickerModel | null>(() => {
    if (presetId === null || modelId === null) return null
    const listed = pickerModels(presetId, models)
    return listed.find(model => model.id === modelId) ?? null
  }, [presetId, modelId, models])

  const busy = turn !== null
  const composer = composerState({ text, busy, signedIn, hasBusiness: workspaceId !== null })

  async function ensureThread (): Promise<string | null> {
    if (selectedThreadId !== null) return selectedThreadId
    const bridge = chatBridge()
    if (bridge === undefined) return null
    const reply = await bridge.createThread({})
    if (refusalOf(reply) !== null) {
      setFailure(refusalOf(reply))
      return null
    }
    const thread = (reply as { thread?: ThreadRow }).thread
    if (thread === undefined) return null
    setThreads(previous => [thread, ...previous])
    setSelectedThreadId(thread.id)
    setMessages([])
    return thread.id
  }

  async function send (raw: string) {
    const body = raw.trim()
    if (body.length === 0 || presetId === null) return
    const threadId = await ensureThread()
    if (threadId === null) return
    const bridge = chatBridge()
    if (bridge === undefined) return

    setFailure(null)
    setRetryText(null)
    setStreamed('')
    const reply = await bridge.sendMessage({
      threadId,
      text: body,
      presetId,
      ...(modelId === null ? {} : { modelId }),
    })
    const refusal = refusalOf(reply)
    if (refusal !== null) {
      setFailure(refusal)
      return
    }
    const answered = reply as { turnId?: string; threadId?: string; userMessage?: MessageRow }
    if (answered.turnId === undefined || answered.userMessage === undefined) return
    setTurn({ turnId: answered.turnId, threadId, text: body })
    setMessages(previous => [...previous, answered.userMessage as MessageRow])
    setText('')
  }

  async function stop () {
    if (turn === null) return
    const bridge = chatBridge()
    if (bridge === undefined) return
    await bridge.cancelTurn({ threadId: turn.threadId })
  }

  async function closeThread () {
    if (selectedThreadId === null) return
    const bridge = chatBridge()
    if (bridge === undefined) return
    setClosing(true)
    const reply = await bridge.closeThread({ threadId: selectedThreadId })
    setClosing(false)
    if (refusalOf(reply) !== null) {
      setFailure(refusalOf(reply))
      return
    }
    void loadThreads(search)
    void loadMemory()
    void loadProposals()
  }

  async function pin (row: ThreadRow) {
    const bridge = chatBridge()
    if (bridge === undefined) return
    const reply = await bridge.pinThread({ threadId: row.id, pinned: !row.pinned })
    if (refusalOf(reply) !== null) return
    void loadThreads(search)
  }

  async function saveMemory (memoryId: string) {
    const bridge = chatBridge()
    if (bridge === undefined) return
    const reply = await bridge.editMemory({ memoryId, text: memoryDraft.trim() })
    if (refusalOf(reply) !== null) {
      setFailure(refusalOf(reply))
      return
    }
    setEditingMemory(null)
    setMemoryDraft('')
    void loadMemory()
  }

  async function forgetMemory (memoryId: string) {
    const bridge = chatBridge()
    if (bridge === undefined) return
    const reply = await bridge.removeMemory({ memoryId })
    if (refusalOf(reply) !== null) {
      setFailure(refusalOf(reply))
      return
    }
    void loadMemory()
  }

  async function decideProposal (proposalId: string, status: 'approved' | 'rejected') {
    const bridge = chatBridge()
    if (bridge === undefined) return
    const reply = await bridge.setProposalStatus({ proposalId, status })
    if (refusalOf(reply) !== null) {
      setFailure(refusalOf(reply))
      return
    }
    void loadProposals()
  }

  async function saveProposal (proposalId: string) {
    const bridge = chatBridge()
    if (bridge === undefined) return
    const reply = await bridge.editProposal({
      proposalId,
      title: proposalTitle.trim(),
      notes: proposalNotes.trim(),
      dueHint: proposalDue.trim(),
    })
    if (refusalOf(reply) !== null) {
      setFailure(refusalOf(reply))
      return
    }
    setEditingProposal(null)
    void loadProposals()
  }

  /* ---------------------------------------------------------------- *
   * Drawing
   * ---------------------------------------------------------------- */

  if (chatBridge() === undefined) {
    return (
      <div data-shell="chat-screen" className="flex min-h-0 flex-1 items-center justify-center bg-surface px-6 py-10">
        <p className="max-w-sm text-center text-sm text-text-secondary">
          The conversation needs the desktop app. This page cannot reach it from a browser.
        </p>
      </div>
    )
  }

  const sections = memorySections(memory)
  const drafts = pendingProposals(proposals)
  const decided = proposals.filter(row => row.status !== 'pending')
  const overlay = privacyView(preview)
  const listedThreads = threadRows(threads)

  return (
    <div
      data-shell="chat-screen"
      data-chat-state={busy ? 'busy' : failure !== null ? 'error' : 'idle'}
      data-chat-bridge="present"
      className="flex min-h-0 min-w-0 flex-1"
    >
      {compact ? null : (
        <ThreadRail
          rows={listedThreads}
          selectedId={selectedThreadId}
          search={search}
          onSearch={setSearch}
          onSelect={setSelectedThreadId}
          onPin={pin}
        />
      )}

      <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
        <header className="flex flex-wrap items-center gap-2 px-4 py-3">
          <BusinessSwitcher
            workspaces={access.workspaces}
            selectedId={workspaceId}
            onSelect={onSelectWorkspace}
          />

          {/*
            Remembered items sit beside the business they belong to, because that is
            the scope they are kept in: switching business switches the count. The
            label carries the number rather than a bare digit, since a lone number on
            a button is a puzzle rather than a control.
          */}
          <ActionButton
            title={memoryOpen ? 'Hide remembered items' : 'Show remembered items'}
            onClick={() => { setMemoryOpen(open => !open) }}
          >
            Remembered {memoryCount(memory)}
          </ActionButton>

          {compact ? (
            <select
              aria-label="Conversation"
              className="min-w-0 flex-1 px-3 py-2 text-sm text-text-primary"
              value={selectedThreadId ?? ''}
              onChange={(event) => setSelectedThreadId(event.target.value === '' ? null : event.target.value)}
            >
              <option value="">New conversation</option>
              {listedThreads.map(row => (
                <option key={row.id} value={row.id}>{row.label}</option>
              ))}
            </select>
          ) : null}

          <ModelPicker
            providers={providers}
            presetId={presetId}
            onProvider={(next) => {
              setPresetId(next)
              setModels([])
              setModelId(null)
              if (identityId !== null) void loadModels(next, identityId)
            }}
            models={pickerModels(presetId ?? '', models)}
            modelId={modelId}
            onModel={setModelId}
            failure={modelsFailure}
          />

          {chosenModel !== null && chosenModel.cloud === false ? (
            <span className="bg-surface-secondary px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
              Local only
            </span>
          ) : null}
        </header>

        {compact && memoryOpen ? (
          <MemoryRail
            sections={sections}
            drafts={drafts}
            decided={decided}
            total={memoryCount(memory)}
            editingMemory={editingMemory}
            memoryDraft={memoryDraft}
            onDraft={setMemoryDraft}
            onEditStart={(row) => { setEditingMemory(row.id); setMemoryDraft(row.text) }}
            onEditCancel={() => { setEditingMemory(null); setMemoryDraft('') }}
            onEditSave={saveMemory}
            onForget={forgetMemory}
            editingProposal={editingProposal}
            proposalTitle={proposalTitle}
            proposalNotes={proposalNotes}
            proposalDue={proposalDue}
            onProposalDraft={(field, value) => {
              if (field === 'title') setProposalTitle(value)
              if (field === 'notes') setProposalNotes(value)
              if (field === 'due') setProposalDue(value)
            }}
            onProposalEditStart={(row) => {
              const card = proposalCard(row)
              setEditingProposal(row.id)
              setProposalTitle(card.title)
              setProposalNotes(card.notes ?? '')
              setProposalDue(card.dueHint ?? '')
            }}
            onProposalEditCancel={() => setEditingProposal(null)}
            onProposalEditSave={saveProposal}
            onDecide={decideProposal}
          />
        ) : (
          <>
            <Conversation
              messages={messages}
              streaming={busy ? streamed : null}
              streamingModel={chosenModel === null ? null : { id: chosenModel.id, cloud: chosenModel.cloud }}
              signedIn={signedIn}
              threadChosen={selectedThreadId !== null}
            />

            {failure === null ? null : (
              <div className="mx-4 mb-2 flex flex-wrap items-center gap-2 bg-alert-danger-fill px-3 py-2">
                <p className="min-w-0 flex-1 text-xs text-alert-danger-text">{sentenceFor(failure.failure)}</p>
                {retryText === null ? null : (
                  <ActionButton
                    onClick={() => { void send(retryText) }}
                  >
                    Try again
                  </ActionButton>
                )}
              </div>
            )}

            <footer className="px-4 pb-4">
              {text.trim().length > 0 ? (
                <p className="mb-2 px-1 text-[11px] text-text-muted" data-privacy-tone={overlay.tone}>
                  <span className="font-semibold text-text-secondary">{overlay.headline}.</span>{' '}
                  {overlay.detail}
                </p>
              ) : null}

              <div className="flex items-end gap-2">
                <textarea
                  aria-label="Message"
                  data-composer="true"
                  rows={1}
                  value={text}
                  disabled={!signedIn}
                  onChange={(event) => setText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      if (composer.canSend) void send(text)
                    }
                  }}
                  placeholder={signedIn ? 'Ask about this business' : 'Sign in to send a message'}
                  className="min-h-[44px] min-w-0 flex-1 resize-none px-4 py-3 text-sm text-text-primary placeholder:text-text-muted"
                />
                {busy ? (
                  <ActionButton iconOnly title="Stop" onClick={() => { void stop() }}>
                    <StopIcon />
                  </ActionButton>
                ) : (
                  <ActionButton
                    iconOnly
                    primary
                    title="Send"
                    disabled={!composer.canSend || presetId === null}
                    onClick={() => { void send(text) }}
                  >
                    <SendIcon />
                  </ActionButton>
                )}
              </div>

              <p className="mt-2 px-1 text-[11px] text-text-muted">
                {presetId === null
                  ? 'Set up a provider in Models before sending anything.'
                  : composer.hint ?? (closing ? 'Settling this conversation.' : 'Enter sends. Shift and Enter starts a new line.')}
              </p>

              {selectedThreadId === null ? null : (
                <p className="mt-1 px-1">
                  <button
                    type="button"
                    onClick={() => { void closeThread() }}
                    disabled={closing || busy}
                    className="px-3 py-1 text-[11px] text-text-secondary hover:text-text-primary disabled:opacity-50"
                  >
                    {compact ? 'Close and settle' : 'Close conversation and settle what it taught'}
                  </button>
                </p>
              )}
            </footer>
          </>
        )}
      </section>

      {memoryOpen && !compact ? (
        <MemoryRail
          sections={sections}
          drafts={drafts}
          decided={decided}
          total={memoryCount(memory)}
          editingMemory={editingMemory}
          memoryDraft={memoryDraft}
          onDraft={setMemoryDraft}
          onEditStart={(row) => { setEditingMemory(row.id); setMemoryDraft(row.text) }}
          onEditCancel={() => { setEditingMemory(null); setMemoryDraft('') }}
          onEditSave={saveMemory}
          onForget={forgetMemory}
          editingProposal={editingProposal}
          proposalTitle={proposalTitle}
          proposalNotes={proposalNotes}
          proposalDue={proposalDue}
          onProposalDraft={(field, value) => {
            if (field === 'title') setProposalTitle(value)
            if (field === 'notes') setProposalNotes(value)
            if (field === 'due') setProposalDue(value)
          }}
          onProposalEditStart={(row) => {
            const card = proposalCard(row)
            setEditingProposal(row.id)
            setProposalTitle(card.title)
            setProposalNotes(card.notes ?? '')
            setProposalDue(card.dueHint ?? '')
          }}
          onProposalEditCancel={() => setEditingProposal(null)}
          onProposalEditSave={saveProposal}
          onDecide={decideProposal}
        />
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * The thread rail
 * ------------------------------------------------------------------ */

function ThreadRail ({
  rows,
  selectedId,
  search,
  onSearch,
  onSelect,
  onPin,
}: {
  rows: ReturnType<typeof threadRows>
  selectedId: string | null
  search: string
  onSearch: (value: string) => void
  onSelect: (threadId: string) => void
  onPin: (row: ThreadRow) => void
}) {
  return (
    <aside className="flex w-[210px] shrink-0 flex-col gap-3 bg-surface-secondary px-3 py-3">
      <label className="flex items-center gap-2 bg-surface px-3 py-2">
        <span className="text-text-muted"><SearchIcon /></span>
        <input
          type="search"
          value={search}
          aria-label="Search conversations"
          placeholder="Search"
          onChange={(event) => onSearch(event.target.value)}
          className="min-w-0 flex-1 bg-transparent px-1 py-1 text-sm text-text-primary placeholder:text-text-muted"
        />
      </label>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <p className="px-1 py-2 text-xs text-text-muted">No conversations yet. Send a message to start one.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {rows.map(row => (
              <li key={row.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onSelect(row.id)}
                  aria-current={row.id === selectedId ? 'true' : undefined}
                  className={`min-w-0 flex-1 px-3 py-2 text-left ${row.id === selectedId ? 'bg-surface text-text-primary' : 'text-text-secondary hover:bg-surface-hover'}`}
                >
                  <span className="block truncate text-sm">{row.label}</span>
                  <span className="mt-0.5 block text-[11px] text-text-muted">
                    {row.when}
                    {row.messageCount > 0 ? ` - ${row.messageCount}` : ''}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onPin({ id: row.id } as ThreadRow)}
                  title={row.pinned ? 'Unpin' : 'Pin'}
                  aria-label={row.pinned ? 'Unpin conversation' : 'Pin conversation'}
                  aria-pressed={row.pinned}
                  data-icon-only="true"
                  className={`grid h-7 w-7 shrink-0 place-items-center ${row.pinned ? 'text-text-primary' : 'text-text-muted'}`}
                >
                  <PinIcon filled={row.pinned} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}

/* ------------------------------------------------------------------ *
 * The business switcher
 * ------------------------------------------------------------------ */

/**
 * Which business the assistant is working in.
 *
 * Only a workspace the person may actually use is selectable. One they manage without
 * the grant is listed and disabled with the reason, because hiding it would leave them
 * wondering why a workspace they know they own is missing from the assistant.
 */
function BusinessSwitcher ({
  workspaces,
  selectedId,
  onSelect,
}: {
  workspaces: AccessState['workspaces']
  selectedId: number | null
  onSelect: (workspaceId: number) => void
}) {
  if (workspaces.length === 0) {
    return <p className="text-sm text-text-secondary">No business is available.</p>
  }

  return (
    <label className="flex min-w-0 items-center gap-2">
      <span className="sr-only">Business</span>
      <select
        aria-label="Business"
        value={selectedId ?? ''}
        onChange={(event) => onSelect(Number(event.target.value))}
        className="max-w-[220px] px-3 py-2 text-sm font-medium text-text-primary"
      >
        {workspaces.map(workspace => (
          <option key={workspace.id} value={workspace.id} disabled={!workspace.granted}>
            {workspace.granted ? workspace.name : `${workspace.name} (ask an owner)`}
          </option>
        ))}
      </select>
    </label>
  )
}

/* ------------------------------------------------------------------ *
 * The model picker
 * ------------------------------------------------------------------ */

/**
 * Which provider and model answer this conversation.
 *
 * The provider is chosen first, because the model list belongs to it and a picker that
 * offered every model from every provider would be offering models it had not read.
 * The chip beside each model is the provider's own answer about where it runs, not a
 * guess from the provider's name.
 */
function ModelPicker ({
  providers,
  presetId,
  onProvider,
  models,
  modelId,
  onModel,
  failure,
}: {
  providers: ProviderEntry[]
  presetId: string | null
  onProvider: (presetId: string) => void
  models: PickerModel[]
  modelId: string | null
  onModel: (modelId: string) => void
  failure: string | null
}) {
  if (providers.length === 0) {
    return (
      <p className="text-[11px] text-text-muted">No provider set up. Add one in Models.</p>
    )
  }

  const chosen = models.find(model => model.id === modelId) ?? null

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <select
        aria-label="Provider"
        value={presetId ?? ''}
        onChange={(event) => onProvider(event.target.value)}
        className="max-w-[170px] px-3 py-2 text-sm text-text-primary"
      >
        {providers.map(entry => (
          <option key={entry.presetId} value={entry.presetId}>{entry.label}</option>
        ))}
      </select>

      <select
        aria-label="Model"
        value={modelId ?? ''}
        onChange={(event) => onModel(event.target.value)}
        className="max-w-[200px] px-3 py-2 text-sm text-text-primary"
      >
        <option value="">{NO_MODEL_CHOSEN}</option>
        {models.map(model => (
          <option key={model.id} value={model.id}>{model.label}</option>
        ))}
      </select>

      {chosen === null ? null : (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="bg-surface-secondary px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
            {chosen.originLabel}
          </span>
          {chosen.chips.map(chip => (
            <span key={chip} className="bg-surface-secondary px-2 py-1 text-[11px] text-text-muted">{chip}</span>
          ))}
        </span>
      )}

      {failure === null ? null : (
        <span className="text-[11px] text-alert-danger-text">{failure}</span>
      )}

      {models.length === 0 && failure === null ? (
        <span className="text-[11px] text-text-muted">{chosenModelLabel(null)}</span>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * The conversation
 * ------------------------------------------------------------------ */

function Conversation ({
  messages,
  streaming,
  streamingModel,
  signedIn,
  threadChosen,
}: {
  messages: MessageRow[]
  streaming: string | null
  streamingModel: { id: string; cloud: boolean } | null
  signedIn: boolean
  threadChosen: boolean
}) {
  if (!signedIn) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6">
        <p className="text-sm text-text-secondary">Sign in to talk to the assistant.</p>
      </div>
    )
  }

  const empty = messages.length === 0 && streaming === null

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-2">
      {empty ? (
        <div className="flex h-full items-center justify-center px-6 text-center">
          <p className="max-w-sm text-sm text-text-secondary">
            {threadChosen
              ? 'Nothing said in this conversation yet. Ask about the business and the answer will be kept here.'
              : 'Ask about a client, a quote or what was decided. What the assistant learns is kept for this business only.'}
          </p>
        </div>
      ) : (
        <ol className="flex flex-col gap-3">
          {messages.map(message => (
            <MessageRowView key={message.id} message={message} />
          ))}
          {streaming === null ? null : (
            <WaitingRow text={streaming} model={streamingModel} />
          )}
        </ol>
      )}
    </div>
  )
}

function MessageRowView ({ message }: { message: MessageRow }) {
  const mine = message.role === 'user'

  if (mine) {
    return (
      <li className="flex justify-end">
        <p
          data-bubble="user"
          className="max-w-[85%] whitespace-pre-wrap break-words bg-navy px-4 py-2 text-sm text-text-on-navy"
        >
          {message.content}
        </p>
      </li>
    )
  }

  if (message.role === 'system') {
    return (
      <li className="flex justify-center">
        <p className="max-w-[85%] text-center text-[11px] text-text-muted">{message.content}</p>
      </li>
    )
  }

  const attribution = answerAttribution(message)

  return (
    <li className="flex flex-col items-start gap-1">
      <p
        data-bubble="assistant"
        className="max-w-[85%] whitespace-pre-wrap break-words bg-surface-secondary px-4 py-2 text-sm text-text-primary"
      >
        {message.content}
      </p>
      <Attribution attribution={attribution} />
    </li>
  )
}

/**
 * The chip and two true sentences under an answer.
 *
 * Attribution comes from the stored row, including its origin: a row that did not
 * record where it ran says so rather than defaulting to the reassuring answer.
 */
function Attribution ({
  attribution,
}: {
  attribution: ReturnType<typeof answerAttribution>
}) {
  return (
    <div className="flex max-w-[85%] flex-col gap-0.5 px-1">
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="bg-surface-secondary px-2 py-0.5 text-[11px] font-medium text-text-secondary">
          {attribution.label}
        </span>
        <span
          data-origin={attribution.origin}
          className="px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted"
        >
          {attribution.originLabel}
        </span>
      </span>
      <span className="text-[11px] text-text-muted">{attribution.note}</span>
      {/* Every answer states the fallback position. Without it a reply that came
        * from the model the person chose reads the same as one that was swapped
        * behind their back, which is the thing this sentence rules out. */}
      <span data-fallback-note="none" className="text-[11px] text-text-muted">{NO_FALLBACK_NOTE}</span>
      <span className="text-[11px] text-text-muted">{NO_SOURCES_NOTE}</span>
    </div>
  )
}

/** The answer that is still arriving, drawn as a bubble that is visibly unfinished. */
function WaitingRow ({ text, model }: { text: string; model: { id: string; cloud: boolean } | null }) {
  const attribution = answerAttribution({
    id: 'streaming',
    threadId: '',
    seq: 0,
    role: 'assistant',
    content: text,
    provider: null,
    model: model === null ? null : model.id,
    cloud: model === null ? null : model.cloud,
    createdAt: '',
  }, true)

  return (
    <li className="flex flex-col items-start gap-1">
      <p
        data-bubble="assistant"
        data-streaming="true"
        className="max-w-[85%] whitespace-pre-wrap break-words bg-surface-secondary px-4 py-2 text-sm text-text-primary"
      >
        {text.length > 0 ? text : 'Thinking.'}
      </p>
      <Attribution attribution={attribution} />
    </li>
  )
}

/* ------------------------------------------------------------------ *
 * The memory rail
 * ------------------------------------------------------------------ */

function MemoryRail ({
  sections,
  drafts,
  decided,
  total,
  editingMemory,
  memoryDraft,
  onDraft,
  onEditStart,
  onEditCancel,
  onEditSave,
  onForget,
  editingProposal,
  proposalTitle,
  proposalNotes,
  proposalDue,
  onProposalDraft,
  onProposalEditStart,
  onProposalEditCancel,
  onProposalEditSave,
  onDecide,
}: {
  sections: ReturnType<typeof memorySections>
  drafts: ProposalRow[]
  decided: ProposalRow[]
  total: number
  editingMemory: string | null
  memoryDraft: string
  onDraft: (value: string) => void
  onEditStart: (row: MemoryRow) => void
  onEditCancel: () => void
  onEditSave: (memoryId: string) => void
  onForget: (memoryId: string) => void
  editingProposal: string | null
  proposalTitle: string
  proposalNotes: string
  proposalDue: string
  onProposalDraft: (field: 'title' | 'notes' | 'due', value: string) => void
  onProposalEditStart: (row: ProposalRow) => void
  onProposalEditCancel: () => void
  onProposalEditSave: (proposalId: string) => void
  onDecide: (proposalId: string, status: 'approved' | 'rejected') => void
}) {
  return (
    <aside className="flex w-[300px] shrink-0 flex-col gap-4 overflow-y-auto bg-surface-secondary px-3 py-3">
      <section className="flex flex-col gap-2">
        <GroupHeading count={total}>What it has been told</GroupHeading>
        <p className="text-[11px] text-text-muted">{MEMORY_LOCALITY_NOTE}</p>

        {sections.length === 0 ? (
          <p className="text-xs text-text-secondary">
            Nothing remembered yet. Decisions and facts are kept here once a conversation settles.
          </p>
        ) : (
          sections.map(section => (
            <div key={section.kind} className="flex flex-col gap-1">
              <GroupHeading count={section.items.length}>{section.label}</GroupHeading>
              <ul className="flex flex-col gap-1">
                {section.items.map(item => (
                  <li key={item.id} className="bg-surface px-3 py-2">
                    {editingMemory === item.id ? (
                      <div className="flex flex-col gap-2">
                        <textarea
                          aria-label="Remembered item"
                          rows={3}
                          value={memoryDraft}
                          onChange={(event) => onDraft(event.target.value)}
                          className="w-full resize-none px-3 py-2 text-sm text-text-primary"
                        />
                        <div className="flex gap-2">
                          <ActionButton onClick={() => onEditSave(item.id)}>Save</ActionButton>
                          <ActionButton onClick={onEditCancel}>Cancel</ActionButton>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm text-text-primary">{item.text}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          {isEditedItem(item) ? (
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                              Your wording
                            </span>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => onEditStart(item)}
                            className="px-2 py-0.5 text-[11px] text-text-secondary hover:text-text-primary"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => onForget(item.id)}
                            className="px-2 py-0.5 text-[11px] text-text-secondary hover:text-text-primary"
                          >
                            Delete
                          </button>
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      <section className="flex flex-col gap-2">
        <GroupHeading count={drafts.length}>Drafted work</GroupHeading>
        {drafts.length === 0 ? (
          <p className="text-xs text-text-secondary">
            Nothing waiting. Ask for something to be done and a draft card appears here.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {drafts.map(row => (
              <li key={row.id}>
                <ProposalCardView
                  proposal={row}
                  editing={editingProposal === row.id}
                  title={proposalTitle}
                  notes={proposalNotes}
                  due={proposalDue}
                  onDraft={onProposalDraft}
                  onEditStart={() => onProposalEditStart(row)}
                  onEditCancel={onProposalEditCancel}
                  onEditSave={() => onProposalEditSave(row.id)}
                  onDecide={(status) => onDecide(row.id, status)}
                />
              </li>
            ))}
          </ul>
        )}

        {decided.length === 0 ? null : (
          <details className="mt-1">
            <summary className="cursor-pointer text-[11px] text-text-muted">
              Decided drafts ({decided.length})
            </summary>
            <ul className="mt-2 flex flex-col gap-1">
              {decided.map(row => {
                const card = proposalCard(row)
                return (
                  <li key={row.id} className="bg-surface px-3 py-2">
                    <p className="text-sm text-text-secondary">{card.title}</p>
                    <p className="mt-0.5 text-[11px] text-text-muted">{card.statusLabel}</p>
                  </li>
                )
              })}
            </ul>
          </details>
        )}
      </section>
    </aside>
  )
}

/**
 * One draft, as a card.
 *
 * The note is part of the card rather than a tooltip, because the single most
 * important thing about this card is what pressing Approve does and does not do.
 */
function ProposalCardView ({
  proposal,
  editing,
  title,
  notes,
  due,
  onDraft,
  onEditStart,
  onEditCancel,
  onEditSave,
  onDecide,
}: {
  proposal: ProposalRow
  editing: boolean
  title: string
  notes: string
  due: string
  onDraft: (field: 'title' | 'notes' | 'due', value: string) => void
  onEditStart: () => void
  onEditCancel: () => void
  onEditSave: () => void
  onDecide: (status: 'approved' | 'rejected') => void
}) {
  const card = proposalCard(proposal)

  if (editing) {
    return (
      <div className="flex flex-col gap-2 bg-surface px-3 py-2" data-proposal={card.id} data-proposal-state="editing">
        <input
          aria-label="Draft title"
          value={title}
          onChange={(event) => onDraft('title', event.target.value)}
          className="w-full px-3 py-2 text-sm text-text-primary"
        />
        <textarea
          aria-label="Draft notes"
          rows={3}
          value={notes}
          onChange={(event) => onDraft('notes', event.target.value)}
          className="w-full resize-none px-3 py-2 text-sm text-text-primary"
        />
        <input
          aria-label="Draft due hint"
          value={due}
          onChange={(event) => onDraft('due', event.target.value)}
          className="w-full px-3 py-2 text-sm text-text-primary"
        />
        <div className="flex gap-2">
          <ActionButton onClick={onEditSave}>Save draft</ActionButton>
          <ActionButton onClick={onEditCancel}>Cancel</ActionButton>
        </div>
        <p className="text-[11px] text-text-muted">{card.note}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 bg-surface px-3 py-2" data-proposal={card.id} data-proposal-state={card.statusLabel.toLowerCase()}>
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm font-medium text-text-primary">{card.title}</p>
        <span className="shrink-0 bg-surface-secondary px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
          {card.statusLabel}
        </span>
      </div>

      {card.notes === null ? null : (
        <p className="text-xs text-text-secondary">{card.notes}</p>
      )}
      {card.dueHint === null ? null : (
        <p className="text-[11px] text-text-muted">Due hint: {card.dueHint}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <ActionButton primary onClick={() => onDecide('approved')}>Approve</ActionButton>
        <ActionButton onClick={onEditStart}>Edit</ActionButton>
        <ActionButton onClick={() => onDecide('rejected')}>Reject</ActionButton>
      </div>

      <p className="text-[11px] text-text-muted" data-executes="false">{card.note}</p>
    </div>
  )
}
