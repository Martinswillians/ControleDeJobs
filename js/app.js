// ═══════════════════════════════════════════════
// app.js — Controle de Job
// ═══════════════════════════════════════════════

import { auth, db } from "./firebase-config.js";
import { uploadPDF } from "./cloudinary.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc,
  getDocs, getDoc, query, where, orderBy, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import {
  subscribeClients, unsubscribeClients, initClientsEvents,
  updateClientSelects, openClientModal, allClients, getClientData
} from "./clients.js";

import {
  checkAccess, showAccessBlocked, hideAccessBlocked,
  showDemoBanner, initAdminPanel, initAdminActions, ADMIN_UID
} from "./access.js";

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────
let currentUser = null;
let allJobs = [];
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
let editingJobId = null;
let deletingJobId = null;
let nfTargetJobId = null;
let charts = {};
let unsubscribeJobs = null;

const MEI_LIMIT = 81000;
const MONTHS_PT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho",
                   "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

// ─────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────
const $ = id => document.getElementById(id);
const fmt = v => `R$ ${Number(v).toLocaleString("pt-BR", {minimumFractionDigits:2})}`;
const fmtDate = d => d ? d.split("-").reverse().join("/") : "-";
const today = () => new Date().toISOString().split("T")[0];

function showToast(msg, type = "success", ms = 3000) {
  const t = $("toast");
  t.textContent = msg;
  t.className = `toast ${type}`;
  t.classList.remove("hidden");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add("hidden"), ms);
}

function loading(show) {
  $("loadingOverlay").classList.toggle("hidden", !show);
}

function statusLabel(s) {
  const map = {
    pendente: "🟡 Pendente",
    pago: "🟢 Pago",
    pago_nf: "🔵 Pago + NF",
    pago_nf_pdf: "🟣 Pago + NF + PDF"
  };
  return map[s] || s;
}

function statusBadge(s) {
  return `<span class="badge badge-${s}">${statusLabel(s)}</span>`;
}

// ─────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────
$("loginBtn").addEventListener("click", async () => {
  const email = $("loginEmail").value.trim();
  const pass = $("loginPassword").value;
  if (!email || !pass) return showMsg("Preencha e-mail e senha.", "error");
  loading(true);
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (e) {
    showMsg(authError(e.code), "error");
  } finally { loading(false); }
});

$("registerBtn").addEventListener("click", async () => {
  const name = $("regName").value.trim();
  const email = $("regEmail").value.trim();
  const pass = $("regPassword").value;
  const prof = $("regProfession").value;
  if (!name || !email || !pass || !prof) return showMsg("Preencha todos os campos.", "error");
  if (pass.length < 6) return showMsg("Senha deve ter pelo menos 6 caracteres.", "error");
  loading(true);
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await setDoc(doc(db, "users", cred.user.uid), { name, email, profession: prof, cnpj: "", createdAt: new Date() });
    showMsg("Conta criada! Entrando...", "success");
  } catch (e) {
    showMsg(authError(e.code), "error");
  } finally { loading(false); }
});

$("forgotPassword").addEventListener("click", async e => {
  e.preventDefault();
  const email = $("loginEmail").value.trim();
  if (!email) return showMsg("Digite seu e-mail acima primeiro.", "error");
  try {
    await sendPasswordResetEmail(auth, email);
    showMsg("E-mail de recuperação enviado!", "success");
  } catch (e) { showMsg("Erro ao enviar e-mail.", "error"); }
});

function authError(code) {
  const map = {
    "auth/user-not-found": "Usuário não encontrado.",
    "auth/wrong-password": "Senha incorreta.",
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/email-already-in-use": "Este e-mail já está cadastrado.",
    "auth/weak-password": "Senha muito fraca.",
    "auth/invalid-email": "E-mail inválido.",
    "auth/too-many-requests": "Muitas tentativas. Tente mais tarde.",
  };
  return map[code] || "Erro de autenticação. Tente novamente.";
}

function showMsg(msg, type) {
  const el = $("authMsg");
  el.textContent = msg;
  el.className = `auth-msg ${type}`;
}

// Auth tabs
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".auth-form").forEach(f => f.classList.remove("active"));
    btn.classList.add("active");
    $(`${btn.dataset.tab}Form`).classList.add("active");
    $("authMsg").className = "auth-msg";
  });
});

// Logout
[$("logoutBtn"), $("logoutBtnSettings")].forEach(btn => {
  btn?.addEventListener("click", async () => {
    try {
      if (unsubscribeJobs) { unsubscribeJobs(); unsubscribeJobs = null; }
      allJobs = [];
      await signOut(auth);
    } catch(e) { console.error("Logout error:", e); }
  });
});

