// Notification handoff for opening a specific article after the Articles view mounts.
let pendingArticleId = null

export const OPEN_ARTICLE_EVENT = 'workspace:open-article'

export function requestArticle(articleId) {
  pendingArticleId = articleId == null ? null : Number(articleId)
  window.dispatchEvent(new Event(OPEN_ARTICLE_EVENT))
}

export function takePendingArticle() {
  const articleId = pendingArticleId
  pendingArticleId = null
  return Number.isFinite(articleId) ? articleId : null
}
