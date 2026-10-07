import { getPresets, styleVars, clean, urlSafe } from "./presets.js";

const MODULE = "party-book";
const SOCKET = `module.${MODULE}`;
const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const TE = () => foundry.applications.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
const esc = s => Handlebars.escapeExpression(s ?? "");
const isBook = j => !!j?.getFlag(MODULE, "isBook");
const sortedPages = j => j.pages.contents.slice().sort((a, b) => a.sort - b.sort);
const visiblePages = j => sortedPages(j).filter(p => p.testUserPermission(game.user, "OBSERVER"));
const formObject = (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object;

function presetOptions(selected, allowInherit = false) {
  const opts = Object.entries(getPresets()).map(([id, p]) => `<option value="${esc(id)}" ${id === selected ? "selected" : ""}>${esc(p.label)}</option>`);
  if (allowInherit) opts.unshift(`<option value="" ${!selected ? "selected" : ""}>(book default)</option>`);
  return opts.join("");
}

function coverStyle(j) {
  const f = n => j.getFlag(MODULE, n);
  let s = `--pb-cover:${clean(f("coverColor") || "#3b2418")};--pb-title:${clean(f("titleColor") || "#e9d9a6")};`;
  if (f("coverImage")) s += `--pb-coverimg:url("${urlSafe(f("coverImage"))}");`;
  return s;
}

async function pageData(journal, page, secrets = false) {
  const s = page.getFlag(MODULE, "style") ?? {};
  const preset = s.preset || journal.getFlag(MODULE, "preset") || "parchment";
  const { style, hasBg } = styleVars(preset, s);
  let html;
  if (page.type === "text") {
    html = await TE().enrichHTML(page.text.content ?? "", { relativeTo: page, secrets: secrets && page.isOwner });
  } else if (page.type === "image") {
    const cap = page.image?.caption ? `<figcaption>${esc(page.image.caption)}</figcaption>` : "";
    html = `<figure class="pb-figure"><img src="${esc(page.src)}" alt="${esc(page.name)}">${cap}</figure>`;
  } else {
    html = `<p class="pb-unsupported"><em>Pages of type "${esc(page.type)}" can't be shown inside the book.</em></p>`;
  }
  return { id: page.id, name: page.name, html, style, hasBg, showTitle: s.showTitle !== false };
}

/* ------------------------------------------------------------------ */
/*  Book window                                                        */
/* ------------------------------------------------------------------ */
class PartyBook extends HandlebarsApplicationMixin(ApplicationV2) {
  static instances = new Map();

  static DEFAULT_OPTIONS = {
  classes: ["party-book-app"],

  position: {
    width: 780,
    height: 880
  },

  window: {
    resizable: true,
    icon: "fa-solid fa-book"
  },

  actions: {
    open: this._open,
    cover: this._cover,
    toc: this._toc,
    next: this._next,
    prev: this._prev,

    goto: this._goto,
    bookmark: this._bookmark,
    addPage: this._addPage,
    editText: this._editText,
    stylePage: this._stylePage,
    deletePage: this._deletePage,
    bookSettings: this._bookSettings,
    showDoc: this._showDoc
  }
};

  static PARTS = { main: { template: `modules/${MODULE}/templates/book.hbs` } };

  view = "cover";
  pageIndex = 0;

  static open(idOrName, { pageId } = {}) {
    const j = game.journals.get(idOrName) ?? game.journals.getName(idOrName);
    if (!j) return ui.notifications.warn("Party Book | book not found.");
    let app = this.instances.get(j.id);
    if (!app) { app = new this({ id: `party-book-${j.id}`, journalId: j.id }); this.instances.set(j.id, app); }
    if (pageId) {
      const i = visiblePages(j).findIndex(p => p.id === pageId);
      if (i >= 0) { app.view = "page"; app.pageIndex = i; }
    }
    app.render({ force: true });
    return app;
  }

  get journal() { return game.journals.get(this.options.journalId); }
  get title() { return this.journal?.name ?? "Party Book"; }
  get bookmarks() { return game.user.getFlag(MODULE, "bookmarks")?.[this.options.journalId] ?? []; }
  get currentPage() { return visiblePages(this.journal)[this.pageIndex]; }

  _onClose(options) {
    super._onClose?.(options);
    PartyBook.instances.delete(this.options.journalId);
  }

  async _prepareContext() {
    const j = this.journal;
    const pages = visiblePages(j);
    if (this.view === "page" && !pages.length) this.view = "cover";
    this.pageIndex = Math.min(Math.max(this.pageIndex, 0), Math.max(pages.length - 1, 0));
    const marks = this.bookmarks;
    const ctx = {
      isGM: game.user.isGM,
      isCover: this.view === "cover", isToc: this.view === "toc", isPage: this.view === "page",
      canAdd: j.isOwner, canConfig: j.isOwner,
      cover: { title: j.name, subtitle: j.getFlag(MODULE, "subtitle") ?? "", style: coverStyle(j) },
      tocStyle: styleVars(j.getFlag(MODULE, "preset") || "parchment").style,
      toc: pages.map((p, i) => ({ index: i, name: p.name, indent: Math.max((p.title?.level ?? 1) - 1, 0) * 16, marked: marks.includes(p.id) })),
      ribbons: pages.map((p, i) => ({ id: p.id, name: p.name, index: i, n: i + 1 })).filter(r => marks.includes(r.id)),
      count: pages.length, number: this.pageIndex + 1, hasNext: this.pageIndex < pages.length - 1
    };
    if (ctx.isPage) {
      const p = pages[this.pageIndex];
      ctx.page = { ...(await pageData(j, p, true)), marked: marks.includes(p.id), canEdit: p.isOwner };
    }
    return ctx;
  }

  _onRender() {
    for (const a of this.element.querySelectorAll("a.content-link[data-uuid]")) {
      a.addEventListener("click", async ev => {
        ev.preventDefault(); ev.stopPropagation();
        const doc = await fromUuid(a.dataset.uuid);
        if (!doc) return ui.notifications.warn("Linked document not found or not visible to you.");
        if (doc instanceof JournalEntry && isBook(doc)) return PartyBook.open(doc.id);
        if (doc instanceof JournalEntryPage && isBook(doc.parent)) return PartyBook.open(doc.parent.id, { pageId: doc.id });
        doc.sheet?.render(true);
      });
    }
  }

  static _open(event, target) {
    console.log("PARTY BOOK OPEN CLICK", this, event, target);

    this.view = "page";
    this.render();
  }
  static _cover() { this.view = "cover"; this.render(); }
  static _toc() { this.view = "toc"; this.render(); }
  static _next() { this.pageIndex++; this.render(); }
  static _prev() { if (this.pageIndex <= 0) this.view = "cover"; else this.pageIndex--; this.render(); }
  static _goto(ev, t) { this.view = "page"; this.pageIndex = Number(t.dataset.index); this.render(); }

  static async _bookmark() {
    const p = this.currentPage; if (!p) return;
    const all = game.user.getFlag(MODULE, "bookmarks") ?? {};
    const set = new Set(all[this.journal.id] ?? []);
    set.has(p.id) ? set.delete(p.id) : set.add(p.id);
    await game.user.setFlag(MODULE, "bookmarks", { ...all, [this.journal.id]: [...set] });
    this.render();
  }

  static async _addPage() {
    const j = this.journal;
    const last = sortedPages(j).at(-1)?.sort ?? 0;
    const [page] = await j.createEmbeddedDocuments("JournalEntryPage", [{
      name: "New Page", type: "text", sort: last + CONST.SORT_INTEGER_DENSITY, text: { content: "<p>Start writing…</p>", format: 1 }
    }]);
    this.view = "page";
    this.pageIndex = Math.max(visiblePages(j).findIndex(p => p.id === page.id), 0);
    this.render();
    page.sheet.render(true);
  }

  static _editText() { this.currentPage?.sheet.render(true); }

  static async _deletePage() {
    const p = this.currentPage; if (!p) return;
    const ok = await DialogV2.confirm({ window: { title: "Delete page" }, content: `<p>Delete page “${esc(p.name)}”? This cannot be undone.</p>` });
    if (!ok) return;
    this.pageIndex = Math.max(this.pageIndex - 1, 0);
    await p.delete();
  }

  static async _stylePage() {
    const p = this.currentPage; if (!p) return;
    const s = p.getFlag(MODULE, "style") ?? {};
    const fonts = ["", ...Object.keys(CONFIG.fontDefinitions ?? {})];
    const fontOpts = fonts.map(f => `<option value="${esc(f)}" ${f === (s.font ?? "") ? "selected" : ""}>${f || "(preset default)"}</option>`).join("");
    const aligns = ["", "left", "center", "right", "justify"].map(a => `<option value="${a}" ${a === (s.align ?? "") ? "selected" : ""}>${a || "(default)"}</option>`).join("");
    const content = `<form class="pb-form">
      <div class="form-group"><label>Preset</label><div class="form-fields"><select name="preset">${presetOptions(s.preset, true)}</select></div></div>
      <div class="form-group"><label>Background image</label><div class="form-fields"><file-picker name="bg" type="image" value="${esc(s.bg ?? "")}"></file-picker></div></div>
      <div class="form-group"><label>Veil over image</label><div class="form-fields"><range-picker name="overlay" min="0" max="1" step="0.05" value="${s.overlay ?? 0.35}"></range-picker></div><p class="hint">Darkens or lightens the picture so text stays readable.</p></div>
      <div class="form-group"><label>Paper (CSS colour/gradient)</label><div class="form-fields"><input type="text" name="paper" value="${esc(s.paper ?? "")}" placeholder="preset default"></div></div>
      <div class="form-group"><label>Text colour</label><div class="form-fields"><input type="text" name="ink" value="${esc(s.ink ?? "")}" placeholder="#3a2812"></div></div>
      <div class="form-group"><label>Heading colour</label><div class="form-fields"><input type="text" name="accent" value="${esc(s.accent ?? "")}" placeholder="#7b1e12"></div></div>
      <div class="form-group"><label>Font</label><div class="form-fields"><select name="font">${fontOpts}</select></div></div>
      <div class="form-group"><label>Font size (px)</label><div class="form-fields"><input type="number" name="size" min="10" max="40" value="${s.size ?? ""}" placeholder="17"></div></div>
      <div class="form-group"><label>Text alignment</label><div class="form-fields"><select name="align">${aligns}</select></div></div>
      <div class="form-group"><label>Show page title</label><div class="form-fields"><input type="checkbox" name="showTitle" ${s.showTitle !== false ? "checked" : ""}></div></div>
    </form>`;
    const result = await DialogV2.wait({
      window: { title: `Style: ${p.name}` }, content, rejectClose: false,
      buttons: [
        { action: "save", label: "Save", icon: "fa-solid fa-check", default: true, callback: formObject },
        { action: "reset", label: "Reset to preset", icon: "fa-solid fa-rotate-left", callback: () => "reset" }
      ]
    });
    if (result === "reset") await p.update({ [`flags.${MODULE}.-=style`]: null });
    else if (result && typeof result === "object") await p.update({ [`flags.${MODULE}.style`]: result });
  }

  static async _bookSettings() {
    const j = this.journal;
    const f = n => j.getFlag(MODULE, n) ?? "";
    const perm = j.ownership?.default ?? 0;
    const permOpts = [[0, "Hidden from players"], [2, "Players can read"], [3, "Players can read and add pages (Owner)"]]
      .map(([v, l]) => `<option value="${v}" ${v === perm ? "selected" : ""}>${l}</option>`).join("");
    const content = `<form class="pb-form">
      <div class="form-group"><label>Title</label><div class="form-fields"><input type="text" name="name" value="${esc(j.name)}"></div></div>
      <div class="form-group"><label>Subtitle</label><div class="form-fields"><input type="text" name="subtitle" value="${esc(f("subtitle"))}"></div></div>
      <div class="form-group"><label>Cover image</label><div class="form-fields"><file-picker name="coverImage" type="image" value="${esc(f("coverImage"))}"></file-picker></div></div>
      <div class="form-group"><label>Cover colour</label><div class="form-fields"><input type="color" name="coverColor" value="${esc(f("coverColor") || "#3b2418")}"></div></div>
      <div class="form-group"><label>Title colour</label><div class="form-fields"><input type="color" name="titleColor" value="${esc(f("titleColor") || "#e9d9a6")}"></div></div>
      <div class="form-group"><label>Default page preset</label><div class="form-fields"><select name="preset">${presetOptions(f("preset") || "parchment")}</select></div></div>
      ${game.user.isGM ? `<div class="form-group"><label>Player access</label><div class="form-fields"><select name="perm">${permOpts}</select></div></div>` : ""}
    </form>`;
    const d = await DialogV2.prompt({ window: { title: "Book settings" }, content, rejectClose: false, ok: { label: "Save", callback: formObject } });
    if (!d) return;
    const update = {
      name: d.name || j.name,
      [`flags.${MODULE}.subtitle`]: d.subtitle, [`flags.${MODULE}.coverImage`]: d.coverImage,
      [`flags.${MODULE}.coverColor`]: d.coverColor, [`flags.${MODULE}.titleColor`]: d.titleColor, [`flags.${MODULE}.preset`]: d.preset
    };
    if (d.perm !== undefined) update["ownership.default"] = Number(d.perm);
    await j.update(update);
  }

  static async _showDoc() {
    const p = this.currentPage; if (!p) return;
    const users = game.users.filter(u => !u.isSelf && u.active);
    if (!users.length) return ui.notifications.info("No other players are connected.");
    const content = `<form class="pb-form"><p>Show “${esc(p.name)}” as a standalone document to:</p>${users.map(u => `<label class="checkbox"><input type="checkbox" name="u-${u.id}" checked> ${esc(u.name)}</label>`).join("<br>")}</form>`;
    const d = await DialogV2.prompt({ window: { title: "Show as document" }, content, rejectClose: false, ok: { label: "Show", icon: "fa-solid fa-scroll", callback: formObject } });
    if (!d) return;
    const userIds = Object.entries(d).filter(([, v]) => v).map(([k]) => k.slice(2));
    if (userIds.length) showDocument(p.uuid, { userIds });
  }
}

/* ------------------------------------------------------------------ */
/*  Found-document viewer (one page, nothing else)                     */
/* ------------------------------------------------------------------ */
class DocumentViewer extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = { classes: ["party-book-app", "pb-doc"], position: { width: 560, height: 720 }, window: { resizable: true, icon: "fa-solid fa-scroll" } };
  static PARTS = { main: { template: `modules/${MODULE}/templates/document.hbs` } };
  constructor(data, options = {}) { super({ window: { title: data.name }, ...options }); this.data = data; }
  async _prepareContext() { return this.data; }
}

