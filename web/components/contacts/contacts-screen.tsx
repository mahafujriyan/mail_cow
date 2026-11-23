"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { Contact } from "@/lib/types";
import { cn } from "@/lib/utils";

const empty = { name: "", email: "", company: "", phone: "", notes: "" };

export function ContactsScreen() {
  const { t } = useI18n();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selected, setSelected] = useState<string | "new">("new");
  const [form, setForm] = useState(empty);
  const [query, setQuery] = useState("");

  async function load(q = query) {
    const data = await api<{ contacts: Contact[] }>(`/api/contacts?q=${encodeURIComponent(q)}`);
    setContacts(data.contacts);
  }

  useEffect(() => {
    void load("");
  }, []);

  function edit(contact: Contact) {
    setSelected(contact.id);
    setForm({ name: contact.name, email: contact.email, company: contact.company, phone: contact.phone, notes: contact.notes });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (selected === "new") {
      const created = await api<Contact>("/api/contacts", { method: "POST", json: form });
      setSelected(created.id);
    } else {
      await api(`/api/contacts/${selected}`, { method: "PATCH", json: form });
    }
    await load();
  }

  async function remove() {
    if (selected === "new") return;
    await api(`/api/contacts/${selected}`, { method: "DELETE" });
    setSelected("new");
    setForm(empty);
    await load();
  }

  return (
    <div className="flex h-full min-h-0 flex-col px-4 py-6 md:px-8">
      <p className="text-sm text-muted">
        <Link href="/mail" className="hover:text-ink">{t("mail")}</Link>
        <span className="px-1.5">/</span>
        <span className="text-ink">{t("contacts")}</span>
      </p>
      <div className="mt-5 grid min-h-0 flex-1 gap-4 lg:grid-cols-[280px_minmax(0,560px)]">
        <aside className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="flex items-center justify-between border-b border-line px-3 py-3">
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                void load(event.target.value);
              }}
              placeholder={t("searchMail")}
              className="h-8 w-full bg-transparent text-sm outline-none"
            />
          </div>
          <button
            type="button"
            className="w-full px-3 py-2 text-left text-sm text-brand"
            onClick={() => {
              setSelected("new");
              setForm(empty);
            }}
          >
            {t("newContact")}
          </button>
          <ul className="max-h-[60vh] overflow-y-auto">
            {contacts.length === 0 && <li className="px-3 py-6 text-sm text-muted">{t("noContacts")}</li>}
            {contacts.map((contact) => (
              <li key={contact.id}>
                <button
                  type="button"
                  onClick={() => edit(contact)}
                  className={cn("block w-full px-3 py-2 text-left text-sm", selected === contact.id ? "bg-mint text-brand" : "hover:bg-canvas")}
                >
                  <span className="block truncate font-medium">{contact.name}</span>
                  <span className="block truncate text-xs text-muted">{contact.email}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <form onSubmit={save} className="rounded-2xl border border-line bg-surface p-5">
          <h1 className="text-[15px] font-semibold">{selected === "new" ? t("newContact") : form.name}</h1>
          <Field label={t("displayName")} value={form.name} required onChange={(name) => setForm({ ...form, name })} />
          <Field label={t("email")} value={form.email} required onChange={(email) => setForm({ ...form, email })} type="email" />
          <Field label={t("company")} value={form.company} onChange={(company) => setForm({ ...form, company })} />
          <Field label={t("phone")} value={form.phone} onChange={(phone) => setForm({ ...form, phone })} />
          <label className="mt-3 block text-xs text-muted">{t("notes")}</label>
          <textarea
            value={form.notes}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
            className="mt-1 h-24 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none"
          />
          <div className="mt-4 flex gap-3">
            <button type="submit" className="h-9 rounded-full bg-brand px-4 text-sm font-semibold text-on-brand">{t("save")}</button>
            {selected !== "new" && (
              <button type="button" onClick={() => void remove()} className="text-sm text-danger">{t("deleteContact")}</button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="mt-3 block text-xs text-muted">
      {label}
      <input required={required} value={value} type={type} onChange={(event) => onChange(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-line px-3 text-sm text-ink outline-none" />
    </label>
  );
}
