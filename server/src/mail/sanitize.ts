import sanitizeHtml from "sanitize-html";

const ALLOWED_TAGS = [
  "a",
  "abbr",
  "b",
  "blockquote",
  "br",
  "caption",
  "code",
  "col",
  "colgroup",
  "dd",
  "div",
  "dl",
  "dt",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
  "center",
  "font",
];

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

export function sanitizeEmailHtml(input: string): string {
  const cleaned = sanitizeHtml(input, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "width", "height"],
      "*": ["align", "valign", "colspan", "rowspan", "width", "height", "cellpadding", "cellspacing", "border", "bgcolor", "style"],
    },
    allowedSchemes: ["http", "https", "mailto", "cid"],
    allowedSchemesByTag: {
      img: ["http", "https", "cid", "data"],
    },
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: "a",
        attribs: {
          ...attribs,
          target: "_blank",
          rel: "noreferrer noopener",
        },
      }),
    },
  });
  return stripDangerousStyles(stripBadDataUrls(cleaned)).replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, "");
}

function stripBadDataUrls(html: string): string {
  return html.replace(/\ssrc=(['"])data:(?!image\/(?:png|jpeg|gif|webp);base64,)[^'"]*\1/gi, "");
}

function stripDangerousStyles(html: string): string {
  return html.replace(/\sstyle=(['"])([\s\S]*?)\1/gi, (_match, quote: string, style: string) => {
    const cleaned = cleanStyle(style);
    return cleaned ? ` style=${quote}${cleaned}${quote}` : "";
  });
}

export function cleanStyle(style: string): string {
  return style
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((declaration) => {
      const lower = declaration.toLowerCase();
      if (!/^[a-z-]+\s*:\s*[^;{}<>]+$/i.test(declaration)) return false;
      if (/expression|url\s*\(|javascript|@import|behavior|-moz-binding|position\s*:\s*fixed/.test(lower)) {
        return false;
      }
      return true;
    })
    .join("; ");
}

export function gateRemoteImages(html: string, allow: boolean): { html: string; blocked: boolean } {
  if (allow) return { html, blocked: false };
  let blocked = false;
  const next = html.replace(
    /(<img\b[^>]*?)\ssrc\s*=\s*(['"])(https?:\/\/[^'"]+)\2/gi,
    (_match, start: string, quote: string, src: string) => {
      blocked = true;
      return `${start} data-blocked-src=${quote}${encodeURIComponent(src)}${quote}`;
    },
  );
  return { html: next, blocked };
}

export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