async function showDocument(uuid, { userIds, local = true } = {}) {
  const page = await fromUuid(uuid);
  if (page?.documentName !== "JournalEntryPage") return ui.notifications.warn("Party Book | page not found.");
  const data = await pageData(page.parent, page, false);
  userIds ??= game.users.filter(u => u.active && !u.isSelf).map(u => u.id);
  game.socket.emit(SOCKET, { type: "doc", userIds, data });
  if (local) new DocumentViewer(data).render({ force: true });
}

/* ------------------------------------------------------------------ */
/*  Library (list of books)                                            */
/* ------------------------------------------------------------------ */
class PartyBookLibrary extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "party-book-library", classes: ["party-book-app", "pb-lib"], position: { width: 380, height: "auto" },
    window: { title: "Party Books", icon: "fa-solid fa-book-open" },
    actions: { openBook: PartyBookLibrary._openBook, newBook: PartyBookLibrary._newBook, convert: PartyBookLibrary._convert }
  };
  static PARTS = { main: { template: `modules/${MODULE}/templates/library.hbs` } };

  static show() { return new this().render({ force: true }); }

  async _prepareContext() {
    const books = game.journals.filter(j => isBook(j) && j.testUserPermission(game.user, "OBSERVER"));
    return {
      isGM: game.user.isGM,
      canCreate: JournalEntry.canUserCreate(game.user),
      books: books.map(j => ({ id: j.id, name: j.name, pages: j.pages.size })),
      others: game.journals.filter(j => !isBook(j)).map(j => ({ id: j.id, name: j.name }))
    };
  }

  static _openBook(ev, t) { PartyBook.open(t.dataset.id); }

  static async _newBook() {
    const d = await DialogV2.prompt({
      window: { title: "New book" }, rejectClose: false,
      content: `<div class="form-group"><label>Title</label><div class="form-fields"><input type="text" name="name" value="New Book" autofocus></div></div>`,
      ok: { label: "Create", callback: formObject }
    });
    if (!d?.name) return;
    const j = await JournalEntry.create({
      name: d.name, ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
      flags: { [MODULE]: { isBook: true, preset: "parchment", subtitle: "" } },
      pages: [{ name: "Page 1", type: "text", text: { content: "<p>Start writing…</p>", format: 1 } }]
    });
    this.render();
    PartyBook.open(j.id);
  }

  static async _convert() {
    const id = this.element.querySelector("[name=convertId]")?.value;
    const j = game.journals.get(id); if (!j) return;
    await j.update({ [`flags.${MODULE}`]: { isBook: true, preset: "parchment" } });
    this.render();
  }
}

