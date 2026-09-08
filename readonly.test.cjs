const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const test = require("node:test");

// Execute the shipped bundle's classes, without loading Obsidian or touching a real vault.
const source = fs.readFileSync(`${__dirname}/main.js`, "utf8");
function extract(kind, name) {
  const result = source.match(new RegExp(`^    ${kind} ${name}\\b[^\\n]*\\{\\n[\\s\\S]*?^    \\}`, "m"));
  assert.ok(result, `Missing ${kind} ${name}`);
  return result[0];
}
function fixture() {
  const writes = [], requests = [], notices = [], opened = [], timers = [];
  const content = "---\ndoc_type: weread-highlights-reviews\nbookId: '39980443'\n---\n我的读书笔记：海绵式思维和淘金式思维\n";
  class TFile {}
  class TFolder {}
  const file = Object.assign(new TFile(), {path: "books read/笔记/学会提问.md", basename: "学会提问"});
  const files = new Map([[file.path, content]]);
  const entries = new Map([[file.path, file], ...["books read", "books read/笔记"].map(path => [path, Object.assign(new TFolder(), {path})])]);
  const metadata = new Map([[file.path, {
    doc_type: "weread-highlights-reviews", bookId: "39980443", title: "学会提问", noteCount: 1, reviewCount: 0,
  }]]);
  const settings = {scheduledSyncToggle: true, scheduledSyncInterval: 1, saveReadingInfoToggle: true,
    noteLocation: "books read/笔记", fileNameType: "BOOK_NAME", removeParens: true, subFolderType: -1};
  const mutationNames = ["modify", "modifyBinary", "create", "createBinary", "createFolder", "write", "writeBinary", "append", "appendBinary", "process", "delete", "trash", "trashFile", "rename", "renameFile", "processFrontMatter", "remove", "rmdir", "mkdir", "copy"];
  const mutations = Object.fromEntries(mutationNames.map(name => [name, (...args) => {
    writes.push([name, ...args]);
    files.set(file.path, "UNEXPECTED MUTATION");
    return Promise.resolve(file);
  }]));
  const vault = {
    ...mutations,
    getMarkdownFiles: () => [...entries.values()].filter(entry => entry instanceof TFile),
    getAbstractFileByPath: path => entries.get(path) || null,
    cachedRead: async () => files.get(file.path),
    adapter: {...mutations, exists: async path => entries.has(path) || files.has(path), read: async () => "{}"},
  };
  const metadataCache = {getFileCache: file => ({frontmatter: metadata.get(file.path)})};
  const leaf = {openFile: async f => opened.push(f.path)};
  const app = {vault, metadataCache, fileManager: mutations, workspace: {getLeaf: () => leaf, revealLeaf: () => {}}};
  const api = new Proxy({}, {get: (_, name) => () => {requests.push(name); throw new Error("Unexpected network request");}});
  function asyncGenerator(self, args, _, generator) {
    return new Promise((resolve, reject) => {
      const iterator = generator.apply(self, args || []);
      function step(method, value) {
        let result;
        try {result = iterator[method](value);} catch (error) {reject(error); return;}
        if (result.done) resolve(result.value);
        else Promise.resolve(result.value).then(value => step("next", value), error => step("throw", error));
      }
      step("next");
    });
  }
  const context = vm.createContext({
    console, Promise, Map, Date,
    e: asyncGenerator,
    t: {TFile, TFolder, Plugin: class {}, Modal: class {}, ItemView: class {}, Notice: class {constructor(message) {notices.push(message);}},
      normalizePath: path => path.replace(/\/{2,}/g, "/"),
      stringifyYaml: object => Object.entries(object).map(([key, value]) => `${key}: ${JSON.stringify(value)}\n`).join("")},
    m: class {}, k: "weread-highlights-reviews", f: {},
    w: title => title.replace(/[\\/:*?"<>|]/g, "").trim(),
    l: () => settings,
    window: {setInterval: () => timers.push("start"), clearInterval: id => timers.push(["clear", id])},
  });
  const classNames = ["E", "T", "P", "Z", "Ee", "St", "zt", "ir", "ve"];
  vm.runInContext([
    extract("function", "wereadRejectVaultWrite"), extract("function", "wereadReadOnlyNotice"),
    extract("function", "wt"), ...classNames.map(name => extract("class", name)),
    `globalThis.classes = {${classNames.join(",")}, wt};`,
  ].join("\n"), context);
  return {app, api, file, leaf, writes, requests, notices, opened, timers, files, entries, metadata, settings, TFile, TFolder, content, ...context.classes};
}

function allowFirstCreation(f) {
  f.app.vault.create = async (path, content) => {
    if (f.files.has(path) || f.entries.has(path)) throw new Error("File already exists");
    f.writes.push(["create", path]);
    const file = Object.assign(new f.TFile(), {path, basename: path.split("/").at(-1).replace(/\.md$/, "")});
    f.files.set(path, content);
    f.entries.set(path, file);
    // Deliberately leave the metadata cache stale, like Obsidian immediately after creation.
    return file;
  };
  f.app.vault.createFolder = async path => {
    if (f.entries.has(path)) throw new Error("Folder already exists");
    f.writes.push(["createFolder", path]);
    f.entries.set(path, Object.assign(new f.TFolder(), {path}));
  };
}

test("manual, forced, single-book, import and statistics sync never fetch or write", async () => {
  const f = fixture();
  const manager = new f.E(f.app.vault, f.app.metadataCache, f.app);
  const sync = new f.P(manager, f.api, f.app);
  await sync.syncNotebooks(false);
  await sync.syncNotebooks(true);
  await sync.syncNotebook({file: f.file, bookId: "39980443"});
  await sync.syncBookById("39980443");
  await sync.importBookFromSearch({bookId: "39980443"});
  await sync.syncNotesToJounal("2026-09-08");
  await new f.Z(f.app.vault, f.api).sync();
  assert.equal(f.notices.length, 7);
  assert.deepEqual(f.requests, []);
  assert.deepEqual(f.writes, []);
  assert.equal(f.files.get(f.file.path), f.content);
});

test("low-level note, journal, deletion, folder and image writes reject even when called directly", async () => {
  const f = fixture();
  const manager = new f.E(f.app.vault, f.app.metadataCache, f.app);
  const sync = new f.P(manager, f.api, f.app);
  const modal = Object.assign(Object.create(f.zt.prototype), {app: f.app});
  const operations = [
    () => manager.saveNotebook({metaData: {file: {file: f.file, new: true}}}),
    () => manager.saveNotebook({metaData: {bookId: "new"}}),
    () => manager.saveDailyNotes(f.file.path, []),
    () => manager.deleteNotebookFile(f.file),
    () => manager.getNewNotebookFilePath({}),
    () => sync.saveNotebook({}),
    () => sync.saveToJounal("2026-09-08", []),
    () => new f.Z(f.app.vault, f.api).saveFile("replacement", "/"),
    () => modal.saveImportedImages("assets"),
    () => modal.ensureFolder("new folder"),
  ];
  for (const operation of operations) await assert.rejects(operation, {code: "WEREAD_READ_ONLY"});
  await modal.saveNote(true);
  assert.deepEqual(f.writes, []);
  assert.equal(f.files.get(f.file.path), f.content);
});

test("commands and enabled scheduled sync cannot modify notes or start a timer", async () => {
  const f = fixture();
  const plugin = Object.assign(new f.ir(), {app: f.app});
  await plugin.startSync(false);
  await plugin.startSync(true);
  await plugin.syncBookById("39980443");
  await plugin.deleteLocalBookByPath(f.file.path);
  await plugin.openBookListImport();
  await plugin.openReadingNote();
  plugin.scheduledSyncTimer = 123;
  plugin.setupScheduledSync();
  plugin.setupScheduledSync();
  assert.deepEqual(f.timers, [["clear", 123]]);
  assert.equal(plugin.scheduledSyncTimer, null);
  assert.deepEqual(f.writes, []);
});

test("cache refresh and cleanup never persist or delete vault files", async () => {
  const f = fixture();
  const cache = new f.T(f.app);
  await cache.set("39980443", [], []);
  await cache.clear("39980443");
  assert.equal(await cache.clearExpired(), 0);
  await cache.ensureCacheDir();
  await f.wt(f.app.vault, {});
  assert.deepEqual(f.writes, []);
});

test("existing book lookup and all local-note navigation keep the note untouched", async () => {
  const f = fixture();
  const manager = new f.E(f.app.vault, f.app.metadataCache, f.app);
  const localFile = (await manager.getNotebookFilesByBookId()).get("39980443");
  assert.equal(localFile.file, f.file);
  const shelf = Object.assign(Object.create(f.Ee.prototype), {app: f.app, localReadingNotes: [], looseReadingNotes: [f.file]});
  await shelf.openLocalFile({bookId: "39980443", localFile});
  // Title-based navigation must also work without a sync marker or matching book ID.
  await shelf.openLocalFile({bookId: "other-id", title: "学会提问（原书第12版）"});
  const detail = Object.assign(Object.create(f.St.prototype), {app: f.app, leaf: f.leaf, localFilePath: f.file.path});
  await detail.openLocalFileIfExists();
  await detail.openLocalFileInCurrentLeaf();
  const notes = Object.assign(Object.create(f.ve.prototype), {app: f.app, close() {}});
  await notes.openFile(f.file);
  assert.deepEqual(f.opened, Array(5).fill(f.file.path));
  assert.deepEqual(f.writes, []);
  assert.equal(f.files.get(f.file.path), f.content);
});

test("the shipped bundle permits creation only inside the explicit create-once path", () => {
  const mutation = /(?:vault(?:\s*\.\s*adapter)?|adapter|fileManager)\s*\.\s*(?:modify(?:Binary)?|create(?:Binary|Folder)?|write(?:Binary)?|append(?:Binary)?|process(?:FrontMatter)?|delete|trash(?:File)?|rename(?:File)?|remove|rmdir|mkdir|copy)\s*\(/g;
  const createOnce = source.match(/^      getOrCreateLinkedNote\(book\) \{\n[\s\S]*?^      \}/m)[0];
  assert.deepEqual(source.replace(createOnce, "").match(mutation) || [], []);
  assert.deepEqual(createOnce.match(mutation), ["vault.createFolder(", "vault.create("]);
  assert.ok(source.includes('(p.onclick = () => this.loadBookshelf())'));
  assert.ok(!source.includes('this.plugin.syncBookById(this.bookId)'));
});

test("existing book ID and unlinked matching title open without any writes", async () => {
  const f = fixture();
  allowFirstCreation(f);
  const manager = new f.E(f.app.vault, f.app.metadataCache, f.app);
  assert.equal(await manager.getOrCreateLinkedNote({bookId: "39980443", title: "改过的书名"}), f.file);
  f.metadata.delete(f.file.path);
  assert.equal(await manager.getOrCreateLinkedNote({bookId: "39980443", title: "学会提问（原书第12版）"}), f.file);
  assert.deepEqual(f.writes, []);
  assert.equal(f.files.get(f.file.path), f.content);
});

test("remote-only book is created once; concurrent and subsequent opens preserve personal edits", async () => {
  const f = fixture();
  allowFirstCreation(f);
  const manager = new f.E(f.app.vault, f.app.metadataCache, f.app);
  const plugin = Object.assign(new f.ir(), {app: f.app, fileManager: manager});
  const book = {bookId: "new-book", title: "新书", author: "作者", remoteExists: true};
  const created = await Promise.all(Array.from({length: 10}, () => plugin.openOrCreateBookNote(book)));
  assert.ok(created.every(file => file === created[0]));
  assert.deepEqual(f.writes, [["create", "books read/笔记/新书.md"]]);
  assert.match(f.files.get(created[0].path), /## 读书笔记/);
  f.files.set(created[0].path, "我后来写的读书总结，不许动");
  await plugin.openOrCreateBookNote(book);
  // Simulate reloading the plugin before metadata indexing catches up.
  plugin.fileManager = new f.E(f.app.vault, f.app.metadataCache, f.app);
  await plugin.openOrCreateBookNote(book);
  assert.equal(f.files.get(created[0].path), "我后来写的读书总结，不许动");
  assert.equal(f.writes.length, 1);
  assert.equal(f.opened.length, 12);
  assert.deepEqual(f.requests, []);
  assert.equal(f.files.get(f.file.path), f.content);
});

test("same-title different-book and unindexed target files are never overwritten", async () => {
  const f = fixture();
  allowFirstCreation(f);
  const manager = new f.E(f.app.vault, f.app.metadataCache, f.app);
  await assert.rejects(() => manager.getOrCreateLinkedNote({bookId: "different-book", title: "学会提问"}), /文件已存在/);
  const path = "books read/笔记/未索引的笔记.md";
  f.files.set(path, "尚未索引的手写内容");
  await assert.rejects(() => manager.getOrCreateLinkedNote({bookId: "not-indexed", title: "未索引的笔记"}), /文件已存在/);
  assert.equal(f.files.get(path), "尚未索引的手写内容");
  assert.equal(f.files.get(f.file.path), f.content);
  assert.deepEqual(f.writes, []);
});

test("a file arriving between lookup and creation is preserved without a write fallback", async () => {
  const f = fixture();
  allowFirstCreation(f);
  const create = f.app.vault.create;
  f.app.vault.create = async (path, content) => {
    f.files.set(path, "另一处刚写入的笔记");
    return create(path, content);
  };
  const manager = new f.E(f.app.vault, f.app.metadataCache, f.app);
  await assert.rejects(() => manager.getOrCreateLinkedNote({bookId: "race", title: "并发笔记"}), /already exists/);
  assert.equal(f.files.get("books read/笔记/并发笔记.md"), "另一处刚写入的笔记");
  assert.deepEqual(f.writes, []);
});

test("missing parent folders are created safely, and invalid paths do not write", async () => {
  const f = fixture();
  allowFirstCreation(f);
  const manager = new f.E(f.app.vault, f.app.metadataCache, f.app);
  f.settings.noteLocation = "新的目录/笔记";
  await Promise.all([
    manager.getOrCreateLinkedNote({bookId: "one", title: "第一本"}),
    manager.getOrCreateLinkedNote({bookId: "two", title: "第二本"}),
  ]);
  assert.equal(f.writes.filter(([operation]) => operation === "createFolder").length, 2);
  assert.equal(f.writes.filter(([operation]) => operation === "create").length, 2);
  f.settings.noteLocation = "../outside";
  await assert.rejects(() => manager.getOrCreateLinkedNote({bookId: "outside", title: "禁止"}), /当前仓库内/);
  assert.equal(f.writes.length, 4);
});

test("the remote-only shelf click creates, opens, then only opens on later clicks", async () => {
  const f = fixture();
  allowFirstCreation(f);
  const manager = new f.E(f.app.vault, f.app.metadataCache, f.app);
  const plugin = Object.assign(new f.ir(), {app: f.app, fileManager: manager});
  const shelf = Object.assign(Object.create(f.Ee.prototype), {
    app: f.app, plugin, localReadingNotes: [], looseReadingNotes: [], renderBooks() {},
  });
  const book = {bookId: "remote", title: "仅远程的新书", remoteExists: true};
  await shelf.openLocalFile(book);
  assert.equal(book.hasLocalFile, true);
  f.files.set(book.localFile.file.path, "点击后补充的感想");
  await shelf.openLocalFile(book);
  assert.equal(f.writes.length, 1);
  assert.equal(f.opened.length, 2);
  assert.equal(f.files.get(book.localFile.file.path), "点击后补充的感想");
});
