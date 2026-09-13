import { AppSelect } from './ui/select.jsx'
// Channels and direct messages, plus the shared composer modal used for every
// "create a record" flow (events, projects, check-ins, chat, follow-ups, invites).

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { ArrowUpRight, Check, CheckCheck, Download, FileText, Hash, MessageSquare, Paperclip, Plus, Search, Smile, Users, X } from 'lucide-react'
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

function ChatWorkspaceView({ viewType, data, workspaceId, currentUserId, onRefresh, onError, onConfirm, onNavigate }) {
  const mode = viewType
  const [selectedChannel, setSelectedChannel] = useState('general')
  const [selectedConversationId, setSelectedConversationId] = useState(null)
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
  const [shareOpen, setShareOpen] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [profileMember, setProfileMember] = useState(null)
  const [reactionUpdates, setReactionUpdates] = useState({})
  const [messageEdits, setMessageEdits] = useState({})
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
  const channels = data.channels || []
  const conversations = data.directConversations || []
  const selectedChannelInfo = channels.find(channel => channel.name === selectedChannel)
  const selectedConversation = conversations.find(conversation => conversation.id === selectedConversationId)

  useEffect(() => {
    setSearch('')
    setDraft('')
    setReplyTo(null)
    setEmojiOpen(false)
    setMentionOpen(false)
    setMentionQuery('')
    setError('')
  }, [viewType])

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

  const lastChannelMessageId = visibleChannelMessages.length ? visibleChannelMessages[visibleChannelMessages.length - 1].id : null
  const lastDirectMessageId = visibleDirectMessages.length ? visibleDirectMessages[visibleDirectMessages.length - 1].id : null

  // Pin the feed to the newest message by scrolling the feed element itself.
  // scrollIntoView also scrolls every scrollable ancestor, which made the whole
  // page jump instead of simply revealing the message that was just sent.
  useLayoutEffect(() => {
    const scroller = messageScrollRef.current
    if (!scroller) return
    scroller.scrollTop = scroller.scrollHeight
  }, [mode, selectedChannel, selectedConversationId, directLoading, lastChannelMessageId, lastDirectMessageId, visibleChannelMessages.length, visibleDirectMessages.length])

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
    const isEditing = editingMessageId === message.id
    const receiptScope = mode === 'direct' && !selectedConversation?.is_group ? '' : ' by everyone'
    const receiptLabel = message.read ? `Read${receiptScope}` : message.delivered ? 'Delivered' : 'Sent'
    return <div className={`chat-message ${message.parent_id ? 'chat-reply' : ''} ${isMine ? 'chat-message-mine' : ''}`} key={message.id}>
      <Avatar name={message.author_name} avatarUrl={author.avatar_url} presence={effectivePresence(author)} small />
      <div className="chat-message-body">
        <div className="chat-message-meta">
          {isMine ? <strong>{message.author_name}</strong> : <button type="button" className="chat-member-name" onClick={() => setProfileMember(author)} aria-label={`View ${message.author_name}'s profile`}>{message.author_name}</button>}
          <span>{formatRelativeActivityTime(message.created_at)}</span>
          {isMine && <span className={`chat-receipt${message.read ? ' chat-receipt-read' : ''}`} aria-label={receiptLabel} title={receiptLabel}>{message.read || message.delivered ? <CheckCheck size={14} /> : <Check size={14} />}</span>}
          {editedAt && <span className="chat-edited-marker" title={`Edited ${formatRelativeActivityTime(editedAt)}`}>edited</span>}
        </div>
        {message.parent_id && <div className="chat-reply-context"><strong>{parent?.author_name || 'Original message'}</strong><span>{parent?.message || 'Original message is unavailable.'}</span></div>}
        <div className={`chat-message-bubble chat-member-tone-${Number(author.id) % 5}`}>
          {isEditing ? <div className="chat-edit-form">
            <textarea value={editDraft} onChange={event => setEditDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); cancelEditing() } }} maxLength="4000" aria-label="Edit message" autoFocus />
            <div className="chat-edit-actions">
              <button type="button" className="chat-edit-save" onClick={() => saveEdit(message)}>Save changes</button>
              <button type="button" className="chat-edit-cancel" onClick={cancelEditing}>Cancel</button>
            </div>
          </div> : <p>{renderMessageText(bodyText)}</p>}
          {!isEditing && <MessageReactionBar message={message} reactions={reactions} isMine={isMine} onToggle={toggleReaction} />}
          {!isEditing && !message.parent_id && <button type="button" className="chat-reply-button" onClick={() => { setReplyTo(message); setDraft('') }}>Reply{message.reply_count ? ` (${message.reply_count})` : ''}</button>}
          {!isEditing && isMine && <button type="button" className="chat-edit-button" onClick={() => startEditing(message)}>Edit</button>}
        </div>
        {(message.shared_documents || []).map(document => <div className="chat-shared-card chat-shared-card-disabled" key={`doc-${document.id}`}><FileText size={16} /><span><strong>{document.title}</strong><small>Document sharing is temporarily unavailable</small></span></div>)}
        {(message.shared_files || []).map(file => isImageFileName(file.original_name) && file.url ? <a className="chat-shared-image" key={`file-${file.id}`} href={file.url} target="_blank" rel="noreferrer" aria-label={`Open image ${file.original_name}`}><img src={file.url} alt={file.original_name} loading="lazy" /></a> : <a className="chat-shared-card" key={`file-${file.id}`} href={file.url} target="_blank" rel="noreferrer"><FileText size={16} /><span><strong>{file.original_name}</strong><small>Open or download file</small></span><Download size={14} /></a>)}
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
      <section className="chat-feed">
        <div className="chat-feed-heading"><div>{mode === 'channels' ? <><h2><Hash size={17} /> {selectedChannel}</h2><p>{selectedChannelInfo?.description || 'Team conversation'}</p></> : selectedConversation ? <><h2>{selectedConversation.is_group && <Users size={17} />}{selectedConversation.title}</h2><p>{selectedConversation.is_group ? `Group chat · ${selectedConversation.participants.length} people` : 'Direct chat · only you two'}</p></> : <><h2>Chats</h2><p>Select a person or start a group chat</p></>}</div></div>
        <div className="chat-message-scroll" ref={messageScrollRef}>{mode === 'channels' ? (visibleChannelMessages.length ? Object.entries(groupedMessages).map(([date, messages]) => <div className="chat-day" key={date}><h3>{date === toDateKey(new Date()) ? 'Today' : date === toDateKey(new Date(Date.now() - 86400000)) ? 'Yesterday' : new Date(`${date}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</h3>{messages.map(renderMessage)}</div>) : <div className="chat-placeholder"><div className="chat-placeholder-icon"><MessageSquare size={22} /></div><h2>{search ? 'No matching messages' : `No messages in #${selectedChannel}`}</h2><p>{search ? 'Try a different search term.' : 'Start the conversation below.'}</p></div>) : selectedConversation ? (directThreadReady ? (visibleDirectMessages.length ? visibleDirectMessages.map(renderMessage) : <div className="chat-placeholder"><h2>{search ? 'No matching messages' : 'No messages yet'}</h2><p>Send the first private message below.</p></div>) : directLoading ? <div className="chat-placeholder"><p>Loading messages…</p></div> : <div className="chat-placeholder"><h2>Messages could not be loaded</h2><p>{error || 'Open the conversation again to retry.'}</p></div>) : <div className="chat-placeholder"><div className="chat-placeholder-icon"><Users size={22} /></div><h2>Start a private conversation</h2><p>Choose an existing conversation or create a new one.</p></div>}</div>
        {(mode === 'channels' || selectedConversation) && <form className="chat-inline-composer" onSubmit={mode === 'channels' ? submitChannelMessage : submitDirectMessage}>
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
      </section>
      <aside className="chat-conversation-list"><div className="chat-list-heading"><h3>{mode === 'channels' ? 'Channels' : 'Chats'}</h3><button type="button" onClick={() => { setError(''); mode === 'channels' ? setChannelDialogOpen(true) : setDirectDialogOpen(true) }} aria-label={mode === 'channels' ? 'Create channel' : 'New chat'}><Plus size={15} /></button></div>{mode === 'channels' ? channels.map(channel => { const unread = data.notifications.filter(notification => notification.target_type === 'chat_channel' && notification.target_id === channel.name && !notification.read).length; return <div className="channel-row-wrap" key={channel.id}><button type="button" className={`channel-row ${selectedChannel === channel.name ? 'active' : ''}`} onClick={() => { setSelectedChannel(channel.name); setSearch(''); setReplyTo(null); markConversationRead('chat_channel', channel.name) }}>{channel.is_private ? <span className="channel-private-mark">•</span> : <Hash size={15} />}<span className="channel-name">{channel.name}</span>{unread > 0 && <Badge>{unread}</Badge>}</button>{channel.name !== 'general' && channel.created_by === currentUserId && <button type="button" className="channel-delete" onClick={() => deleteChannel(channel)} aria-label={`Delete ${channel.name}`}><X size={13} /></button>}</div> }) : conversations.length ? conversations.map(conversation => { const unread = data.notifications.filter(notification => notification.target_type === 'direct_conversation' && notification.target_id === String(conversation.id) && !notification.read).length; const other = directOtherMember(conversation); const otherPresence = other ? effectivePresence(other) : null; return <button type="button" className={`direct-row ${selectedConversationId === conversation.id ? 'active' : ''}`} key={conversation.id} onClick={() => { setSelectedConversationId(conversation.id); setSearch(''); markConversationRead('direct_conversation', conversation.id) }}><span className={`avatar blue small ${conversation.is_group ? 'group-chat-avatar' : ''}`}>{conversation.is_group ? <Users size={14} /> : conversation.title.slice(0, 2).toUpperCase()}{otherPresence && <span className={`presence-dot presence-${otherPresence}`} title={PRESENCE_LABEL[otherPresence] || otherPresence} />}</span><span><strong>{conversation.title}</strong><small>{conversation.is_group ? `Group · ${conversation.participants.length} people` : conversation.last_message || 'Direct chat'}</small></span>{unread > 0 && <Badge>{unread}</Badge>}</button> }) : <p className="chat-sidebar-empty">No chats yet.</p>}</aside>
    </div>
    {channelDialogOpen && <div className="modal-backdrop" onMouseDown={() => setChannelDialogOpen(false)}><form className="modal chat-create-modal" role="dialog" aria-modal="true" aria-labelledby="create-channel-title" onSubmit={createChannel} onMouseDown={event => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">Channels</p><h2 id="create-channel-title">Create a channel</h2></div><button type="button" className="close-button" onClick={() => setChannelDialogOpen(false)} aria-label="Close"><X size={18} /></button></div><label>Channel name<input autoFocus value={channelForm.name} onChange={event => setChannelForm(current => ({ ...current, name: event.target.value }))} placeholder="e.g. product-launch" maxLength="80" required /></label><label>Description<textarea value={channelForm.description} onChange={event => setChannelForm(current => ({ ...current, description: event.target.value }))} placeholder="What is this channel for?" maxLength="240" /></label><label className="chat-privacy-toggle"><input type="checkbox" checked={channelForm.is_private} onChange={event => setChannelForm(current => ({ ...current, is_private: event.target.checked, member_ids: [] }))} /> Private channel</label>{channelForm.is_private && <div className="chat-member-picker"><span>Add members</span>{data.members.filter(member => member.id !== currentUserId).map(member => <label key={member.id}><input type="checkbox" checked={channelForm.member_ids.includes(member.id)} onChange={() => toggleMember(member.id, channelForm.member_ids, member_ids => setChannelForm(current => ({ ...current, member_ids })))} /> {memberName(member)}</label>)}</div>}{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary-button modal-submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create channel'}</button></form></div>}
    {directDialogOpen && <div className="modal-backdrop" onMouseDown={() => setDirectDialogOpen(false)}><form className="modal chat-create-modal" role="dialog" aria-modal="true" aria-labelledby="create-direct-title" onSubmit={createDirectConversation} onMouseDown={event => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">Private chats</p><h2 id="create-direct-title">New chat</h2><p className="modal-subtitle">Choose one person for a direct chat or several people for a group chat.</p></div><button type="button" className="close-button" onClick={() => setDirectDialogOpen(false)} aria-label="Close"><X size={18} /></button></div><div className="chat-member-picker"><span>Choose people</span>{data.members.filter(member => member.id !== currentUserId).map(member => <label key={member.id}><input type="checkbox" checked={directMemberIds.includes(member.id)} onChange={() => toggleMember(member.id, directMemberIds, setDirectMemberIds)} /> {memberName(member)}</label>)}</div>{directMemberIds.length > 0 && <p className="chat-selection-summary">{directMemberIds.length === 1 ? 'Direct chat' : `Group chat with ${directMemberIds.length + 1} people`}</p>}{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary-button modal-submit" disabled={submitting || !directMemberIds.length}>{submitting ? 'Starting…' : directMemberIds.length > 1 ? 'Start group chat' : 'Start direct chat'}</button></form></div>}
    {profileMember && <div className="modal-backdrop" onMouseDown={() => setProfileMember(null)}><section className="modal chat-member-profile" role="dialog" aria-modal="true" aria-labelledby="chat-member-profile-title" onMouseDown={event => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">Workspace member</p><h2 id="chat-member-profile-title">{memberName(profileMember)}</h2></div><button type="button" className="close-button" onClick={() => setProfileMember(null)} aria-label="Close profile"><X size={18} /></button></div><div className="chat-member-profile-summary"><span className="avatar blue">{memberName(profileMember).slice(0, 2).toUpperCase()}</span><div><strong>{memberName(profileMember)}</strong><span>{profileMember.email}</span></div></div><dl><div><dt>Role</dt><dd>{profileMember.role || 'Member'}</dd></div><div><dt>Availability</dt><dd>{profileMember.presence || 'Available'}</dd></div><div><dt>Member since</dt><dd>{profileMember.joined_at ? new Date(profileMember.joined_at).toLocaleDateString() : 'Not available'}</dd></div></dl></section></div>}
  </section>
}

export { ChatWorkspaceView }
