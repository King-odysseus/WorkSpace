import { AppSelect } from './ui/select.jsx'
// Channels and direct messages, plus the shared composer modal used for every
// "create a record" flow (events, projects, check-ins, chat, follow-ups, invites).

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { ArrowUpRight, Check, CheckCheck, Download, FileText, FolderOpen, Hash, Info, MessageSquare, PanelRight, Paperclip, Pencil, Plus, Search, Smile, Trash2, Users, X } from 'lucide-react'
import { Badge } from './ui/badge.jsx'
import Avatar from './Avatar.jsx'
import LinkedText from './LinkedText.jsx'
import { DateField, DateTimeField, SelectField, WorkspaceViewHeading } from './workspace-ui.jsx'
import { PRESENCE_LABEL, effectivePresence, formatRelativeActivityTime, getCsrfToken, isImageFileName, toDateKey } from '../lib/workspace-format.js'

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

function renderMessageText(text) {
  return <LinkedText text={text} />
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

function ChatWorkspaceView({ viewType, data, workspaceId, currentUserId, onRefresh, onError, onConfirm, onNavigate }) {
  const mode = viewType
  const [selectedChannel, setSelectedChannel] = useState('general')
  const [selectedConversationId, setSelectedConversationId] = useState(null)
  const [activePane, setActivePane] = useState('posts')
  const [chatFilter, setChatFilter] = useState('all')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [directMessages, setDirectMessages] = useState([])
  const [directMessageConversationId, setDirectMessageConversationId] = useState(null)
  const [directLoading, setDirectLoading] = useState(false)
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
  const [workspaceDocuments, setWorkspaceDocuments] = useState([])
  const [workspaceFiles, setWorkspaceFiles] = useState([])
  const [sharedDocumentIds, setSharedDocumentIds] = useState([])
  const [sharedFileIds, setSharedFileIds] = useState([])
  const [uploadingFile, setUploadingFile] = useState(false)
  const [channelForm, setChannelForm] = useState({ name: '', description: '', is_private: false, member_ids: [] })
  const [directMemberIds, setDirectMemberIds] = useState([])
  const messageScrollRef = useRef(null)
  const messageInputRef = useRef(null)
  const draftKeyRef = useRef(null)
  const channels = data.channels || []
  const conversations = data.directConversations || []
  const selectedChannelInfo = channels.find(channel => channel.name === selectedChannel)
  const selectedConversation = conversations.find(conversation => conversation.id === selectedConversationId)
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
  }, [viewType])

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
    fetch(`/api/direct-conversations/${selectedConversationId}/messages/`, { credentials: 'include' })
      .then(response => response.json().then(payload => ({ response, payload })))
      .then(({ response, payload }) => {
        if (!response.ok) throw new Error(payload.error || 'Direct messages could not be loaded.')
        if (current) {
          setDirectMessages(payload.messages)
          setDirectMessageConversationId(selectedConversationId)
        }
      })
      .catch(loadError => { if (current) setError(loadError.message) })
      .finally(() => { if (current) setDirectLoading(false) })
    return () => { current = false }
  }, [selectedConversationId, data.directConversations])

  // Which conversation the fetched messages belong to. The workspace refresh
  // hands back directConversations as a fresh array whenever anything in the
  // workspace changes, including changes with nothing to do with chat, so this
  // fetch re-runs often. Without the id there was no way to tell "I have no
  // messages for this conversation yet" apart from "I am re-fetching the one I
  // am already reading", and every re-run swapped the thread for the loading
  // placeholder.
  const directThreadReady = directMessageConversationId === selectedConversationId
  const visibleChannelMessages = data.messages.filter(message => message.channel === selectedChannel && (!search.trim() || `${message.author_name} ${message.message}`.toLowerCase().includes(search.trim().toLowerCase())))
  const visibleDirectMessages = directThreadReady ? directMessages.filter(message => !search.trim() || `${message.author_name} ${message.message}`.toLowerCase().includes(search.trim().toLowerCase())) : []
  const groupedMessages = visibleChannelMessages.reduce((groups, message) => {
    const key = toDateKey(message.created_at)
    ;(groups[key] ||= []).push(message)
    return groups
  }, {})
  const unreadCountFor = (targetType, targetId) => data.notifications.filter(
    notification => notification.target_type === targetType && notification.target_id === String(targetId) && !notification.read,
  ).length
  const unreadTotal = mode === 'channels'
    ? channels.reduce((total, channel) => total + unreadCountFor('chat_channel', channel.name), 0)
    : conversations.reduce((total, conversation) => total + unreadCountFor('direct_conversation', conversation.id), 0)
  const filteredChannels = chatFilter === 'unread' ? channels.filter(channel => unreadCountFor('chat_channel', channel.name) > 0) : channels
  const filteredConversations = chatFilter === 'unread' ? conversations.filter(conversation => unreadCountFor('direct_conversation', conversation.id) > 0) : conversations
  const groupConversations = filteredConversations.filter(conversation => conversation.is_group)
  const directConversations = filteredConversations.filter(conversation => !conversation.is_group)
  const activeMessages = mode === 'channels'
    ? data.messages.filter(message => message.channel === selectedChannel)
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

  // Pin the feed to the newest message by scrolling the feed element itself.
  // scrollIntoView also scrolls every scrollable ancestor, which made the whole
  // page jump instead of simply revealing the message that was just sent.
  useLayoutEffect(() => {
    const scroller = messageScrollRef.current
    if (!scroller) return
    scroller.scrollTop = scroller.scrollHeight
  }, [mode, selectedChannel, selectedConversationId, activePane, directLoading, lastChannelMessageId, lastDirectMessageId, visibleChannelMessages.length, visibleDirectMessages.length])

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
      setDraft('')
      setReplyTo(null)
      setSharedDocumentIds([]); setSharedFileIds([]); setShareOpen(false)
      setEmojiOpen(false)
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
  useEffect(() => {
    const openFromToday = event => {
      const memberId = Number(event.detail?.memberId)
      if (memberId && memberId !== Number(currentUserId)) openDirectConversation([memberId])
    }
    window.addEventListener('chat:direct', openFromToday)
    return () => window.removeEventListener('chat:direct', openFromToday)
  }, [currentUserId, workspaceId, submitting])

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

  const deleteConversation = async conversation => {
    const confirmed = await onConfirm(
      'Delete this chat from your chat list? New messages will bring it back.',
      { title: 'Delete chat', confirmLabel: 'Delete chat' },
    )
    if (!confirmed) return
    try {
      const response = await fetch(`/api/direct-conversations/${conversation.id}/`, {
        method: 'DELETE', credentials: 'include', headers: { 'X-CSRFToken': await getCsrfToken() },
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Chat could not be deleted.')
      if (selectedConversationId === conversation.id) {
        setSelectedConversationId(null)
        setDirectMessages([])
        setDirectMessageConversationId(null)
      }
      onRefresh()
    } catch (deleteError) {
      onError(deleteError.message)
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
    if (!participantConversation || groupMemberIds.length < 2 || submitting) return
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
  const memberForMessage = message => data.members.find(member => String(member.id) === String(message.author_id)) || { id: message.author_id, email: message.author_name, role: 'member' }
  const directOtherMember = conversation => {
    if (conversation.is_group) return null
    const other = (conversation.participants || []).find(participant => String(participant.id) !== String(currentUserId))
    return data.members.find(member => String(member.id) === String(other?.id)) || null
  }
  const toggleMember = (id, selectedIds, updateSelectedIds) => updateSelectedIds(selectedIds.includes(id) ? selectedIds.filter(value => value !== id) : [...selectedIds, id])
  const insertEmoji = emoji => {
    const input = messageInputRef.current
    const start = input?.selectionStart ?? draft.length
    const end = input?.selectionEnd ?? start
    const nextDraft = `${draft.slice(0, start)}${emoji}${draft.slice(end)}`
    setDraft(nextDraft.slice(0, 4000))
    setEmojiOpen(false)
    requestAnimationFrame(() => {
      const cursor = Math.min(start + emoji.length, 4000)
      messageInputRef.current?.focus()
      messageInputRef.current?.setSelectionRange(cursor, cursor)
    })
  }
  const insertMention = member => {
    const input = messageInputRef.current
    const start = input?.selectionStart ?? draft.length
    const end = input?.selectionEnd ?? start
    const context = getMentionContext(draft, start)
    const replaceStart = context?.start ?? start
    const replaceEnd = context?.end ?? end
    const alias = (member.email || memberName(member)).split('@')[0].trim().toLowerCase().replace(/\s+/g, '')
    const prefix = !context && start && !/\s/.test(draft[start - 1]) ? ' ' : ''
    const mention = `${prefix}@${alias} `
    setDraft(`${draft.slice(0, replaceStart)}${mention}${draft.slice(replaceEnd)}`.slice(0, 4000))
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
  const selectChannel = channelName => {
    setSelectedChannel(channelName)
    setSearch('')
    setReplyTo(null)
    setActivePane('posts')
    markConversationRead('chat_channel', channelName)
  }
  const selectConversation = conversationId => {
    setSelectedConversationId(conversationId)
    setSearch('')
    setReplyTo(null)
    setActivePane('posts')
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
    setEditingMessageId(message.id)
    setEditDraft(messageEdits[message.id]?.message ?? message.message)
    setError('')
  }
  const cancelEditing = () => {
    setEditingMessageId(null)
    setEditDraft('')
  }
  const saveEdit = async message => {
    const text = editDraft.trim()
    if (!text) { setError('Message is required.'); return }
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
      setMessageEdits(current => ({ ...current, [message.id]: payload.message }))
      cancelEditing()
    } catch (editError) { setError(editError.message) }
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
    if (mode === 'channels' && selectedChannel) markConversationRead('chat_channel', selectedChannel)
  }, [mode, selectedChannel, workspaceId])
  const renderMessage = message => {
    const parent = message.parent_id ? (mode === 'channels' ? data.messages : directMessages).find(item => item.id === message.parent_id) : null
    const reactions = reactionUpdates[message.id] || message.reactions || []
    const author = memberForMessage(message)
    const isMine = String(author.id) === String(currentUserId)
    const edit = messageEdits[message.id]
    const bodyText = edit ? edit.message : message.message
    const editedAt = edit ? edit.edited_at : message.edited_at
    const deletedAt = messageDeletes[message.id]?.deleted_at || message.deleted_at
    const isEditing = editingMessageId === message.id
    const receiptScope = mode === 'direct' && !selectedConversation?.is_group ? '' : ' by everyone'
    const receiptLabel = message.read ? `Read${receiptScope}` : message.delivered ? 'Delivered' : 'Sent'
    return <div className={`chat-message ${message.parent_id ? 'chat-reply' : ''} ${isMine ? 'chat-message-mine' : ''}`} key={message.id}>
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
          {isEditing ? <div className="chat-edit-form">
            <textarea value={editDraft} onChange={event => setEditDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); cancelEditing() } }} maxLength="4000" aria-label="Edit message" autoFocus />
            <div className="chat-edit-actions">
              <button type="button" className="chat-edit-save" onClick={() => saveEdit(message)}>Save changes</button>
              <button type="button" className="chat-edit-cancel" onClick={cancelEditing}>Cancel</button>
            </div>
          </div> : deletedAt ? <p className="chat-deleted-text" title={`Deleted ${formatRelativeActivityTime(deletedAt)}`}>This message was deleted</p> : <p>{renderMessageText(bodyText)}</p>}
          {!isEditing && !deletedAt && <MessageReactionBar message={message} reactions={reactions} isMine={isMine} onToggle={toggleReaction} />}
          {!isEditing && !deletedAt && !message.parent_id && <button type="button" className="chat-reply-button" onClick={() => setReplyTo(message)}>Reply{message.reply_count ? ` (${message.reply_count})` : ''}</button>}
          {!isEditing && isMine && !deletedAt && <button type="button" className="chat-edit-button" onClick={() => startEditing(message)}>Edit</button>}
          {!isEditing && isMine && !deletedAt && <button type="button" className="chat-delete-button" onClick={() => deleteMessage(message)} aria-label="Delete message">Delete</button>}
        </div>
        {!deletedAt && (message.shared_documents || []).map(document => <div className="chat-shared-card chat-shared-card-disabled" key={`doc-${document.id}`}><FileText size={16} /><span><strong>{document.title}</strong><small>Document sharing is temporarily unavailable</small></span></div>)}
        {!deletedAt && (message.shared_files || []).map(file => isImageFileName(file.original_name) && file.url ? <a className="chat-shared-image" key={`file-${file.id}`} href={file.url} target="_blank" rel="noreferrer" aria-label={`Open image ${file.original_name}`}><img src={file.url} alt={file.original_name} loading="lazy" /></a> : <a className="chat-shared-card" key={`file-${file.id}`} href={file.url} target="_blank" rel="noreferrer"><FileText size={16} /><span><strong>{file.original_name}</strong><small>Open or download file</small></span><Download size={14} /></a>)}
      </div>
    </div>
  }

  const renderPostsPane = () => <div className="chat-message-scroll" ref={messageScrollRef}>
    {mode === 'channels' ? (visibleChannelMessages.length
      ? Object.entries(groupedMessages).map(([date, messages]) => <div className="chat-day" key={date}><h3>{date === toDateKey(new Date()) ? 'Today' : date === toDateKey(new Date(Date.now() - 86400000)) ? 'Yesterday' : new Date(`${date}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</h3>{messages.map(renderMessage)}</div>)
      : <div className="chat-placeholder"><div className="chat-placeholder-icon"><MessageSquare size={22} /></div><h2>{search ? 'No matching messages' : `No messages in #${selectedChannel}`}</h2><p>{search ? 'Try a different search term.' : 'Start the conversation below.'}</p></div>)
      : selectedConversation
        ? (directThreadReady
          ? (visibleDirectMessages.length ? visibleDirectMessages.map(renderMessage) : <div className="chat-placeholder"><h2>{search ? 'No matching messages' : 'No messages yet'}</h2><p>Send the first private message below.</p></div>)
      : directLoading ? <div className="chat-placeholder"><p>Loading messages...</p></div> : <div className="chat-placeholder"><h2>Messages could not be loaded</h2><p>{error || 'Open the conversation again to retry.'}</p></div>)
        : <div className="chat-placeholder"><div className="chat-placeholder-icon"><Users size={22} /></div><h2>Start a private conversation</h2><p>Choose an existing conversation or create a new one.</p></div>}
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
    const title = isChannel ? `#${selectedChannel}` : selectedConversation?.title || 'Chat'
    const description = isChannel ? (selectedChannelInfo?.description || 'No channel description yet.') : selectedConversation?.is_group ? 'Group conversation for workspace collaboration.' : 'Private one-to-one conversation.'
    return <div className="chat-pane-scroll chat-about-panel" aria-label="About this conversation">
      <div className="chat-about-hero"><span className="chat-about-icon">{isChannel ? <Hash size={23} /> : selectedConversation?.is_group ? <Users size={23} /> : <MessageSquare size={23} />}</span><div><p className="eyebrow">{isChannel ? 'Channel' : selectedConversation?.is_group ? 'Group chat' : 'Direct chat'}</p><h2>{title}</h2><p>{description}</p></div></div>
      <dl className="chat-about-grid">
        <div><dt>Participants</dt><dd>{isChannel ? selectedMembers.length : selectedConversation?.participants?.length || 0}</dd></div>
        <div><dt>Shared items</dt><dd>{sharedItems.length}</dd></div>
        <div><dt>Privacy</dt><dd>{isChannel ? (selectedChannelInfo?.is_private ? 'Private' : 'Workspace') : selectedConversation?.is_group ? 'Group members' : 'Private'}</dd></div>
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
    return <div className="channel-row-wrap" key={channel.id}>
      <button type="button" className={`channel-row ${selectedChannel === channel.name ? 'active' : ''}`} onClick={() => selectChannel(channel.name)}>
        {channel.is_private ? <span className="channel-private-mark">•</span> : <Hash size={15} />}
        <span className="channel-name">{channel.name}</span>
        {unread > 0 && <Badge>{unread}</Badge>}
      </button>
      {channel.name !== 'general' && channel.created_by === currentUserId && <button type="button" className="channel-delete" onClick={() => deleteChannel(channel)} aria-label={`Delete ${channel.name}`}><X size={13} /></button>}
    </div>
  }

  const renderDirectConversationRow = conversation => {
    const unread = unreadCountFor('direct_conversation', conversation.id)
    const other = directOtherMember(conversation)
    const otherPresence = other ? effectivePresence(other) : null
    return <div className="direct-row-wrap" key={conversation.id}>
      <button type="button" className={`direct-row ${selectedConversationId === conversation.id ? 'active' : ''}`} onClick={() => selectConversation(conversation.id)}>
        <span className={`avatar blue small ${conversation.is_group ? 'group-chat-avatar' : ''}`}>{conversation.is_group ? <Users size={14} /> : conversation.title.slice(0, 2).toUpperCase()}{otherPresence && <span className={`presence-dot presence-${otherPresence}`} title={PRESENCE_LABEL[otherPresence] || otherPresence} />}</span>
        <span><strong>{conversation.title}</strong><small>{conversation.is_group ? `Group - ${conversation.participants.length} people` : conversation.last_message_deleted ? 'This message was deleted' : conversation.last_message || 'Direct chat'}</small></span>
        {unread > 0 && <Badge>{unread}</Badge>}
      </button>
      <div className="direct-row-actions">
        {conversation.is_group && <button type="button" onClick={() => openParticipantEditor(conversation)} aria-label={`Edit participants for ${conversation.title}`} title="Edit participants"><Pencil size={13} /></button>}
        <button type="button" className="direct-row-delete" onClick={() => deleteConversation(conversation)} aria-label={`Delete ${conversation.title} chat`} title="Delete chat"><Trash2 size={13} /></button>
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
          <div className="chat-feed-heading"><div>{mode === 'channels' ? <><h2><Hash size={17} /> {selectedChannel}</h2><p>{selectedChannelInfo?.description || 'Team conversation'}</p></> : selectedConversation ? <><h2>{selectedConversation.is_group && <Users size={17} />}{selectedConversation.title}</h2><p>{selectedConversation.is_group ? `Group chat · ${selectedConversation.participants.length} people` : 'Direct chat · only you two'}</p></> : <><h2>Chats</h2><p>Select a person or start a group chat</p></>}</div></div>
          <button type="button" className={`chat-details-toggle ${detailsOpen ? 'active' : ''}`} onClick={() => setDetailsOpen(open => !open)} aria-label={detailsOpen ? 'Hide conversation details' : 'Show conversation details'} aria-expanded={detailsOpen} disabled={mode === 'direct' && !selectedConversation}><PanelRight size={17} /></button>
        </div>
        <nav className="chat-pane-tabs" role="tablist" aria-label="Conversation views">
          <button type="button" role="tab" aria-selected={activePane === 'posts'} className={activePane === 'posts' ? 'active' : ''} onClick={() => setActivePane('posts')}><MessageSquare size={15} /> Posts</button>
          <button type="button" role="tab" aria-selected={activePane === 'files'} className={activePane === 'files' ? 'active' : ''} onClick={() => setActivePane('files')}><FolderOpen size={15} /> Files{sharedItems.length > 0 && <span>{sharedItems.length}</span>}</button>
          <button type="button" role="tab" aria-selected={activePane === 'about'} className={activePane === 'about' ? 'active' : ''} onClick={() => setActivePane('about')}><Info size={15} /> About</button>
        </nav>
        <div className={`chat-feed-body ${detailsOpen ? 'details-open' : ''}`}>
          <div className="chat-main-pane">
            {activePane === 'posts' ? renderPostsPane() : activePane === 'files' ? renderFilesPane() : renderAboutPane()}
        {activePane === 'posts' && (mode === 'channels' || selectedConversation) && <form className="chat-inline-composer" onSubmit={mode === 'channels' ? submitChannelMessage : submitDirectMessage}>
          {replyTo && <div className="reply-context"><span>Replying to <strong>{replyTo.author_name}</strong>: {replyTo.message.slice(0, 100)}</span><button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply"><X size={14} /></button></div>}
          {(sharedDocumentIds.length > 0 || sharedFileIds.length > 0) && <div className="chat-pending-attachments" aria-label="Files attached to this message">{sharedDocumentIds.map(id => { const document = workspaceDocuments.find(item => item.id === id); return <span key={`pending-document-${id}`}><FileText size={14} />{document?.title || 'Document'}<button type="button" onClick={() => setSharedDocumentIds(current => current.filter(value => value !== id))} aria-label={`Remove ${document?.title || 'document'}`}><X size={12} /></button></span> })}{sharedFileIds.map(id => { const file = workspaceFiles.find(item => item.id === id); return <span key={`pending-file-${id}`}><Paperclip size={14} />{file?.original_name || 'File'}<button type="button" onClick={() => setSharedFileIds(current => current.filter(value => value !== id))} aria-label={`Remove ${file?.original_name || 'file'}`}><X size={12} /></button></span> })}</div>}
          <div className="chat-compose-surface">
            <textarea ref={messageInputRef} value={draft} onChange={event => { const nextDraft = event.target.value; setDraft(nextDraft); const context = getMentionContext(nextDraft, event.target.selectionStart ?? nextDraft.length); setMentionOpen(Boolean(context)); setMentionQuery(context?.query || ''); if (context) { setEmojiOpen(false); setShareOpen(false) } }} onKeyDown={event => { if (event.key === 'Escape' && mentionOpen) { event.preventDefault(); setMentionOpen(false); setMentionQuery(''); return } if (event.key === 'Enter' && !event.shiftKey && mentionOpen && mentionMembers.length) { event.preventDefault(); insertMention(mentionMembers[0]); return } if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form.requestSubmit() } }} placeholder={mode === 'channels' ? `Message #${selectedChannel}` : `Message ${selectedConversation?.title}`} maxLength="4000" aria-label="Message" />
            <div className="chat-compose-toolbar">
            <Popover.Root open={mentionOpen} onOpenChange={nextOpen => { setMentionOpen(nextOpen); setMentionQuery(''); if (nextOpen) { setEmojiOpen(false); setShareOpen(false) } }}><Popover.Trigger asChild><button type="button" className={mentionOpen ? 'chat-emoji-trigger active' : 'chat-emoji-trigger'} aria-label="Mention a teammate" aria-expanded={mentionOpen}>@</button></Popover.Trigger><Popover.Portal><Popover.Content className="chat-mention-popup" side="top" align="start" sideOffset={8} collisionPadding={12} aria-label="Mention a workspace member"><MentionPicker members={mentionMembers} getMemberName={memberName} onSelect={insertMention} /><Popover.Arrow className="chat-mention-popup-arrow" /></Popover.Content></Popover.Portal></Popover.Root>
            <Popover.Root open={emojiOpen} onOpenChange={nextOpen => { setEmojiOpen(nextOpen); if (nextOpen) { setMentionOpen(false); setShareOpen(false) } }}><Popover.Trigger asChild><button type="button" className={`chat-emoji-trigger ${emojiOpen ? 'active' : ''}`} aria-label="Add emoji" aria-expanded={emojiOpen}><Smile size={18} /></button></Popover.Trigger><Popover.Portal><Popover.Content className="chat-emoji-popup" side="top" align="start" sideOffset={8} collisionPadding={12} aria-label="Choose an emoji"><EmojiPicker onSelect={insertEmoji} /><Popover.Arrow className="chat-emoji-popup-arrow" /></Popover.Content></Popover.Portal></Popover.Root>
            <label className="secondary-button chat-upload-button" aria-label="Upload and attach a file"><Paperclip size={15} /> {uploadingFile ? 'Uploading...' : 'Attach file'}<input type="file" hidden onChange={uploadChatFile} disabled={uploadingFile} /></label>
            <button type="submit" className="primary-button" disabled={submitting || uploadingFile || (!draft.trim() && !sharedDocumentIds.length && !sharedFileIds.length)}>{submitting ? 'Sending…' : 'Send'}</button>
          </div>
          </div>
          <small className="chat-compose-hint">Enter to send. Shift + Enter for a new line.</small>
          {error && <p className="auth-error" role="alert">{error}</p>}
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
        </div>
        <div className="chat-list-scroll">
          {mode === 'channels'
            ? (filteredChannels.length ? filteredChannels.map(renderChannelRow) : <p className="chat-sidebar-empty">No unread channels.</p>)
            : filteredConversations.length
              ? <>
                {groupConversations.length > 0 && <section className="chat-list-group"><h4>Group chats <span>{groupConversations.length}</span></h4><div className="chat-list-group-rows">{groupConversations.map(renderDirectConversationRow)}</div></section>}
                {directConversations.length > 0 && <section className="chat-list-group"><h4>Direct messages <span>{directConversations.length}</span></h4><div className="chat-list-group-rows">{directConversations.map(renderDirectConversationRow)}</div></section>}
              </>
              : <p className="chat-sidebar-empty">{chatFilter === 'unread' ? 'No unread conversations.' : 'No chats yet.'}</p>}
        </div>
      </aside>
    </div>
    {channelDialogOpen && <div className="modal-backdrop" onMouseDown={() => setChannelDialogOpen(false)}><form className="modal chat-create-modal" role="dialog" aria-modal="true" aria-labelledby="create-channel-title" onSubmit={createChannel} onMouseDown={event => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">Channels</p><h2 id="create-channel-title">Create a channel</h2></div><button type="button" className="close-button" onClick={() => setChannelDialogOpen(false)} aria-label="Close"><X size={18} /></button></div><label>Channel name<input autoFocus value={channelForm.name} onChange={event => setChannelForm(current => ({ ...current, name: event.target.value }))} placeholder="e.g. product-launch" maxLength="80" required /></label><label>Description<textarea value={channelForm.description} onChange={event => setChannelForm(current => ({ ...current, description: event.target.value }))} placeholder="What is this channel for?" maxLength="240" /></label><label className="chat-privacy-toggle"><input type="checkbox" checked={channelForm.is_private} onChange={event => setChannelForm(current => ({ ...current, is_private: event.target.checked, member_ids: [] }))} /> Private channel</label>{channelForm.is_private && <div className="chat-member-picker"><span>Add members</span>{data.members.filter(member => member.id !== currentUserId).map(member => <label key={member.id}><input type="checkbox" checked={channelForm.member_ids.includes(member.id)} onChange={() => toggleMember(member.id, channelForm.member_ids, member_ids => setChannelForm(current => ({ ...current, member_ids })))} /> {memberName(member)}</label>)}</div>}{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary-button modal-submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create channel'}</button></form></div>}
    {directDialogOpen && <div className="modal-backdrop" onMouseDown={() => setDirectDialogOpen(false)}><form className="modal chat-create-modal" role="dialog" aria-modal="true" aria-labelledby="create-direct-title" onSubmit={createDirectConversation} onMouseDown={event => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">Private chats</p><h2 id="create-direct-title">New chat</h2><p className="modal-subtitle">Choose one person for a direct chat or several people for a group chat.</p></div><button type="button" className="close-button" onClick={() => setDirectDialogOpen(false)} aria-label="Close"><X size={18} /></button></div><div className="chat-member-picker"><span>Choose people</span>{data.members.filter(member => member.id !== currentUserId).map(member => <label key={member.id}><input type="checkbox" checked={directMemberIds.includes(member.id)} onChange={() => toggleMember(member.id, directMemberIds, setDirectMemberIds)} /> {memberName(member)}</label>)}</div>{directMemberIds.length > 0 && <p className="chat-selection-summary">{directMemberIds.length === 1 ? 'Direct chat' : `Group chat with ${directMemberIds.length + 1} people`}</p>}{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary-button modal-submit" disabled={submitting || !directMemberIds.length}>{submitting ? 'Starting…' : directMemberIds.length > 1 ? 'Start group chat' : 'Start direct chat'}</button></form></div>}
    {profileMember && <div className="modal-backdrop" onMouseDown={() => setProfileMember(null)}><section className="modal chat-member-profile" role="dialog" aria-modal="true" aria-labelledby="chat-member-profile-title" onMouseDown={event => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">Workspace member</p><h2 id="chat-member-profile-title">{memberName(profileMember)}</h2></div><button type="button" className="close-button" onClick={() => setProfileMember(null)} aria-label="Close profile"><X size={18} /></button></div><div className="chat-member-profile-summary"><span className="avatar blue">{memberName(profileMember).slice(0, 2).toUpperCase()}</span><div><strong>{memberName(profileMember)}</strong><span>{profileMember.email}</span></div></div><dl><div><dt>Role</dt><dd>{profileMember.role || 'Member'}</dd></div><div><dt>Availability</dt><dd>{profileMember.presence || 'Available'}</dd></div><div><dt>Member since</dt><dd>{profileMember.joined_at ? new Date(profileMember.joined_at).toLocaleDateString() : 'Not available'}</dd></div></dl></section></div>}
    {participantConversation && <div className="modal-backdrop" onMouseDown={() => { setParticipantConversation(null); setGroupMemberIds([]); setError('') }}><form className="modal chat-create-modal chat-participant-modal" role="dialog" aria-modal="true" aria-labelledby="edit-group-participants-title" onSubmit={saveGroupParticipants} onMouseDown={event => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">Group chat</p><h2 id="edit-group-participants-title">Edit participants</h2><p className="modal-subtitle">Choose at least two other workspace members. You will stay in this group chat.</p></div><button type="button" className="close-button" onClick={() => { setParticipantConversation(null); setGroupMemberIds([]); setError('') }} aria-label="Close"><X size={18} /></button></div><div className="chat-member-picker"><span>Choose participants</span>{data.members.filter(member => String(member.id) !== String(currentUserId)).map(member => <label key={member.id}><input type="checkbox" checked={groupMemberIds.includes(member.id)} onChange={() => toggleMember(member.id, groupMemberIds, setGroupMemberIds)} /> {memberName(member)}</label>)}</div><p className="chat-selection-summary">Group chat with {groupMemberIds.length + 1} people</p>{groupMemberIds.length < 2 && <p className="chat-selection-error">Choose at least two other members.</p>}{error && <p className="auth-error" role="alert">{error}</p>}<div className="chat-modal-actions"><button type="button" className="secondary-button" onClick={() => { setParticipantConversation(null); setGroupMemberIds([]); setError('') }}>Cancel</button><button type="submit" className="primary-button" disabled={submitting || groupMemberIds.length < 2}>{submitting ? 'Saving...' : 'Save participants'}</button></div></form></div>}
  </section>
}

export { ChatWorkspaceView }
