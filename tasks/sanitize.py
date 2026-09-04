"""HTML and document content sanitizing for workspace documents.

Uses only the standard library so the project takes on no new dependency.
Client-side cleaning in the rich editor is a convenience; this module is the
authority, because any client can PATCH document content directly.
"""

import re
from html import escape
from html.parser import HTMLParser

# Tags the rich editor and slide editor can legitimately produce.
ALLOWED_TAGS = {
    'a', 'b', 'blockquote', 'br', 'code', 'div', 'em', 'font', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'hr', 'i', 'img', 'li', 'mark', 'ol', 'p', 'pre', 's', 'span', 'strike', 'strong', 'sub', 'sup',
    'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul',
}

# Tags whose entire subtree is discarded rather than unwrapped.
DROP_SUBTREE_TAGS = {'script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math'}

VOID_TAGS = {'br', 'hr', 'img'}

GLOBAL_ATTRIBUTES = {'style', 'class', 'align', 'dir', 'title'}

TAG_ATTRIBUTES = {
    'a': {'href', 'target', 'rel'},
    'img': {'src', 'alt', 'width', 'height'},
    'font': {'face', 'size', 'color'},
    'td': {'colspan', 'rowspan'},
    'th': {'colspan', 'rowspan', 'scope'},
    'ol': {'start', 'type'},
}

URL_ATTRIBUTES = {'href', 'src'}

SAFE_URL = re.compile(r'^(?:https?://|mailto:|tel:|/|\#|\./|\.\./)', re.IGNORECASE)
SAFE_DATA_IMAGE = re.compile(r'^data:image/(?:png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=\s]+$', re.IGNORECASE)

# url(...) inside style attributes, and anything else that can execute from CSS.
UNSAFE_STYLE = re.compile(r'(?:url\s*\(|expression\s*\(|javascript\s*:|@import|behaviou?r\s*:|-moz-binding)', re.IGNORECASE)


def safe_url(value):
    """Return the URL if it uses a scheme we allow, otherwise an empty string."""
    candidate = (value or '').strip()
    if not isinstance(value, str) or not candidate:
        return ''
    # Browsers ignore control characters, so "java\tscript:alert(1)" would run.
    # Strip them before deciding, but only from the part before the first slash,
    # so legitimate paths and query strings are left intact.
    head, separator, tail = candidate.partition('/')
    candidate = re.sub(r'[\x00-\x20]', '', head) + separator + tail
    if SAFE_DATA_IMAGE.match(candidate):
        return candidate
    if SAFE_URL.match(candidate):
        return candidate
    return ''


def _safe_style(value):
    return '' if UNSAFE_STYLE.search(value or '') else (value or '')


class _Sanitizer(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.open_tags = []
        self.skip_depth = 0

    def _allowed_attributes(self, tag, attributes):
        allowed = GLOBAL_ATTRIBUTES | TAG_ATTRIBUTES.get(tag, set())
        result = []
        for name, value in attributes:
            name = (name or '').lower()
            if name.startswith('on') or name not in allowed:
                continue
            value = value or ''
            if name in URL_ATTRIBUTES:
                value = safe_url(value)
                if not value:
                    continue
            elif name == 'style':
                value = _safe_style(value)
                if not value:
                    continue
            result.append((name, value))
        if tag == 'a' and any(name == 'href' for name, _ in result):
            result = [item for item in result if item[0] != 'rel'] + [('rel', 'noopener noreferrer')]
        return result

    def _render(self, tag, attributes):
        return ''.join(f' {name}="{escape(value, quote=True)}"' for name, value in self._allowed_attributes(tag, attributes))

    def handle_starttag(self, tag, attributes):
        tag = tag.lower()
        if self.skip_depth or tag in DROP_SUBTREE_TAGS:
            self.skip_depth += 1
            return
        if tag not in ALLOWED_TAGS:
            return
        rendered = self._render(tag, attributes)
        if tag in VOID_TAGS:
            self.parts.append(f'<{tag}{rendered}>')
            return
        self.open_tags.append(tag)
        self.parts.append(f'<{tag}{rendered}>')

    def handle_startendtag(self, tag, attributes):
        tag = tag.lower()
        if self.skip_depth or tag in DROP_SUBTREE_TAGS or tag not in ALLOWED_TAGS:
            return
        rendered = self._render(tag, attributes)
        self.parts.append(f'<{tag}{rendered}>' if tag in VOID_TAGS else f'<{tag}{rendered}></{tag}>')

    def handle_endtag(self, tag):
        tag = tag.lower()
        if self.skip_depth:
            self.skip_depth -= 1
            return
        if tag in VOID_TAGS or tag not in self.open_tags:
            return
        while self.open_tags:
            open_tag = self.open_tags.pop()
            self.parts.append(f'</{open_tag}>')
            if open_tag == tag:
                break

    def handle_data(self, data):
        if not self.skip_depth:
            self.parts.append(escape(data, quote=False))

    def close_document(self):
        self.close()
        while self.open_tags:
            self.parts.append(f'</{self.open_tags.pop()}>')
        return ''.join(self.parts)


def sanitize_html(value):
    """Strip scripting, unsafe URLs, and unknown markup from an HTML fragment."""
    if not isinstance(value, str) or not value:
        return ''
    parser = _Sanitizer()
    parser.feed(value)
    return parser.close_document()


def strip_html(value):
    """Return the visible text of an HTML fragment, collapsed to single spaces."""
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', sanitize_html(value))).strip()


def _sanitize_slide(slide):
    if not isinstance(slide, dict):
        return slide
    cleaned = dict(slide)
    if 'body' in cleaned:
        cleaned['body'] = sanitize_html(cleaned.get('body'))
    if isinstance(cleaned.get('text_boxes'), list):
        cleaned['text_boxes'] = [
            {**box, 'text': sanitize_html(box.get('text'))} if isinstance(box, dict) else box
            for box in cleaned['text_boxes']
        ]
    for key in ('images', 'icons'):
        if isinstance(cleaned.get(key), list):
            cleaned[key] = [
                {**item, 'url': safe_url(item.get('url'))}
                for item in cleaned[key]
                if isinstance(item, dict) and safe_url(item.get('url'))
            ]
    return cleaned


def sanitize_document_content(content):
    """Sanitize every HTML-bearing field of a stored document payload."""
    if not isinstance(content, dict):
        return {}
    cleaned = dict(content)
    if 'html' in cleaned:
        cleaned['html'] = sanitize_html(cleaned.get('html'))
        cleaned['text'] = strip_html(cleaned.get('html'))
    elif 'text' in cleaned:
        cleaned['text'] = strip_html(cleaned.get('text'))
    if isinstance(cleaned.get('slides'), list):
        cleaned['slides'] = [_sanitize_slide(slide) for slide in cleaned['slides']]
    return cleaned
