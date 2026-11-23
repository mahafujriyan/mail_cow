"use client";

import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, ImageIcon, Italic, Link2, List, ListOrdered, Underline as UnderlineIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const UploadImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      uploadId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-upload-id"),
        renderHTML: (attributes) => (attributes.uploadId ? { "data-upload-id": attributes.uploadId } : {}),
      },
    };
  },
});

export function MailEditor({
  seed,
  seedKey,
  placeholder,
  onChange,
  onUploadImage,
  minHeight = 180,
  showToolbar = true,
}: {
  seed: string;
  seedKey: string;
  placeholder: string;
  onChange: (html: string) => void;
  onUploadImage?: (file: File) => Promise<{ id: string; src: string } | null>;
  minHeight?: number;
  showToolbar?: boolean;
}) {
  const { t } = useI18n();
  const appliedKey = useRef(seedKey);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true, protocols: ["http", "https", "mailto"] }),
      UploadImage,
      Placeholder.configure({ placeholder }),
    ],
    content: seed || "<p></p>",
    editorProps: {
      attributes: { class: "px-4 py-3 text-[15px] leading-6" },
    },
    onUpdate: ({ editor: current }) => onChange(current.getHTML()),
  });

  useEffect(() => {
    if (!editor || appliedKey.current === seedKey) return;
    appliedKey.current = seedKey;
    editor.commands.setContent(seed || "<p></p>", { emitUpdate: false });
  }, [editor, seed, seedKey]);

  async function addImage(file: File) {
    if (!editor || !onUploadImage) return;
    const uploaded = await onUploadImage(file);
    if (!uploaded) return;
    editor
      .chain()
      .focus()
      .insertContent(`<img src="${uploaded.src}" data-upload-id="${uploaded.id}" alt="">`)
      .run();
  }

  function applyLink() {
    if (!editor) return;
    const url = linkValue.trim();
    if (!url) {
      editor.chain().focus().unsetLink().run();
    } else if (/^(https?:|mailto:)/i.test(url)) {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
    setLinkOpen(false);
  }

  return (
    <div>
      {showToolbar && (
        <div className="flex flex-wrap items-center gap-0.5 border-b border-line px-2 py-1.5">
          <ToolButton label={t("bold")} active={editor?.isActive("bold")} onClick={() => editor?.chain().focus().toggleBold().run()}>
            <Bold className="h-4 w-4" />
          </ToolButton>
          <ToolButton label={t("italic")} active={editor?.isActive("italic")} onClick={() => editor?.chain().focus().toggleItalic().run()}>
            <Italic className="h-4 w-4" />
          </ToolButton>
          <ToolButton label={t("underline")} active={editor?.isActive("underline")} onClick={() => editor?.chain().focus().toggleUnderline().run()}>
            <UnderlineIcon className="h-4 w-4" />
          </ToolButton>
          <ToolButton label={t("bulletList")} active={editor?.isActive("bulletList")} onClick={() => editor?.chain().focus().toggleBulletList().run()}>
            <List className="h-4 w-4" />
          </ToolButton>
          <ToolButton label={t("numberedList")} active={editor?.isActive("orderedList")} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>
            <ListOrdered className="h-4 w-4" />
          </ToolButton>
          <ToolButton
            label={t("link")}
            active={editor?.isActive("link") || linkOpen}
            onClick={() => {
              setLinkValue(editor?.getAttributes("link").href || "");
              setLinkOpen((open) => !open);
            }}
          >
            <Link2 className="h-4 w-4" />
          </ToolButton>
          <ToolButton label={t("image")} onClick={() => document.getElementById("editor-image")?.click()}>
            <ImageIcon className="h-4 w-4" />
          </ToolButton>
          <input
            id="editor-image"
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void addImage(file);
              event.target.value = "";
            }}
          />
        </div>
      )}
      {linkOpen && (
        <form
          className="flex items-center gap-2 border-b border-line px-3 py-2"
          onSubmit={(event) => {
            event.preventDefault();
            applyLink();
          }}
        >
          <input
            value={linkValue}
            onChange={(event) => setLinkValue(event.target.value)}
            placeholder={t("linkUrl")}
            className="h-8 flex-1 rounded-md border border-line bg-surface px-2 text-sm outline-none"
            autoFocus
          />
          <button type="submit" className="text-sm font-medium text-brand">
            {t("apply")}
          </button>
          <button type="button" className="text-sm text-muted" onClick={() => { editor?.chain().focus().unsetLink().run(); setLinkOpen(false); }}>
            {t("removeLink")}
          </button>
        </form>
      )}
      <EditorContent editor={editor} style={{ minHeight }} />
    </div>
  );
}

function ToolButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn("grid h-8 w-8 place-items-center rounded-md text-ink hover:bg-canvas", active && "bg-mint text-brand")}
    >
      {children}
    </button>
  );
}
