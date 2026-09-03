// Channels and direct messages, plus the shared composer modal used for every
// "create a record" flow (events, projects, check-ins, chat, follow-ups, invites).

import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Download, FileText, Hash, MessageSquare, Plus, Search, Smile, Users, X } from 'lucide-react'
import { Badge } from './ui/badge.jsx'
import { Card } from './ui/card.jsx'
import { DateField, DateTimeField, SelectField, WorkspaceViewHeading } from './workspace-ui.jsx'
import { formatRelativeActivityTime, getCsrfToken, toDateKey } from '../lib/workspace-format.js'

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
function renderMessageText(text) {
  return String(text || '').split(/(@[A-Za-z0-9_.-]+)/g).map((part, index) => part.startsWith('@') ? <mark className="chat-mention" key={index}>{part}</mark> : <span key={index}>{part}</span>)
}

function EmojiPicker({ onSelect }) {
  const [category, setCategory] = useState(0)
  return <div className="chat-emoji-picker" aria-label="Choose an emoji">
    <div className="chat-emoji-categories" role="tablist" aria-label="Emoji categories">
      {EMOJI_CATEGORIES.map(([label, icon], index) => <button type="button" role="tab" aria-selected={category === index} className={category === index ? 'active' : ''} key={label} title={label} onClick={() => setCategory(index)}><span aria-hidden="true">{icon}</span><small>{label}</small></button>)}
    </div>
    <div className="chat-emoji-grid" role="listbox" aria-label={EMOJI_CATEGORIES[category][0]}>
      {EMOJI_CATEGORIES[category][2].map((emoji, index) => <button type="button" role="option" key={`${emoji}-${index}`} onClick={() => onSelect(emoji)} aria-label={`Insert ${emoji}`}>{emoji}</button>)}
    </div>
  </div>
}

