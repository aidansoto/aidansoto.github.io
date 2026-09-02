/**
 * Knowledge Vault screen.
 *
 * Search, view, edit, delete, upload, download, and send to an agent or a
 * mission. Scopes are kept visually distinct because the separation is the
 * point: shared knowledge, mission memory and personal agent memory are not
 * interchangeable.
 */

import { useMemo, useRef, useState } from 'react';
import { useCampus } from '@/state/store';
import { addEntry, deleteEntry, searchVault, updateEntry, vaultStats } from '@/knowledge/vault';
import { Button } from './primitives';
import type { CampusDocument } from '@/core/types';
import type { KnowledgeEntry, KnowledgeKind, KnowledgeScope } from '@/core/mission';

const KINDS: KnowledgeKind[] = [
  'note', 'document', 'research', 'output', 'result', 'instruction', 'decision', 'procedure', 'image', 'pdf',
];

const SCOPE_LABEL: Record<KnowledgeScope, string> = {
  shared: 'Shared campus knowledge',
  mission: 'Mission memory',
  agent: 'Agent memory',
};

export function KnowledgeVaultScreen(): JSX.Element {
  const doc = useCampus((s) => s.doc);
  const setDoc = useCampus((s) => s.setDoc);
  const setScreen = useCampus((s) => s.setScreen);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<KnowledgeScope | 'all'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ title: string; body: string } | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const results = useMemo(
    () => (doc ? searchVault(doc.knowledge, query, { scope }) : []),
    [doc, query, scope],
  );

  if (!doc) {
    return <div className="screen"><div className="screen-body"><div className="empty" style={{ padding: 60 }}>Loading…</div></div></div>;
  }

  const stats = vaultStats(doc.knowledge);
  const selected = doc.knowledge.find((e) => e.id === selectedId) ?? null;

  /** Apply a mutation to the document immutably enough for React to notice. */
  const mutate = (fn: (d: CampusDocument) => void): void => {
    const next: CampusDocument = { ...doc };
    fn(next);
    setDoc(next);
  };

  const upload = async (files: FileList): Promise<void> => {
    for (const file of Array.from(files).slice(0, 10)) {
      const isText = file.type.startsWith('text/') || /\.(md|txt|json|csv|ya?ml)$/i.test(file.name);
      let body: string;
      let kind: KnowledgeKind = 'document';
      try {
        if (isText) {
          body = await file.text();
          kind = 'document';
        } else if (file.type.startsWith('image/')) {
          body = await new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result));
            r.onerror = () => reject(r.error);
            r.readAsDataURL(file);
          });
          kind = 'image';
        } else {
          body = `[${file.name} — ${file.type || 'binary'}, ${(file.size / 1024).toFixed(1)} KB. Stored by reference only.]`;
          kind = file.type === 'application/pdf' ? 'pdf' : 'document';
        }
      } catch {
        body = `[${file.name} could not be read.]`;
      }
      mutate((d) => {
        addEntry(d, { title: file.name, kind, scope: 'shared', body, source: 'owner', mime: file.type || null });
      });
    }
  };

  const download = (entry: KnowledgeEntry): void => {
    try {
      const blob = new Blob([entry.body], { type: entry.mime ?? 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = entry.title.includes('.') ? entry.title : `${entry.title}.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch {
      void navigator.clipboard?.writeText(entry.body);
    }
  };

  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <h1 className="screen-title">Knowledge Vault</h1>
          <p className="screen-sub">
            {stats.total} entries · {stats.shared} shared · {stats.mission} mission · {stats.agent} agent ·{' '}
            {(stats.bytes / 1024).toFixed(0)} KB
          </p>
        </div>
        <div className="btn-row">
          <Button onClick={() => fileInput.current?.click()}>Upload</Button>
          <Button
            onClick={() => {
              mutate((d) => {
                const entry = addEntry(d, {
                  title: 'New note', kind: 'note', scope: 'shared', body: '', source: 'owner',
                });
                setSelectedId(entry.id);
                setDraft({ title: entry.title, body: '' });
              });
            }}
          >
            New Note
          </Button>
          <Button onClick={() => setScreen('dashboard')}>Dashboard</Button>
          <Button onClick={() => setScreen('campus')}>Back to Campus</Button>
        </div>
      </header>

      <input
        ref={fileInput}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => { if (e.target.files) void upload(e.target.files); e.target.value = ''; }}
      />

      <div className="screen-body results-layout">
        <aside className="results-list">
          <div className="field">
            <input
              type="text"
              placeholder="Search the vault…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="field">
            <select value={scope} onChange={(e) => setScope(e.target.value as KnowledgeScope | 'all')}>
              <option value="all">All scopes</option>
              <option value="shared">Shared campus knowledge</option>
              <option value="mission">Mission memory</option>
              <option value="agent">Agent memory</option>
            </select>
          </div>

          {results.length === 0 ? (
            <div className="empty">
              {doc.knowledge.length === 0
                ? 'The vault is empty. Mission results are filed here automatically.'
                : 'Nothing matched that search.'}
            </div>
          ) : (
            <div className="list">
              {results.map((e) => (
                <div
                  key={e.id}
                  className={`row${selectedId === e.id ? ' is-selected' : ''}`}
                  onClick={() => { setSelectedId(e.id); setDraft(null); }}
                >
                  <div className="row-main">
                    <div className="row-title">{e.title}</div>
                    <div className="row-sub">
                      {e.kind} · {e.scope} · {(e.size / 1024).toFixed(1)} KB
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </aside>

        <section className="results-detail">
          {!selected ? (
            <div className="empty" style={{ padding: 60 }}>
              Select an entry, or upload a document. Agents retrieve only the entries relevant to
              their task — never the whole vault.
            </div>
          ) : (
            <>
              <div className="results-head">
                <div style={{ minWidth: 0 }}>
                  {draft ? (
                    <input
                      type="text"
                      value={draft.title}
                      onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    />
                  ) : (
                    <h2 className="results-title">{selected.title}</h2>
                  )}
                  <p className="screen-sub">
                    {SCOPE_LABEL[selected.scope]} · from {selected.source} ·{' '}
                    {new Date(selected.updatedAt).toLocaleString()}
                  </p>
                </div>
                <div className="btn-row">
                  {draft ? (
                    <>
                      <Button
                        small
                        accent="gold"
                        onClick={() => {
                          mutate((d) => updateEntry(d, selected.id, { title: draft.title, body: draft.body }));
                          setDraft(null);
                        }}
                      >
                        Save
                      </Button>
                      <Button small onClick={() => setDraft(null)}>Cancel</Button>
                    </>
                  ) : (
                    <>
                      <Button small onClick={() => setDraft({ title: selected.title, body: selected.body })}>
                        Edit
                      </Button>
                      <Button small onClick={() => download(selected)}>Download</Button>
                      <Button
                        small
                        accent="red"
                        onClick={() => {
                          mutate((d) => deleteEntry(d, selected.id));
                          setSelectedId(null);
                          setDraft(null);
                        }}
                      >
                        Delete
                      </Button>
                    </>
                  )}
                </div>
              </div>

              <div className="modal-columns" style={{ marginBottom: 12 }}>
                <div className="field">
                  <label className="field-label">Kind</label>
                  <select
                    value={selected.kind}
                    onChange={(e) => mutate((d) => updateEntry(d, selected.id, { kind: e.target.value as KnowledgeKind }))}
                  >
                    {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label className="field-label">Scope</label>
                  <select
                    value={selected.scope}
                    onChange={(e) => mutate((d) => updateEntry(d, selected.id, { scope: e.target.value as KnowledgeScope }))}
                  >
                    <option value="shared">Shared campus knowledge</option>
                    <option value="mission">Mission memory</option>
                    <option value="agent">Agent memory</option>
                  </select>
                </div>
              </div>

              {selected.kind === 'image' && selected.body.startsWith('data:image/') ? (
                <img src={selected.body} alt={selected.title} className="vault-image" />
              ) : draft ? (
                <textarea
                  className="mission-input"
                  rows={18}
                  value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                />
              ) : (
                <pre className="result-block">{selected.body || '(empty)'}</pre>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
