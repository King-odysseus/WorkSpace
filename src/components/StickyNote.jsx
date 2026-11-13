import React from 'react'

// One sticky note, used wherever a plan or a planner item is shown as a note: the
// day plan, My planner and the Today widget. Tone sets the paper colour (work is
// yellow, a break green, a planner item blue, a finished one grey); tilt is only
// a small turn so a board does not look like a grid of boxes.
export default function StickyNote({ header, chip, title, detail, tone = 'work', tilt = 0, active = false, leading, children, onClick, label, articleProps = {} }) {
  // The tick (leading) is a button of its own, so the part that opens the note is
  // only the title and detail, never wrapped around it.
  const text = (
    <>
      <h3>{title}</h3>
      {detail && <p>{detail}</p>}
    </>
  )
  return (
    <article role="listitem" {...articleProps} className={`plan-sticky is-${tone} tilt-${tilt % 3}${active ? ' is-active' : ''}${articleProps.className ? ` ${articleProps.className}` : ''}`}>
      <header>
        {leading}
        <strong>{header}</strong>
        {chip && <span>{chip}</span>}
      </header>
      {onClick
        ? <button type="button" className="sticky-open" onClick={onClick} aria-label={label || title}>{text}</button>
        : text}
      {children}
    </article>
  )
}
