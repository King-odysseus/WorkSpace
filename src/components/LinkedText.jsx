import React from 'react'
import { tokenizeText } from '../lib/linkify.js'

// Renders user text with clickable links and highlighted @mentions. React
// escapes every segment, so the text can never inject markup.
export default function LinkedText({ text, mentions = true }) {
  return tokenizeText(text).map((segment, index) => {
    if (segment.type === 'link') {
      return <a key={index} className="linked-text-link" href={segment.href} target="_blank" rel="noopener noreferrer" onClick={event => event.stopPropagation()}>{segment.value}</a>
    }
    if (segment.type === 'mention' && mentions) return <mark className="chat-mention" key={index}>{segment.value}</mark>
    return <React.Fragment key={index}>{segment.value}</React.Fragment>
  })
}
