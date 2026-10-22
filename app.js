(() => {
  "use strict";
  const DB_NAME = "daymark-local-v1";
  const DB_VERSION = 1;
  const STORE = "records";
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  let db;
  let state = { lists: [], tasks: [] };
  let currentView = "all";
  let currentListId = null;
  let taskFilter = "open";
  let editingTaskId = null;
  let editingListId = null;
  let taskDraftImages = [];
  let listDraftCover = null;
  let toastTimer;

  function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE, { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  function readRecord(key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror = () => reject(req.error);
    });
  }
  function writeRecord(key, value) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ key, value });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Storage transaction aborted"));
    });
  }
  async function persist() {
    await writeRecord("lists", state.lists);
    await writeRecord("tasks", state.tasks);
  }
  async function load() {
    db = await openDB();
    const [lists, tasks] = await Promise.all([readRecord("lists"), readRecord("tasks")]);
    state.lists = Array.isArray(lists) ? lists : [];
    state.tasks = Array.isArray(tasks) ? tasks : [];
    if (!state.lists.length) {
      state.lists = [
        { id: uid(), name: "Personal", description: "Little things that make life better.", color: "#D9E7DA", cover: null, createdAt: Date.now() },
        { id: uid(), name: "Learning", description: "Stay curious. Keep growing.", color: "#DCE7F8", cover: null, createdAt: Date.now() },
        { id: uid(), name: "Projects", description: "Ideas in motion.", color: "#F5DFD5", cover: null, createdAt: Date.now() }
      ];
      await persist();
    }
  }
  function escapeHTML(value = "") {
    return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  }
  function listById(id) { return state.lists.find((list) => list.id === id); }
  function taskById(id) { return state.tasks.find((task) => task.id === id); }
  function countForList(id) {
    const tasks = state.tasks.filter((task) => task.listId === id);
    return { all: tasks.length, open: tasks.filter((task) => !task.done).length, done: tasks.filter((task) => task.done).length };
  }
  function dateLabel(iso) {
    if (!iso) return "";
    const date = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
    if (iso.slice(0, 10) === todayISO()) return `Today${iso.length > 10 ? ` · ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}`;
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowISO = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
    if (iso.slice(0, 10) === tomorrowISO) return `Tomorrow${iso.length > 10 ? ` · ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}`;
    return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}${iso.length > 10 ? ` · ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}`;
  }
  function notify(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2300);
  }
  function setActiveNav() {
    $$(".main-nav [data-view]").forEach((button) => button.classList.toggle("active", currentView === button.dataset.view && !currentListId));
    $$("#listNav .list-link").forEach((button) => button.classList.toggle("active", button.dataset.listId === currentListId));
  }
  function getViewInfo() {
    if (currentListId) {
      const list = listById(currentListId);
      if (list) return { title: list.name, eyebrow: "YOUR COLLECTION", description: list.description || "A place for what matters.", list };
      currentListId = null;
    }
    const info = {
      all: ["All tasks", "YOUR PERSONAL SPACE", "A little progress, every day."],
      today: ["Today", "ONE DAY AT A TIME", "Focus on what matters right now."],
      upcoming: ["Upcoming", "LOOKING AHEAD", "A little preparation goes a long way."],
      completed: ["Completed", "LOOK HOW FAR YOU'VE COME", "Every finished task is progress."]
    }[currentView] || ["All tasks", "YOUR PERSONAL SPACE", "A little progress, every day."];
    return { title: info[0], eyebrow: info[1], description: info[2], list: null };
  }
  function getVisibleTasks() {
    let tasks = [...state.tasks];
    const search = $("#searchInput").value.trim().toLowerCase();
    if (currentListId) tasks = tasks.filter((task) => task.listId === currentListId);
    else if (currentView === "today") tasks = tasks.filter((task) => task.due && task.due.slice(0, 10) === todayISO() && !task.done);
    else if (currentView === "upcoming") tasks = tasks.filter((task) => task.due && task.due.slice(0, 10) > todayISO() && !task.done);
    else if (currentView === "completed") tasks = tasks.filter((task) => task.done);
    if (search) tasks = tasks.filter((task) => {
      const listName = listById(task.listId)?.name || "";
      return `${task.title} ${task.notes || ""} ${listName}`.toLowerCase().includes(search);
    });
    if (taskFilter === "open") tasks = tasks.filter((task) => !task.done);
    else if (taskFilter === "done") tasks = tasks.filter((task) => task.done);
    tasks.sort((a, b) => {
      if (a.done !== b.done) return Number(a.done) - Number(b.done);
      if (a.due && b.due) return a.due.localeCompare(b.due) || a.createdAt - b.createdAt;
      if (a.due) return -1;
      if (b.due) return 1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    return tasks;
  }
  function renderSidebar() {
    const openTasks = state.tasks.filter((task) => !task.done).length;
    $("#allCount").textContent = openTasks;
    $("#todayCount").textContent = state.tasks.filter((task) => !task.done && task.due && task.due.slice(0, 10) === todayISO()).length;
    $("#listNav").innerHTML = state.lists.map((list) => {
      const count = countForList(list.id);
      return `<button class="list-link ${list.id === currentListId ? "active" : ""}" data-list-id="${escapeHTML(list.id)}"><span class="list-color" style="background:${escapeHTML(list.color)}"></span><span>${escapeHTML(list.name)}</span><span class="list-link-count">${count.open || ""}</span></button>`;
    }).join("");
    setActiveNav();
  }
  function renderTask(task) {
    const list = listById(task.listId);
    const due = task.due ? `<span class="due ${task.due < todayISO() && !task.done ? "overdue" : ""}">◷ ${escapeHTML(dateLabel(task.due))}</span>` : "";
    const listPill = !currentListId && list ? `<span class="list-pill"><i style="background:${escapeHTML(list.color)}"></i>${escapeHTML(list.name)}</span>` : "";
    const notes = task.notes ? `<p class="task-notes">${escapeHTML(task.notes)}</p>` : "";
    const images = task.images?.length ? `<div class="task-images">${task.images.map((image, index) => `<button type="button" data-image-task="${escapeHTML(task.id)}" data-image-index="${index}" aria-label="View attachment ${index + 1}"><img src="${image.data}" alt="${escapeHTML(image.name || "Task attachment")}" loading="lazy"></button>`).join("")}</div>` : "";
    return `<article class="task-row ${task.done ? "is-done" : ""}" data-task-row="${escapeHTML(task.id)}">
      <input class="task-check" type="checkbox" aria-label="Mark ${escapeHTML(task.title)} complete" data-toggle-task="${escapeHTML(task.id)}" ${task.done ? "checked" : ""}>
      <div class="task-body"><span class="task-title">${escapeHTML(task.title)}</span>${notes}<div class="task-meta">${due}${listPill}</div>${images}</div>
      <div class="task-actions"><button type="button" data-edit-task="${escapeHTML(task.id)}" aria-label="Edit task" title="Edit">✎</button><button type="button" data-delete-task="${escapeHTML(task.id)}" aria-label="Delete task" title="Delete">×</button></div>
    </article>`;
  }
  function render() {
    renderSidebar();
    const info = getViewInfo();
    $("#breadcrumbCurrent").textContent = info.title;
    $("#pageTitle").innerHTML = `${escapeHTML(info.title)}<span class="heading-period">.</span>`;
    $("#pageEyebrow").textContent = info.eyebrow;
    $("#pageDescription").textContent = info.description;
    const hero = $("#listHero");
    hero.classList.toggle("hidden", !info.list);
    if (info.list) {
      $("#heroTitle").textContent = info.list.name;
      $("#heroSubtitle").textContent = info.list.description || "A place for what matters.";
      $("#heroIcon").textContent = info.list.name.slice(0, 1).toUpperCase();
      $("#heroImage").style.backgroundImage = info.list.cover ? `url("${info.list.cover.data}")` : `linear-gradient(120deg, ${info.list.color}, #f3f3ed)`;
      $("#heroShade").style.backgroundImage = "none";
    }
    const allForCurrent = state.tasks.filter((task) => currentListId ? task.listId === currentListId : currentView === "today" ? task.due && task.due.slice(0, 10) === todayISO() && !task.done : currentView === "upcoming" ? task.due && task.due.slice(0, 10) > todayISO() && !task.done : currentView === "completed" ? task.done : true);
    const doneCount = allForCurrent.filter((task) => task.done).length;
    const openCount = allForCurrent.length - doneCount;
    $("#openCount").textContent = openCount;
    $("#doneCount").textContent = doneCount;
    const percent = allForCurrent.length ? Math.round(doneCount / allForCurrent.length * 100) : 0;
    $("#progressLabel").textContent = `${percent}% complete`;
    $("#progressBar").style.width = `${percent}%`;
    const tasks = getVisibleTasks();
    $("#taskList").innerHTML = tasks.map(renderTask).join("");
    const empty = tasks.length === 0;
    $("#emptyState").classList.toggle("visible", empty);
    $("#addTaskRow").classList.toggle("hidden", empty && currentView === "completed" && !currentListId);
    if (empty) {
      $("#emptyTitle").textContent = $("#searchInput").value.trim() ? "No matches found" : currentView === "completed" ? "Nothing completed just yet" : "A clear space to begin";
      $("#emptyDescription").textContent = $("#searchInput").value.trim() ? "Try another search term." : currentView === "completed" ? "Finished tasks will find their home here." : "Add a task and turn your plans into progress.";
      $("#emptyAddButton").classList.toggle("hidden", currentView === "completed" && !currentListId);
    }
    $("#taskList").classList.toggle("hidden", empty);
    $("#viewTabs").classList.toggle("hidden", currentView === "today" || currentView === "upcoming" || currentView === "completed");
    $$("#viewTabs [data-filter]").forEach((button) => button.classList.toggle("active", button.dataset.filter === taskFilter));
  }
  function openTaskDialog(task = null) {
    editingTaskId = task?.id || null;
    taskDraftImages = task?.images ? [...task.images] : [];
    $("#taskDialogTitle").textContent = task ? "Edit task" : "New task";
    $("#taskTitle").value = task?.title || "";
    $("#taskNotes").value = task?.notes || "";
    $("#taskDue").value = task?.due || "";
    $("#taskImages").value = "";
    $("#taskListSelect").innerHTML = state.lists.map((list) => `<option value="${escapeHTML(list.id)}">${escapeHTML(list.name)}</option>`).join("");
    $("#taskListSelect").value = task?.listId || currentListId || state.lists[0]?.id || "";
    renderTaskDraftImages();
    $("#taskDialog").showModal();
    setTimeout(() => $("#taskTitle").focus(), 50);
  }
  function renderTaskDraftImages() {
    $("#taskAttachmentPreview").innerHTML = taskDraftImages.map((image, index) => `<div class="preview-tile"><img src="${image.data}" alt="${escapeHTML(image.name || "Attachment")}"><button type="button" data-remove-task-image="${index}" aria-label="Remove image">×</button></div>`).join("");
  }
  function openListDialog(list = null) {
    editingListId = list?.id || null;
    listDraftCover = list?.cover || null;
    $("#listDialogTitle").textContent = list ? "Edit list" : "Create a list";
    $("#listName").value = list?.name || "";
    $("#listDescription").value = list?.description || "";
    const radio = $(`input[name="listColor"][value="${CSS.escape(list?.color || "#D9E7DA")}"]`) || $('input[name="listColor"][value="#D9E7DA"]');
    radio.checked = true;
    $("#listCover").value = "";
    $("#coverPreview").classList.toggle("hidden", !listDraftCover);
    $("#coverPreview").style.backgroundImage = listDraftCover ? `url("${listDraftCover.data}")` : "";
    $("#coverPicker").classList.toggle("hidden", !!listDraftCover);
    $("#listDialog").showModal();
    setTimeout(() => $("#listName").focus(), 50);
  }
  function readImage(file) {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith("image/")) return reject(new Error("Please choose an image file."));
      if (file.size > MAX_IMAGE_BYTES) return reject(new Error("Each image must be 5 MB or smaller."));
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const maxSide = 1500;
          const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          const context = canvas.getContext("2d");
          context.drawImage(img, 0, 0, canvas.width, canvas.height);
          const data = canvas.toDataURL("image/jpeg", .82);
          resolve({ data, name: file.name, type: "image/jpeg" });
        };
        img.onerror = () => reject(new Error("This image could not be opened."));
        img.src = reader.result;
      };
      reader.onerror = () => reject(new Error("Could not read this image."));
      reader.readAsDataURL(file);
    });
  }
  async function handleImages(files, existing, setter) {
    const picked = [...files];
    if (!picked.length) return;
    try {
      const loaded = [];
      for (const file of picked) loaded.push(await readImage(file));
      setter([...existing, ...loaded]);
      notify(`${loaded.length} image${loaded.length === 1 ? "" : "s"} added`);
    } catch (error) { notify(error.message || "Could not add image."); }
  }
  const webReminderTimers = new Map();
  async function scheduleWebReminder(task) {
    const old = webReminderTimers.get(task.id); if (old) clearTimeout(old);
    if (!task.due || task.done || !("Notification" in window)) return;
    if (Notification.permission !== "granted") {
      if (Notification.permission === "default") { try { await Notification.requestPermission(); } catch {} }
      if (Notification.permission !== "granted") return;
    }
    const delay = new Date(task.due).getTime() - Date.now();
    if (delay <= 0 || delay > 2147480000) return;
    const timer = setTimeout(() => { try { new Notification("Daymark reminder", { body: task.title, icon: "./icon-192.png", tag: `daymark-${task.id}` }); } catch {} }, delay);
    webReminderTimers.set(task.id, timer);
  }
  async function saveTask(event) {
    event.preventDefault();
    const title = $("#taskTitle").value.trim();
    if (!title) return;
    const data = { id: editingTaskId || uid(), title, notes: $("#taskNotes").value.trim(), listId: $("#taskListSelect").value, due: $("#taskDue").value, images: taskDraftImages, done: editingTaskId ? !!taskById(editingTaskId)?.done : false, createdAt: editingTaskId ? taskById(editingTaskId)?.createdAt || Date.now() : Date.now(), updatedAt: Date.now() };
    if (!data.listId) return notify("Create a list first.");
    if (editingTaskId) state.tasks = state.tasks.map((task) => task.id === editingTaskId ? data : task);
    else state.tasks.unshift(data);
    try { await persist();
      if (window.DaymarkNotifications) await window.DaymarkNotifications.schedule(data);
      else scheduleWebReminder(data);
      $("#taskDialog").close(); render(); notify(editingTaskId ? "Task updated" : "Task added"); }
    catch { notify("Storage is full. Export a backup and remove some large images."); }
  }
  async function saveList(event) {
    event.preventDefault();
    const name = $("#listName").value.trim();
    if (!name) return;
    const color = $('input[name="listColor"]:checked')?.value || "#D9E7DA";
    if (editingListId) {
      state.lists = state.lists.map((list) => list.id === editingListId ? { ...list, name, description: $("#listDescription").value.trim(), color, cover: listDraftCover } : list);
    } else {
      const list = { id: uid(), name, description: $("#listDescription").value.trim(), color, cover: listDraftCover, createdAt: Date.now() };
      state.lists.push(list);
      currentListId = list.id;
      currentView = "all";
    }
    try { await persist(); $("#listDialog").close(); render(); notify(editingListId ? "List updated" : "List created"); }
    catch { notify("Storage is full. Export a backup and remove some large images."); }
  }
  async function toggleTask(id, done) {
    const task = taskById(id);
    if (!task) return;
    task.done = done;
    task.updatedAt = Date.now();
    await persist();
    if (window.DaymarkNotifications) await window.DaymarkNotifications.cancel(id);
    const timer = webReminderTimers.get(id); if (timer) clearTimeout(timer);
    render();
    if (done) notify("Nicely done ✨");
  }
  async function deleteTask(id) {
    const task = taskById(id);
    if (!task || !confirm(`Delete “${task.title}”?`)) return;
    state.tasks = state.tasks.filter((item) => item.id !== id);
    if (window.DaymarkNotifications) await window.DaymarkNotifications.cancel(id);
    const timer = webReminderTimers.get(id); if (timer) clearTimeout(timer);
    await persist(); render(); notify("Task deleted");
  }
  async function deleteCurrentList() {
    const list = listById(currentListId);
    if (!list) return;
    const count = countForList(list.id).all;
    if (!confirm(`Delete “${list.name}” and its ${count} task(s)? This cannot be undone unless you have a backup.`)) return;
    state.lists = state.lists.filter((item) => item.id !== list.id);
    state.tasks = state.tasks.filter((task) => task.listId !== list.id);
    currentListId = null;
    currentView = "all";
    await persist(); render(); notify("List deleted");
  }
  function exportBackup() {
    const payload = { format: "daymark-backup", version: 1, exportedAt: new Date().toISOString(), ...state };
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `daymark-backup-${todayISO()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    notify("Backup exported");
  }
  async function importBackup(file) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (parsed.format !== "daymark-backup" || !Array.isArray(parsed.lists) || !Array.isArray(parsed.tasks)) throw new Error("This doesn't look like a Daymark backup.");
      if (!confirm("Import this backup and replace the lists and tasks currently saved on this device? Export your current data first if you need it.")) return;
      state.lists = parsed.lists;
      state.tasks = parsed.tasks;
      currentListId = null; currentView = "all";
      await persist(); render(); notify("Backup imported");
    } catch (error) { notify(error.message || "Could not import backup."); }
    finally { $("#importFile").value = ""; }
  }
  function setView(view) {
    currentView = view; currentListId = null; taskFilter = view === "completed" ? "done" : "open";
    render(); closeSidebar();
  }
  function closeSidebar() { $("#sidebar").classList.remove("open"); $("#mobileScrim").classList.remove("visible"); }
  function openSidebar() { $("#sidebar").classList.add("open"); $("#mobileScrim").classList.add("visible"); }
  function showImage(taskId, index) {
    const image = taskById(taskId)?.images?.[index];
    if (!image) return;
    const viewer = document.createElement("dialog");
    viewer.className = "modal image-viewer";
    viewer.innerHTML = `<div class="modal-header"><div><div class="eyebrow">ATTACHMENT</div><h2>${escapeHTML(image.name || "Image")}</h2></div><button class="icon-button" aria-label="Close">×</button></div><img src="${image.data}" alt="${escapeHTML(image.name || "Task attachment")}" style="display:block;max-width:100%;max-height:65vh;object-fit:contain;margin:auto;border-radius:10px"><div class="modal-footer"><button class="secondary-button">Close</button></div>`;
    document.body.appendChild(viewer);
    const close = () => { viewer.close(); viewer.remove(); };
    viewer.querySelectorAll("button").forEach((button) => button.addEventListener("click", close));
    viewer.addEventListener("click", (event) => { if (event.target === viewer) close(); });
    viewer.showModal();
  }

  document.addEventListener("click", async (event) => {
    // Close sidebar when tapping the dimmed overlay or empty main area (mobile)
    if (event.target.id === "mobileScrim") {
      closeSidebar();
      return;
    }
    const sidebarOpen = $("#sidebar").classList.contains("open");
    if (sidebarOpen && !$("#sidebar").contains(event.target) && event.target.id !== "menuButton") {
      closeSidebar();
    }
    const target = event.target.closest("button, label, a");
    if (!target) return;
    if (target.closest(".topbar-brand")) { event.preventDefault(); return; }
    if (target.dataset.close) { $("#" + target.dataset.close).close(); return; }
    if (target.dataset.view) { setView(target.dataset.view); return; }
    if (target.dataset.listId) { currentListId = target.dataset.listId; currentView = "all"; taskFilter = "open"; render(); closeSidebar(); return; }
    if (target.dataset.filter) { taskFilter = target.dataset.filter; render(); return; }
    if (target.dataset.editTask) { openTaskDialog(taskById(target.dataset.editTask)); return; }
    if (target.dataset.deleteTask) { await deleteTask(target.dataset.deleteTask); return; }
    if (target.dataset.removeTaskImage !== undefined) { taskDraftImages.splice(Number(target.dataset.removeTaskImage), 1); renderTaskDraftImages(); return; }
    if (target.dataset.imageTask) { showImage(target.dataset.imageTask, Number(target.dataset.imageIndex)); return; }
    if (target.id === "newTaskButton" || target.id === "addTaskRow" || target.id === "emptyAddButton") { openTaskDialog(); return; }
    if (target.id === "addListSide") { openListDialog(); return; }
    if (target.id === "editListButton") { const list = listById(currentListId); if (list) openListDialog(list); return; }
    if (target.id === "backupButton") { exportBackup(); return; }
    if (target.id === "searchButton") { $("#searchRow").classList.remove("hidden"); $("#searchInput").focus(); return; }
    if (target.id === "closeSearch") { $("#searchInput").value = ""; $("#searchRow").classList.add("hidden"); render(); return; }
    if (target.id === "menuButton") { openSidebar(); return; }
    if (target.id === "workspaceButton") { notify("Your lists are saved privately in this browser."); return; }
  });
  document.addEventListener("change", async (event) => {
    const checkbox = event.target.closest("[data-toggle-task]");
    if (checkbox) await toggleTask(checkbox.dataset.toggleTask, checkbox.checked);
  });
  $("#taskForm").addEventListener("submit", saveTask);
  $("#listForm").addEventListener("submit", saveList);
  $("#taskImages").addEventListener("change", (event) => handleImages(event.target.files, taskDraftImages, (value) => { taskDraftImages = value; renderTaskDraftImages(); event.target.value = ""; }));
  $("#listCover").addEventListener("change", async (event) => {
    const file = event.target.files?.[0]; if (!file) return;
    try { listDraftCover = await readImage(file); $("#coverPreview").style.backgroundImage = `url("${listDraftCover.data}")`; $("#coverPreview").classList.remove("hidden"); $("#coverPicker").classList.add("hidden"); }
    catch (error) { notify(error.message); }
    event.target.value = "";
  });
  $("#coverPicker").addEventListener("click", (event) => { if (event.target.closest("input, label")) return; $("#listCover").click(); });
  $("#coverPreview").addEventListener("click", () => { listDraftCover = null; $("#coverPreview").classList.add("hidden"); $("#coverPicker").classList.remove("hidden"); });
  $("#importFile").addEventListener("change", (event) => importBackup(event.target.files?.[0]));
  $("#searchInput").addEventListener("input", render);
  $("#taskDialog").addEventListener("click", (event) => { if (event.target === $("#taskDialog")) $("#taskDialog").close(); });
  $("#listDialog").addEventListener("click", (event) => { if (event.target === $("#listDialog")) $("#listDialog").close(); });
  document.addEventListener("keydown", (event) => {
    const tag = document.activeElement?.tagName;
    const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(tag) || document.activeElement?.isContentEditable;
    if (!typing && event.key.toLowerCase() === "n" && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); openTaskDialog(); }
    if (event.key === "Escape") closeSidebar();
  });

  window.addEventListener("daymark-native-ready", () => { if (db) window.DaymarkNotifications.sync(state.tasks); });
  load().then(async () => { render();
    if (window.DaymarkNotifications) await window.DaymarkNotifications.sync(state.tasks);
    else state.tasks.forEach(scheduleWebReminder);
  }).catch((error) => {
    console.error(error);
    $("#pageTitle").textContent = "Storage unavailable";
    $("#pageDescription").textContent = "Please open this site in a modern browser with local storage enabled.";
    notify("Could not open local storage. Try hosting on Cloudflare Pages or use localhost.");
  });
})();