// ─────────────────────────────────────────────
// AUTH STATE
// ─────────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  if (user) {
    currentUser = user;
    window._currentUid = user.uid;

    // Check access
    const access = await checkAccess(user.uid);
    if (!access.allowed) {
      await signOut(auth);
      showAccessBlocked(access.reason, () => location.reload());
      return;
    }

    // Switch screens
    $("authScreen").style.display = "none";
    $("authScreen").classList.remove("active");
    $("appScreen").style.display = "grid";
    $("appScreen").classList.add("active");
    hideAccessBlocked();

    // Demo banner
    if (access.reason === "demo" && access.daysLeft != null) {
      showDemoBanner(access.daysLeft);
      document.body.classList.add("has-demo-banner");
    }

    await loadUserProfile();
    if (!unsubscribeJobs) subscribeJobs();

    // Clients
    subscribeClients(user.uid, () => {});
    initClientsEvents(user.uid, showToast, loading);

    // Admin
    window._navigateTo = navigateTo;
    initAdminPanel(user.uid);
    initAdminActions();

    navigateTo("dashboard");
  } else {
    currentUser = null;
    window._currentUid = null;
    allJobs = [];
    $("appScreen").style.display = "none";
    $("appScreen").classList.remove("active");
    $("authScreen").style.display = "flex";
    $("authScreen").classList.add("active");
    if (unsubscribeJobs) { unsubscribeJobs(); unsubscribeJobs = null; }
    unsubscribeClients();
  }
});

// ─────────────────────────────────────────────
// USER PROFILE
// ─────────────────────────────────────────────
async function loadUserProfile() {
  try {
    const snap = await getDoc(doc(db, "users", currentUser.uid));
    if (snap.exists()) {
      const d = snap.data();
      $("userNameDisplay").textContent = d.name?.split(" ")[0] || "";
      $("sidebarName").textContent = d.name || "";
      $("sidebarRole").textContent = d.profession || "";
      $("settingName").value = d.name || "";
      $("settingProfession").value = d.profession || "";
      $("settingCNPJ").value = d.cnpj || "";
    }
  } catch (e) { console.error(e); }
}

$("saveSettings").addEventListener("click", async () => {
  const name = $("settingName").value.trim();
  const profession = $("settingProfession").value;
  const cnpj = $("settingCNPJ").value.trim();
  try {
    await setDoc(doc(db, "users", currentUser.uid), { name, profession, cnpj }, { merge: true });
    $("userNameDisplay").textContent = name.split(" ")[0];
    $("sidebarName").textContent = name;
    $("sidebarRole").textContent = profession;
    showToast("Configurações salvas!");
  } catch (e) { showToast("Erro ao salvar.", "error"); }
});

// ─────────────────────────────────────────────
// NAVIGATION
// ─────────────────────────────────────────────
function navigateTo(page) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
  $(`page-${page}`)?.classList.add("active");
  document.querySelector(`[data-page="${page}"]`)?.classList.add("active");
  closeSidebar();

  if (page === "dashboard") renderDashboard();
  else if (page === "jobs") renderJobsPage();
  else if (page === "nf") renderNFPage();
  else if (page === "reports") renderReports();
  else if (page === "mei") renderMEI();
  else if (page === "clients") {} // rendered by clients.js listener
  else if (page === "admin") {} // rendered by access.js
}

document.querySelectorAll(".nav-link").forEach(link => {
  link.addEventListener("click", e => { e.preventDefault(); navigateTo(link.dataset.page); });
});

// Sidebar mobile
$("menuToggle").addEventListener("click", () => {
  $("sidebar").classList.toggle("open");
  $("sidebarOverlay").classList.toggle("active");
});
$("sidebarOverlay").addEventListener("click", closeSidebar);
function closeSidebar() {
  $("sidebar").classList.remove("open");
  $("sidebarOverlay").classList.remove("active");
}

// ─────────────────────────────────────────────
// MONTH NAV
// ─────────────────────────────────────────────
function updateMonthLabel() {
  $("currentMonthLabel").textContent = `${MONTHS_PT[currentMonth]} ${currentYear}`;
}
$("prevMonth").addEventListener("click", () => {
  currentMonth--;
  if (currentMonth < 0) { currentMonth = 11; currentYear--; }
  updateMonthLabel();
  renderDashboard();
});
$("nextMonth").addEventListener("click", () => {
  currentMonth++;
  if (currentMonth > 11) { currentMonth = 0; currentYear++; }
  updateMonthLabel();
  renderDashboard();
});
updateMonthLabel();

// ─────────────────────────────────────────────
// FIRESTORE — JOBS
// ─────────────────────────────────────────────
function subscribeJobs() {
  const q = query(
    collection(db, "users", currentUser.uid, "jobs"),
    orderBy("date", "desc")
  );
  unsubscribeJobs = onSnapshot(q, snap => {
    allJobs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    refreshAllViews();
  }, err => console.error("Firestore error:", err));
}

function refreshAllViews() {
  const activePage = document.querySelector(".page.active")?.id?.replace("page-", "");
  if (activePage === "dashboard") renderDashboard();
  else if (activePage === "jobs") renderJobsPage();
  else if (activePage === "nf") renderNFPage();
  else if (activePage === "reports") renderReports();
  else if (activePage === "mei") renderMEI();
  updateMEIAlert();
  populateClientSuggestions();
  populateFilterClients();
}

