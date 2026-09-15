import { AppSelect } from './ui/select.jsx'
import { Alert } from './ui/alert.jsx'
import { Skeleton, SkeletonGroup } from './ui/skeleton.jsx'
// Channels and direct messages, plus the shared composer modal used for every
// "create a record" flow (events, projects, check-ins, chat, follow-ups, invites).

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Archive, ArchiveRestore, ArrowDown, ArrowUpRight, Check, CheckCheck, Download, FileText, FolderOpen, Hash, Info, MessageSquare, PanelRight, Paperclip, Pencil, Plus, Search, Smile, Trash2, Users, X } from 'lucide-react'
import { Badge } from './ui/badge.jsx'
import Avatar from './Avatar.jsx'
import LinkedText from './LinkedText.jsx'
import { DateField, DateTimeField, SelectField, WorkspaceViewHeading } from './workspace-ui.jsx'
import { PRESENCE_LABEL, effectivePresence, formatDate, formatDay, formatRelativeActivityTime, getCsrfToken, isImageFileName, toDateKey } from '../lib/workspace-format.js'
import { takePendingChatThread, takePendingDirectMessage } from '../lib/chat-navigation.js'

const EMOJI_CATEGORIES = [
  ['Smileys', '😀', ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😋', '😛', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '🥺', '😢', '😭', '😤', '😠', '😡', '🤯', '😳', '🥵', '🥶', '😱', '😨', '🤗', '🤔', '🫡', '🤭', '🫢', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😴', '🤤', '😷', '🤒', '🤕']],
  ['People', '👋', ['👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🫰', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '🫶', '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '👀', '👁️', '🧠', '🫂', '🙋', '🙆', '🙅', '🤷', '🤦', '🧑‍💻', '🧑‍💼', '🧑‍🎨', '🧑‍🔧', '🧑‍🚀']],
  ['Animals', '🐶', ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐻‍❄️', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🙈', '🙉', '🙊', '🐔', '🐧', '🐦', '🦄', '🐝', '🪱', '🐛', '🦋', '🐌', '🐞', '🐢', '🐍', '🦎', '🦖', '🐙', '🦑', '🦀', '🐠', '🐟', '🐬', '🐳', '🦈', '🐊', '🐅', '🐆', '🦓', '🦍', '🐘', '🦒', '🦘', '🐕', '🐈', '🪶', '🌿', '🌵', '🌴', '🌳', '🌻', '🌹', '🌸']],
  ['Food', '🍕', ['🍏', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🥑', '🥦', '🥕', '🌽', '🌶️', '🍄', '🥐', '🥯', '🍞', '🧀', '🥚', '🍳', '🥞', '🧇', '🥓', '🍔', '🍟', '🍕', '🌭', '🥪', '🌮', '🌯', '🥗', '🍝', '🍜', '🍣', '🍱', '🍛', '🍚', '🍦', '🍩', '🍪', '🎂', '🍰', '🍫', '🍿', '☕', '🍵', '🥤', '🧃', '🍺', '🥂']],
  ['Activities', '⚽', ['⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🏓', '🏸', '🥅', '⛳', '🏹', '🎣', '🥊', '🥋', '🎽', '🛹', '🛼', '🛷', '⛸️', '🎿', '🏂', '🏋️', '🤸', '🏊', '🚴', '🏆', '🥇', '🥈', '🥉', '🎯', '🎮', '🕹️', '🎲', '🧩', '🎨', '🎭', '🎤', '🎧', '🎸', '🎹', '🥁', '🎬']],
  ['Travel', '🚀', ['🚗', '🚕', '🚌', '🏎️', '🚓', '🚑', '🚒', '🚐', '🛻', '🚚', '🚜', '🛵', '🏍️', '🚲', '✈️', '🚁', '🚀', '🛸', '🚢', '⛵', '🚤', '🗺️', '🗿', '🗽', '🗼', '🏰', '🏯', '🎡', '🎢', '⛲', '⛺', '🏖️', '🏝️', '🏔️', '🌋', '🏕️', '🌅', '🌄', '🌠', '🌌', '☀️', '🌤️', '⛈️', '🌈', '❄️', '☔', '⚡']],
  ['Objects', '💡', ['⌚', '📱', '💻', '⌨️', '🖥️', '🖨️', '🖱️', '💾', '📷', '📹', '🎥', '☎️', '📺', '📻', '⏰', '⌛', '💡', '🔦', '🕯️', '🧯', '💰', '💳', '💎', '🧰', '🔧', '🔨', '⚙️', '🧲', '🔬', '🔭', '💊', '🩹', '🚪', '🪑', '🎁', '🎈', '📌', '📍', '📎', '✂️', '📝', '✏️', '🔍', '🔐', '🔑', '📣', '🔔', '💬']],
  ['Symbols', '❤️', ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️', '✝️', '☪️', '☯️', '♾️', '⚛️', '✅', '☑️', '✔️', '❌', '❗', '❓', '‼️', '💯', '🔥', '✨', '⭐', '🌟', '💫', '⚡', '💥', '🎉', '🎊', '🚩', '🏁', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪']],
  ['Flags', '🏳️', ['🏳️', '🏴', '🏁', '🚩', '🏳️‍🌈', '🏳️‍⚧️', '🇬🇧', '🇺🇸', '🇨🇦', '🇲🇽', '🇧🇷', '🇦🇷', '🇫🇷', '🇩🇪', '🇪🇸', '🇮🇹', '🇵🇹', '🇳🇱', '🇧🇪', '🇮🇪', '🇳🇴', '🇸🇪', '🇩🇰', '🇫🇮', '🇵🇱', '🇺🇦', '🇬🇷', '🇹🇷', '🇿🇦', '🇳🇬', '🇬🇭', '🇰🇪', '🇪🇬', '🇲🇦', '🇮🇳', '🇵🇰', '🇧🇩', '🇨🇳', '🇯🇵', '🇰🇷', '🇸🇬', '🇵🇭', '🇮🇩', '🇦🇺', '🇳🇿', '🇦🇪', '🇸🇦']],
]

const MESSAGE_REACTIONS = [
  ['👍', 'Like'],
  ['❤️', 'Love'],
  ['😂', 'Laugh'],
  ['🎉', 'Celebrate'],
  ['😮', 'Surprised'],
  ['👏', 'Applause'],
]

const CHAT_COMPOSER_MAX_HEIGHT = 140
const CHAT_HISTORY_PAGE_SIZE = 10
const CHAT_JUMP_THRESHOLD = 320

function renderMessageText(text) {
  return <LinkedText text={text} />
}

function mergeMessagePages(latestMessages, currentMessages) {
  const latestIds = new Set(latestMessages.map(message => message.id))
  return [...latestMessages, ...currentMessages.filter(message => !latestIds.has(message.id))]
    .sort((left, right) => Number(left.id) - Number(right.id))
}

function EmojiPicker({ onSelect, actionLabel = 'Insert' }) {
  const [category, setCategory] = useState(0)
  return <div className="chat-emoji-picker" aria-label="Choose an emoji">
    <div className="chat-emoji-categories" role="tablist" aria-label="Emoji categories">
      {EMOJI_CATEGORIES.map(([label, icon], index) => <button type="button" role="tab" aria-selected={category === index} className={category === index ? 'active' : ''} key={label} title={label} onClick={() => setCategory(index)}><span aria-hidden="true">{icon}</span><small>{label}</small></button>)}
    </div>
    <div className="chat-emoji-grid" role="listbox" aria-label={EMOJI_CATEGORIES[category][0]}>
      {EMOJI_CATEGORIES[category][2].map((emoji, index) => <button type="button" role="option" key={`${emoji}-${index}`} onClick={() => onSelect(emoji)} aria-label={`${actionLabel} ${emoji}`}>{emoji}</button>)}
    </div>
  </div>
}

function getMentionContext(value, caret) {
  const beforeCaret = value.slice(0, caret)
  const match = beforeCaret.match(/(^|\s)@([^\s@]*)$/)
  if (!match) return null
  return {
    start: match.index + match[1].length,
    end: caret,
    query: match[2],
  }
}

function MentionPicker({ members, getMemberName, onSelect }) {
  if (!members.length) return <p className="chat-mention-empty">No matching workspace members.</p>
  return <div className="chat-mention-picker" role="listbox" aria-label="Mention a workspace member">
    {members.map(member => <button type="button" role="option" key={member.id} onClick={() => onSelect(member)} aria-label={`Mention ${getMemberName(member)}`}><strong>{getMemberName(member)}</strong><span>@{(member.email || '').split('@')[0]}</span></button>)}
  </div>
}

function MessageReactionBar({ message, reactions, isMine, onToggle }) {
  const [open, setOpen] = useState(false)
  const availableReactions = MESSAGE_REACTIONS.filter(([emoji]) => !reactions.some(reaction => reaction.emoji === emoji))

  return <div className={`chat-reactions ${reactions.length ? 'has-reactions' : ''} ${open ? 'reaction-picker-open' : ''}`} aria-label="Message reactions">
    {reactions.map(reaction => <button type="button" key={reaction.emoji} className={reaction.reacted ? 'active' : ''} onClick={() => onToggle(message, reaction.emoji)} aria-pressed={reaction.reacted}>{reaction.emoji} {reaction.count}</button>)}
    {availableReactions.map(([emoji, label]) => <button type="button" className="chat-reaction-add" key={emoji} onClick={() => onToggle(message, emoji)} aria-label={`React with ${label}`} title={`React with ${label}`}>{emoji}</button>)}
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild><button type="button" className="chat-reaction-more" aria-label="More reactions" title="More reactions"><Plus size={14} /></button></Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="chat-reaction-picker" side="top" align={isMine ? 'start' : 'end'} sideOffset={8} collisionPadding={12} aria-label={`More reactions for ${message.author_name}`}>
          <EmojiPicker actionLabel="React with" onSelect={emoji => { setOpen(false); onToggle(message, emoji) }} />
          <Popover.Arrow className="chat-reaction-picker-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  </div>
}

function readChatDraft(workspaceId, targetKey) {
  if (!targetKey) return ''
  try {
    return window.localStorage.getItem(`workspace-chat-draft:${workspaceId}:${targetKey}`) || ''
  } catch {
    return ''
  }
}

function writeChatDraft(workspaceId, targetKey, value) {
  if (!targetKey) return
  try {
    const key = `workspace-chat-draft:${workspaceId}:${targetKey}`
    if (value) window.localStorage.setItem(key, value)
    else window.localStorage.removeItem(key)
  } catch {
    // Draft persistence is optional and must never block the composer.
  }
}

function ChatWorkspaceView({ viewType, data, workspaceId, currentUserId, onRefresh, onError, onConfirm, onNavigate, threadRequest = 0 }) {
  const mode = viewType
  const [selectedChannel, setSelectedChannel] = useState('general')
  const [selectedConversationId, setSelectedConversationId] = useState(null)
  const [activePane, setActivePane] = useState('posts')
  const [chatFilter, setChatFilter] = useState('all')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [directMessages, setDirectMessages] = useState([])
  const [directMessageConversationId, setDirectMessageConversationId] = useState(null)
  const [directLoading, setDirectLoading] = useState(false)
  const [directLoadingOlder, setDirectLoadingOlder] = useState(false)
  const [directHistory, setDirectHistory] = useState({ hasMore: false, nextBefore: null })
  const [channelMessages, setChannelMessages] = useState([])
  const [channelMessageName, setChannelMessageName] = useState(null)
  const [channelLoading, setChannelLoading] = useState(false)
  const [channelLoadingOlder, setChannelLoadingOlder] = useState(false)
  const [channelHistory, setChannelHistory] = useState({ hasMore: false, nextBefore: null })
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [channelDialogOpen, setChannelDialogOpen] = useState(false)
  const [directDialogOpen, setDirectDialogOpen] = useState(false)
  const [participantConversation, setParticipantConversation] = useState(null)
  const [groupMemberIds, setGroupMemberIds] = useState([])
  const [shareOpen, setShareOpen] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [profileMember, setProfileMember] = useState(null)
  const [reactionUpdates, setReactionUpdates] = useState({})
  const [messageEdits, setMessageEdits] = useState({})
  const [messageDeletes, setMessageDeletes] = useState({})
  const [editingMessageId, setEditingMessageId] = useState(null)
  const [editDraft, setEditDraft] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const editRequestRef = useRef(null)
  const composerDraft = editingMessageId !== null ? editDraft : draft
  const setComposerDraft = editingMessageId !== null ? setEditDraft : setDraft
  const [workspaceDocuments, setWorkspaceDocuments] = useState([])
  const [workspaceFiles, setWorkspaceFiles] = useState([])
  const [sharedDocumentIds, setSharedDocumentIds] = useState([])
  const [sharedFileIds, setSharedFileIds] = useState([])
  const [uploadingFile, setUploadingFile] = useState(false)
  const [channelForm, setChannelForm] = useState({ name: '', description: '', is_private: false, member_ids: [] })
  const [directMemberIds, setDirectMemberIds] = useState([])
  // Set when a notification names a specific message. `revealMessageId` holds the
  // reader on that message by standing the newest-message pin down, and persists
  // until they pick another thread or send; `highlightMessageId` is only the ring
  // that fades, and is cleared on a timer.
  const [revealMessageId, setRevealMessageId] = useState(null)
  const [highlightMessageId, setHighlightMessageId] = useState(null)
  const [unreadMarker, setUnreadMarker] = useState(null)
  const messageScrollRef = useRef(null)
  const messageInputRef = useRef(null)
  const draftKeyRef = useRef(null)
  const skipNextBottomPinRef = useRef(false)
  const pendingScrollRestoreRef = useRef(null)
  const activeThreadKeyRef = useRef('')
  const historyLoadingRef = useRef({ channel: false, direct: false })
  const replaceWithLatestRef = useRef(false)
  const channels = data.channels || []
  const conversations = data.directConversations || []
  const archivedConversations = data.archivedConversations || []
  const selectedChannelInfo = channels.find(channel => channel.name === selectedChannel)
  // Archived chats are still readable, so the selection has to resolve across
  // both lists - otherwise restoring or archiving while a chat is open would
  // drop the thread out from under the reader.
  const selectedConversation = [...conversations, ...archivedConversations].find(conversation => conversation.id === selectedConversationId)
  const draftKey = mode === 'channels' ? `channel:${selectedChannel}` : selectedConversationId ? `conversation:${selectedConversationId}` : ''

  useEffect(() => {
    setSearch('')
    setReplyTo(null)
    setActivePane('posts')
    setChatFilter('all')
    setDetailsOpen(false)
    setEmojiOpen(false)
    setMentionOpen(false)
    setMentionQuery('')
    setError('')
    setUnreadMarker(null)
    setShowJumpToLatest(false)
  }, [viewType])

  useEffect(() => {
    setEditingMessageId(null)
    setEditDraft('')
    setSavingEdit(false)
    editRequestRef.current = null
    setEmojiOpen(false)
    setMentionOpen(false)
  }, [draftKey, workspaceId])

  useEffect(() => {
    const storedDraft = draftKeyRef.current
    if (!storedDraft || storedDraft.workspaceId !== workspaceId || storedDraft.targetKey !== draftKey) {
      if (storedDraft?.targetKey) writeChatDraft(storedDraft.workspaceId, storedDraft.targetKey, draft)
      setDraft(readChatDraft(workspaceId, draftKey))
      draftKeyRef.current = { workspaceId, targetKey: draftKey }
    } else if (draftKey) {
      writeChatDraft(workspaceId, draftKey, draft)
    }
  }, [draft, draftKey, workspaceId])

  useEffect(() => {
    Promise.all([
      fetch(`/api/workspaces/${workspaceId}/documents/`, { credentials: 'include', headers: { 'X-Workspace-Id': String(workspaceId) } }).then(response => response.json()),
      fetch(`/api/workspaces/${workspaceId}/files/`, { credentials: 'include', headers: { 'X-Workspace-Id': String(workspaceId) } }).then(response => response.json()),
    ]).then(([documents, files]) => { setWorkspaceDocuments(documents.documents || []); setWorkspaceFiles(files.files || []) }).catch(error => console.error('Workspace resources could not be loaded', error))
  }, [workspaceId])

  useEffect(() => {
    if (!selectedConversationId) return undefined
    let current = true
    setDirectLoading(true)
    setError('')
    const historyParams = new URLSearchParams({ limit: String(CHAT_HISTORY_PAGE_SIZE) })
    if (revealMessageId) historyParams.set('around', String(revealMessageId))
    fetch(`/api/direct-conversations/${selectedConversationId}/messages/?${historyParams.toString()}`, { credentials: 'include' })
      .then(response => response.json().then(payload => ({ response, payload })))
      .then(({ response, payload }) => {
        if (!response.ok) throw new Error(payload.error || 'Direct messages could not be loaded.')
        if (current) {
          const newestPage = payload.messages || []
          const sameThread = directMessageConversationId === selectedConversationId
          const replaceWithLatest = replaceWithLatestRef.current
          replaceWithLatestRef.current = false
          const keepLoadedHistory = sameThread && !revealMessageId && !replaceWithLatest
          setDirectMessages(currentMessages => keepLoadedHistory ? mergeMessagePages(newestPage, currentMessages) : newestPage)
          if (!keepLoadedHistory) setDirectHistory({ hasMore: Boolean(payload.has_more), nextBefore: payload.next_before || null })
          setDirectMessageConversationId(selectedConversationId)
        }
      })
      .catch(loadError => { replaceWithLatestRef.current = false; if (current) setError(loadError.message) })
      .finally(() => { if (current) setDirectLoading(false) })
    return () => { current = false }
  }, [selectedConversationId, data.directConversations, data.archivedConversations, revealMessageId])

  // The workspace snapshot is shared across every channel and is capped at the
  // newest 100 messages workspace-wide. That is enough for badges, but it can
  // omit a channel's own post and leave a notification pointing at a message
  // the reader cannot see. A named channel is fetched independently.
  useEffect(() => {
    if (mode !== 'channels' || !selectedChannel) return undefined
    let current = true
    setChannelLoading(true)
    const historyParams = new URLSearchParams({
      channel: selectedChannel,
      limit: String(CHAT_HISTORY_PAGE_SIZE),
    })
    if (revealMessageId) historyParams.set('around', String(revealMessageId))
    fetch(`/api/workspaces/${workspaceId}/chat-messages/?${historyParams.toString()}`, {
      credentials: 'include',
      headers: { 'X-Workspace-Id': String(workspaceId) },
    })
      .then(response => response.json().then(payload => ({ response, payload })))
      .then(({ response, payload }) => {
        if (!response.ok) throw new Error(payload.error || 'Channel messages could not be loaded.')
        if (current) {
          const newestPage = payload.messages || []
          const sameThread = channelMessageName === selectedChannel
          const replaceWithLatest = replaceWithLatestRef.current
          replaceWithLatestRef.current = false
          const keepLoadedHistory = sameThread && !revealMessageId && !replaceWithLatest
          setChannelMessages(currentMessages => keepLoadedHistory ? mergeMessagePages(newestPage, currentMessages) : newestPage)
          if (!keepLoadedHistory) setChannelHistory({ hasMore: Boolean(payload.has_more), nextBefore: payload.next_before || null })
          setChannelMessageName(selectedChannel)
        }
      })
      .catch(loadError => { replaceWithLatestRef.current = false; if (current) setError(loadError.message) })
      .finally(() => { if (current) setChannelLoading(false) })
    return () => { current = false }
  }, [mode, selectedChannel, workspaceId, threadRequest, revealMessageId])

  // Which conversation the fetched messages belong to. The workspace refresh
  // hands back directConversations as a fresh array whenever anything in the
  // workspace changes, including changes with nothing to do with chat, so this
  // fetch re-runs often. Without the id there was no way to tell "I have no
  // messages for this conversation yet" apart from "I am re-fetching the one I
  // am already reading", and every re-run swapped the thread for the loading
  // placeholder.
  const directThreadReady = directMessageConversationId === selectedConversationId
  const channelThreadReady = channelMessageName === selectedChannel
  const activeChannelMessages = channelThreadReady
    ? channelMessages
    : data.messages.filter(message => message.channel === selectedChannel)
  const visibleChannelMessages = activeChannelMessages.filter(message => !search.trim() || `${message.author_name} ${message.message}`.toLowerCase().includes(search.trim().toLowerCase()))
  const visibleDirectMessages = directThreadReady ? directMessages.filter(message => !search.trim() || `${message.author_name} ${message.message}`.toLowerCase().includes(search.trim().toLowerCase())) : []
  const groupedMessages = visibleChannelMessages.reduce((groups, message) => {
    const key = toDateKey(message.created_at)
    ;(groups[key] ||= []).push(message)
    return groups
  }, {})
  const unreadNotificationsFor = (targetType, targetId) => data.notifications.filter(
    notification => notification.target_type === targetType && notification.target_id === String(targetId) && !notification.read,
  )
  const unreadCountFor = (targetType, targetId) => unreadNotificationsFor(targetType, targetId).length
  const notificationMessageId = notification => {
    const match = String(notification.group_key || '').match(/^message:(\d+)$/)
    return match ? Number(match[1]) : null
  }
  const unreadMarkerFor = (targetType, targetId) => {
    const notifications = unreadNotificationsFor(targetType, targetId)
    if (!notifications.length) return null
    const messageIds = notifications.map(notificationMessageId).filter(Number.isFinite)
    return {
      targetType,
      targetId: String(targetId),
      firstMessageId: messageIds.length ? Math.min(...messageIds) : null,
      count: notifications.length,
    }
  }
  const unreadTotal = mode === 'channels'
    ? channels.reduce((total, channel) => total + unreadCountFor('chat_channel', channel.name), 0)
    : conversations.reduce((total, conversation) => total + unreadCountFor('direct_conversation', conversation.id), 0)
  const filteredChannels = chatFilter === 'unread' ? channels.filter(channel => unreadCountFor('chat_channel', channel.name) > 0) : channels
  const filteredConversations = chatFilter === 'unread' ? conversations.filter(conversation => unreadCountFor('direct_conversation', conversation.id) > 0) : conversations
  const groupConversations = filteredConversations.filter(conversation => conversation.is_group)
  const directConversations = filteredConversations.filter(conversation => !conversation.is_group)
  const activeMessages = mode === 'channels'
    ? activeChannelMessages
    : directThreadReady ? directMessages : []
  const sharedItems = activeMessages.flatMap(message => {
    if (message.deleted_at) return []
    const files = (message.shared_files || []).map(file => ({
      key: `file-${message.id}-${file.id}`,
      kind: 'file',
      id: file.id,
      title: file.original_name || 'Shared file',
      url: file.url,
      author: message.author_name,
      created_at: message.created_at,
    }))
    const documents = (message.shared_documents || []).map(document => ({
      key: `document-${message.id}-${document.id}`,
      kind: 'document',
      id: document.id,
      title: document.title || 'Shared document',
      url: '',
      author: message.author_name,
      created_at: message.created_at,
    }))
    return [...files, ...documents]
  })
  const selectedParticipantIds = selectedConversation
    ? [...new Set([...(selectedConversation.participants || []).map(participant => String(participant.id)), String(currentUserId)])]
    : (selectedChannelInfo?.is_private ? selectedChannelInfo.member_ids || [] : data.members.map(member => member.id))
  const selectedMembers = selectedParticipantIds
    .map(id => data.members.find(member => String(member.id) === String(id)))
    .filter(Boolean)

  const lastChannelMessageId = visibleChannelMessages.length ? visibleChannelMessages[visibleChannelMessages.length - 1].id : null
  const lastDirectMessageId = visibleDirectMessages.length ? visibleDirectMessages[visibleDirectMessages.length - 1].id : null
  const activeThreadType = mode === 'channels' ? 'chat_channel' : 'direct_conversation'
  const activeThreadId = mode === 'channels' ? selectedChannel : selectedConversationId
  const activeThreadKey = `${mode}:${activeThreadId ?? ''}`
  activeThreadKeyRef.current = activeThreadKey
  const activeUnreadMarker = unreadMarker && unreadMarker.targetType === activeThreadType && String(unreadMarker.targetId) === String(activeThreadId)
    ? unreadMarker
    : null
  const firstUnreadMessageId = activeUnreadMarker?.firstMessageId ?? null

  // Pin the feed to the newest message by scrolling the feed element itself.
  // scrollIntoView also scrolls every scrollable ancestor, which made the whole
  // page jump instead of simply revealing the message that was just sent. The
  // pin stands down while an alert is holding the reader on an older message,
  // and again while that message fades, or the pin would yank them away from it.
  useLayoutEffect(() => {
    const scroller = messageScrollRef.current
    if (!scroller || revealMessageId) return
    if (skipNextBottomPinRef.current) {
      skipNextBottomPinRef.current = false
      return
    }
    scroller.scrollTop = scroller.scrollHeight
    setShowJumpToLatest(false)
  }, [mode, selectedChannel, selectedConversationId, activePane, directLoading, lastChannelMessageId, lastDirectMessageId, visibleChannelMessages.length, visibleDirectMessages.length, revealMessageId])

  // Prepending changes the scroller's height. Adding the height delta to the old
  // scrollTop keeps the message the reader was looking at under the same pixel,
  // instead of letting the browser reveal the newly inserted history above it.
  useLayoutEffect(() => {
    const restore = pendingScrollRestoreRef.current
    if (!restore) return
    const scroller = messageScrollRef.current
    if (!scroller) {
      pendingScrollRestoreRef.current = null
      return
    }
    scroller.scrollTop = restore.scrollTop + (scroller.scrollHeight - restore.scrollHeight)
    pendingScrollRestoreRef.current = null
    setShowJumpToLatest(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > CHAT_JUMP_THRESHOLD)
  }, [activeMessages.length, mode, selectedChannel, selectedConversationId])

  // Keep the composer compact for a single line, then grow it only as the draft
  // wraps. The element height is reset first so deleting lines can shrink it too.
  useLayoutEffect(() => {
    const input = messageInputRef.current
    if (!input) return
    input.style.height = 'auto'
    const nextHeight = Math.min(input.scrollHeight, CHAT_COMPOSER_MAX_HEIGHT)
    if (!nextHeight) return
    input.style.height = `${nextHeight}px`
    input.style.overflowY = input.scrollHeight > CHAT_COMPOSER_MAX_HEIGHT ? 'auto' : 'hidden'
  }, [composerDraft, mode, selectedChannel, selectedConversationId, activePane])

  // Bring the alerted message into view in the middle of the feed, the same way
  // the pin scrolls the feed element rather than calling scrollIntoView. Re-runs
  // without effect when the target is not in the feed yet, which is the normal
  // case for a direct conversation: the thread is still being fetched, and the
  // message count changing is what brings it back here.
  useLayoutEffect(() => {
    const scroller = messageScrollRef.current
    if (!scroller || !revealMessageId) return
    const target = scroller.querySelector(`[data-message-id="${revealMessageId}"]`)
    if (!target) return
    const scrollerBox = scroller.getBoundingClientRect()
    const targetBox = target.getBoundingClientRect()
    scroller.scrollTop += targetBox.top - scrollerBox.top - (scrollerBox.height - targetBox.height) / 2
    setShowJumpToLatest(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > CHAT_JUMP_THRESHOLD)
  }, [revealMessageId, highlightMessageId, activeMessages.length, directLoading, channelLoading, activePane, mode, selectedChannel, selectedConversationId])

  // The ring is a "this is the one" cue, not a state to stay in, so it clears on
  // its own and leaves the reader where they were.
  useEffect(() => {
    if (!highlightMessageId) return undefined
    const timer = setTimeout(() => setHighlightMessageId(null), 2500)
    return () => clearTimeout(timer)
  }, [highlightMessageId])

  const submitChannelMessage = async event => {
    event.preventDefault()
    const hasAttachments = sharedDocumentIds.length > 0 || sharedFileIds.length > 0
    const messageText = draft.trim() || (hasAttachments ? 'Shared an attachment' : '')
    if (!messageText || submitting || uploadingFile) return
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/chat-messages/`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken(), 'X-Workspace-Id': String(workspaceId) },
        body: JSON.stringify({ channel: selectedChannel, message: messageText, parent_id: replyTo?.id || null, document_ids: sharedDocumentIds, file_ids: sharedFileIds }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Message could not be sent.')
      setChannelMessages(current => channelMessageName === selectedChannel ? [...current, payload.message] : [payload.message])
      setChannelMessageName(selectedChannel)
      setDraft('')
      setReplyTo(null)
      setSharedDocumentIds([]); setSharedFileIds([]); setShareOpen(false)
      setEmojiOpen(false)
      // Sending is the clearest sign the reader is done with the alerted message,
      // so the pin takes the feed back to the newest one.
      setRevealMessageId(null)
      onRefresh()
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setSubmitting(false)
    }
  }

  const submitDirectMessage = async event => {
    event.preventDefault()
    const hasAttachments = sharedDocumentIds.length > 0 || sharedFileIds.length > 0
    const messageText = draft.trim() || (hasAttachments ? 'Shared an attachment' : '')
    if (!selectedConversation || !messageText || submitting || uploadingFile) return
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch(`/api/direct-conversations/${selectedConversation.id}/messages/`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() },
        body: JSON.stringify({ message: messageText, parent_id: replyTo?.id || null, document_ids: sharedDocumentIds, file_ids: sharedFileIds }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Message could not be sent.')
      setDirectMessages(current => [...current, payload.message])
      setDraft('')
      setReplyTo(null)
      setSharedDocumentIds([]); setSharedFileIds([]); setShareOpen(false)
      setEmojiOpen(false)
      setRevealMessageId(null)
      onRefresh()
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setSubmitting(false)
    }
  }

  const createChannel = async event => {
    event.preventDefault()
    if (!channelForm.name.trim() || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/chat-channels/`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken(), 'X-Workspace-Id': String(workspaceId) },
        body: JSON.stringify(channelForm),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Channel could not be created.')
      setSelectedChannel(payload.channel.name)
      setChannelForm({ name: '', description: '', is_private: false, member_ids: [] })
      setChannelDialogOpen(false)
      window.dispatchEvent(new CustomEvent('workspace:notice', { detail: `#${payload.channel.name} created.` }))
      onRefresh()
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setSubmitting(false)
    }
  }

  const openDirectConversation = async memberIds => {
    if (!memberIds.length || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/direct-conversations/`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken(), 'X-Workspace-Id': String(workspaceId) },
        body: JSON.stringify({ participant_ids: memberIds }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Conversation could not be created.')
      setSelectedConversationId(payload.conversation.id)
      setDirectMemberIds([])
      setDirectDialogOpen(false)
      onRefresh()
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setSubmitting(false)
    }
  }
  const createDirectConversation = async event => { event.preventDefault(); await openDirectConversation(directMemberIds) }
  // Today and the Team board hand a target over here instead of firing a window
  // event, because this view is lazy-loaded and mounts after the click, so the
  // event used to arrive before this effect had registered a listener.
  useEffect(() => {
    const memberId = Number(takePendingDirectMessage())
    if (memberId && memberId !== Number(currentUserId)) openDirectConversation([memberId])
  }, [currentUserId, workspaceId, submitting])
  // A notification names the thread it is about, so opening the alert has to
  // land on that thread and not just on this view. `threadRequest` is a counter
  // the shell bumps on every open, which also covers the case where the reader
  // is already on this view: a prop change re-runs the effect, where a mount-only
  // effect would have been skipped. When the alert also names the message, this
  // is what points the feed at it; the scrolling happens further down, once that
  // message is actually in the feed.
  useEffect(() => {
    const thread = takePendingChatThread()
    if (!thread) return
    if (thread.targetType === 'chat_channel') selectChannel(thread.targetId)
    else selectConversation(Number(thread.targetId))
    setRevealMessageId(thread.messageId || null)
    setHighlightMessageId(thread.messageId || null)
  }, [threadRequest, workspaceId])

  const deleteChannel = async channel => {
    if (!(await onConfirm(`Delete #${channel.name} and all of its messages?`, { title: 'Delete channel', confirmLabel: 'Delete channel' }))) return
    try {
      const response = await fetch(`/api/chat-channels/${channel.id}/`, { method: 'DELETE', credentials: 'include', headers: { 'X-CSRFToken': await getCsrfToken() } })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Channel could not be deleted.')
      setSelectedChannel('general')
      onRefresh()
    } catch (deleteError) {
      onError(deleteError.message)
    }
  }

  const closeConversationIfOpen = conversationId => {
    if (selectedConversationId !== conversationId) return
    setSelectedConversationId(null)
    setDirectMessages([])
    setDirectMessageConversationId(null)
    setUnreadMarker(null)
  }

  const archiveConversation = async conversation => {
    const confirmed = await onConfirm(
      'Move this chat to Archived? It disappears from everyone in the chat, and only a restore brings it back.',
      { title: 'Archive chat', confirmLabel: 'Archive chat' },
    )
    if (!confirmed) return
    try {
      const response = await fetch(`/api/direct-conversations/${conversation.id}/`, {
        method: 'DELETE', credentials: 'include', headers: { 'X-CSRFToken': await getCsrfToken() },
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Chat could not be archived.')
      closeConversationIfOpen(conversation.id)
      onRefresh()
    } catch (archiveError) {
      onError(archiveError.message)
    }
  }

  const deleteConversation = async conversation => {
    const confirmed = await onConfirm(
      'Delete this conversation and all of its messages for everyone? This cannot be undone.',
      { title: 'Delete chat', confirmLabel: 'Delete conversation' },
    )
    if (!confirmed) return
    try {
      const response = await fetch(`/api/direct-conversations/${conversation.id}/delete/`, {
        method: 'DELETE', credentials: 'include', headers: { 'X-CSRFToken': await getCsrfToken() },
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Conversation could not be deleted.')
      closeConversationIfOpen(conversation.id)
      onRefresh()
    } catch (deleteError) {
      onError(deleteError.message)
    }
  }

  const restoreConversation = async conversation => {
    try {
      const response = await fetch(`/api/direct-conversations/${conversation.id}/restore/`, {
        method: 'POST', credentials: 'include', headers: { 'X-CSRFToken': await getCsrfToken() },
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Chat could not be restored.')
      onRefresh()
    } catch (restoreError) {
      onError(restoreError.message)
    }
  }

  const openParticipantEditor = conversation => {
    setParticipantConversation(conversation)
    setGroupMemberIds((conversation.participants || [])
      .filter(participant => String(participant.id) !== String(currentUserId))
      .map(participant => Number(participant.id)))
    setError('')
  }

  const saveGroupParticipants = async event => {
    event.preventDefault()
    if (!participantConversation || groupMemberIds.length < 1 || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch(`/api/direct-conversations/${participantConversation.id}/`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() },
        body: JSON.stringify({ participant_ids: groupMemberIds }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Participants could not be updated.')
      setParticipantConversation(null)
      setGroupMemberIds([])
      onRefresh()
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSubmitting(false)
    }
  }

  const memberName = member => [member.first_name, member.last_name].filter(Boolean).join(' ') || member.email
  const currentMember = data.members.find(member => String(member.id) === String(currentUserId))
  const memberForMessage = message => data.members.find(member => String(member.id) === String(message.author_id)) || { id: message.author_id, email: message.author_name, role: 'member' }
  const directOtherMember = conversation => {
    if (conversation.is_group || conversation.is_self) return null
    const other = (conversation.participants || []).find(participant => String(participant.id) !== String(currentUserId))
    return data.members.find(member => String(member.id) === String(other?.id)) || null
  }
  const toggleMember = (id, selectedIds, updateSelectedIds) => updateSelectedIds(selectedIds.includes(id) ? selectedIds.filter(value => value !== id) : [...selectedIds, id])
  const toggleDirectMember = id => {
    const isSelf = String(id) === String(currentUserId)
    setDirectMemberIds(selectedIds => {
      const selected = selectedIds.some(value => String(value) === String(id))
      if (isSelf) return selected ? [] : [currentUserId]
      const withoutSelf = selectedIds.filter(value => String(value) !== String(currentUserId))
      return selected ? withoutSelf.filter(value => String(value) !== String(id)) : [...withoutSelf, id]
    })
  }
  const insertEmoji = emoji => {
    const input = messageInputRef.current
    const start = input?.selectionStart ?? composerDraft.length
    const end = input?.selectionEnd ?? start
    const nextDraft = `${composerDraft.slice(0, start)}${emoji}${composerDraft.slice(end)}`
    setComposerDraft(nextDraft.slice(0, 4000))
    setEmojiOpen(false)
    requestAnimationFrame(() => {
      const cursor = Math.min(start + emoji.length, 4000)
      messageInputRef.current?.focus()
      messageInputRef.current?.setSelectionRange(cursor, cursor)
    })
  }
  const insertMention = member => {
    const input = messageInputRef.current
    const start = input?.selectionStart ?? composerDraft.length
    const end = input?.selectionEnd ?? start
    const context = getMentionContext(composerDraft, start)
    const replaceStart = context?.start ?? start
    const replaceEnd = context?.end ?? end
    const alias = (member.email || memberName(member)).split('@')[0].trim().toLowerCase().replace(/\s+/g, '')
    const prefix = !context && start && !/\s/.test(composerDraft[start - 1]) ? ' ' : ''
    const mention = `${prefix}@${alias} `
    setComposerDraft(`${composerDraft.slice(0, replaceStart)}${mention}${composerDraft.slice(replaceEnd)}`.slice(0, 4000))
    setMentionOpen(false)
    setMentionQuery('')
    requestAnimationFrame(() => {
      const cursor = Math.min(replaceStart + mention.length, 4000)
      messageInputRef.current?.focus()
      messageInputRef.current?.setSelectionRange(cursor, cursor)
    })
  }
  const normalizedMentionQuery = mentionQuery.trim().toLowerCase()
  const mentionMembers = data.members.filter(member => {
    if (String(member.id) === String(currentUserId)) return false
    if (!normalizedMentionQuery) return true
    const alias = (member.email || '').split('@')[0].toLowerCase()
    return memberName(member).toLowerCase().includes(normalizedMentionQuery) || alias.includes(normalizedMentionQuery)
  })
  const markConversationRead = async (targetType, targetId) => {
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/notifications/`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken(), 'X-Workspace-Id': String(workspaceId) },
        body: JSON.stringify({ target_type: targetType, target_id: String(targetId) }),
      })
      if (response.ok) {
        window.dispatchEvent(new Event('workspace:notifications-changed'))
        onRefresh()
      }
    } catch (readError) { console.warn('Chat notifications could not be marked read.', readError) }
  }
  const captureUnreadMarker = (targetType, targetId) => setUnreadMarker(unreadMarkerFor(targetType, targetId))
  const loadOlderMessages = async () => {
    const isChannel = mode === 'channels'
    const historyKey = isChannel ? 'channel' : 'direct'
    const history = isChannel ? channelHistory : directHistory
    const loadingOlder = isChannel ? channelLoadingOlder : directLoadingOlder
    if (!history.hasMore || !history.nextBefore || loadingOlder || historyLoadingRef.current[historyKey]) return
    historyLoadingRef.current[historyKey] = true
    const threadKey = activeThreadKeyRef.current
    const scroller = messageScrollRef.current
    if (scroller) {
      pendingScrollRestoreRef.current = {
        scrollHeight: scroller.scrollHeight,
        scrollTop: scroller.scrollTop,
      }
    }
    if (isChannel) setChannelLoadingOlder(true)
    else setDirectLoadingOlder(true)
    setError('')
    try {
      const historyParams = new URLSearchParams({
        before: String(history.nextBefore),
        limit: String(CHAT_HISTORY_PAGE_SIZE),
      })
      let response
      if (isChannel) {
        historyParams.set('channel', selectedChannel)
        response = await fetch(`/api/workspaces/${workspaceId}/chat-messages/?${historyParams.toString()}`, {
          credentials: 'include',
          headers: { 'X-Workspace-Id': String(workspaceId) },
        })
      } else {
        response = await fetch(`/api/direct-conversations/${selectedConversationId}/messages/?${historyParams.toString()}`, { credentials: 'include' })
      }
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Older messages could not be loaded.')
      if (threadKey !== activeThreadKeyRef.current) return
      const olderMessages = payload.messages || []
      const prependUnique = current => {
        const existingIds = new Set(current.map(message => message.id))
        return [...olderMessages.filter(message => !existingIds.has(message.id)), ...current]
      }
      if (isChannel) {
        if (olderMessages.length) skipNextBottomPinRef.current = true
        else pendingScrollRestoreRef.current = null
        setChannelMessages(prependUnique)
        setChannelHistory({ hasMore: Boolean(payload.has_more), nextBefore: payload.next_before || null })
      } else {
        if (olderMessages.length) skipNextBottomPinRef.current = true
        else pendingScrollRestoreRef.current = null
        setDirectMessages(prependUnique)
        setDirectHistory({ hasMore: Boolean(payload.has_more), nextBefore: payload.next_before || null })
      }
    } catch (historyError) {
      pendingScrollRestoreRef.current = null
      if (threadKey === activeThreadKeyRef.current) setError(historyError.message)
    } finally {
      historyLoadingRef.current[historyKey] = false
      if (isChannel) setChannelLoadingOlder(false)
      else setDirectLoadingOlder(false)
    }
  }
  const handleMessageScroll = event => {
    const scroller = event.currentTarget
    const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
    setShowJumpToLatest(distanceFromBottom > CHAT_JUMP_THRESHOLD)
    if (scroller.scrollTop <= 80) loadOlderMessages()
  }
  const jumpToLatest = () => {
    const scroller = messageScrollRef.current
    if (revealMessageId) {
      replaceWithLatestRef.current = true
      setRevealMessageId(null)
      return
    }
    if (!scroller) return
    scroller.scrollTop = scroller.scrollHeight
    setShowJumpToLatest(false)
  }
  const selectChannel = channelName => {
    setSelectedChannel(channelName)
    setSearch('')
    setReplyTo(null)
    setActivePane('posts')
    setShowJumpToLatest(false)
    // Opening a thread by hand is a fresh start, so any message an earlier alert
    // was holding the reader on stops mattering.
    setRevealMessageId(null)
    captureUnreadMarker('chat_channel', channelName)
    markConversationRead('chat_channel', channelName)
  }
  const selectConversation = conversationId => {
    setSelectedConversationId(conversationId)
    setSearch('')
    setReplyTo(null)
    setActivePane('posts')
    setShowJumpToLatest(false)
    setRevealMessageId(null)
    captureUnreadMarker('direct_conversation', conversationId)
    markConversationRead('direct_conversation', conversationId)
  }
  const toggleReaction = async (message, emoji) => {
    const direct = mode === 'direct'
    const endpoint = direct ? `/api/direct-messages/${message.id}/reactions/` : `/api/chat-messages/${message.id}/reactions/`
    const existing = (reactionUpdates[message.id] || message.reactions || []).find(item => item.emoji === emoji)
    setError('')
    try {
      const response = await fetch(endpoint, {
        method: existing?.reacted ? 'DELETE' : 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify({ emoji }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Reaction could not be updated.')
      setReactionUpdates(current => ({ ...current, [message.id]: payload.message.reactions }))
    } catch (reactionError) { setError(reactionError.message) }
  }
  const startEditing = message => {
    if (savingEdit || submitting || uploadingFile) return
    setEmojiOpen(false)
    setMentionOpen(false)
    setShareOpen(false)
    messageInputRef.current?.focus({ preventScroll: true })
    setEditingMessageId(message.id)
    setEditDraft(messageEdits[message.id]?.message ?? message.message)
    setError('')
  }
  const cancelEditing = () => {
    setEditingMessageId(null)
    setEditDraft('')
    setEmojiOpen(false)
    setMentionOpen(false)
    setError('')
  }
  const saveEdit = async event => {
    event.preventDefault()
    if (editRequestRef.current || editingMessageId === null) return
    const message = { id: editingMessageId }
    const request = { thread: draftKey }
    editRequestRef.current = request
    const text = editDraft.trim()
    if (!text) { editRequestRef.current = null; setError('Message is required.'); return }
    setSavingEdit(true)
    const direct = mode === 'direct'
    const endpoint = direct ? `/api/direct-messages/${message.id}/` : `/api/chat-messages/${message.id}/`
    setError('')
    try {
      const response = await fetch(endpoint, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify({ message: text }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Message could not be updated.')
      if (editRequestRef.current !== request) return
      setMessageEdits(current => ({ ...current, [message.id]: payload.message }))
      cancelEditing()
    } catch (editError) {
      if (editRequestRef.current === request) setError(editError.message)
    } finally {
      if (editRequestRef.current === request) {
        editRequestRef.current = null
        setSavingEdit(false)
      }
    }
  }
  const deleteMessage = async message => {
    const direct = mode === 'direct'
    if (!(await onConfirm('Delete this message? This cannot be undone.', { title: 'Delete message', confirmLabel: 'Delete message' }))) return
    const endpoint = direct ? `/api/direct-messages/${message.id}/` : `/api/chat-messages/${message.id}/`
    setError('')
    try {
      const response = await fetch(endpoint, { method: 'DELETE', credentials: 'include', headers: { 'X-CSRFToken': await getCsrfToken() } })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Message could not be deleted.')
      setMessageDeletes(current => ({ ...current, [message.id]: payload.message }))
      if (editingMessageId === message.id) cancelEditing()
      if (replyTo?.id === message.id) setReplyTo(null)
    } catch (deleteError) { setError(deleteError.message) }
  }
  useEffect(() => {
    if (mode === 'channels' && selectedChannel) {
      captureUnreadMarker('chat_channel', selectedChannel)
      markConversationRead('chat_channel', selectedChannel)
    }
  }, [mode, selectedChannel, workspaceId])
  const renderMessage = message => {
    const parent = message.parent_id ? (mode === 'channels' ? activeChannelMessages : directMessages).find(item => item.id === message.parent_id) : null
    const reactions = reactionUpdates[message.id] || message.reactions || []
    const author = memberForMessage(message)
    const isMine = String(author.id) === String(currentUserId)
    const edit = messageEdits[message.id]
    const bodyText = edit ? edit.message : message.message
    const editedAt = edit ? edit.edited_at : message.edited_at
    const deletedAt = messageDeletes[message.id]?.deleted_at || message.deleted_at
    const isEditing = editingMessageId === message.id
    const hasMessageActions = !isEditing && !deletedAt
    const receiptScope = mode === 'direct' && !selectedConversation?.is_group ? '' : ' by everyone'
    const receiptLabel = message.read ? `Read${receiptScope}` : message.delivered ? 'Delivered' : 'Sent'
    // data-message-id is how the feed finds this row to scroll to when a
    // notification points at it. The highlight is the same reference, only for as
    // long as the ring lasts.
    const highlighted = highlightMessageId !== null && String(message.id) === String(highlightMessageId)
    const archivedThread = mode === 'direct' && selectedConversation?.is_archived
    return <div className={`chat-message ${message.parent_id ? 'chat-reply' : ''} ${isMine ? 'chat-message-mine' : ''} ${hasMessageActions ? 'chat-message-has-actions' : ''} ${archivedThread ? 'chat-message-archived' : ''} ${highlighted ? 'chat-message-highlight' : ''}`} data-message-id={message.id} key={message.id}>
      <Avatar name={message.author_name} avatarUrl={author.avatar_url} presence={effectivePresence(author)} small />
      <div className="chat-message-body">
        <div className="chat-message-meta">
          {isMine ? <strong>{message.author_name}</strong> : <button type="button" className="chat-member-name" onClick={() => setProfileMember(author)} aria-label={`View ${message.author_name}'s profile`}>{message.author_name}</button>}
          <span>{formatRelativeActivityTime(message.created_at)}</span>
          {isMine && !deletedAt && <span className={`chat-receipt${message.read ? ' chat-receipt-read' : ''}`} aria-label={receiptLabel} title={receiptLabel}>{message.read || message.delivered ? <CheckCheck size={14} /> : <Check size={14} />}</span>}
          {editedAt && !deletedAt && <span className="chat-edited-marker" title={`Edited ${formatRelativeActivityTime(editedAt)}`}>edited</span>}
        </div>
        {message.parent_id && <div className="chat-reply-context"><strong>{parent?.author_name || 'Original message'}</strong><span>{parent?.deleted_at ? 'Original message was deleted.' : (parent?.message || 'Original message is unavailable.')}</span></div>}
        <div className={`chat-message-bubble chat-member-tone-${Number(author.id) % 5}`}>
          {deletedAt ? <p className="chat-deleted-text" title={`Deleted ${formatRelativeActivityTime(deletedAt)}`}>This message was deleted</p> : <p>{renderMessageText(bodyText)}</p>}
        </div>
        {hasMessageActions && <div className={`chat-message-actions ${reactions.length ? 'has-reactions' : ''}`}>
          <MessageReactionBar message={message} reactions={reactions} isMine={isMine} onToggle={toggleReaction} />
          <button type="button" className="chat-reply-button" onClick={() => setReplyTo(message)}>Reply{message.reply_count ? ` (${message.reply_count})` : ''}</button>
          {isMine && <button type="button" className="chat-edit-button" onClick={() => startEditing(message)}>Edit</button>}
          {isMine && <button type="button" className="chat-delete-button" onClick={() => deleteMessage(message)} aria-label="Delete message">Delete</button>}
        </div>}
        {!deletedAt && (message.shared_documents || []).map(document => <div className="chat-shared-card chat-shared-card-disabled" key={`doc-${document.id}`}><FileText size={16} /><span><strong>{document.title}</strong><small>Document sharing is temporarily unavailable</small></span></div>)}
        {!deletedAt && (message.shared_files || []).map(file => isImageFileName(file.original_name) && file.url ? <a className="chat-shared-image" key={`file-${file.id}`} href={file.url} target="_blank" rel="noreferrer" aria-label={`Open image ${file.original_name}`}><img src={file.url} alt={file.original_name} loading="lazy" /></a> : <a className="chat-shared-card" key={`file-${file.id}`} href={file.url} target="_blank" rel="noreferrer"><FileText size={16} /><span><strong>{file.original_name}</strong><small>Open or download file</small></span><Download size={14} /></a>)}
      </div>
    </div>
  }

  const renderMessageWithUnreadMarker = message => <Fragment key={message.id}>
    {firstUnreadMessageId !== null && String(message.id) === String(firstUnreadMessageId) && <div className="chat-new-message-divider" role="separator" aria-label="New messages"><span>New messages</span></div>}
    {renderMessage(message)}
  </Fragment>

  const renderPostsPane = () => <div className="chat-message-pane">
    <div className="chat-message-scroll" ref={messageScrollRef} onScroll={handleMessageScroll}>
      {mode === 'channels' ? (visibleChannelMessages.length
        ? Object.entries(groupedMessages).map(([date, messages]) => <div className="chat-day" key={date}><h3>{date === toDateKey(new Date()) ? 'Today' : date === toDateKey(new Date(Date.now() - 86400000)) ? 'Yesterday' : formatDay(date)}</h3>{messages.map(renderMessageWithUnreadMarker)}</div>)
        : <div className="chat-placeholder"><div className="chat-placeholder-icon"><MessageSquare size={22} /></div><h2>{search ? 'No matching messages' : `No messages in #${selectedChannel}`}</h2><p>{search ? 'Try a different search term.' : 'Start the conversation below.'}</p></div>)
        : selectedConversation
          ? (directThreadReady
            ? (visibleDirectMessages.length ? visibleDirectMessages.map(renderMessageWithUnreadMarker) : <div className="chat-placeholder"><h2>{search ? 'No matching messages' : 'No messages yet'}</h2><p>Send the first private message below.</p></div>)
        : directLoading ? <SkeletonGroup className="chat-feed-skeleton" label="Loading messages">
          {[0, 1, 2].map(item => <div className="chat-message-skeleton" key={item}>
            <Skeleton variant="circle" />
            <div className="chat-message-skeleton-lines">
              <Skeleton variant="heading" />
              <Skeleton variant="line" />
              <Skeleton variant="text" style={{ width: item === 1 ? '64%' : '88%' }} />
            </div>
          </div>)}
        </SkeletonGroup> : <div className="chat-placeholder"><h2>Messages could not be loaded</h2><p>{error || 'Open the conversation again to retry.'}</p></div>)
          : <div className="chat-placeholder"><div className="chat-placeholder-icon"><Users size={22} /></div><h2>Start a private conversation</h2><p>Choose an existing conversation or create a new one.</p></div>}
    </div>
    {showJumpToLatest && <button type="button" className="chat-jump-latest" onClick={jumpToLatest} aria-label="Jump to latest messages" title="Jump to latest messages"><ArrowDown size={18} /></button>}
  </div>

  const renderFilesPane = () => <div className="chat-pane-scroll" aria-label="Shared files and documents">
    <div className="chat-pane-intro"><span className="chat-pane-icon"><FolderOpen size={19} /></span><div><h2>Files</h2><p>{sharedItems.length ? `${sharedItems.length} shared item${sharedItems.length === 1 ? '' : 's'}` : 'Files shared in this conversation will appear here.'}</p></div></div>
    {sharedItems.length ? <div className="chat-resource-list">
      {sharedItems.map(item => item.kind === 'file' && item.url
        ? <a className="chat-resource-row" href={item.url} target="_blank" rel="noreferrer" key={item.key}><span className="chat-resource-icon"><FileText size={17} /></span><span><strong>{item.title}</strong><small>{item.author} - {formatRelativeActivityTime(item.created_at)}</small></span><Download size={15} /></a>
        : <div className="chat-resource-row is-disabled" key={item.key}><span className="chat-resource-icon"><FileText size={17} /></span><span><strong>{item.title}</strong><small>{item.author} - {formatRelativeActivityTime(item.created_at)}</small></span></div>)}
    </div> : <div className="chat-placeholder"><div className="chat-placeholder-icon"><FolderOpen size={22} /></div><h2>No shared files</h2><p>Files attached to messages will be collected here.</p></div>}
  </div>

  const renderAboutPane = () => {
    const isChannel = mode === 'channels'
    const isSelfChat = Boolean(selectedConversation?.is_self)
    const title = isChannel ? `#${selectedChannel}` : isSelfChat ? 'Message yourself' : selectedConversation?.title || 'Chat'
    const description = isChannel ? (selectedChannelInfo?.description || 'No channel description yet.') : isSelfChat ? 'A private space for notes and reminders.' : selectedConversation?.is_group ? 'Group conversation for workspace collaboration.' : 'Private one-to-one conversation.'
    return <div className="chat-pane-scroll chat-about-panel" aria-label="About this conversation">
      <div className="chat-about-hero"><span className="chat-about-icon">{isChannel ? <Hash size={23} /> : selectedConversation?.is_group ? <Users size={23} /> : <MessageSquare size={23} />}</span><div><p className="eyebrow">{isChannel ? 'Channel' : isSelfChat ? 'Private notes' : selectedConversation?.is_group ? 'Group chat' : 'Direct chat'}</p><h2>{title}</h2><p>{description}</p></div></div>
      <dl className="chat-about-grid">
        <div><dt>Participants</dt><dd>{isChannel ? selectedMembers.length : selectedConversation?.participants?.length || 0}</dd></div>
        <div><dt>Shared items</dt><dd>{sharedItems.length}</dd></div>
        <div><dt>Privacy</dt><dd>{isChannel ? (selectedChannelInfo?.is_private ? 'Private' : 'Workspace') : isSelfChat ? 'Only you' : selectedConversation?.is_group ? 'Group members' : 'Private'}</dd></div>
        <div><dt>Messages</dt><dd>{activeMessages.length}</dd></div>
      </dl>
      <div className="chat-about-members"><div className="chat-section-heading"><h3>People</h3><span>{selectedMembers.length}</span></div><div className="chat-details-members">{selectedMembers.slice(0, 12).map(member => <button type="button" className="chat-detail-member" key={member.id} onClick={() => setProfileMember(member)}><Avatar name={memberName(member)} avatarUrl={member.avatar_url} presence={effectivePresence(member)} small /><span><strong>{memberName(member)}</strong><small>{member.role || 'Member'}</small></span></button>)}</div>{selectedMembers.length > 12 && <p className="chat-details-more">+{selectedMembers.length - 12} more</p>}</div>
    </div>
  }

  const renderDetailsPanel = () => <aside className="chat-details-panel" aria-label="Conversation details">
    <div className="chat-details-heading"><h3>Details</h3><button type="button" onClick={() => setDetailsOpen(false)} aria-label="Close details"><X size={16} /></button></div>
    <section className="chat-details-section"><div className="chat-section-heading"><h4>Participants</h4><span>{selectedMembers.length}</span></div><div className="chat-details-members">{selectedMembers.map(member => <button type="button" className="chat-detail-member" key={member.id} onClick={() => setProfileMember(member)}><Avatar name={memberName(member)} avatarUrl={member.avatar_url} presence={effectivePresence(member)} small /><span><strong>{memberName(member)}</strong><small>{member.role || 'Member'}</small></span></button>)}</div>{mode === 'channels' && selectedChannelInfo?.is_private && <p className="chat-details-note">This channel is limited to its selected members.</p>}{selectedConversation?.is_group && <button type="button" className="secondary-button chat-details-edit" onClick={() => openParticipantEditor(selectedConversation)}><Pencil size={14} /> Edit participants</button>}</section>
    <section className="chat-details-section"><div className="chat-section-heading"><h4>Shared files</h4><span>{sharedItems.length}</span></div>{sharedItems.length ? <div className="chat-details-files">{sharedItems.slice(0, 5).map(item => item.url ? <a href={item.url} target="_blank" rel="noreferrer" key={item.key}><FileText size={15} /><span><strong>{item.title}</strong><small>{item.author}</small></span></a> : <div key={item.key}><FileText size={15} /><span><strong>{item.title}</strong><small>{item.author}</small></span></div>)}</div> : <p className="chat-details-empty">No shared files yet.</p>}{sharedItems.length > 5 && <button type="button" className="chat-details-link" onClick={() => { setActivePane('files'); setDetailsOpen(false) }}>View all {sharedItems.length} items</button>}</section>
  </aside>

  const renderChannelRow = channel => {
    const unread = unreadCountFor('chat_channel', channel.name)
    const unreadLabel = `${unread} unread message${unread === 1 ? '' : 's'}`
    return <div className="channel-row-wrap" key={channel.id}>
      <button type="button" className={`channel-row ${selectedChannel === channel.name ? 'active' : ''} ${unread > 0 ? 'has-unread' : ''}`} onClick={() => selectChannel(channel.name)} aria-label={unread > 0 ? `${channel.name}, ${unreadLabel}` : undefined}>
        {channel.is_private ? <span className="channel-private-mark">•</span> : <Hash size={15} />}
        <span className="channel-name">{channel.name}</span>
        {unread > 0 && <Badge aria-label={unreadLabel}>{unread > 99 ? '99+' : unread}</Badge>}
      </button>
      {channel.name !== 'general' && channel.created_by === currentUserId && <button type="button" className="channel-delete" onClick={() => deleteChannel(channel)} aria-label={`Delete ${channel.name}`}><X size={13} /></button>}
    </div>
  }

  const renderDirectConversationRow = (conversation, archived = false) => {
    const unread = unreadCountFor('direct_conversation', conversation.id)
    const unreadLabel = `${unread} unread message${unread === 1 ? '' : 's'}`
    const other = directOtherMember(conversation)
    const otherPresence = other ? effectivePresence(other) : null
    const title = conversation.is_self ? 'Message yourself' : conversation.title
    const subtitle = conversation.is_self ? (conversation.last_message_deleted ? 'This message was deleted' : conversation.last_message || 'Private notes') : conversation.is_group ? `Group - ${conversation.participants.length} people` : conversation.last_message_deleted ? 'This message was deleted' : conversation.last_message || 'Direct chat'
    return <div className="direct-row-wrap" key={conversation.id}>
      <button type="button" className={`direct-row ${selectedConversationId === conversation.id ? 'active' : ''} ${unread > 0 ? 'has-unread' : ''}`} onClick={() => selectConversation(conversation.id)} aria-label={unread > 0 ? `${title}, ${unreadLabel}` : undefined}>
        <span className={`avatar blue small ${conversation.is_group ? 'group-chat-avatar' : ''}`}>{conversation.is_group ? <Users size={14} /> : conversation.is_self ? <MessageSquare size={14} /> : conversation.title.slice(0, 2).toUpperCase()}{otherPresence && <span className={`presence-dot presence-${otherPresence}`} title={PRESENCE_LABEL[otherPresence] || otherPresence} />}</span>
        <span><strong>{title}</strong><small>{subtitle}</small></span>
        {unread > 0 && <Badge aria-label={unreadLabel}>{unread > 99 ? '99+' : unread}</Badge>}
      </button>
      <div className="direct-row-actions">
        {!archived && conversation.is_group && <button type="button" onClick={() => openParticipantEditor(conversation)} aria-label={`Edit participants for ${title}`} title="Edit participants"><Pencil size={13} /></button>}
        {archived
          ? <button type="button" className="direct-row-restore" onClick={() => restoreConversation(conversation)} aria-label={`Restore ${title} chat`} title="Restore chat"><ArchiveRestore size={13} /></button>
          : <button type="button" className="direct-row-archive" onClick={() => archiveConversation(conversation)} aria-label={`Archive ${title} chat`} title="Archive chat"><Archive size={13} /></button>}
        <button type="button" className="direct-row-delete" onClick={() => deleteConversation(conversation)} aria-label={`Delete conversation with ${title}`} title="Delete conversation"><Trash2 size={13} /></button>
      </div>
    </div>
  }

  const uploadChatFile = async event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || uploadingFile) return
    setUploadingFile(true)
    setError('')
    try {
      const body = new FormData()
      body.append('file', file)
      const response = await fetch(`/api/workspaces/${workspaceId}/files/`, { method: 'POST', credentials: 'include', headers: { 'X-CSRFToken': await getCsrfToken(), 'X-Workspace-Id': String(workspaceId) }, body })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'File could not be uploaded.')
      setWorkspaceFiles(current => [payload.file, ...current.filter(item => item.id !== payload.file.id)])
      setSharedFileIds(current => [...new Set([...current, Number(payload.file.id)])])
      setShareOpen(false)
      window.dispatchEvent(new CustomEvent('workspace:notice', { detail: `${file.name} uploaded and attached.` }))
    } catch (uploadError) {
      setError(uploadError.message)
    } finally {
      setUploadingFile(false)
    }
  }

  return <section className={`workspace-view chat-workspace-view chat-mode-${mode}`}>
    <WorkspaceViewHeading title={mode === 'channels' ? 'Channels' : 'Chats'} subtitle={mode === 'channels' ? 'Shared rooms for workspace topics, teams, and projects.' : 'Private one-to-one and group conversations.'} />
    <div className="chat-toolbar"><label className="chat-search"><Search size={15} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder={mode === 'channels' ? `Search #${selectedChannel}` : 'Search this chat'} aria-label="Search messages" /></label><button type="button" className="primary-button chat-create-button" onClick={() => { setError(''); mode === 'channels' ? setChannelDialogOpen(true) : setDirectDialogOpen(true) }}><Plus size={15} /> {mode === 'channels' ? 'Create channel' : 'New chat'}</button></div>
    <div className="chat-layout">
      <section className={`chat-feed ${detailsOpen ? 'details-open' : ''}`}>
        <div className="chat-feed-header">
          <div className="chat-feed-heading"><div>{mode === 'channels' ? <><h2><Hash size={17} /> {selectedChannel}</h2><p>{selectedChannelInfo?.description || 'Team conversation'}</p></> : selectedConversation ? <><h2>{selectedConversation.is_group && <Users size={17} />}{selectedConversation.is_self ? 'Message yourself' : selectedConversation.title}</h2><p>{selectedConversation.is_self ? 'Private notes and reminders' : selectedConversation.is_group ? `Group chat · ${selectedConversation.participants.length} people` : 'Direct chat · only you two'}</p></> : <><h2>Chats</h2><p>Select a person or start a group chat</p></>}</div></div>
          {mode === 'direct' && selectedConversation?.is_group && !selectedConversation.is_archived && <button type="button" className="secondary-button chat-header-members" onClick={() => openParticipantEditor(selectedConversation)}><Users size={15} /> <span>Add or remove members</span></button>}
          <button type="button" className={`chat-details-toggle ${detailsOpen ? 'active' : ''}`} onClick={() => setDetailsOpen(open => !open)} aria-label={detailsOpen ? 'Hide conversation details' : 'Show conversation details'} aria-expanded={detailsOpen} disabled={mode === 'direct' && !selectedConversation}><PanelRight size={17} /></button>
        </div>
        <nav className="chat-pane-tabs" role="tablist" aria-label="Conversation views">
          <button type="button" role="tab" aria-selected={activePane === 'posts'} className={activePane === 'posts' ? 'active' : ''} onClick={() => setActivePane('posts')}><MessageSquare size={15} /> Posts</button>
          <button type="button" role="tab" aria-selected={activePane === 'files'} className={activePane === 'files' ? 'active' : ''} onClick={() => setActivePane('files')}><FolderOpen size={15} /> Files{sharedItems.length > 0 && <span>{sharedItems.length}</span>}</button>
          <button type="button" role="tab" aria-selected={activePane === 'about'} className={activePane === 'about' ? 'active' : ''} onClick={() => setActivePane('about')}><Info size={15} /> About</button>
        </nav>
        {mode === 'direct' && selectedConversation?.is_archived && <div className="chat-archive-banner"><Archive size={15} /><span>Archived chat</span><button type="button" onClick={() => restoreConversation(selectedConversation)}><ArchiveRestore size={14} /> Restore</button></div>}
        <div className={`chat-feed-body ${detailsOpen ? 'details-open' : ''}`}>
          <div className="chat-main-pane">
            {activePane === 'posts' ? renderPostsPane() : activePane === 'files' ? renderFilesPane() : renderAboutPane()}
        {activePane === 'posts' && (mode === 'channels' || selectedConversation) && <form className="chat-inline-composer" onSubmit={editingMessageId !== null ? saveEdit : mode === 'channels' ? submitChannelMessage : submitDirectMessage}>
          {editingMessageId !== null && <div className="reply-context"><span>Editing message</span><button type="button" disabled={savingEdit} onClick={cancelEditing}>Cancel</button></div>}
          {editingMessageId === null && replyTo && <div className="reply-context"><span>Replying to <strong>{replyTo.author_name}</strong>: {replyTo.message.slice(0, 100)}</span><button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply"><X size={14} /></button></div>}
          {editingMessageId === null && (sharedDocumentIds.length > 0 || sharedFileIds.length > 0) && <div className="chat-pending-attachments" aria-label="Files attached to this message">{sharedDocumentIds.map(id => { const document = workspaceDocuments.find(item => item.id === id); return <span key={`pending-document-${id}`}><FileText size={14} />{document?.title || 'Document'}<button type="button" onClick={() => setSharedDocumentIds(current => current.filter(value => value !== id))} aria-label={`Remove ${document?.title || 'document'}`}><X size={12} /></button></span> })}{sharedFileIds.map(id => { const file = workspaceFiles.find(item => item.id === id); return <span key={`pending-file-${id}`}><Paperclip size={14} />{file?.original_name || 'File'}<button type="button" onClick={() => setSharedFileIds(current => current.filter(value => value !== id))} aria-label={`Remove ${file?.original_name || 'file'}`}><X size={12} /></button></span> })}</div>}
          <div className="chat-compose-surface">
            <div className="chat-compose-input">
              <textarea ref={messageInputRef} rows={1} value={composerDraft} readOnly={savingEdit} onChange={event => { const nextDraft = event.target.value; setComposerDraft(nextDraft); const context = getMentionContext(nextDraft, event.target.selectionStart ?? nextDraft.length); setMentionOpen(Boolean(context)); setMentionQuery(context?.query || ''); if (context) { setEmojiOpen(false); setShareOpen(false) } }} onKeyDown={event => { if (event.key === 'Escape' && mentionOpen) { event.preventDefault(); setMentionOpen(false); setMentionQuery(''); return } if (event.key === 'Enter' && !event.shiftKey && mentionOpen && mentionMembers.length) { event.preventDefault(); insertMention(mentionMembers[0]); return } if (event.key === 'Escape' && editingMessageId !== null && !savingEdit) { event.preventDefault(); cancelEditing(); return } if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form.requestSubmit() } }} placeholder={mode === 'channels' ? `Message #${selectedChannel}` : selectedConversation?.is_self ? 'Message yourself' : `Message ${selectedConversation?.title}`} maxLength="4000" aria-label={editingMessageId !== null ? 'Edit message' : 'Message'} />
              <div className="chat-compose-actions">
                <Popover.Root open={mentionOpen} onOpenChange={nextOpen => { setMentionOpen(nextOpen); setMentionQuery(''); if (nextOpen) { setEmojiOpen(false); setShareOpen(false) } }}><Popover.Trigger asChild><button type="button" className={mentionOpen ? 'chat-emoji-trigger active' : 'chat-emoji-trigger'} aria-label="Mention a teammate" aria-expanded={mentionOpen}>@</button></Popover.Trigger><Popover.Portal><Popover.Content className="chat-mention-popup" side="top" align="start" sideOffset={8} collisionPadding={12} aria-label="Mention a workspace member"><MentionPicker members={mentionMembers} getMemberName={memberName} onSelect={insertMention} /><Popover.Arrow className="chat-mention-popup-arrow" /></Popover.Content></Popover.Portal></Popover.Root>
                <Popover.Root open={emojiOpen} onOpenChange={nextOpen => { setEmojiOpen(nextOpen); if (nextOpen) { setMentionOpen(false); setShareOpen(false) } }}><Popover.Trigger asChild><button type="button" className={`chat-emoji-trigger ${emojiOpen ? 'active' : ''}`} aria-label="Add emoji" aria-expanded={emojiOpen}><Smile size={18} /></button></Popover.Trigger><Popover.Portal><Popover.Content className="chat-emoji-popup" side="top" align="start" sideOffset={8} collisionPadding={12} aria-label="Choose an emoji"><EmojiPicker onSelect={insertEmoji} /><Popover.Arrow className="chat-emoji-popup-arrow" /></Popover.Content></Popover.Portal></Popover.Root>
                {editingMessageId === null && <label className="chat-upload-button" aria-label={uploadingFile ? 'Uploading file' : 'Upload and attach a file'} title={uploadingFile ? 'Uploading file' : 'Attach file'}><Paperclip size={17} /><input type="file" onChange={uploadChatFile} disabled={uploadingFile} /></label>}
                <button type="submit" className="primary-button" aria-label={editingMessageId !== null ? 'Save changes' : 'Send'} disabled={editingMessageId !== null ? savingEdit || !editDraft.trim() : submitting || uploadingFile || (!draft.trim() && !sharedDocumentIds.length && !sharedFileIds.length)}>{editingMessageId !== null ? savingEdit ? 'Saving...' : 'Save' : submitting ? 'Sending…' : 'Send'}</button>
              </div>
            </div>
          </div>
          <small className="chat-compose-hint">Enter to send. Shift + Enter for a new line.</small>
          {error && <Alert tone="danger" compact>{error}</Alert>}
        </form>}
          </div>
          {detailsOpen && renderDetailsPanel()}
        </div>
      </section>
      <aside className="chat-conversation-list">
        <div className="chat-list-heading">
          <div className="chat-list-heading-copy"><h3>{mode === 'channels' ? 'Channels' : 'Conversations'}</h3><span>{unreadTotal ? `${unreadTotal} unread` : 'All caught up'}</span></div>
          <button type="button" onClick={() => { setError(''); mode === 'channels' ? setChannelDialogOpen(true) : setDirectDialogOpen(true) }} aria-label={mode === 'channels' ? 'Create channel' : 'New chat'}><Plus size={15} /></button>
        </div>
        <div className="chat-filter-tabs" role="tablist" aria-label="Filter conversations">
          <button type="button" role="tab" aria-selected={chatFilter === 'all'} className={chatFilter === 'all' ? 'active' : ''} onClick={() => setChatFilter('all')}>All <span>{mode === 'channels' ? channels.length : conversations.length}</span></button>
          <button type="button" role="tab" aria-selected={chatFilter === 'unread'} className={chatFilter === 'unread' ? 'active' : ''} onClick={() => setChatFilter('unread')}>Unread <span>{unreadTotal}</span></button>
          {mode === 'direct' && <button type="button" role="tab" aria-selected={chatFilter === 'archived'} className={chatFilter === 'archived' ? 'active' : ''} onClick={() => setChatFilter('archived')}>Archived <span>{archivedConversations.length}</span></button>}
        </div>
        <div className="chat-list-scroll">
          {mode === 'channels'
            ? (filteredChannels.length ? filteredChannels.map(renderChannelRow) : <p className="chat-sidebar-empty">No unread channels.</p>)
            : chatFilter === 'archived'
              ? (archivedConversations.length
                ? <section className="chat-list-group"><h4>Archived <span>{archivedConversations.length}</span></h4><div className="chat-list-group-rows">{archivedConversations.map(conversation => renderDirectConversationRow(conversation, true))}</div></section>
                : <p className="chat-sidebar-empty">No archived chats.</p>)
              : filteredConversations.length
                ? <>
                  {groupConversations.length > 0 && <section className="chat-list-group"><h4>Group chats <span>{groupConversations.length}</span></h4><div className="chat-list-group-rows">{groupConversations.map(conversation => renderDirectConversationRow(conversation))}</div></section>}
                  {directConversations.length > 0 && <section className="chat-list-group"><h4>Direct messages <span>{directConversations.length}</span></h4><div className="chat-list-group-rows">{directConversations.map(conversation => renderDirectConversationRow(conversation))}</div></section>}
                </>
                : <p className="chat-sidebar-empty">{chatFilter === 'unread' ? 'No unread conversations.' : 'No chats yet.'}</p>}
        </div>
      </aside>
    </div>
    {channelDialogOpen && <div className="modal-backdrop" onMouseDown={() => setChannelDialogOpen(false)}><form className="modal chat-create-modal" role="dialog" aria-modal="true" aria-labelledby="create-channel-title" onSubmit={createChannel} onMouseDown={event => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">Channels</p><h2 id="create-channel-title">Create a channel</h2></div><button type="button" className="close-button" onClick={() => setChannelDialogOpen(false)} aria-label="Close"><X size={18} /></button></div><label>Channel name<input autoFocus value={channelForm.name} onChange={event => setChannelForm(current => ({ ...current, name: event.target.value }))} placeholder="e.g. product-launch" maxLength="80" required /></label><label>Description<textarea value={channelForm.description} onChange={event => setChannelForm(current => ({ ...current, description: event.target.value }))} placeholder="What is this channel for?" maxLength="240" /></label><label className="chat-privacy-toggle"><input type="checkbox" checked={channelForm.is_private} onChange={event => setChannelForm(current => ({ ...current, is_private: event.target.checked, member_ids: [] }))} /> Private channel</label>{channelForm.is_private && <div className="chat-member-picker"><span>Add members</span>{data.members.filter(member => member.id !== currentUserId).map(member => <label key={member.id}><input type="checkbox" checked={channelForm.member_ids.includes(member.id)} onChange={() => toggleMember(member.id, channelForm.member_ids, member_ids => setChannelForm(current => ({ ...current, member_ids })))} /> {memberName(member)}</label>)}</div>}{error && <Alert tone="danger" compact>{error}</Alert>}<button className="primary-button modal-submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create channel'}</button></form></div>}
    {directDialogOpen && <div className="modal-backdrop" onMouseDown={() => setDirectDialogOpen(false)}><form className="modal chat-create-modal" role="dialog" aria-modal="true" aria-labelledby="create-direct-title" onSubmit={createDirectConversation} onMouseDown={event => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">Private chats</p><h2 id="create-direct-title">New chat</h2><p className="modal-subtitle">Choose yourself for private notes, one person for a direct chat, or several people for a group chat.</p></div><button type="button" className="close-button" onClick={() => setDirectDialogOpen(false)} aria-label="Close"><X size={18} /></button></div><div className="chat-member-picker"><span>Choose people</span>{currentMember && <label><input type="checkbox" checked={directMemberIds.some(id => String(id) === String(currentUserId))} onChange={() => toggleDirectMember(currentUserId)} /> Message yourself</label>}{data.members.filter(member => String(member.id) !== String(currentUserId)).map(member => <label key={member.id}><input type="checkbox" checked={directMemberIds.some(id => String(id) === String(member.id))} onChange={() => toggleDirectMember(member.id)} /> {memberName(member)}</label>)}</div>{directMemberIds.length > 0 && <p className="chat-selection-summary">{directMemberIds.some(id => String(id) === String(currentUserId)) ? 'Private notes' : directMemberIds.length === 1 ? 'Direct chat' : `Group chat with ${directMemberIds.length + 1} people`}</p>}{error && <Alert tone="danger" compact>{error}</Alert>}<button className="primary-button modal-submit" disabled={submitting || !directMemberIds.length}>{submitting ? 'Starting…' : directMemberIds.some(id => String(id) === String(currentUserId)) ? 'Message yourself' : directMemberIds.length > 1 ? 'Start group chat' : 'Start direct chat'}</button></form></div>}
    {profileMember && <div className="modal-backdrop" onMouseDown={() => setProfileMember(null)}><section className="modal chat-member-profile" role="dialog" aria-modal="true" aria-labelledby="chat-member-profile-title" onMouseDown={event => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">Workspace member</p><h2 id="chat-member-profile-title">{memberName(profileMember)}</h2></div><button type="button" className="close-button" onClick={() => setProfileMember(null)} aria-label="Close profile"><X size={18} /></button></div><div className="chat-member-profile-summary"><span className="avatar blue">{memberName(profileMember).slice(0, 2).toUpperCase()}</span><div><strong>{memberName(profileMember)}</strong><span>{profileMember.email}</span></div></div><dl><div><dt>Role</dt><dd>{profileMember.role || 'Member'}</dd></div><div><dt>Availability</dt><dd>{profileMember.presence || 'Available'}</dd></div><div><dt>Member since</dt><dd>{profileMember.joined_at ? formatDate(profileMember.joined_at) : 'Not available'}</dd></div></dl></section></div>}
    {participantConversation && <div className="modal-backdrop" onMouseDown={() => { setParticipantConversation(null); setGroupMemberIds([]); setError('') }}><form className="modal chat-create-modal chat-participant-modal" role="dialog" aria-modal="true" aria-labelledby="edit-group-participants-title" onSubmit={saveGroupParticipants} onMouseDown={event => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">Group chat</p><h2 id="edit-group-participants-title">Edit participants</h2><p className="modal-subtitle">Choose the people who should be in this chat. Untick someone to remove them. You will stay in it.</p></div><button type="button" className="close-button" onClick={() => { setParticipantConversation(null); setGroupMemberIds([]); setError('') }} aria-label="Close"><X size={18} /></button></div><div className="chat-member-picker"><span>Choose participants</span>{data.members.filter(member => String(member.id) !== String(currentUserId)).map(member => <label key={member.id}><input type="checkbox" checked={groupMemberIds.includes(member.id)} onChange={() => toggleMember(member.id, groupMemberIds, setGroupMemberIds)} /> {memberName(member)}</label>)}</div><p className="chat-selection-summary">{groupMemberIds.length === 1 ? 'Direct chat' : `Group chat with ${groupMemberIds.length + 1} people`}</p>{groupMemberIds.length < 1 && <p className="chat-selection-error">Choose at least one other member.</p>}{error && <Alert tone="danger" compact>{error}</Alert>}<div className="chat-modal-actions"><button type="button" className="secondary-button" onClick={() => { setParticipantConversation(null); setGroupMemberIds([]); setError('') }}>Cancel</button><button type="submit" className="primary-button" disabled={submitting || groupMemberIds.length < 1}>{submitting ? 'Saving...' : 'Save participants'}</button></div></form></div>}
  </section>
}

export { ChatWorkspaceView }
