import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, formatBytes, type Category, type DocumentMeta, type Page } from '../api';

interface Props {
  withStepUp: <T>(action: () => Promise<T>) => Promise<T>;
}

/**
 * Document management.
 *
 * Ingestion is administrator-only by design: untrusted upload is the largest
 * attack surface in an application like this, and removing it from the client
 * costs nothing against the MVP. Whatever is uploaded here still goes through
 * the full validation pipeline — the type is decided by the bytes, not by the
 * name or what the browser claims.
 */
export function DocumentsView({ withStepUp }: Props) {
  const [page, setPage] = useState<Page<DocumentMeta> | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (q: string) => {
    try {
      setPage(
        await api.get<Page<DocumentMeta>>(
          `/admin/documents?limit=50${q ? `&q=${encodeURIComponent(q)}` : ''}`,
        ),
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message_ : 'Unable to load.');
    }
  }, []);

  useEffect(() => {
    void load('');
    api.get<Category[]>('/admin/categories').then(setCategories).catch(() => undefined);
  }, [load]);

  return (
    <>
      <h2>Documents</h2>
      <p className="sub">{page?.total ?? 0} document(s) in the vault.</p>

      <UploadCard
        categories={categories}
        onUploaded={(d) => {
          setNotice(`Uploaded ${d.filename} (${d.fileType}).`);
          setError(null);
          void load(query);
        }}
        onError={(m) => {
          setError(m);
          setNotice(null);
        }}
      />

      <div className="card">
        <div className="row" style={{ marginBottom: 14 }}>
          <input
            placeholder="Search title, filename or tags..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void load(query);
            }}
          />
          <button className="btn" style={{ flex: 0 }} onClick={() => void load(query)}>
            Search
          </button>
        </div>

        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Type</th>
              <th>Size</th>
              <th>Category</th>
              <th>Tags</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {page?.items.map((d) => (
              <tr key={d.id}>
                <td>{d.title}</td>
                <td className="mono">{d.fileType.split('/').pop()}</td>
                <td>{formatBytes(d.sizeBytes)}</td>
                <td>{d.category.name}</td>
                <td className="mono">{d.tags.join(', ') || '—'}</td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    className="btn danger"
                    onClick={() => {
                      void (async () => {
                        setError(null);
                        try {
                          await withStepUp(() => api.del(`/admin/documents/${d.id}`));
                          setNotice(`Deleted ${d.title}.`);
                          void load(query);
                        } catch (e) {
                          setError(
                            e instanceof ApiError ? e.message_ : 'Unable to delete.',
                          );
                        }
                      })();
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {page?.items.length === 0 && (
              <tr>
                <td colSpan={6} className="sub" style={{ padding: '16px 10px' }}>
                  Nothing here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {error && <p className="err">{error}</p>}
      {notice && <p className="ok">{notice}</p>}
    </>
  );
}

function UploadCard({
  categories,
  onUploaded,
  onError,
}: {
  categories: Category[];
  onUploaded: (d: DocumentMeta) => void;
  onError: (message: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('personal');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    const file = fileRef.current?.files?.[0];
    if (!file) return onError('Choose a file first.');

    setBusy(true);
    try {
      const form = new FormData();
      form.append('category', category);
      if (title.trim()) form.append('title', title.trim());
      if (tags.trim()) form.append('tags', tags.trim());
      form.append('file', file, file.name);

      const uploaded = await api.upload(form);
      setTitle('');
      setTags('');
      if (fileRef.current) fileRef.current.value = '';
      onUploaded(uploaded);
    } catch (e) {
      onError(e instanceof ApiError ? e.message_ : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3>Upload</h3>
      <div className="field">
        <label htmlFor="file">File</label>
        <input id="file" type="file" ref={fileRef} />
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="title">Title (optional)</label>
          <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="cat">Category</label>
          <select id="cat" value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="tags">Tags (comma separated)</label>
          <input id="tags" value={tags} onChange={(e) => setTags(e.target.value)} />
        </div>
      </div>
      <button className="btn primary" disabled={busy} onClick={() => void submit()}>
        {busy ? 'Uploading...' : 'Upload'}
      </button>
    </div>
  );
}
