(() => {
  "use strict";

  const DB_NAME = "daymark-local-v1";
  const DB_VERSION = 1;
  const STORE = "records";
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const uid = () => {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      try { return window.crypto.randomUUID(); } catch (_) {}
    }
    return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  };

  const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  // Cross-browser safe ISO string parser
  function parseISODate(iso) {
    if (!iso) return null;
    const parts = iso.split(/[-T:]/);
    if (parts.length >= 3) {
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10) - 1;
      const d = parseInt(parts[2], 10);
      const hh = parts[3] ? parseInt(parts[3], 10) : 12;
      const mm = parts[4] ? parseInt(parts[4], 10) : 0;
      return new Date(y, m, d, hh, mm);
    }
    return new Date(iso);
  }

  /* Universal Fallback Storage Driver (IndexedDB -> localStorage -> Memory) */
  const Storage = {
    mode: "idb",
    mem: {},
    async init() {
      try {
        if (!("indexedDB" in window)) throw new Error("IndexedDB not supported");
        await new Promise((resolve, reject) => {
          const req = indexedDB.open(DB_NAME, DB_VERSION);
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" });
          };
          req.onsuccess = () => { req.result.close(); resolve(); };
          req.onerror = () => reject(req.error);
        });
        this.mode = "idb";
      } catch (e) {
        try {
          localStorage.setItem("__test", "1");
          localStorage.removeItem("__test");
          this.mode = "local";
        } catch (_) {
          this.mode = "mem";
        }
      }
    },
    async get(key) {
      if (this.mode === "idb") {
        return new Promise((resolve) => {
          const req = indexedDB.open(DB_NAME, DB_VERSION);
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction(STORE, "readonly");
            const getReq = tx.objectStore(STORE).get(key);
            getReq.onsuccess = () => resolve(getReq.result ? getReq.result.value : null);
            getReq.onerror = () => resolve(null);
          };
          req.onerror = () => resolve(null);
        });
      }
      if (this.mode === "local") {
        try {
          const val = localStorage.getItem(`daymark_${key}`);
          return val ? JSON.parse(val) : null;
        } catch (_) { return null; }
      }
      return this.mem[key] || null;
    },
    async set(key, value) {
      if (this.mode === "idb") {
        return new Promise((resolve, reject) => {
          const req = indexedDB.open(DB_NAME, DB_VERSION);
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction(STORE, "readwrite");
            tx.objectStore(STORE).put({ key, value });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          };
          req.onerror = () => reject(req.error);
        });
      }
      if (this.mode === "local") {
        try {
          localStorage.setItem(`daymark_${key}`, JSON.stringify(value));
          return;
        } catch (e) { throw e; }
      }
      this.mem[key] = value;
    }
  };

  let state = { lists: [], tasks: [] };
  let currentView = "all";
  let currentListId = null;
  let taskFilter = "open";
  let editingTaskId = null;
  let editingListId = null;
  let taskDraftImages = [];
  let listDraftCover = null;
  let toastTimer;

  async function persist() {
    await Storage.set("lists", state.lists);
    await Storage.set("tasks", state.tasks);
  }

  async function load() {
    await Storage.init();
    const [lists, tasks] = await Promise.all([Storage.get("lists"), Storage.get("tasks")]);
    state.lists = Array.isArray(lists) ? lists : [];
    state.tasks = Array.isArray(tasks) ? tasks : [];

    // Ensure at least one default list always exists
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
    return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function listById(id) { return state.lists.find((list) => list.id === id); }
  function taskById(id) { return state.tasks.find((task) => task.id === id); }
  function countForList(id) {
    const tasks = state.tasks.filter((task) => task.listId === id);
    return { all: tasks.length, open: tasks.filter((t) => !t.done).length, done: tasks.filter((t) => t.done).length };
  }

  function dateLabel(iso) {
    if (!iso) return "";
    const date = parseISODate(iso);
    if (!date || isNaN(date.getTime())) return "";
    const timeString = iso.length > 10 ? ` · ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true })}` : "";
    
    if (iso.slice(0, 10) === todayISO()) return `Today${timeString}`;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowISO = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
    if (iso.slice(0, 10) === tomorrowISO) return `Tomorrow${timeString}`;
    
    return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}${timeString}`;
  }

  function dateTimeLabel(timestamp) {
    if (!timestamp) return "recently";
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "recently";
    try {
      return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", hour12: true }).format(date);
    } catch {
      return `${date.toLocaleDateString()} ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true })}`;
    }
  }

  function notify(message) {
    const toast = $("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
  }

  function setActiveNav() {
    $$(".main-nav [data-view]").forEach((btn) => btn.classList.toggle("active", currentView === btn.dataset.view && !currentListId));
    $$("#listNav .list-link").forEach((btn) => btn.classList.toggle("active", btn.dataset.listId === currentListId));
  }

  function getViewInfo() {
    if (currentListId) {
      const list = listById(currentListId);
      if (list) return { title: list.name, eyebrow: "ACTIVE LIST", description: list.description || "A place for what matters.", list };
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
    const search = $("#searchInput")?.value.trim().toLowerCase() || "";
    if (currentListId) tasks = tasks.filter((t) => t.listId === currentListId);
    else if (currentView === "today") tasks = tasks.filter((t) => t.due && t.due.slice(0, 10) === todayISO() && !t.done);
    else if (currentView === "upcoming") tasks = tasks.filter((t) => t.due && t.due.slice(0, 10) > todayISO() && !t.done);
    else if (currentView === "completed") tasks = tasks.filter((t) => t.done);

    if (search) {
      tasks = tasks.filter((t) => {
        const listName = listById(t.listId)?.name || "";
        return `${t.title} ${t.notes || ""} ${listName}`.toLowerCase().includes(search);
      });
    }

    if (taskFilter === "open") tasks = tasks.filter((t) => !t.done);
    else if (taskFilter === "done") tasks = tasks.filter((t) => t.done);

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
    const openTasks = state.tasks.filter((t) => !t.done).length;
    $("#allCount").textContent = openTasks;
    $("#todayCount").textContent = state.tasks.filter((t) => !t.done && t.due && t.due.slice(0, 10) === todayISO()).length;
    $("#listNav").innerHTML = state.lists.map((list) => {
      const count = countForList(list.id);
      return `
        <div class="list-link-wrapper">
          <button class="list-link ${list.id === currentListId ? "active" : ""}" data-list-id="${escapeHTML(list.id)}">
            <span class="list-color" style="background:${escapeHTML(list.color)}"></span>
            <span>${escapeHTML(list.name)}</span>
            <span class="list-link-count">${count.open || ""}</span>
          </button>
          <button class="sidebar-list-delete" type="button" data-delete-list="${escapeHTML(list.id)}" title="Delete ${escapeHTML(list.name)}">×</button>
        </div>`;
    }).join("");
    setActiveNav();
  }

  function renderTask(task) {
    const list = listById(task.listId);
    const due = task.due ? `<span class="due ${task.due < todayISO() && !task.done ? "overdue" : ""}">⏰ ${escapeHTML(dateLabel(task.due))}</span>` : "";
    const listPill = !currentListId && list ? `<span class="list-pill"><i style="background:${escapeHTML(list.color)}"></i>${escapeHTML(list.name)}</span>` : "";
    const notes = task.notes ? `<p class="task-notes">${escapeHTML(task.notes)}</p>` : "";
    const images = task.images?.length ? `<div class="task-images">${task.images.map((img, idx) => `<button type="button" data-image-task="${escapeHTML(task.id)}" data-image-index="${idx}" aria-label="View attachment"><img src="${img.data}" alt="Attachment" loading="lazy"></button>`).join("")}</div>` : "";
    
    return `<article class="task-row ${task.done ? "is-done" : ""}" data-task-row="${escapeHTML(task.id)}">
      <input class="task-check" type="checkbox" aria-label="Mark complete" data-toggle-task="${escapeHTML(task.id)}" ${task.done ? "checked" : ""}>
      <div class="task-body">
        <span class="task-title">${escapeHTML(task.title)}</span>
        ${notes}
        <div class="task-meta">${due}${listPill}<span class="created-at">Added ${escapeHTML(dateTimeLabel(task.createdAt))}</span></div>
        ${images}
      </div>
      <div class="task-actions">
        <button type="button" data-edit-task="${escapeHTML(task.id)}" aria-label="Edit task" title="Edit">✎</button>
        <button type="button" data-delete-task="${escapeHTML(task.id)}" aria-label="Delete task" title="Delete">×</button>
      </div>
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
    }

    const allForCurrent = state.tasks.filter((t) => currentListId ? t.listId === currentListId : currentView === "today" ? t.due && t.due.slice(0, 10) === todayISO() && !t.done : currentView === "upcoming" ? t.due && t.due.slice(0, 10) > todayISO() && !t.done : currentView === "completed" ? t.done : true);
    const doneCount = allForCurrent.filter((t) => t.done).length;
    const openCount = allForCurrent.length - doneCount;
    $("#openCount").textContent = openCount;
    $("#doneCount").textContent = doneCount;
    const percent = allForCurrent.length ? Math.round((doneCount / allForCurrent.length) * 100) : 0;
    $("#progressLabel").textContent = `${percent}% complete`;
    $("#progressBar").style.width = `${percent}%`;

    const tasks = getVisibleTasks();
    $("#taskList").innerHTML = tasks.map(renderTask).join("");
    const empty = tasks.length === 0;
    $("#emptyState").classList.toggle("visible", empty);
    $("#addTaskRow").classList.toggle("hidden", empty && currentView === "completed" && !currentListId);

    if (empty) {
      $("#emptyTitle").textContent = $("#searchInput").value.trim() ? "No matches found" : currentView === "completed" ? "Nothing completed just yet" : "A clear space to begin";
      $("#emptyDescription").textContent = $("#searchInput").value.trim() ? "Try another search term." : currentView === "completed" ? "Finished tasks will appear here." : "Add a task and turn your plans into progress.";
      $("#emptyAddButton").classList.toggle("hidden", currentView === "completed" && !currentListId);
    }

    $("#taskList").classList.toggle("hidden", empty);
    $("#viewTabs").classList.toggle("hidden", currentView === "today" || currentView === "upcoming" || currentView === "completed");
    $$("#viewTabs [data-filter]").forEach((b) => b.classList.toggle("active", b.dataset.filter === taskFilter));
  }

  /* Reliable Cross-Browser Date and Time Handling */
  function setDueFields(isoString = "") {
    const dateInput = $("#dueDateInput");
    const timeInput = $("#dueTimeInput");
    const hiddenDue = $("#taskDue");
    hiddenDue.value = isoString || "";

    if (!isoString) {
      dateInput.value = "";
      timeInput.value = "";
      return;
    }
    dateInput.value = isoString.slice(0, 10);
    timeInput.value = isoString.length > 10 ? isoString.slice(11, 16) : "";
  }

  function getCombinedDueValue() {
    const date = $("#dueDateInput").value;
    const time = $("#dueTimeInput").value;
    if (!date && !time) return "";
    const effectiveDate = date || todayISO();
    return time ? `${effectiveDate}T${time}` : effectiveDate;
  }

  function openTaskDialog(task = null) {
    if (!state.lists.length) {
      state.lists.push({ id: uid(), name: "Inbox", description: "General tasks", color: "#D9E7DA", cover: null, createdAt: Date.now() });
      persist();
    }
    editingTaskId = task?.id || null;
    taskDraftImages = task?.images ? [...task.images] : [];
    $("#taskDialogTitle").textContent = task ? "Edit task" : "New task";
    $("#taskTitle").value = task?.title || "";
    $("#taskNotes").value = task?.notes || "";
    setDueFields(task?.due || "");
    $("#taskImages").value = "";
    $("#taskListSelect").innerHTML = state.lists.map((l) => `<option value="${escapeHTML(l.id)}">${escapeHTML(l.name)}</option>`).join("");
    $("#taskListSelect").value = task?.listId || currentListId || state.lists[0]?.id || "";
    renderTaskDraftImages();
    $("#taskDialog").showModal();
    setTimeout(() => $("#taskTitle").focus(), 50);
  }

  function renderTaskDraftImages() {
    $("#taskAttachmentPreview").innerHTML = taskDraftImages.map((img, idx) => `<div class="preview-tile"><img src="${img.data}" alt="Attachment"><button type="button" data-remove-task-image="${idx}" aria-label="Remove image">×</button></div>`).join("");
  }

  function openListDialog(list = null) {
    editingListId = list?.id || null;
    listDraftCover = list?.cover || null;
    $("#listDialogTitle").textContent = list ? "Edit list" : "Create a list";
    $("#listName").value = list?.name || "";
    $("#listDescription").value = list?.description || "";
    const selectedColor = list?.color || "#D9E7DA";
    const radio = $$('input[name="listColor"]').find((i) => i.value === selectedColor) || $('input[name="listColor"][value="#D9E7DA"]');
    if (radio) radio.checked = true;
    $("#listCover").value = "";
    $("#coverPreview").classList.toggle("hidden", !listDraftCover);
    $("#coverPreview").style.backgroundImage = listDraftCover ? `url("${listDraftCover.data}")` : "";
    $("#coverPicker").classList.toggle("hidden", !!listDraftCover);

    const modalDeleteBtn = $("#modalDeleteListBtn");
    if (modalDeleteBtn) modalDeleteBtn.classList.toggle("hidden", !list);
    
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
          const maxSide = 1400;
          const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve({ data: canvas.toDataURL("image/jpeg", 0.8), name: file.name, type: "image/jpeg" });
        };
        img.onerror = () => reject(new Error("This image could not be opened."));
        img.src = reader.result;
      };
      reader.onerror = () => reject(new Error("Could not read image file."));
      reader.readAsDataURL(file);
    });
  }

  async function handleImages(files, existing, setter) {
    const picked = [...files];
    if (!picked.length) return;
    try {
      const loaded = [];
      for (const f of picked) loaded.push(await readImage(f));
      setter([...existing, ...loaded]);
      notify(`${loaded.length} image(s) added`);
    } catch (e) {
      notify(e.message || "Could not add image.");
    }
  }

  const webReminderTimers = new Map();
  async function scheduleWebReminder(task) {
    const old = webReminderTimers.get(task.id);
    if (old) clearTimeout(old);
    if (!task.due || task.done || !("Notification" in window)) return;
    if (Notification.permission !== "granted") {
      if (Notification.permission === "default") {
        try { await Notification.requestPermission(); } catch (_) {}
      }
      if (Notification.permission !== "granted") return;
    }
    const dueTime = parseISODate(task.due)?.getTime();
    if (!dueTime) return;
    const delay = dueTime - Date.now();
    if (delay <= 0 || delay > 2147480000) return;
    const timer = setTimeout(() => {
      try { new Notification("Daymark reminder", { body: task.title, icon: "./icon-192.png", tag: `daymark-${task.id}` }); } catch (_) {}
    }, delay);
    webReminderTimers.set(task.id, timer);
  }

  async function saveTask(event) {
    event.preventDefault();
    const title = $("#taskTitle").value.trim();
    if (!title) return;
    const now = Date.now();
    const existingTask = editingTaskId ? taskById(editingTaskId) : null;
    const due = getCombinedDueValue();
    const data = {
      id: editingTaskId || uid(),
      title,
      notes: $("#taskNotes").value.trim(),
      listId: $("#taskListSelect").value,
      due,
      images: taskDraftImages,
      done: existingTask ? !!existingTask.done : false,
      createdAt: existingTask?.createdAt || now,
      updatedAt: now
    };

    if (editingTaskId) state.tasks = state.tasks.map((t) => t.id === editingTaskId ? data : t);
    else state.tasks.unshift(data);

    try {
      await persist();
      scheduleWebReminder(data);
      $("#taskDialog").close();
      render();
      notify(editingTaskId ? "Task updated" : "Task added");
    } catch {
      notify("Storage quota exceeded. Please remove some attachments.");
    }
  }

  async function saveList(event) {
    event.preventDefault();
    const name = $("#listName").value.trim();
    if (!name) return;
    const color = $('input[name="listColor"]:checked')?.value || "#D9E7DA";
    if (editingListId) {
      state.lists = state.lists.map((l) => l.id === editingListId ? { ...l, name, description: $("#listDescription").value.trim(), color, cover: listDraftCover } : l);
    } else {
      const list = { id: uid(), name, description: $("#listDescription").value.trim(), color, cover: listDraftCover, createdAt: Date.now() };
      state.lists.push(list);
      currentListId = list.id;
      currentView = "all";
    }
    try {
      await persist();
      $("#listDialog").close();
      render();
      notify(editingListId ? "List updated" : "List created");
    } catch {
      notify("Failed to save list.");
    }
  }

  async function toggleTask(id, done) {
    const task = taskById(id);
    if (!task) return;
    task.done = done;
    task.updatedAt = Date.now();
    await persist();
    const timer = webReminderTimers.get(id);
    if (timer) clearTimeout(timer);
    render();
    if (done) notify("Nicely done ✨");
  }

  async function deleteTask(id) {
    const task = taskById(id);
    if (!task || !confirm(`Delete “${task.title}”?`)) return;
    state.tasks = state.tasks.filter((t) => t.id !== id);
    const timer = webReminderTimers.get(id);
    if (timer) clearTimeout(timer);
    await persist();
    render();
    notify("Task deleted");
  }

  async function deleteListById(id) {
    const list = listById(id);
    if (!list) return;
    const count = countForList(list.id).all;
    const confirmMessage = count > 0
      ? `Delete “${list.name}” and its ${count} task(s)? This cannot be undone.`
      : `Delete “${list.name}”?`;
    if (!confirm(confirmMessage)) return;

    state.lists = state.lists.filter((l) => l.id !== id);
    state.tasks = state.tasks.filter((t) => t.listId !== id);

    // Auto-create a default list if user cleared all
    if (!state.lists.length) {
      state.lists.push({ id: uid(), name: "Personal", description: "Default space", color: "#D9E7DA", cover: null, createdAt: Date.now() });
    }

    if (currentListId === id) {
      currentListId = null;
      currentView = "all";
    }
    await persist();
    render();
    notify("List deleted");
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
      if (parsed.format !== "daymark-backup" || !Array.isArray(parsed.lists) || !Array.isArray(parsed.tasks)) {
        throw new Error("Invalid Daymark backup file.");
      }
      if (!confirm("Import backup? This will replace your current tasks and lists on this device.")) return;
      state.lists = parsed.lists;
      state.tasks = parsed.tasks;
      currentListId = null;
      currentView = "all";
      await persist();
      render();
      notify("Backup imported successfully");
    } catch (e) {
      notify(e.message || "Could not import backup.");
    } finally {
      $("#importFile").value = "";
    }
  }

  function setView(view) {
    currentView = view;
    currentListId = null;
    taskFilter = view === "completed" ? "done" : "open";
    render();
    closeSidebar();
  }
  function closeSidebar() {
    $("#sidebar").classList.remove("open");
    $("#mobileScrim").classList.remove("visible");
  }
  function openSidebar() {
    $("#sidebar").classList.add("open");
    $("#mobileScrim").classList.add("visible");
  }

  function showImage(taskId, index) {
    const image = taskById(taskId)?.images?.[index];
    if (!image) return;
    const viewer = document.createElement("dialog");
    viewer.className = "modal image-viewer";
    viewer.innerHTML = `
      <div class="modal-header">
        <div><div class="eyebrow">ATTACHMENT</div><h2>${escapeHTML(image.name || "Image")}</h2></div>
        <button class="icon-button" aria-label="Close">×</button>
      </div>
      <img src="${image.data}" alt="Task attachment" style="display:block;max-width:100%;max-height:65vh;object-fit:contain;margin:auto;border-radius:10px">
      <div class="modal-footer"><button class="secondary-button">Close</button></div>`;
    document.body.appendChild(viewer);
    const close = () => { viewer.close(); viewer.remove(); };
    viewer.querySelectorAll("button").forEach((btn) => btn.addEventListener("click", close));
    viewer.addEventListener("click", (e) => {
      const rect = viewer.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) close();
    });
    viewer.showModal();
  }

  /* Safe Cross-Browser Modal Outside-Click Handler */
  function setupDialogBackdropClick(dialog) {
    dialog.addEventListener("click", (e) => {
      const rect = dialog.getBoundingClientRect();
      const isInside = (
        rect.top <= e.clientY &&
        e.clientY <= rect.top + rect.height &&
        rect.left <= e.clientX &&
        e.clientX <= rect.left + rect.width
      );
      if (!isInside) dialog.close();
    });
  }

  /* Global Events */
  document.addEventListener("click", async (event) => {
    if (event.target.id === "mobileScrim") { closeSidebar(); return; }
    const sidebarOpen = $("#sidebar").classList.contains("open");
    if (sidebarOpen && !$("#sidebar").contains(event.target) && event.target.id !== "menuButton") {
      closeSidebar();
    }
    const target = event.target.closest("button, label, a");
    if (!target) return;
    if (target.closest(".topbar-brand")) { event.preventDefault(); return; }
    if (target.dataset.close) { $("#" + target.dataset.close)?.close(); return; }
    if (target.dataset.view) { setView(target.dataset.view); return; }
    if (target.dataset.listId) {
      currentListId = target.dataset.listId;
      currentView = "all";
      taskFilter = "open";
      render();
      closeSidebar();
      return;
    }
    if (target.dataset.deleteList) {
      event.stopPropagation();
      await deleteListById(target.dataset.deleteList);
      return;
    }
    if (target.dataset.filter) { taskFilter = target.dataset.filter; render(); return; }
    if (target.dataset.editTask) { openTaskDialog(taskById(target.dataset.editTask)); return; }
    if (target.dataset.deleteTask) { await deleteTask(target.dataset.deleteTask); return; }
    if (target.dataset.removeTaskImage !== undefined) {
      taskDraftImages.splice(Number(target.dataset.removeTaskImage), 1);
      renderTaskDraftImages();
      return;
    }
    if (target.dataset.imageTask) { showImage(target.dataset.imageTask, Number(target.dataset.imageIndex)); return; }
    if (target.id === "newTaskButton" || target.id === "addTaskRow" || target.id === "emptyAddButton") { openTaskDialog(); return; }
    if (target.id === "addListSide") { openListDialog(); return; }
    if (target.id === "editListButton") { const list = listById(currentListId); if (list) openListDialog(list); return; }

    /* Delete Button on top of Notes & inside List Modal */
    if (target.id === "deleteListButton") {
      if (currentListId) await deleteListById(currentListId);
      return;
    }
    if (target.id === "modalDeleteListBtn") {
      if (editingListId) {
        $("#listDialog").close();
        await deleteListById(editingListId);
      }
      return;
    }

    /* Date and Time Quick Chips */
    if (target.id === "quickToday") {
      $("#dueDateInput").value = todayISO();
      return;
    }
    if (target.id === "quickTomorrow") {
      const tmrw = new Date();
      tmrw.setDate(tmrw.getDate() + 1);
      $("#dueDateInput").value = `${tmrw.getFullYear()}-${String(tmrw.getMonth() + 1).padStart(2, "0")}-${String(tmrw.getDate()).padStart(2, "0")}`;
      return;
    }
    if (target.dataset.presetTime) {
      $("#dueTimeInput").value = target.dataset.presetTime;
      if (!$("#dueDateInput").value) $("#dueDateInput").value = todayISO();
      return;
    }
    if (target.id === "clearDueButton") {
      setDueFields("");
      return;
    }

    if (target.id === "backupButton") { exportBackup(); return; }
    if (target.id === "searchButton") { $("#searchRow").classList.remove("hidden"); $("#searchInput").focus(); return; }
    if (target.id === "closeSearch") { $("#searchInput").value = ""; $("#searchRow").classList.add("hidden"); render(); return; }
    if (target.id === "menuButton") { openSidebar(); return; }
    if (target.id === "workspaceButton") { notify("Stored securely and privately in this browser."); return; }
  });

  document.addEventListener("change", async (event) => {
    const checkbox = event.target.closest("[data-toggle-task]");
    if (checkbox) await toggleTask(checkbox.dataset.toggleTask, checkbox.checked);
  });

  $("#taskForm").addEventListener("submit", saveTask);
  $("#listForm").addEventListener("submit", saveList);
  $("#taskImages").addEventListener("change", (e) => handleImages(e.target.files, taskDraftImages, (val) => { taskDraftImages = val; renderTaskDraftImages(); e.target.value = ""; }));
  $("#listCover").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      listDraftCover = await readImage(file);
      $("#coverPreview").style.backgroundImage = `url("${listDraftCover.data}")`;
      $("#coverPreview").classList.remove("hidden");
      $("#coverPicker").classList.add("hidden");
    } catch (err) { notify(err.message); }
    e.target.value = "";
  });
  $("#coverPicker").addEventListener("click", (e) => {
    if (e.target.closest("input, label")) return;
    $("#listCover").click();
  });
  $("#coverPreview").addEventListener("click", () => {
    listDraftCover = null;
    $("#coverPreview").classList.add("hidden");
    $("#coverPicker").classList.remove("hidden");
  });
  $("#importFile").addEventListener("change", (e) => importBackup(e.target.files?.[0]));
  $("#searchInput").addEventListener("input", render);

  setupDialogBackdropClick($("#taskDialog"));
  setupDialogBackdropClick($("#listDialog"));

  document.addEventListener("keydown", (event) => {
    const tag = document.activeElement?.tagName;
    const isTyping = ["INPUT", "TEXTAREA", "SELECT"].includes(tag) || document.activeElement?.isContentEditable;
    if (!isTyping && event.key.toLowerCase() === "n" && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      openTaskDialog();
    }
    if (event.key === "Escape") closeSidebar();
  });

  load().then(() => {
    render();
    state.tasks.forEach(scheduleWebReminder);
  });
})();