// ─────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────
function renderDashboard() {
  updateMonthLabel();
  const monthJobs = allJobs.filter(j => {
    if (!j.date) return false;
    const [y, m] = j.date.split("-");
    return parseInt(m) - 1 === currentMonth && parseInt(y) === currentYear;
  });

  const yearJobs = allJobs.filter(j => j.date?.startsWith(String(currentYear)));

  const recebido = monthJobs.filter(j => j.status !== "pendente").reduce((a, j) => a + Number(j.value || 0), 0);
  const pendente = monthJobs.filter(j => j.status === "pendente").reduce((a, j) => a + Number(j.value || 0), 0);
  const total = monthJobs.reduce((a, j) => a + Number(j.value || 0), 0);
  const anoTotal = yearJobs.reduce((a, j) => a + Number(j.value || 0), 0);
  const anoNF = yearJobs.filter(j => j.status === "pago_nf" || j.status === "pago_nf_pdf")
                         .reduce((a, j) => a + Number(j.value || 0), 0);
  const ticket = monthJobs.length ? total / monthJobs.length : 0;

  $("cardRecebido").textContent = fmt(recebido);
  $("cardPendente").textContent = fmt(pendente);
  $("cardTotal").textContent = fmt(total);
  $("cardAno").textContent = fmt(anoTotal);
  $("cardAnoNF").textContent = fmt(anoNF);
  $("cardJobs").textContent = monthJobs.length;
  $("cardTicket").textContent = fmt(ticket);

  // Table
  const tbody = $("dashJobsBody");
  tbody.innerHTML = "";
  $("dashEmpty").classList.toggle("hidden", monthJobs.length > 0);

  monthJobs.forEach(j => {
    const tr = document.createElement("tr");
    tr.classList.add("clickable-row");
    tr.innerHTML = `
      <td class="job-date">${fmtDate(j.date)}</td>
      <td><div class="job-name">${j.name}</div></td>
      <td><div class="job-client">${j.client}</div></td>
      <td class="job-value">${fmt(j.value)}</td>
      <td>${statusBadge(j.status)}</td>
      <td>
        <div class="row-actions">
          <button class="row-btn" title="Editar" data-edit="${j.id}">✏️</button>
          <button class="row-btn" title="NF" data-nf="${j.id}">🧾</button>
          <button class="row-btn delete" title="Excluir" data-del="${j.id}">🗑️</button>
        </div>
      </td>`;
    tr.addEventListener("click", () => openJobModal(j.id));
    tbody.appendChild(tr);
  });

  bindRowActions(tbody);
}