function ChatWorkspaceView({ viewType, data, workspaceId, currentUserId, onRefresh, onError, onConfirm, onNavigate }) {
  const mode = viewType
  const [selectedChannel, setSelectedChannel] = useState('general')
  const [selectedConversationId, setSelectedConversationId] = useState(null)
  const [directMessages, setDirectMessages] = useState([])
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
  const [workspaceDocuments, setWorkspaceDocuments] = useState([])
  const [workspaceFiles, setWorkspaceFiles] = useState([])
  const [sharedDocumentIds, setSharedDocumentIds] = useState([])
  const [sharedFileIds, setSharedFileIds] = useState([])
  const [channelForm, setChannelForm] = useState({ name: '', description: '', is_private: false, member_ids: [] })
  const [directMemberIds, setDirectMemberIds] = useState([])
  const feedEndRef = useRef(null)
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
    setError('')
  }, [viewType])

  useEffect(() => {
    Promise.all([
      fetch(`/api/workspaces/${workspaceId}/documents/`, { credentials: 'include', headers: { 'X-Workspace-Id': String(workspaceId) } }).then(response => response.json()),
      fetch(`/api/workspaces/${workspaceId}/files/`, { credentials: 'include', headers: { 'X-Workspace-Id': String(workspaceId) } }).then(response => response.json()),
    ]).then(([documents, files]) => { setWorkspaceDocuments(documents.documents || []); setWorkspaceFiles(files.files || []) }).catch(() => {})
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
        if (current) setDirectMessages(payload.messages)
      })
      .catch(loadError => { if (current) setError(loadError.message) })
      .finally(() => { if (current) setDirectLoading(false) })
    return () => { current = false }
  }, [selectedConversationId, data.directConversations])

  const visibleChannelMessages = data.messages.filter(message => message.channel === selectedChannel && (!search.trim() || `${message.author_name} ${message.message}`.toLowerCase().includes(search.trim().toLowerCase())))
  const visibleDirectMessages = directMessages.filter(message => !search.trim() || `${message.author_name} ${message.message}`.toLowerCase().includes(search.trim().toLowerCase()))
  const groupedMessages = visibleChannelMessages.reduce((groups, message) => {
    const key = toDateKey(message.created_at)
    ;(groups[key] ||= []).push(message)
    return groups
  }, {})

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [visibleChannelMessages.length, visibleDirectMessages.length, mode])

  const submitChannelMessage = async event => {
    event.preventDefault()
    const messageText = draft.trim()
    if (!messageText || submitting) return
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
    const messageText = draft.trim()
    if (!selectedConversation || !messageText || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch(`/api/direct-conversations/${selectedConversation.id}/messages/`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() },
        body: JSON.stringify({ message: messageText, document_ids: sharedDocumentIds, file_ids: sharedFileIds }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Message could not be sent.')
      setDirectMessages(current => [...current, payload.message])
      setDraft('')
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

  const createDirectConversation = async event => {
    event.preventDefault()
    if (!directMemberIds.length || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/direct-conversations/`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken(), 'X-Workspace-Id': String(workspaceId) },
        body: JSON.stringify({ participant_ids: directMemberIds }),
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
  const renderMessage = message => <div className={`chat-message ${message.parent_id ? 'chat-reply' : ''}`} key={message.id}>
    <span className="avatar blue small">{message.author_name.slice(0, 2).toUpperCase()}</span>
    <div className="chat-message-body"><div className="chat-message-meta"><strong>{message.author_name}</strong><span>{formatRelativeActivityTime(message.created_at)}</span></div><p>{renderMessageText(message.message)}</p>{(message.shared_documents || []).map(document => <button type="button" className="chat-shared-card" key={`doc-${document.id}`} onClick={() => { localStorage.setItem('workspace-open-document-id', String(document.id)); onNavigate?.('Files') }}><FileText size={16} /><span><strong>{document.title}</strong><small>Open in document editor</small></span><ArrowUpRight size={14} /></button>)}{(message.shared_files || []).map(file => <a className="chat-shared-card" key={`file-${file.id}`} href={file.url} target="_blank" rel="noreferrer"><FileText size={16} /><span><strong>{file.original_name}</strong><small>View shared file</small></span><Download size={14} /></a>)}{mode === 'channels' && !message.parent_id && <button type="button" className="chat-reply-button" onClick={() => { setReplyTo(message); setDraft('') }}>Reply{message.reply_count ? ` (${message.reply_count})` : ''}</button>}</div>
  </div>

  return <section className="workspace-view chat-workspace-view">
    <WorkspaceViewHeading title={mode === 'channels' ? 'Channels' : 'Chats'} subtitle={mode === 'channels' ? 'Shared rooms for workspace topics, teams, and projects.' : 'Private one-to-one and group conversations.'} />
    <div className="chat-toolbar"><label className="chat-search"><Search size={15} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder={mode === 'channels' ? `Search #${selectedChannel}` : 'Search this chat'} aria-label="Search messages" /></label><button type="button" className="primary-button chat-create-button" onClick={() => { setError(''); mode === 'channels' ? setChannelDialogOpen(true) : setDirectDialogOpen(true) }}><Plus size={15} /> {mode === 'channels' ? 'Create channel' : 'New chat'}</button></div>
    <div className="chat-layout">
      <Card className="chat-feed">
        <div className="chat-feed-heading"><div>{mode === 'channels' ? <><h2><Hash size={17} /> {selectedChannel}</h2><p>{selectedChannelInfo?.description || 'Team conversation'}</p></> : selectedConversation ? <><h2>{selectedConversation.is_group && <Users size={17} />}{selectedConversation.title}</h2><p>{selectedConversation.is_group ? `Group chat · ${selectedConversation.participants.length} people` : 'Direct chat · only you two'}</p></> : <><h2>Chats</h2><p>Select a person or start a group chat</p></>}</div></div>
        <div className="chat-message-scroll">{mode === 'channels' ? (visibleChannelMessages.length ? Object.entries(groupedMessages).map(([date, messages]) => <div className="chat-day" key={date}><h3>{date === toDateKey(new Date()) ? 'Today' : date === toDateKey(new Date(Date.now() - 86400000)) ? 'Yesterday' : new Date(`${date}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</h3>{messages.map(renderMessage)}</div>) : <div className="chat-placeholder"><div className="chat-placeholder-icon"><MessageSquare size={22} /></div><h2>{search ? 'No matching messages' : `No messages in #${selectedChannel}`}</h2><p>{search ? 'Try a different search term.' : 'Start the conversation below.'}</p></div>) : selectedConversation ? (directLoading ? <div className="chat-placeholder"><p>Loading messages…</p></div> : visibleDirectMessages.length ? visibleDirectMessages.map(renderMessage) : <div className="chat-placeholder"><h2>{search ? 'No matching messages' : 'No messages yet'}</h2><p>Send the first private message below.</p></div>) : <div className="chat-placeholder"><div className="chat-placeholder-icon"><Users size={22} /></div><h2>Start a private conversation</h2><p>Choose an existing conversation or create a new one.</p></div>}<div ref={feedEndRef} /></div>
        {(mode === 'channels' || selectedConversation) && <form className="chat-inline-composer" onSubmit={mode === 'channels' ? submitChannelMessage : submitDirectMessage}>
          {replyTo && mode === 'channels' && <div className="reply-context"><span>Replying to <strong>{replyTo.author_name}</strong>: {replyTo.message.slice(0, 100)}</span><button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply"><X size={14} /></button></div>}
          {shareOpen && <div className="chat-share-picker"><label>Share document<select value="" onChange={event => { if (event.target.value) setSharedDocumentIds(current => [...new Set([...current, Number(event.target.value)])]) }}><option value="">Choose a document…</option>{workspaceDocuments.map(document => <option key={document.id} value={document.id}>{document.title}</option>)}</select></label><label>Share uploaded file<select value="" onChange={event => { if (event.target.value) setSharedFileIds(current => [...new Set([...current, Number(event.target.value)])]) }}><option value="">Choose a file…</option>{workspaceFiles.map(file => <option key={file.id} value={file.id}>{file.original_name}</option>)}</select></label>{(sharedDocumentIds.length || sharedFileIds.length) > 0 && <p className="text-xs text-text-muted">{sharedDocumentIds.length + sharedFileIds.length} item(s) attached</p>}</div>}
          {emojiOpen && <EmojiPicker onSelect={insertEmoji} />}
          <div>
            <textarea ref={messageInputRef} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form.requestSubmit() } }} placeholder={mode === 'channels' ? `Message #${selectedChannel}` : `Message ${selectedConversation?.title}`} maxLength="4000" aria-label="Message" />
            <button type="button" className={`chat-emoji-trigger ${emojiOpen ? 'active' : ''}`} onClick={() => { setEmojiOpen(current => !current); setShareOpen(false) }} aria-label="Add emoji" aria-expanded={emojiOpen}><Smile size={18} /></button>
            <button type="button" className="secondary-button" onClick={() => { setShareOpen(current => !current); setEmojiOpen(false) }} aria-label="Share a file or document">{shareOpen ? 'Close share' : 'Share'}</button>
            <button type="submit" className="primary-button" disabled={submitting || (!draft.trim() && !sharedDocumentIds.length && !sharedFileIds.length)}>{submitting ? 'Sending…' : 'Send'}</button>
          </div>
          {error && <p className="auth-error" role="alert">{error}</p>}
        </form>}
      </Card>
      <Card className="workspace-side-card chat-conversation-list"><div className="chat-list-heading"><h3>{mode === 'channels' ? 'Channels' : 'Chats'}</h3><button type="button" onClick={() => { setError(''); mode === 'channels' ? setChannelDialogOpen(true) : setDirectDialogOpen(true) }} aria-label={mode === 'channels' ? 'Create channel' : 'New chat'}><Plus size={15} /></button></div>{mode === 'channels' ? channels.map(channel => { const unread = data.notifications.filter(notification => notification.target_type === 'chat_channel' && notification.target_id === channel.name && !notification.read).length; return <div className="channel-row-wrap" key={channel.id}><button type="button" className={`channel-row ${selectedChannel === channel.name ? 'active' : ''}`} onClick={() => { setSelectedChannel(channel.name); setSearch(''); setReplyTo(null) }}>{channel.is_private ? <span className="channel-private-mark">•</span> : <Hash size={15} />}<span className="channel-name">{channel.name}</span>{unread > 0 && <Badge>{unread}</Badge>}</button>{channel.name !== 'general' && channel.created_by === currentUserId && <button type="button" className="channel-delete" onClick={() => deleteChannel(channel)} aria-label={`Delete ${channel.name}`}><X size={13} /></button>}</div> }) : conversations.length ? conversations.map(conversation => { const unread = data.notifications.filter(notification => notification.target_type === 'direct_conversation' && notification.target_id === String(conversation.id) && !notification.read).length; return <button type="button" className={`direct-row ${selectedConversationId === conversation.id ? 'active' : ''}`} key={conversation.id} onClick={() => { setSelectedConversationId(conversation.id); setSearch('') }}><span className={`avatar blue small ${conversation.is_group ? 'group-chat-avatar' : ''}`}>{conversation.is_group ? <Users size={14} /> : conversation.title.slice(0, 2).toUpperCase()}</span><span><strong>{conversation.title}</strong><small>{conversation.is_group ? `Group · ${conversation.participants.length} people` : conversation.last_message || 'Direct chat'}</small></span>{unread > 0 && <Badge>{unread}</Badge>}</button> }) : <p className="chat-sidebar-empty">No chats yet.</p>}</Card>
    </div>
    {channelDialogOpen && <div className="modal-backdrop" onMouseDown={() => setChannelDialogOpen(false)}><form className="modal chat-create-modal" role="dialog" aria-modal="true" aria-labelledby="create-channel-title" onSubmit={createChannel} onMouseDown={event => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">Channels</p><h2 id="create-channel-title">Create a channel</h2></div><button type="button" className="close-button" onClick={() => setChannelDialogOpen(false)} aria-label="Close"><X size={18} /></button></div><label>Channel name<input autoFocus value={channelForm.name} onChange={event => setChannelForm(current => ({ ...current, name: event.target.value }))} placeholder="e.g. product-launch" maxLength="80" required /></label><label>Description<textarea value={channelForm.description} onChange={event => setChannelForm(current => ({ ...current, description: event.target.value }))} placeholder="What is this channel for?" maxLength="240" /></label><label className="chat-privacy-toggle"><input type="checkbox" checked={channelForm.is_private} onChange={event => setChannelForm(current => ({ ...current, is_private: event.target.checked, member_ids: [] }))} /> Private channel</label>{channelForm.is_private && <div className="chat-member-picker"><span>Add members</span>{data.members.filter(member => member.id !== currentUserId).map(member => <label key={member.id}><input type="checkbox" checked={channelForm.member_ids.includes(member.id)} onChange={() => toggleMember(member.id, channelForm.member_ids, member_ids => setChannelForm(current => ({ ...current, member_ids })))} /> {memberName(member)}</label>)}</div>}{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary-button modal-submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create channel'}</button></form></div>}
    {directDialogOpen && <div className="modal-backdrop" onMouseDown={() => setDirectDialogOpen(false)}><form className="modal chat-create-modal" role="dialog" aria-modal="true" aria-labelledby="create-direct-title" onSubmit={createDirectConversation} onMouseDown={event => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">Private chats</p><h2 id="create-direct-title">New chat</h2><p className="modal-subtitle">Choose one person for a direct chat or several people for a group chat.</p></div><button type="button" className="close-button" onClick={() => setDirectDialogOpen(false)} aria-label="Close"><X size={18} /></button></div><div className="chat-member-picker"><span>Choose people</span>{data.members.filter(member => member.id !== currentUserId).map(member => <label key={member.id}><input type="checkbox" checked={directMemberIds.includes(member.id)} onChange={() => toggleMember(member.id, directMemberIds, setDirectMemberIds)} /> {memberName(member)}</label>)}</div>{directMemberIds.length > 0 && <p className="chat-selection-summary">{directMemberIds.length === 1 ? 'Direct chat' : `Group chat with ${directMemberIds.length + 1} people`}</p>}{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary-button modal-submit" disabled={submitting || !directMemberIds.length}>{submitting ? 'Starting…' : directMemberIds.length > 1 ? 'Start group chat' : 'Start direct chat'}</button></form></div>}
  </section>
}

function WorkspaceComposer({ type, form, setForm, replyTo, error, submitting, onClose, onSubmit, members = [], tasks = [], channels = ['general'], projectTemplates = [] }) {
  const titles = { calendar: 'Add calendar event', project: 'Create project', checkin: 'Daily check-in', chat: 'New team message', followup: 'Add follow-up', invite: 'Invite team member' }
  const update = event => setForm(current => ({ ...current, [event.target.name]: event.target.value }))
  const field = (name, label, placeholder, inputType = 'text') => {
    if (inputType === 'date') return <DateField label={label} name={name} value={form[name]} onChange={update} required />
    const baseField = <label>{label}<input name={name} type={inputType} value={form[name]} onChange={update} placeholder={placeholder} required /></label>
    if (type !== 'calendar' || name !== 'title') return baseField
    return <>{baseField}<label>Description<textarea name="description" value={form.description} onChange={update} placeholder="What is this event for?" maxLength="4000" /></label><SelectField label="Event type" name="event_type" value={form.event_type} onChange={update} options={[['meeting', 'Meeting'], ['focus', 'Focus time'], ['deadline', 'Deadline'], ['reminder', 'Reminder']]} /></>
  }
    return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal composer-modal" role="dialog" aria-modal="true" aria-labelledby="composer-title" onSubmit={onSubmit} onMouseDown={event => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">Workspace update</p><h2 id="composer-title">{titles[type]}</h2></div><button type="button" className="close-button" onClick={onClose} aria-label="Close workspace update dialog"><X size={18} /></button></div>{type === 'calendar' && <>{field('title', 'Event title', 'Daily planning session')}<DateTimeField label="Starts" name="start_at" value={form.start_at} onChange={update} required /><DateTimeField label="Ends" name="end_at" value={form.end_at} onChange={update} required /><SelectField label="Reminder" name="reminder_minutes" value={form.reminder_minutes} onChange={update} options={[['0', 'At event time'], ['5', '5 minutes before'], ['15', '15 minutes before'], ['30', '30 minutes before'], ['60', '1 hour before'], ['1440', '1 day before']]} /></>}{type === 'project' && <><label>Apply template<select value={form.template_id || ''} onChange={event => { const id = event.target.value; const template = projectTemplates.find(item => String(item.id) === String(id)); if (template) { setForm(current => ({ ...current, template_id: id, name: template.project_name, description: template.description })) } }}><option value="">No template</option>{projectTemplates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>{field('name', 'Project name', 'Website refresh')}<label>Description<textarea name="description" value={form.description} onChange={update} placeholder="What is this project moving forward?" /></label><DateField label="Due date" name="due_date" value={form.due_date} onChange={update} /></>}{type === 'checkin' && <>{field('date', 'Date', '', 'date')}<label>What did you complete?<textarea name="completed" value={form.completed} onChange={update} maxLength="4000" required /></label><label>What is next?<textarea name="next_steps" value={form.next_steps} onChange={update} maxLength="4000" /></label><label>Any blockers?<textarea name="blockers" value={form.blockers} onChange={update} maxLength="4000" /></label></>}{type === 'chat' && <>{replyTo && <p className="reply-context">Replying to {replyTo.author_name}</p>}<label>Channel<input name="channel" list="workspace-chat-channels" value={form.channel} onChange={update} placeholder="team-updates" required /><datalist id="workspace-chat-channels">{channels.map(channel => <option key={channel} value={channel} />)}</datalist></label><label>Message<textarea name="message" value={form.message} onChange={update} placeholder="Share an update with the team" required autoFocus /></label></>}{type === 'followup' && <>{field('note', 'Follow-up note', 'Ask for launch approval')}{field('due_date', 'Due date', '', 'date')}<label>Assign to<select name="assigned_to" value={form.assigned_to || ''} onChange={update}><option value="">Unassigned</option>{members.map(member => <option key={member.id} value={member.id}>{[member.first_name, member.last_name].filter(Boolean).join(' ') || member.email}</option>)}</select></label><label>Link to task<select name="task_id" value={form.task_id || ''} onChange={update}><option value="">No linked task</option>{tasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label></>}{type === 'invite' && <><label>Email<input name="email" type="email" value={form.email} onChange={update} placeholder="teammate@company.com" required /></label><label>Role<select name="role" value={form.role} onChange={update}><option value="member">Member</option><option value="manager">Manager</option></select></label></>}{error && <p className="auth-error">{error}</p>}<button className="primary-button modal-submit" disabled={submitting}>{submitting ? 'Saving...' : 'Save update'} <ArrowUpRight size={16} /></button></form></div>
}

export { ChatWorkspaceView, WorkspaceComposer }
