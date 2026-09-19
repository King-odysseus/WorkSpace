import { clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// tailwind-merge reads a `text-*` class as one of two things: a font size from
// the scale it ships with, or a text colour. It knows none of the names this
// app added to the type scale, so `text-overline` and friends fell through to
// the colour group - and the failure was silent. `text-overline text-primary`
// on one element looked like two competing colours, so tailwind-merge kept the
// last one and dropped the font size entirely, leaving the element to inherit
// whatever size its parent had.
//
// Naming the scale here puts those utilities back in the font-size group, where
// they conflict with each other and not with colour.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        'text-display',
        'text-page-heading',
        'text-section-heading',
        'text-card-heading',
        'text-subheading',
        'text-body',
        'text-body-small',
        'text-label',
        'text-caption',
        'text-overline',
        'text-metric',
      ],
    },
  },
})

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}