/* ------------------------------------------------------------------ */
/*  Hooks                                                              */
/* ------------------------------------------------------------------ */
Hooks.once("init", () => {
  game.settings.register(MODULE, "customPresets", {
    name: "Custom presets (JSON)",
    hint: 'Add your own looks, e.g. {"swamp":{"label":"Swamp","paper":"#2b3a2b","ink":"#d6e6c8","accent":"#9acd32","border":"#44603f","veil":"10,20,10","overlay":0.5,"grain":0.2}}',
    scope: "world", config: true, type: String, default: "{}"
  });
});

Hooks.once("ready", () => {
  game.modules.get(MODULE).api = {
    open: (idOrName, opts) => PartyBook.open(idOrName, opts),
    library: () => PartyBookLibrary.show(),
    showDocument
  };
  game.socket.on(SOCKET, msg => {
    if (msg?.type === "doc" && msg.userIds?.includes(game.user.id)) new DocumentViewer(msg.data).render({ force: true });
  });
});

Hooks.on("renderJournalDirectory", (app, html) => {
  const root = html instanceof HTMLElement ? html : html[0];
  if (!root || root.querySelector(".pb-library-btn")) return;
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "pb-library-btn";
  btn.innerHTML = '<i class="fa-solid fa-book-open"></i> Party Books';
  btn.addEventListener("click", () => PartyBookLibrary.show());
  (root.querySelector(".header-actions") ?? root.querySelector(".directory-header"))?.prepend(btn);
});

function contextOptions(options) {
  const idOf = li => { const el = li instanceof HTMLElement ? li : li[0]; return el?.dataset.entryId ?? el?.dataset.documentId; };
  options.push(
    { name: "Open as Party Book", icon: '<i class="fa-solid fa-book-open"></i>', condition: li => isBook(game.journals.get(idOf(li))), callback: li => PartyBook.open(idOf(li)) },
    { name: "Convert to Party Book", icon: '<i class="fa-solid fa-book"></i>', condition: li => game.user.isGM && !isBook(game.journals.get(idOf(li))), callback: li => game.journals.get(idOf(li)).update({ [`flags.${MODULE}`]: { isBook: true, preset: "parchment" } }) }
  );
}
Hooks.on("getJournalEntryContextOptions", (app, options) => contextOptions(options));
Hooks.on("getJournalDirectoryEntryContext", (app, options) => contextOptions(options));

const refresh = doc => {
  const id = doc.documentName === "JournalEntry" ? doc.id : doc.parent?.id;
  PartyBook.instances.get(id)?.render();
};
for (const h of ["updateJournalEntry", "updateJournalEntryPage", "createJournalEntryPage", "deleteJournalEntryPage"]) Hooks.on(h, refresh);
