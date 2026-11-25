import React, { useEffect, useState } from 'react'
import { ArrowLeft, BookOpen, Pencil, Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from './ui/button.jsx'
import { WorkspaceViewHeading } from './workspace-ui.jsx'
import { workspaceCall } from '../lib/workspace-api.js'
import { OPEN_ARTICLE_EVENT, takePendingArticle } from '../lib/article-navigation.js'

const dateLabel = value => value ? new Date(value).toLocaleDateString([], { dateStyle: 'medium' }) : ''

function ArticleEditor({ article, onSave, onClose }) {
  const [title, setTitle] = useState(article?.title || '')
  const [body, setBody] = useState(article?.body || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event, status) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try { await onSave({ title, body, status }) } catch (saveError) { setError(saveError.message); setBusy(false) }
  }
  return (
    <form className="article-editor" onSubmit={event => submit(event, article?.status || 'draft')}>
      <label>Title<input autoFocus maxLength={180} required value={title} onChange={event => setTitle(event.target.value)} placeholder="Give your article a clear title" /></label>
      <label>Article<textarea required maxLength={50000} rows={16} value={body} onChange={event => setBody(event.target.value)} placeholder="Write what the team should learn..." /></label>
      {error && <p className="memo-error" role="alert">{error}</p>}
      <div className="memo-actions">
        <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
        {article?.status === 'published' && <Button type="button" variant="secondary" disabled={busy} onClick={event => submit(event, 'draft')}>Unpublish</Button>}
        {(!article || article.status === 'draft') && <Button type="button" variant="secondary" disabled={busy} onClick={event => submit(event, 'draft')}>Save draft</Button>}
        <Button type="button" loading={busy} onClick={event => submit(event, 'published')}>{article?.status === 'published' ? 'Save changes' : 'Publish article'}</Button>
      </div>
    </form>
  )
}

