import { startTransition, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import {
  Antenna,
  ArrowRight,
  Check,
  Clapperboard,
  Film,
  Library,
  LoaderCircle,
  ExternalLink,
  Plus,
  Pencil,
  Power,
  Radio,
  Server,
  Settings,
  Trash2,
  Tv,
  X
} from "lucide-react";
import {
  checkPlexLink,
  createChannel,
  deleteChannel,
  getChannel,
  getChannels,
  getChannelSchedules,
  getCollections,
  getLibraryFilters,
  getLibraryItems,
  getLibraries,
  getPlexStatus,
  isChannelNumberAvailable,
  selectPlexServer,
  setChannelActive,
  startPlexLink,
  updateChannel,
  uploadChannelLogo
} from "./api";
import type { Channel, ChannelDetails, ChannelSchedule, PlexCollection, PlexItem, PlexLibrary, PlexLibraryFilters, PlexLink, PlexServerChoice, PlexStatus } from "./types";

type View = "channels" | "library" | "settings";

const EMPTY_STATUS: PlexStatus = {
  connected: false,
  baseUrl: null,
  serverName: null,
  serverVersion: null
};

export function App() {
  const [view, setView] = useState<View>("channels");
  const [status, setStatus] = useState<PlexStatus>(EMPTY_STATUS);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [schedules, setSchedules] = useState<ChannelSchedule[]>([]);
  const [libraries, setLibraries] = useState<PlexLibrary[]>([]);
  const [collections, setCollections] = useState<PlexCollection[]>([]);
  const [plexItems, setPlexItems] = useState<PlexItem[]>([]);
  const [selectedLibrary, setSelectedLibrary] = useState<PlexLibrary | null>(null);
  const [editingChannel, setEditingChannel] = useState<ChannelDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getPlexStatus(), getChannels(), getChannelSchedules().catch((error: Error) => {
      setMessage(error.message);
      return [];
    })])
      .then(([plexStatus, savedChannels, savedSchedules]) => {
        setStatus(plexStatus);
        setChannels(savedChannels);
        setSchedules(savedSchedules);
        if (!plexStatus.connected) setView("settings");
      })
      .catch((error: Error) => setMessage(error.message))
      .finally(() => setLoading(false));
  }, []);

  async function loadLibraries() {
    setMessage(null);
    try {
      const result = await getLibraries();
      startTransition(() => {
        setLibraries(result.filter((library) => library.type === "movie" || library.type === "show"));
        setView("library");
      });
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function selectLibrary(library: PlexLibrary) {
    setSelectedLibrary(library);
    setCollections([]);
    setPlexItems([]);
    setMessage(null);
    try {
      const [nextCollections, nextItems] = await Promise.all([getCollections(library.key), getLibraryItems(library.key)]);
      startTransition(() => { setCollections(nextCollections); setPlexItems(nextItems); });
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  function navigate(nextView: View) {
    if (nextView !== "library") setEditingChannel(null);
    if (nextView === "library" && status.connected && libraries.length === 0) {
      void loadLibraries();
      return;
    }
    setView(nextView);
  }

  async function beginEditChannel(channel: Channel) {
    setMessage(null);
    try {
      const libraryPromise = libraries.length > 0
        ? Promise.resolve(libraries)
        : getLibraries().then((result) => result.filter((library) => library.type === "movie" || library.type === "show"));
      const [details, availableLibraries] = await Promise.all([getChannel(channel.id), libraryPromise]);
      const library = availableLibraries.find((item) => item.key === details.libraryId);
      if (!library) throw new Error(`Plex library ${details.libraryTitle} is no longer available`);
      setLibraries(availableLibraries);
      setEditingChannel(details);
      await selectLibrary(library);
      setView("library");
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  function channelSaved(channel: Channel) {
    setChannels((current) => current.map((item) => item.id === channel.id ? channel : item).sort((a, b) => a.number - b.number));
    setEditingChannel(null);
    setView("channels");
    void getChannelSchedules().then(setSchedules).catch((error: Error) => setMessage(error.message));
  }

  if (loading) {
    return (
      <div className="boot-screen">
        <Radio size={34} />
        <span>Warming up ChannelDock</span>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => navigate("channels")}>
          <span className="brand-mark"><Antenna size={21} /></span>
          <span>ChannelDock</span>
        </button>
        <nav aria-label="Primary navigation">
          <NavButton active={view === "channels"} icon={<Tv />} label="Channels" onClick={() => navigate("channels")} />
          <NavButton active={view === "library"} icon={<Library />} label="Sources" onClick={() => navigate("library")} />
          <NavButton active={view === "settings"} icon={<Settings />} label="Settings" onClick={() => navigate("settings")} />
        </nav>
        <div className={`signal ${status.connected ? "is-live" : ""}`}>
          <span className="signal-dot" />
          <div>
            <strong>{status.connected ? "Plex linked" : "Plex offline"}</strong>
            <small>{status.serverName ?? "Connect a media server"}</small>
          </div>
        </div>
      </aside>

      <main>
        {message ? <div className="alert">{message}</div> : null}
        {view === "settings" ? (
          <PlexSettings status={status} onConnected={(next) => { setStatus(next); void loadLibraries(); }} />
        ) : null}
        {view === "library" ? (
          <SourceBrowser
            connected={status.connected}
            libraries={libraries}
            collections={collections}
            items={plexItems}
            selectedLibrary={selectedLibrary}
            editingChannel={editingChannel}
            onSelectLibrary={selectLibrary}
            onGoToSettings={() => setView("settings")}
            onCancelEdit={() => { setEditingChannel(null); setView("channels"); }}
            onChannelUpdated={channelSaved}
            onChannelCreated={(channel) => {
              setChannels((current) => [...current, channel].sort((a, b) => a.number - b.number));
              setView("channels");
              void getChannelSchedules().then(setSchedules).catch((error: Error) => setMessage(error.message));
            }}
          />
        ) : null}
        {view === "channels" ? (
          <Channels channels={channels} schedules={schedules} connected={status.connected} onAdd={() => navigate(status.connected ? "library" : "settings")} onEdit={beginEditChannel} onToggle={async (channel) => {
            try {
              const updated = await setChannelActive(channel.id, !channel.isActive);
              setChannels((current) => current.map((item) => item.id === updated.id ? updated : item));
              void getChannelSchedules().then(setSchedules).catch((error: Error) => setMessage(error.message));
            } catch (error) {
              setMessage((error as Error).message);
            }
          }} onDelete={async (channel) => {
            if (!window.confirm(`Remove channel ${channel.number}, ${channel.name}?`)) return;
            try {
              await deleteChannel(channel.id);
              setChannels((current) => current.filter((item) => item.id !== channel.id));
              setSchedules((current) => current.filter((schedule) => schedule.channelId !== channel.id));
            } catch (error) {
              setMessage((error as Error).message);
            }
          }} />
        ) : null}
      </main>
    </div>
  );
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick}>
      {icon}<span>{label}</span>
    </button>
  );
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return (
    <header className="page-heading">
      <div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>
      {action}
    </header>
  );
}

function PlexSettings({ status, onConnected }: { status: PlexStatus; onConnected: (status: PlexStatus) => void }) {
  const [link, setLink] = useState<PlexLink | null>(null);
  const [servers, setServers] = useState<PlexServerChoice[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function beginLink() {
    setSaving(true);
    setError(null);
    try {
      const nextLink = await startPlexLink();
      setLink(nextLink);
      window.open(nextLink.linkUrl, "_blank", "noopener,noreferrer");
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!link) return;
    let stopped = false;
    const poll = async () => {
      try {
        const result = await checkPlexLink(link.id);
        if (!stopped && result.linked) {
          setServers(result.servers);
          setLink(null);
        }
      } catch (caught) {
        if (!stopped) {
          setError((caught as Error).message);
          setLink(null);
        }
      }
    };
    const timer = window.setInterval(() => void poll(), 2_000);
    void poll();
    return () => { stopped = true; window.clearInterval(timer); };
  }, [link]);

  async function chooseServer(server: PlexServerChoice) {
    setSaving(true);
    setError(null);
    try {
      onConnected(await selectPlexServer(server.clientIdentifier));
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <PageHeading eyebrow="Connections" title="Bring your library aboard" description="Authorise ChannelDock with Plex, then choose the server that holds your library." />
      <div className="settings-grid">
        <div className="panel connection-panel">
          <div className="panel-title"><span className="plex-glyph">›</span><div><h2>Plex account</h2><p>{status.connected ? "Link a different account or server" : "Secure browser authorisation"}</p></div></div>
          {!link && servers.length === 0 ? <div className="link-intro"><p>ChannelDock will generate a short code and open Plex in a new browser tab. Sign in there to grant access.</p><button className="primary-button" disabled={saving} onClick={beginLink}>{saving ? <LoaderCircle className="spin" size={18} /> : <ExternalLink size={18} />}{saving ? "Creating code" : "Link Plex account"}</button></div> : null}
          {link ? <div className="pin-panel"><p className="eyebrow">Enter this code at plex.tv/link</p><strong>{link.code}</strong><a className="primary-button" href={link.linkUrl} target="_blank" rel="noreferrer"><ExternalLink size={18} />Open Plex link</a><span><LoaderCircle className="spin" size={14} />Waiting for approval</span></div> : null}
          {servers.length > 0 ? <div className="server-list"><p className="section-label">Choose a Plex server</p>{servers.map((server) => <button key={server.clientIdentifier} onClick={() => void chooseServer(server)} disabled={saving}><Server size={18} /><span><strong>{server.name}</strong><small>{server.connections.some((connection) => connection.local) ? "Local connection available" : "Remote connection"}</small></span><ArrowRight size={16} /></button>)}</div> : null}
          {error ? <p className="form-error">{error}</p> : null}
        </div>
        <div className="panel guide-panel">
          <p className="eyebrow">How linking works</p>
          <ol><li><span>01</span>ChannelDock requests a time-limited code from Plex.</li><li><span>02</span>You approve that code using your Plex account.</li><li><span>03</span>ChannelDock discovers your servers and prefers a local connection.</li></ol>
          {status.connected ? <div className="connected-card"><Check size={18} /><div><strong>{status.serverName}</strong><small>Plex {status.serverVersion}</small></div></div> : null}
        </div>
      </div>
    </section>
  );
}

function SourceBrowser({ connected, libraries, collections, items, selectedLibrary, editingChannel, onSelectLibrary, onGoToSettings, onChannelCreated, onChannelUpdated, onCancelEdit }: {
  connected: boolean; libraries: PlexLibrary[]; collections: PlexCollection[]; items: PlexItem[]; selectedLibrary: PlexLibrary | null;
  editingChannel: ChannelDetails | null; onSelectLibrary: (library: PlexLibrary) => void; onGoToSettings: () => void; onChannelCreated: (channel: Channel) => void;
  onChannelUpdated: (channel: Channel) => void; onCancelEdit: () => void;
}) {
  const [sourceMode, setSourceMode] = useState<"titles" | "collections">("titles");
  const [selected, setSelected] = useState<Map<string, PlexItem>>(
    () => new Map(editingChannel?.items.map((item) => [item.ratingKey, item as PlexItem]) ?? [])
  );
  const chosen = Array.from(selected.values());
  const showCount = chosen.filter((item) => item.type === "show").length;
  const filmCount = chosen.filter((item) => item.type === "movie").length;
  const episodeCount = chosen.reduce((total, item) => total + (item.type === "show" ? item.leafCount ?? 0 : 0), 0);

  useEffect(() => {
    if (editingChannel) setSourceMode("titles");
  }, [editingChannel]);
  useEffect(() => {
    if (items.length === 0) return;
    setSelected((current) => {
      const next = new Map(current);
      let changed = false;
      for (const item of items) {
        if (!current.has(item.ratingKey)) continue;
        const existing = current.get(item.ratingKey)!;
        if (existing.leafCount !== item.leafCount) {
          next.set(item.ratingKey, item);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [items]);
  if (!connected) return <EmptyState icon={<Server />} title="Connect Plex first" text="A Plex connection is needed before sources can be browsed." action="Open settings" onAction={onGoToSettings} />;
  return (
    <section>
      <PageHeading eyebrow="Plex catalogue" title="Build the lineup" description="Use a collection or assemble a channel from individual movies and complete shows." />
      <div className="source-layout">
        <div className="library-rail"><p className="section-label">Libraries</p>{libraries.map((library) => <button key={library.key} className={selectedLibrary?.key === library.key ? "selected" : ""} onClick={() => { setSourceMode("titles"); onSelectLibrary(library); }}>{library.type === "show" ? <Tv size={17} /> : <Film size={17} />}<span>{library.title}</span><ArrowRight size={15} /></button>)}<div className="selection-tally" aria-live="polite"><p className="section-label">Selected for channel</p><strong>{chosen.length} {chosen.length === 1 ? "title" : "titles"}</strong><span><Tv size={14} />{showCount} {showCount === 1 ? "show" : "shows"}</span><span className="tally-detail">{episodeCount.toLocaleString()} {episodeCount === 1 ? "episode" : "episodes"}</span><span><Film size={14} />{filmCount} {filmCount === 1 ? "film" : "films"}</span></div></div>
        <div className="collection-area">
          {!selectedLibrary ? <EmptyState icon={<Library />} title="Select a library" text="Its Plex collections will appear here." /> : null}
          {selectedLibrary ? <><div className="source-tabs" role="tablist" aria-label="Channel source"><button role="tab" aria-selected={sourceMode === "titles"} className={sourceMode === "titles" ? "active" : ""} onClick={() => setSourceMode("titles")}>Choose titles</button><button role="tab" aria-selected={sourceMode === "collections"} className={sourceMode === "collections" ? "active" : ""} disabled={Boolean(editingChannel)} onClick={() => setSourceMode("collections")}>Collections <span>{collections.length}</span></button></div>{sourceMode === "titles" ? <SelectionBuilder library={selectedLibrary} items={items} selected={selected} setSelected={setSelected} editingChannel={editingChannel} onCreated={onChannelCreated} onUpdated={onChannelUpdated} onCancelEdit={onCancelEdit} /> : null}{sourceMode === "collections" && collections.length === 0 ? <EmptyState icon={<Clapperboard />} title="No collections" text="This Plex library has no collections." /> : null}{sourceMode === "collections" && collections.length > 0 ? <div className="collection-grid">{collections.map((collection) => <CollectionCard key={collection.ratingKey} collection={collection} library={selectedLibrary} onCreated={onChannelCreated} />)}</div> : null}</> : null}
        </div>
      </div>
    </section>
  );
}

function CollectionCard({ collection, library, onCreated }: { collection: PlexCollection; library: PlexLibrary; onCreated: (channel: Channel) => void }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState(collection.title);
  const [number, setNumber] = useState(100);
  const [order, setOrder] = useState<"shuffle" | "sequential">("shuffle");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    try {
      if (!await isChannelNumberAvailable(number)) throw new Error("That channel number is already in use");
      onCreated(await createChannel({ name, number, playbackOrder: order, sourceType: "plex-collection", sourceId: collection.ratingKey, sourceTitle: collection.title, libraryId: library.key, libraryTitle: library.title, logoRatingKey: collection.ratingKey, isActive: true }));
    } catch (caught) { setError((caught as Error).message); }
  }

  return (
    <article className="collection-card">
      <div className="poster-placeholder"><Clapperboard size={24} /><span>{collection.childCount ?? "•"}</span></div>
      <div className="collection-copy"><h3>{collection.title}</h3><p>{collection.summary || `${collection.subtype ?? collection.type} collection`}</p></div>
      {!creating ? <button className="text-button" onClick={() => setCreating(true)}><Plus size={16} />Make channel</button> : <div className="quick-create"><label>Channel name<input value={name} onChange={(event) => setName(event.target.value)} /></label><div className="field-row"><label>Number<input type="number" min="1" max="9999" value={number} onChange={(event) => setNumber(Number(event.target.value))} /></label><label>Order<select value={order} onChange={(event) => setOrder(event.target.value as typeof order)}><option value="shuffle">Shuffle</option><option value="sequential">Mixed, episodes in order</option></select></label></div>{error ? <p className="form-error">{error}</p> : null}<div className="button-row"><button className="ghost-button" onClick={() => setCreating(false)}>Cancel</button><button className="primary-button compact" onClick={save}>Create</button></div></div>}
    </article>
  );
}

function SelectionBuilder({ library, items, selected, setSelected, editingChannel, onCreated, onUpdated, onCancelEdit }: { library: PlexLibrary; items: PlexItem[]; selected: Map<string, PlexItem>; setSelected: Dispatch<SetStateAction<Map<string, PlexItem>>>; editingChannel: ChannelDetails | null; onCreated: (channel: Channel) => void; onUpdated: (channel: Channel) => void; onCancelEdit: () => void }) {
  const [name, setName] = useState(editingChannel?.name ?? `${library.title} Channel`);
  const [number, setNumber] = useState(editingChannel?.number ?? 100);
  const [order, setOrder] = useState<"shuffle" | "sequential">(editingChannel?.playbackOrder ?? "shuffle");
  const [isActive, setIsActive] = useState(editingChannel?.isActive ?? true);
  const [query, setQuery] = useState("");
  const [genre, setGenre] = useState("");
  const [label, setLabel] = useState("");
  const [year, setYear] = useState("");
  const [filters, setFilters] = useState<PlexLibraryFilters>({ genres: [], labels: [], years: [] });
  const [filteredItems, setFilteredItems] = useState(items);
  const [visibleCount, setVisibleCount] = useState(200);
  const [filtering, setFiltering] = useState(false);
  const [logoRatingKey, setLogoRatingKey] = useState(editingChannel?.logoRatingKey ?? "");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const chosen = Array.from(selected.values());
  const matching = filteredItems.filter((item) => item.title.toLowerCase().includes(query.trim().toLowerCase()));
  const visible = matching.slice(0, visibleCount);

  useEffect(() => {
    setFilteredItems(items);
    setVisibleCount(200);
  }, [items]);

  useEffect(() => {
    setQuery("");
    setGenre("");
    setLabel("");
    setYear("");
  }, [library.key]);

  useEffect(() => {
    getLibraryFilters(library.key).then(setFilters).catch((caught: Error) => setError(caught.message));
  }, [library.key]);

  async function applyFilters(nextGenre: string, nextLabel: string, nextYear: string) {
    setFiltering(true);
    setError(null);
    try {
      setFilteredItems(await getLibraryItems(library.key, { genre: nextGenre || undefined, label: nextLabel || undefined, year: nextYear || undefined }));
      setVisibleCount(200);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setFiltering(false);
    }
  }

  function toggle(item: PlexItem) {
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(item.ratingKey)) next.delete(item.ratingKey);
      else {
        next.set(item.ratingKey, item);
        if (!logoRatingKey) setLogoRatingKey(item.ratingKey);
      }
      return next;
    });
  }
  async function save() {
    setError(null);
    try {
      if (chosen.length === 0) throw new Error("Select at least one movie or show");
      if ((!editingChannel || number !== editingChannel.number) && !await isChannelNumberAvailable(number)) throw new Error("That channel number is already in use");
      const selectedLogo = chosen.some((item) => item.ratingKey === logoRatingKey) ? logoRatingKey : chosen[0]?.ratingKey ?? null;
      const draft = { name, number, playbackOrder: order, sourceType: editingChannel?.sourceType ?? "plex-selection" as const, sourceId: editingChannel?.sourceId ?? "selection", sourceTitle: editingChannel?.sourceTitle ?? `${chosen.length} selected titles`, libraryId: library.key, libraryTitle: library.title, logoRatingKey: selectedLogo, isActive, items: chosen.map(({ ratingKey, title, type, leafCount }) => ({ ratingKey, title, type, leafCount: leafCount ?? null })) };
      let saved = editingChannel ? await updateChannel(editingChannel.id, draft) : await createChannel(draft);
      if (logoFile) saved = await uploadChannelLogo(saved.id, logoFile);
      if (editingChannel) onUpdated(saved); else onCreated(saved);
    } catch (caught) { setError((caught as Error).message); }
  }
  return <section className="selection-builder"><div className="selection-head"><div><p className="section-label">{editingChannel ? `Editing channel ${editingChannel.number}` : "Movies & shows"}</p><h2>{editingChannel ? `Edit ${editingChannel.name}` : `Choose titles from ${library.title}`}</h2><p>Select films or complete shows. Shows expand to their episodes when scheduled.</p></div></div>
    <div className="channel-controls"><div className="editor-options"><label className="active-toggle"><input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} /><span><strong>Channel in use</strong><small>{isActive ? "Visible in the TV app" : "Saved but hidden from the TV app"}</small></span></label><label className="logo-upload">Custom channel logo<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setLogoFile(event.target.files?.[0] ?? null)} /><small>{logoFile?.name ?? (editingChannel?.hasCustomLogo ? "Custom logo currently set" : "PNG, JPEG or WebP")}</small></label></div>
    <div className="channel-composer"><label>Channel name<input value={name} onChange={(event) => setName(event.target.value)} /></label><label>Number<input type="number" min="1" max="9999" value={number} onChange={(event) => setNumber(Number(event.target.value))} /></label><label>Order<select value={order} onChange={(event) => setOrder(event.target.value as typeof order)}><option value="shuffle">Shuffle</option><option value="sequential">Mixed, episodes in order</option></select></label><label>Channel logo<select value={logoRatingKey} onChange={(event) => setLogoRatingKey(event.target.value)}><option value="">First selected title</option>{chosen.map((item) => <option key={item.ratingKey} value={item.ratingKey}>{item.title}</option>)}</select></label><div><span className="selection-count">{chosen.length} selected</span><span className="composer-actions">{editingChannel ? <button className="ghost-button compact" onClick={onCancelEdit}>Cancel</button> : null}<button className="primary-button compact" onClick={() => void save()}>{editingChannel ? "Save changes" : "Create channel"}</button></span></div></div>{error ? <p className="form-error">{error}</p> : null}</div>
    <div className="catalogue-search"><input aria-label="Filter titles" placeholder="Search titles" value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(200); }} /></div>
    <div className="catalogue-filters"><label>Genre<select value={genre} onChange={(event) => { const next = event.target.value; setGenre(next); void applyFilters(next, label, year); }}><option value="">All genres</option>{filters.genres.map((option) => <option key={option.key} value={option.key}>{option.title}</option>)}</select></label><label>Label<select value={label} onChange={(event) => { const next = event.target.value; setLabel(next); void applyFilters(genre, next, year); }}><option value="">All labels</option>{filters.labels.map((option) => <option key={option.key} value={option.key}>{option.title}</option>)}</select></label><label className="year-filter">Year<select value={year} onChange={(event) => { const next = event.target.value; setYear(next); void applyFilters(genre, label, next); }}><option value="">All years</option>{filters.years.map((option) => <option key={option.key} value={option.key}>{option.title}</option>)}</select></label>{genre || label || year ? <button className="catalogue-clear" onClick={() => { setGenre(""); setLabel(""); setYear(""); void applyFilters("", "", ""); }}><X size={14} />Clear filters</button> : null}<span>{filtering ? "Loading…" : `${matching.length.toLocaleString()} titles`}</span></div>
    <div className="media-picker">{visible.map((item) => <button key={item.ratingKey} className={selected.has(item.ratingKey) ? "selected" : ""} onClick={() => toggle(item)}><span>{item.type === "show" ? <Tv size={15} /> : <Film size={15} />}{item.title}</span>{selected.has(item.ratingKey) ? <Check size={16} /> : null}</button>)}</div>
    {visible.length < matching.length ? <div className="catalogue-more"><span>Showing {visible.length.toLocaleString()} of {matching.length.toLocaleString()}</span><button className="ghost-button compact" onClick={() => setVisibleCount((count) => count + 200)}>Show more</button></div> : null}</section>;
}

function Channels({ channels, schedules, connected, onAdd, onEdit, onToggle, onDelete }: { channels: Channel[]; schedules: ChannelSchedule[]; connected: boolean; onAdd: () => void; onEdit: (channel: Channel) => Promise<void>; onToggle: (channel: Channel) => Promise<void>; onDelete: (channel: Channel) => Promise<void> }) {
  const scheduleByChannel = new Map(schedules.map((schedule) => [schedule.channelId, schedule]));
  return (
    <section>
      <PageHeading eyebrow="Playout" title="Your channel board" description="Each channel is an always-ready lineup built from your own catalogue." action={<button className="primary-button" onClick={onAdd}><Plus size={18} />New channel</button>} />
      {channels.length === 0 ? <EmptyState icon={<Radio />} title="No channels yet" text={connected ? "Choose titles or a Plex collection to create one." : "Connect Plex, then build your first channel."} action={connected ? "Browse sources" : "Connect Plex"} onAction={onAdd} /> : <div className="channel-board">{channels.map((channel) => {
        const schedule = scheduleByChannel.get(channel.id);
        const hasMedia = Boolean(schedule?.itemCount);
        const statusLabel = !channel.isActive ? "Not in use" : hasMedia ? "Live" : "No media";
        const logoUrl = channel.hasCustomLogo ? `/channel-logo/${channel.id}` : channel.logoRatingKey ? `/artwork/${channel.logoRatingKey}` : null;
        return <article className={`channel-card ${channel.isActive ? "" : "inactive"}`} key={channel.id}>{logoUrl ? <img className={`channel-card-logo ${channel.hasCustomLogo ? "custom" : ""}`} src={logoUrl} alt="" /> : <span className="channel-card-logo placeholder"><Radio size={22} /></span>}<div className="channel-card-copy"><span className={`channel-status ${channel.isActive && hasMedia ? "live" : "idle"}`}>{statusLabel}</span><p className="channel-number">Channel {channel.number}</p><h2>{channel.name}</h2><p>{schedule?.itemCount ?? 0} items · {channel.playbackOrder}</p></div><div className="channel-card-actions"><button className={`channel-toggle ${channel.isActive ? "on" : ""}`} aria-label={`${channel.isActive ? "Turn off" : "Turn on"} ${channel.name}`} onClick={() => void onToggle(channel)}><Power size={16} /><span>{channel.isActive ? "Turn off" : "Turn on"}</span></button><button className="channel-edit" aria-label={`Edit ${channel.name}`} onClick={() => void onEdit(channel)}><Pencil size={16} /><span>Edit</span></button><button className="channel-delete" aria-label={`Remove ${channel.name}`} onClick={() => void onDelete(channel)}><Trash2 size={16} /><span>Remove</span></button></div></article>;
      })}</div>}
    </section>
  );
}

function EmptyState({ icon, title, text, action, onAction }: { icon: React.ReactNode; title: string; text: string; action?: string; onAction?: () => void }) {
  return <div className="empty-state"><span>{icon}</span><h2>{title}</h2><p>{text}</p>{action && onAction ? <button className="text-button" onClick={onAction}>{action}<ArrowRight size={16} /></button> : null}</div>;
}
