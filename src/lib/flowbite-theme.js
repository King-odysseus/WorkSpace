/**
 * The Flowbite React theme, pointed at the WorkSpace design tokens.
 *
 * Flowbite React ships a default theme per component - `buttonTheme` and
 * friends - and merges a supplied theme over it with tailwind-merge. Rather
 * than restating every component, this file overrides only what the design
 * disagrees with, so a Flowbite upgrade brings its fixes through untouched.
 *
 * Two rules govern the overrides:
 *
 *   Colour comes from the app tokens, never from Flowbite's palette. The
 *   design's fills (`#F3F4F6` secondary, `#C70036` danger, `#101828` label)
 *   are the app's own --color-surface-hover, --color-danger and
 *   --color-text-primary, so the classes below name the token, not the hex.
 *
 *   Geometry comes from the design's radius ladder. Flowbite's defaults use
 *   rounded-lg on controls; the design uses the 12px control radius, which
 *   the app already exposes as --radius-control.
 *
 * tailwind-merge is the reason `base` is replaced wholesale rather than
 * extended: it only knows the class names it ships with, so a custom
 * `rounded-control` would not be seen as overriding Flowbite's `rounded-lg`
 * and the wrong radius would win silently.
 */

/* The design's control: 42px tall, a 14px/500 label, the 12px control radius.
   Flowbite's `md` size is h-10/text-sm, so it is restated rather than tweaked. */
const controlSize = 'h-[42px] px-5 text-label'

/* 16px icon buttons - the design's square icon control, unchanged in height. */
const iconSize = 'size-[42px] p-0'

const base =
  'relative flex items-center justify-center gap-2 rounded-control text-center font-medium ' +
  'whitespace-nowrap transition-colors outline-none disabled:pointer-events-none disabled:opacity-50 ' +
  'focus-visible:ring-[3px] focus-visible:ring-info/35 focus-visible:border-info [&_svg]:shrink-0'

export const flowbiteTheme = {
  button: {
    base,
    size: {
      md: controlSize,
      sm: 'h-9 px-3.5 text-body-small',
      lg: 'h-12 px-6 text-subheading',
      icon: iconSize,
      'icon-sm': 'size-9 p-0',
    },
    color: {
      primary:
        'border border-navy bg-navy text-text-on-navy hover:bg-navy-hover hover:border-navy-hover',
      /* The design's secondary fill - #F3F4F6 with a #101828 label. */
      secondary:
        'bg-surface-hover text-text-primary hover:bg-border',
      /* The design's destructive fill - #C70036 on white. */
      danger: 'bg-danger text-white hover:brightness-95',
      /* The branded bronze token used across WorkSpace. */
      gold: 'bg-bronze text-navy hover:bg-bronze-hover',
      outline:
        'border border-border bg-transparent text-text-primary hover:bg-surface-hover',
      ghost: 'bg-transparent text-text-primary hover:bg-surface-hover',
      link: 'bg-transparent text-info underline-offset-4 hover:underline rounded-none p-0 h-auto',
    },
  },
}

export default flowbiteTheme