export default function ArticlesView({ workspaceId, currentUserId, role }) {
  const [articles, setArticles] = useState([])
  const [canWrite, setCanWrite] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)
  const [editing, setEditing] = useState(undefined)
  const [tab, setTab] = useState('published')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pendingOpenId, setPendingOpenId] = useState(null)

  const load = async () => {
    setLoaded(false)
    try {
      const payload = await workspaceCall(workspaceId, 'articles/', 'GET')
      setArticles(payload.articles || [])
      setCanWrite(Boolean(payload.can_write))
      setError('')
    } catch (loadError) { setError(loadError.message) } finally { setLoaded(true) }
  }
  useEffect(() => {
    const claim = () => {
      const id = takePendingArticle()
      if (id) setPendingOpenId(id)
    }
    const reload = () => load()
    claim()
    load()
    window.addEventListener(OPEN_ARTICLE_EVENT, claim)
    window.addEventListener('workspace:articles-changed', reload)
    return () => {
      window.removeEventListener(OPEN_ARTICLE_EVENT, claim)
      window.removeEventListener('workspace:articles-changed', reload)
    }
  }, [workspaceId])

  useEffect(() => {
    if (!pendingOpenId || !loaded) return
    const article = articles.find(item => Number(item.id) === pendingOpenId)
    if (article) {
      setSelected(article)
      setPendingOpenId(null)
      return
    }
    workspaceCall(workspaceId, `articles/${pendingOpenId}/`, 'GET')
      .then(payload => setSelected(payload.article))
      .catch(() => toast.error('That article is no longer available.'))
      .finally(() => setPendingOpenId(null))
  }, [pendingOpenId, loaded, articles, workspaceId])

  const canManage = article => canWrite && (article.author_id === currentUserId || role === 'owner')
  const save = async fields => {
    const saved = editing?.id
      ? await workspaceCall(workspaceId, `articles/${editing.id}/`, 'PATCH', fields)
      : await workspaceCall(workspaceId, 'articles/', 'POST', fields)
    toast.success(fields.status === 'published' ? 'Article published.' : 'Draft saved.')
    setEditing(undefined)
    if (!selected && fields.status === 'draft') setTab('drafts')
    await load()
    if (selected && saved.article) setSelected(saved.article)
  }
  const remove = async () => {
    try {
      await workspaceCall(workspaceId, `articles/${selected.id}/`, 'DELETE')
      toast.success('Article deleted.')
      setSelected(null)
      setConfirmDelete(false)
      await load()
    } catch (deleteError) { setError(deleteError.message); setConfirmDelete(false) }
  }

  if (editing !== undefined && !selected) {
    return <section className="workspace-view articles-view">
      <WorkspaceViewHeading eyebrow="Collaborate" title="Write an article" subtitle="Save a draft or publish it for your team to read." />
      <ArticleEditor article={null} onSave={save} onClose={() => setEditing(undefined)} />
    </section>
  }

  if (selected && editing) {
    return <section className="workspace-view articles-view">
      <Button variant="ghost" className="article-back" onClick={() => setEditing(undefined)}><ArrowLeft size={16} aria-hidden="true" /> Back to article</Button>
      <ArticleEditor article={editing} onSave={save} onClose={() => setEditing(undefined)} />
    </section>
  }

  if (selected) {
    return <section className="workspace-view articles-view">
      <Button variant="ghost" className="article-back" onClick={() => { setSelected(null); setPendingOpenId(null); setConfirmDelete(false) }}><ArrowLeft size={16} aria-hidden="true" /> All articles</Button>
      <article className="article-reader">
        {selected.status === 'draft' && <span className="article-draft-label">Draft</span>}
        <h1>{selected.title}</h1>
        <p className="article-meta">{selected.author_name} - {dateLabel(selected.published_at || selected.created_at)}</p>
        <div className="article-body">{selected.body}</div>
        {error && <p className="memo-error" role="alert">{error}</p>}
        {canManage(selected) && <div className="memo-actions article-owner-actions">
          {confirmDelete ? <><span>Delete this article permanently?</span><Button variant="secondary" onClick={() => setConfirmDelete(false)}>Keep article</Button><Button variant="destructive" onClick={remove}>Delete article</Button></> : <><Button variant="secondary" onClick={() => setEditing(selected)}><Pencil size={14} aria-hidden="true" /> Edit</Button><Button variant="secondary" onClick={() => setConfirmDelete(true)}><Trash2 size={14} aria-hidden="true" /> Delete</Button></>}
        </div>}
      </article>
    </section>
  }

  return <section className="workspace-view articles-view">
    <WorkspaceViewHeading eyebrow="Collaborate" title="Articles" subtitle="Learning articles from your team, all in one place." action={canWrite && tab === 'published' ? 'Write article' : undefined} icon={Plus} onAction={() => setEditing(null)} />
    {canWrite && <div className="memo-tabs" role="tablist" aria-label="Articles"><button type="button" role="tab" aria-selected={tab === 'published'} className={tab === 'published' ? 'is-active' : ''} onClick={() => setTab('published')}>Published</button><button type="button" role="tab" aria-selected={tab === 'drafts'} className={tab === 'drafts' ? 'is-active' : ''} onClick={() => setTab('drafts')}>Drafts</button></div>}
    {editing !== undefined && <ArticleEditor article={editing || null} onSave={save} onClose={() => setEditing(undefined)} />}
    {error && <p className="memo-error" role="alert">{error}</p>}
    {!loaded ? <p className="memo-empty" role="status">Loading articles...</p> : (() => {
      const items = articles.filter(article => tab === 'drafts' ? article.status === 'draft' : article.status === 'published')
      return items.length ? <div className="memo-list">{items.map(article => <article className="memo-card article-card" key={article.id}>
        <span className="memo-card-icon" aria-hidden="true"><BookOpen size={18} /></span><div className="memo-card-main">
          <button type="button" className="memo-card-title" onClick={() => { setPendingOpenId(null); setSelected(article) }}>{article.title}</button>
          <p className="memo-card-meta">{article.author_name} - {dateLabel(article.published_at || article.created_at)}{article.status === 'draft' ? ' - Draft' : ''}</p>
          <p className="memo-card-preview">{article.body}</p>
        </div>
      </article>)}</div> : <div className="memo-empty"><BookOpen size={22} aria-hidden="true" /><strong>{tab === 'drafts' ? 'No drafts yet' : 'No articles yet'}</strong><p>{tab === 'drafts' ? 'Drafts you save will appear here.' : canWrite ? 'Write the first learning article for your team.' : 'Learning articles from your managers will appear here.'}</p></div>
    })()}
  </section>
}