// Botão Filtrar — vai para Jobs com o mês atual do dashboard já aplicado
$("dashFilterBtn").addEventListener("click", () => {
  const monthStr = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}`;
  navigateTo("jobs");
  populateFilterMonths();
  $("filterMonth").value = monthStr;
  renderJobsPage();
});

// ─────────────────────────────────────────────
// JOBS PAGE
// ─────────────────────────────────────────────
function renderJobsPage() {
  const fMonth = $("filterMonth").value;
  const fClient = $("filterClient").value;
  const fStatus = $("filterStatus").value;
  const fNF = $("filterNF").value;

  let jobs = [...allJobs];
  if (fMonth) jobs = jobs.filter(j => j.date?.startsWith(fMonth));
  if (fClient) jobs = jobs.filter(j => j.client === fClient);
  if (fStatus) jobs = jobs.filter(j => j.status === fStatus);
  if (fNF === "com") jobs = jobs.filter(j => j.nf?.number);
  if (fNF === "sem") jobs = jobs.filter(j => !j.nf?.number);

  const tbody = $("allJobsBody");
  tbody.innerHTML = "";
  $("jobsEmpty").classList.toggle("hidden", jobs.length > 0);

  jobs.forEach(j => {
    const tr = document.createElement("tr");
    tr.classList.add("clickable-row");
    tr.innerHTML = `
      <td class="job-date">${fmtDate(j.date)}</td>
      <td><div class="job-name">${j.name}</div><div class="job-client">${j.client}</div></td>
      <td>${j.client}</td>
      <td class="job-value">${fmt(j.value)}</td>
      <td>${statusBadge(j.status)}</td>
      <td class="nf-icon">${j.nf?.number ? "🧾" : ""}</td>
      <td>
        <div class="row-actions">
          <button class="row-btn" title="Editar" data-edit="${j.id}">✏️</button>
          <button class="row-btn" title="NF" data-nf="${j.id}">🧾</button>
          <button class="row-btn delete" title="Excluir" data-del="${j.id}">🗑️</button>
        </div>
      </td>`;
    tr.addEventListener("click", () => openJobModal(j.id));
    tbody.appendChild(tr);
  });

  bindRowActions(tbody);
}

function populateFilterClients() {
  const clients = [...new Set(allJobs.map(j => j.client).filter(Boolean))].sort();
  const sel = $("filterClient");
  const cur = sel.value;
  sel.innerHTML = '<option value="">Todos os clientes</option>';
  clients.forEach(c => { const o = document.createElement("option"); o.value = c; o.textContent = c; sel.appendChild(o); });
  sel.value = cur;
}

function populateFilterMonths() {
  const months = [...new Set(allJobs.map(j => j.date?.slice(0,7)).filter(Boolean))].sort().reverse();
  const sel = $("filterMonth");
  const cur = sel.value;
  sel.innerHTML = '<option value="">Todos os meses</option>';
  months.forEach(m => {
    const [y, mo] = m.split("-");
    const o = document.createElement("option");
    o.value = m;
    o.textContent = `${MONTHS_PT[parseInt(mo)-1]} ${y}`;
    sel.appendChild(o);
  });
  sel.value = cur;
}

[$("filterMonth"), $("filterClient"), $("filterStatus"), $("filterNF")].forEach(sel => {
  sel?.addEventListener("change", renderJobsPage);
});
$("clearFilters").addEventListener("click", () => {
  $("filterMonth").value = "";
  $("filterClient").value = "";
  $("filterStatus").value = "";
  $("filterNF").value = "";
  renderJobsPage();
});

// ─────────────────────────────────────────────
// BIND ROW ACTIONS
// ─────────────────────────────────────────────
function bindRowActions(tbody) {
  tbody.querySelectorAll("[data-edit]").forEach(btn => {
    btn.addEventListener("click", e => { e.stopPropagation(); openJobModal(btn.dataset.edit); });
  });
  tbody.querySelectorAll("[data-nf]").forEach(btn => {
    btn.addEventListener("click", e => { e.stopPropagation(); openNFModal(btn.dataset.nf); });
  });
  tbody.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", e => { e.stopPropagation(); openDeleteModal(btn.dataset.del); });
  });
}

// ─────────────────────────────────────────────
// JOB MODAL
// ─────────────────────────────────────────────
function openJobModal(jobId = null) {
  editingJobId = jobId;
  $("jobModalTitle").textContent = jobId ? "Editar Job" : "Novo Job";

  if (jobId) {
    const j = allJobs.find(x => x.id === jobId);
    if (!j) return;
    $("jobDate").value = j.date || "";
    $("jobName").value = j.name || "";
    $("jobClient").value = j.client || "";
    $("jobValue").value = j.value || "";
    $("jobNotes").value = j.notes || "";
    $("jobStatus").value = j.status || "pendente";
    $("jobPayDate").value = j.payDate || "";
  } else {
    $("jobDate").value = today();
    $("jobName").value = "";
    $("jobClient").value = "";
    $("jobValue").value = "";
    $("jobNotes").value = "";
    $("jobStatus").value = "pendente";
    $("jobPayDate").value = "";
  }

  togglePayDateField();
  $("jobModal").classList.remove("hidden");
}

function closeJobModal() { $("jobModal").classList.add("hidden"); editingJobId = null; }
$("closeJobModal").addEventListener("click", closeJobModal);
$("cancelJobModal").addEventListener("click", closeJobModal);

$("jobStatus").addEventListener("change", togglePayDateField);
function togglePayDateField() {
  const paid = $("jobStatus").value !== "pendente";
  $("payDateField").style.display = paid ? "block" : "none";
}

$("saveJobBtn").addEventListener("click", async () => {
  const date = $("jobDate").value;
  const name = $("jobName").value.trim();
  const client = $("jobClient").value.trim();
  const value = parseFloat($("jobValue").value);
  const notes = $("jobNotes").value.trim();
  const status = $("jobStatus").value;
  const payDate = $("jobPayDate").value;

  if (!date || !name || !client || isNaN(value) || value < 0)
    return showToast("Preencha todos os campos obrigatórios.", "error");

  if (!currentUser) return showToast("Sessão expirada. Faça login novamente.", "error");

  loading(true);
  try {
    const data = { date, name, client, value, notes, status, payDate: status !== "pendente" ? payDate : "", updatedAt: new Date() };
    if (editingJobId) {
      await updateDoc(doc(db, "users", currentUser.uid, "jobs", editingJobId), data);
      showToast("Job atualizado!");
    } else {
      data.createdAt = new Date();
      await addDoc(collection(db, "users", currentUser.uid, "jobs"), data);
      showToast("Job adicionado!");
    }
    closeJobModal();
    populateFilterMonths();
  } catch (e) {
    console.error(e);
    showToast("Erro ao salvar job.", "error");
  } finally { loading(false); }
});

[$("addJobBtn"), $("addJobBtnDash")].forEach(btn => {
  btn?.addEventListener("click", () => openJobModal());
});

function populateClientSuggestions() {
  // Now handled by clients.js -> updateClientSelects()
  // Fallback: also add job-based clients not in clients collection
  const dl = $("clientsSuggestions");
  if (!dl) return;
  const jobClients = [...new Set(allJobs.map(j => j.client).filter(Boolean))];
  const existingNames = (window.allClients || []).map(c => c.name);
  const extra = jobClients.filter(c => !existingNames.includes(c));
  const current = [...dl.options].map(o => o.value);
  extra.forEach(c => {
    if (!current.includes(c)) {
      const o = document.createElement("option");
      o.value = c;
      dl.appendChild(o);
    }
  });
}

// ─────────────────────────────────────────────
// DELETE MODAL
// ─────────────────────────────────────────────
function openDeleteModal(jobId) {
  deletingJobId = jobId;
  $("deleteModal").classList.remove("hidden");
}
$("closeDeleteModal").addEventListener("click", () => { $("deleteModal").classList.add("hidden"); deletingJobId = null; });
$("cancelDelete").addEventListener("click", () => { $("deleteModal").classList.add("hidden"); deletingJobId = null; });
$("confirmDelete").addEventListener("click", async () => {
  if (!deletingJobId) return;
  loading(true);
  try {
    await deleteDoc(doc(db, "users", currentUser.uid, "jobs", deletingJobId));
    showToast("Job excluído.");
    $("deleteModal").classList.add("hidden");
    deletingJobId = null;
  } catch (e) {
    showToast("Erro ao excluir.", "error");
  } finally { loading(false); }
});

// ─────────────────────────────────────────────
// NF MODAL
// ─────────────────────────────────────────────
let selectedPDFFile = null;
let currentPdfUrl = "";

function openNFModal(jobId) {
  nfTargetJobId = jobId;
  selectedPDFFile = null;
  const j = allJobs.find(x => x.id === jobId);
  if (!j) return;

  $("nfJobInfo").innerHTML = `
    <strong>${j.name}</strong> — ${j.client}<br>
    <span style="color:var(--text2)">Valor: ${fmt(j.value)} | Data: ${fmtDate(j.date)}</span>`;

  const nf = j.nf || {};
  $("nfNumber").value = nf.number || "";
  $("nfDate").value = nf.date || today();
  $("nfLink").value = nf.link || "";
  currentPdfUrl = nf.pdfUrl || "";

  // Reset dropzone UI
  resetPDFDropzone();
  if (currentPdfUrl) {
    showPDFPreview(nf.pdfName || "PDF anexado", currentPdfUrl);
  }

  $("nfModal").classList.remove("hidden");
}

function closeNFModal() {
  $("nfModal").classList.add("hidden");
  nfTargetJobId = null;
  selectedPDFFile = null;
  currentPdfUrl = "";
}
$("closeNFModal").addEventListener("click", closeNFModal);
$("cancelNFModal").addEventListener("click", closeNFModal);

// ─────────────────────────────────────────────
// PDF DROPZONE UI
// ─────────────────────────────────────────────
function resetPDFDropzone() {
  $("nfPDFEmpty").classList.remove("hidden");
  $("nfPDFPreview").classList.add("hidden");
  $("nfPDFProgress").classList.add("hidden");
  $("nfPDFFile").value = "";
}

function showPDFPreview(name, url) {
  $("nfPDFEmpty").classList.add("hidden");
  $("nfPDFProgress").classList.add("hidden");
  $("nfPDFPreview").classList.remove("hidden");
  $("nfPDFFileName").textContent = name;
  $("nfPDFPreview").dataset.url = url || "";
}

$("nfPDFDropzone").addEventListener("click", (e) => {
  if (e.target.id === "nfPDFRemove") return;
  if ($("nfPDFPreview").classList.contains("hidden")) {
    $("nfPDFFile").click();
  }
});

$("nfPDFFile").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.type !== "application/pdf") {
    showToast("Apenas arquivos PDF são permitidos.", "error");
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showToast("O arquivo deve ter no máximo 5MB.", "error");
    return;
  }
  selectedPDFFile = file;
  showPDFPreview(file.name, null);
});

$("nfPDFRemove").addEventListener("click", (e) => {
  e.stopPropagation();
  selectedPDFFile = null;
  currentPdfUrl = "";
  resetPDFDropzone();
});

// Drag and drop
["dragover", "dragleave", "drop"].forEach(evt => {
  $("nfPDFDropzone").addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (evt === "dragover") $("nfPDFDropzone").classList.add("drag-active");
    if (evt === "dragleave" || evt === "drop") $("nfPDFDropzone").classList.remove("drag-active");
    if (evt === "drop" && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type !== "application/pdf") {
        showToast("Apenas arquivos PDF são permitidos.", "error");
        return;
      }
      selectedPDFFile = file;
      showPDFPreview(file.name, null);
    }
  });
});

$("saveNFBtn").addEventListener("click", async () => {
  if (!nfTargetJobId) return;
  const number = $("nfNumber").value.trim();
  const date = $("nfDate").value;
  const link = $("nfLink").value.trim();

  if (!number) return showToast("Informe o número da NF.", "error");

  loading(true);
  try {
    const j = allJobs.find(x => x.id === nfTargetJobId);
    let pdfUrl = currentPdfUrl;
    let pdfName = j?.nf?.pdfName || "";

    // Se selecionou novo arquivo, faz upload
    if (selectedPDFFile) {
      $("nfPDFProgress").classList.remove("hidden");
      $("nfPDFPreview").classList.add("hidden");
      try {
        const result = await uploadPDF(selectedPDFFile, currentUser.uid, (pct) => {
          $("nfPDFProgressFill").style.width = pct + "%";
          $("nfPDFProgressText").textContent = `Enviando... ${pct}%`;
        });
        pdfUrl = result.url;
        pdfName = selectedPDFFile.name;
      } catch (uploadErr) {
        showToast(uploadErr.message, "error");
        loading(false);
        $("nfPDFProgress").classList.add("hidden");
        showPDFPreview(selectedPDFFile.name, null);
        return;
      }
    }

    const nfData = { number, date, link, pdfUrl, pdfName };
    const newStatus = pdfUrl ? "pago_nf_pdf" : "pago_nf";

    await updateDoc(doc(db, "users", currentUser.uid, "jobs", nfTargetJobId), {
      nf: nfData,
      status: newStatus,
      payDate: j?.payDate || today()
    });

    showToast("Nota Fiscal salva!");
    closeNFModal();
  } catch (e) {
    console.error(e);
    showToast("Erro ao salvar NF.", "error");
  } finally { loading(false); }
});

// ─────────────────────────────────────────────
// NF PAGE
// ─────────────────────────────────────────────
function renderNFPage() {
  const nfJobs = allJobs.filter(j => j.nf?.number);
  const container = $("nfList");
  container.innerHTML = "";
  $("nfEmpty").classList.toggle("hidden", nfJobs.length > 0);

  nfJobs.forEach(j => {
    const card = document.createElement("div");
    card.className = "nf-card";
    card.innerHTML = `
      <div class="nf-card-header">
        <span class="nf-number">NF #${j.nf.number}</span>
        ${statusBadge(j.status)}
      </div>
      <div class="nf-job-title">${j.name}</div>
      <div class="nf-client">${j.client}</div>
      <div class="nf-meta">
        <span>💰 ${fmt(j.value)}</span>
        <span>📅 Emissão: ${fmtDate(j.nf.date)}</span>
        <span>🗓️ Job: ${fmtDate(j.date)}</span>
      </div>
      <div class="nf-actions">
        ${j.nf.link ? `<a href="${j.nf.link}" target="_blank" class="btn-nf-link">🔗 Consultar NF</a>` : ""}
        ${j.nf.pdfUrl ? `<button class="btn-nf-pdf" onclick="window.open('${j.nf.pdfUrl}','_blank')">📄 Ver PDF</button>` : ""}
        <button class="btn-nf-pdf" onclick="(function(){
          document.querySelectorAll('[data-nf]').forEach(b=>b.click&&false);
          window._editNF('${j.id}');
        })()">✏️ Editar</button>
      </div>`;
    container.appendChild(card);
  });

  // expose for inline onclick
  window._editNF = openNFModal;
}

// ─────────────────────────────────────────────
// REPORTS
// ─────────────────────────────────────────────
function renderReports() {
  renderNFvsMEI();
  renderChartMes();
  renderChartCliente();
  renderChartStatus();
  renderTopClientes();
}

function renderNFvsMEI() {
  const year = new Date().getFullYear();
  const yearJobs = allJobs.filter(j => j.date?.startsWith(String(year)));

  // Jobs com NF emitida (status pago_nf ou pago_nf_pdf)
  const jobsWithNF = yearJobs.filter(j => j.status === "pago_nf" || j.status === "pago_nf_pdf");
  const totalNF = jobsWithNF.reduce((a, j) => a + Number(j.value || 0), 0);
  const countNF = jobsWithNF.length;
  const pctNF = Math.min((totalNF / MEI_LIMIT) * 100, 100);

  $("repNFTotal").textContent = fmt(totalNF);
  $("repNFCount").textContent = countNF;
  $("repNFPercent").textContent = pctNF.toFixed(1) + "%";
  $("repNFProgress").style.width = pctNF + "%";

  // Jobs pagos SEM nota fiscal emitida (alerta)
  const paidWithoutNF = yearJobs.filter(j => j.status === "pago");
  const totalWithoutNF = paidWithoutNF.reduce((a, j) => a + Number(j.value || 0), 0);

  const alertBox = $("repNFWithoutAlert");
  if (paidWithoutNF.length > 0) {
    alertBox.classList.remove("hidden");
    alertBox.innerHTML = `⚠️ Você tem <strong>${paidWithoutNF.length} job(s)</strong> pagos no valor de <strong>${fmt(totalWithoutNF)}</strong> sem nota fiscal emitida ainda este ano.`;
  } else {
    alertBox.classList.add("hidden");
  }
}

function chartDefaults() {
  return {
    responsive: true,
    plugins: { legend: { labels: { color: "#9090b0", font: { family: "Space Grotesk" } } } },
    scales: {
      x: { ticks: { color: "#9090b0" }, grid: { color: "#2a2a38" } },
      y: { ticks: { color: "#9090b0" }, grid: { color: "#2a2a38" } }
    }
  };
}

function destroyChart(key) {
  if (charts[key]) { charts[key].destroy(); delete charts[key]; }
}

function renderChartMes() {
  destroyChart("mes");
  const byMonth = {};
  allJobs.forEach(j => {
    const m = j.date?.slice(0,7);
    if (!m) return;
    byMonth[m] = (byMonth[m] || 0) + Number(j.value || 0);
  });
  const keys = Object.keys(byMonth).sort().slice(-12);
  const labels = keys.map(k => { const [y,m]=k.split("-"); return `${MONTHS_PT[parseInt(m)-1].slice(0,3)} ${y}`; });
  const data = keys.map(k => byMonth[k]);

  charts.mes = new Chart($("chartMes"), {
    type: "bar",
    data: {
      labels,
      datasets: [{ label: "Faturamento", data, backgroundColor: "#7c6af788", borderColor: "#7c6af7", borderWidth: 2, borderRadius: 6 }]
    },
    options: { ...chartDefaults(), plugins: { legend: { display: false } } }
  });
}

function renderChartCliente() {
  destroyChart("cliente");
  const byClient = {};
  allJobs.forEach(j => { byClient[j.client] = (byClient[j.client] || 0) + 1; });
  const entries = Object.entries(byClient).sort((a,b) => b[1]-a[1]).slice(0,8);
  const colors = ["#7c6af7","#3498db","#2ecc71","#f39c12","#e74c3c","#9b59b6","#1abc9c","#e67e22"];

  charts.cliente = new Chart($("chartCliente"), {
    type: "doughnut",
    data: {
      labels: entries.map(e=>e[0]),
      datasets: [{ data: entries.map(e=>e[1]), backgroundColor: colors, borderWidth: 0 }]
    },
    options: { responsive: true, plugins: { legend: { position: "bottom", labels: { color: "#9090b0", font: { family: "Space Grotesk" }, padding: 12 } } } }
  });
}

function renderChartStatus() {
  destroyChart("status");
  const counts = { pendente: 0, pago: 0, pago_nf: 0, pago_nf_pdf: 0 };
  allJobs.forEach(j => { if (counts[j.status] !== undefined) counts[j.status]++; });

  charts.status = new Chart($("chartStatus"), {
    type: "doughnut",
    data: {
      labels: ["Pendente", "Pago", "Pago + NF", "Pago + NF + PDF"],
      datasets: [{ data: Object.values(counts), backgroundColor: ["#f39c12","#2ecc71","#3498db","#9b59b6"], borderWidth: 0 }]
    },
    options: { responsive: true, plugins: { legend: { position: "bottom", labels: { color: "#9090b0", font: { family: "Space Grotesk" }, padding: 12 } } } }
  });
}

function renderTopClientes() {
  const byClient = {};
  allJobs.forEach(j => { byClient[j.client] = (byClient[j.client] || 0) + Number(j.value || 0); });
  const sorted = Object.entries(byClient).sort((a,b) => b[1]-a[1]).slice(0,6);
  const max = sorted[0]?.[1] || 1;

  $("topClientes").innerHTML = `<div class="top-clients-list">
    ${sorted.map(([c,v]) => `
      <div class="top-client-item">
        <div class="top-client-name">${c}</div>
        <div class="top-client-bar-wrap"><div class="top-client-bar" style="width:${(v/max*100).toFixed(1)}%"></div></div>
        <div class="top-client-value">${fmt(v)}</div>
      </div>`).join("")}
  </div>`;
}

// ─────────────────────────────────────────────
// MEI
// ─────────────────────────────────────────────
function renderMEI() {
  const year = new Date().getFullYear();
  const yearJobs = allJobs.filter(j => j.date?.startsWith(String(year)));
  const faturado = yearJobs.reduce((a,j) => a + Number(j.value||0), 0);
  const disponivel = MEI_LIMIT - faturado;
  const pct = Math.min(faturado / MEI_LIMIT * 100, 100);

  // Faturamento com Nota Fiscal emitida
  const jobsComNF = yearJobs.filter(j => j.status === "pago_nf" || j.status === "pago_nf_pdf");
  const faturadoNF = jobsComNF.reduce((a,j) => a + Number(j.value||0), 0);

  $("meiFaturado").textContent = fmt(faturado);
  $("meiFaturadoNF").textContent = fmt(faturadoNF);
  $("meiDisponivel").textContent = fmt(disponivel);
  $("meiPercent").textContent = pct.toFixed(1) + "%";
  $("meiProgress").style.width = pct + "%";

  // Stats
  const monthNow = new Date().getMonth() + 1;
  const media = monthNow > 0 ? faturado / monthNow : 0;
  const projecao = media * 12;
  const mesesRestantes = 12 - monthNow;

  $("meiMedia").textContent = fmt(media);
  $("meiProjecao").textContent = fmt(projecao);
  $("meiMesesRestantes").textContent = mesesRestantes;

  // Alert box
  const alertBox = $("meiAlertBox");
  alertBox.className = "mei-alert-box";
  if (pct >= 95) {
    alertBox.classList.remove("hidden");
    alertBox.classList.add("warn95");
    alertBox.textContent = `🚨 ATENÇÃO: Você atingiu ${pct.toFixed(1)}% do limite MEI. Considere abrir uma empresa ou suspender emissão de notas.`;
  } else if (pct >= 85) {
    alertBox.classList.remove("hidden");
    alertBox.classList.add("warn85");
    alertBox.textContent = `⚠️ Alerta: Você está em ${pct.toFixed(1)}% do limite MEI. Fique atento ao faturamento restante.`;
  } else if (pct >= 70) {
    alertBox.classList.remove("hidden");
    alertBox.classList.add("warn70");
    alertBox.textContent = `💡 Aviso: Você já utilizou ${pct.toFixed(1)}% do limite MEI anual.`;
  } else {
    alertBox.classList.add("hidden");
  }
}

function updateMEIAlert() {
  const year = new Date().getFullYear();
  const faturado = allJobs.filter(j => j.date?.startsWith(String(year))).reduce((a,j)=>a+Number(j.value||0),0);
  const pct = faturado / MEI_LIMIT * 100;
  const alert = $("meiAlert");

  if (pct >= 95) {
    alert.className = "mei-alert warn95";
    alert.textContent = `🚨 Limite MEI: ${pct.toFixed(0)}% utilizado — R$ ${fmt(faturado)} de R$ 81.000`;
    alert.classList.remove("hidden");
  } else if (pct >= 85) {
    alert.className = "mei-alert warn85";
    alert.textContent = `⚠️ Limite MEI: ${pct.toFixed(0)}% utilizado`;
    alert.classList.remove("hidden");
  } else if (pct >= 70) {
    alert.className = "mei-alert warn70";
    alert.textContent = `💡 Limite MEI: ${pct.toFixed(0)}% utilizado`;
    alert.classList.remove("hidden");
  } else {
    alert.classList.add("hidden");
  }
}

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────
$("exportCSV").addEventListener("click", () => {
  const jobs = getFilteredJobs();
  const header = ["Data","Job","Cliente","Valor","Status","NF Número","NF Data","Observações"];
  const rows = jobs.map(j => [
    j.date, j.name, j.client, j.value, statusLabel(j.status),
    j.nf?.number || "", j.nf?.date || "", j.notes || ""
  ]);
  const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
  downloadFile(csv, "jobs.csv", "text/csv");
});

$("exportExcel").addEventListener("click", () => {
  const jobs = getFilteredJobs();
  const data = jobs.map(j => ({
    Data: fmtDate(j.date),
    Job: j.name,
    Cliente: j.client,
    Valor: Number(j.value),
    Status: statusLabel(j.status),
    "NF Nº": j.nf?.number || "",
    "NF Data": fmtDate(j.nf?.date),
    Observações: j.notes || ""
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Jobs");
  XLSX.writeFile(wb, "controle-jobs.xlsx");
});

$("exportPDF").addEventListener("click", () => {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text("Controle de Jobs", 14, 16);
  doc.setFontSize(10);
  doc.text(`Exportado em ${new Date().toLocaleDateString("pt-BR")}`, 14, 22);

  const jobs = getFilteredJobs();
  const total = jobs.reduce((a,j)=>a+Number(j.value||0),0);

  doc.autoTable({
    startY: 28,
    head: [["Data","Job","Cliente","Valor","Status"]],
    body: jobs.map(j => [fmtDate(j.date), j.name, j.client, fmt(j.value), statusLabel(j.status)]),
    foot: [["","","","TOTAL", fmt(total)]],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [124,106,247] },
    footStyles: { fontStyle: "bold" }
  });

  doc.save("controle-jobs.pdf");
});

function getFilteredJobs() {
  const fMonth = $("filterMonth").value;
  const fClient = $("filterClient").value;
  const fStatus = $("filterStatus").value;
  let jobs = [...allJobs];
  if (fMonth) jobs = jobs.filter(j => j.date?.startsWith(fMonth));
  if (fClient) jobs = jobs.filter(j => j.client === fClient);
  if (fStatus) jobs = jobs.filter(j => j.status === fStatus);
  return jobs;
}

function downloadFile(content, filename, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename;
  a.click();
}

// ─────────────────────────────────────────────
// PWA SERVICE WORKER
// ─────────────────────────────────────────────
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

// Initial populate
populateFilterMonths();
