// ═══════════════════════════════════════════════
// clients.js — Cadastro de Clientes/Produtoras
// ═══════════════════════════════════════════════

import { db } from "./firebase-config.js";
import {
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export let allClients = [];
let unsubClients = null;
let editingClientId = null;

const $ = id => document.getElementById(id);

// ─────────────────────────────────────────────
// SUBSCRIBE
// ─────────────────────────────────────────────
export function subscribeClients(uid, onUpdate) {
  if (unsubClients) unsubClients();
  const q = query(
    collection(db, "users", uid, "clients"),
    orderBy("name", "asc")
  );
  unsubClients = onSnapshot(q, snap => {
    allClients = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderClientsList();
    updateClientSelects();
    if (onUpdate) onUpdate(allClients);
  });
  return unsubClients;
}

export function unsubscribeClients() {
  if (unsubClients) { unsubClients(); unsubClients = null; }
}

// ─────────────────────────────────────────────
// RENDER LIST
// ─────────────────────────────────────────────
export function renderClientsList() {
  const list = $("clientsListBody");
  const empty = $("clientsEmpty");
  if (!list) return;

  const active = allClients.filter(c => c.status !== "inativo");
  const inactive = allClients.filter(c => c.status === "inativo");
  const sorted = [...active, ...inactive];

  list.innerHTML = "";
  if (sorted.length === 0) {
    empty?.classList.remove("hidden");
    return;
  }
  empty?.classList.add("hidden");

  sorted.forEach(c => {
    const tr = document.createElement("tr");
    const isInativo = c.status === "inativo";
    tr.innerHTML = `
      <td>
        <div class="client-name ${isInativo ? 'inativo' : ''}">${c.name}</div>
        ${c.tradeName ? `<div class="client-sub">${c.tradeName}</div>` : ""}
      </td>
      <td class="client-cnpj">${formatCNPJ(c.cnpj) || "—"}</td>
      <td class="client-city">${c.city || "—"}</td>
      <td>${isInativo
        ? '<span class="badge badge-inativo">⚫ Inativo</span>'
        : '<span class="badge badge-ativo">🟢 Ativo</span>'
      }</td>
      <td>
        <div class="row-actions" style="opacity:1">
          <button class="row-btn" data-cedit="${c.id}" title="Editar">✏️</button>
          <button class="row-btn ${isInativo ? '' : 'delete'}" 
            data-ctoggle="${c.id}" 
            data-cstatus="${c.status || 'ativo'}"
            title="${isInativo ? 'Reativar' : 'Inativar'}">
            ${isInativo ? '♻️' : '🚫'}
          </button>
          <button class="row-btn delete" data-cdel="${c.id}" title="Excluir">🗑️</button>
        </div>
      </td>`;
    list.appendChild(tr);
  });

  // Bind actions
  list.querySelectorAll("[data-cedit]").forEach(btn => {
    btn.addEventListener("click", () => openClientModal(btn.dataset.cedit));
  });
  list.querySelectorAll("[data-ctoggle]").forEach(btn => {
    btn.addEventListener("click", () => toggleClientStatus(btn.dataset.ctoggle, btn.dataset.cstatus));
  });
  list.querySelectorAll("[data-cdel]").forEach(btn => {
    btn.addEventListener("click", () => confirmDeleteClient(btn.dataset.cdel));
  });
}

// ─────────────────────────────────────────────
// UPDATE SELECTS (job modal + filters)
// ─────────────────────────────────────────────
export function updateClientSelects() {
  const activeClients = allClients.filter(c => c.status !== "inativo");

  // Job modal datalist
  const dl = $("clientsSuggestions");
  if (dl) {
    dl.innerHTML = activeClients.map(c => `<option value="${c.name}">`).join("");
  }

  // Filter select
  const fSel = $("filterClient");
  if (fSel) {
    const cur = fSel.value;
    fSel.innerHTML = '<option value="">Todos os clientes</option>';
    activeClients.forEach(c => {
      const o = document.createElement("option");
      o.value = c.name;
      o.textContent = c.name;
      fSel.appendChild(o);
    });
    fSel.value = cur;
  }
}

// ─────────────────────────────────────────────
// MODAL
// ─────────────────────────────────────────────
export function openClientModal(clientId = null) {
  editingClientId = clientId;
  $("clientModalTitle").textContent = clientId ? "Editar Cliente" : "Novo Cliente";

  if (clientId) {
    const c = allClients.find(x => x.id === clientId);
    if (!c) return;
    $("cName").value = c.name || "";
    $("cTradeName").value = c.tradeName || "";
    $("cCNPJ").value = c.cnpj || "";
    $("cEmail").value = c.email || "";
    $("cPhone").value = c.phone || "";
    $("cAddress").value = c.address || "";
    $("cCity").value = c.city || "";
    $("cState").value = c.state || "";
    $("cCEP").value = c.cep || "";
    $("cNotes").value = c.notes || "";
  } else {
    ["cName","cTradeName","cCNPJ","cEmail","cPhone","cAddress","cCity","cState","cCEP","cNotes"]
      .forEach(id => { const el = $(id); if(el) el.value = ""; });
    $("cState").value = "DF";
  }

  $("clientModal").classList.remove("hidden");
}

function closeClientModal() {
  $("clientModal").classList.add("hidden");
  editingClientId = null;
}

// ─────────────────────────────────────────────
// SAVE
// ─────────────────────────────────────────────
export async function saveClient(uid, showToast, loading) {
  const name = $("cName").value.trim();
  if (!name) { showToast("Informe o nome do cliente.", "error"); return; }

  const data = {
    name,
    tradeName: $("cTradeName").value.trim(),
    cnpj: $("cCNPJ").value.trim(),
    email: $("cEmail").value.trim(),
    phone: $("cPhone").value.trim(),
    address: $("cAddress").value.trim(),
    city: $("cCity").value.trim(),
    state: $("cState").value,
    cep: $("cCEP").value.trim(),
    notes: $("cNotes").value.trim(),
    status: "ativo",
    updatedAt: new Date()
  };

  loading(true);
  try {
    if (editingClientId) {
      await updateDoc(doc(db, "users", uid, "clients", editingClientId), data);
      showToast("Cliente atualizado!");
    } else {
      data.createdAt = new Date();
      await addDoc(collection(db, "users", uid, "clients"), data);
      showToast("Cliente cadastrado!");
    }
    closeClientModal();
  } catch(e) {
    console.error(e);
    showToast("Erro ao salvar cliente.", "error");
  } finally { loading(false); }
}

async function toggleClientStatus(clientId, currentStatus) {
  const uid = window._currentUid;
  if (!uid) return;
  const newStatus = currentStatus === "inativo" ? "ativo" : "inativo";
  try {
    await updateDoc(doc(db, "users", uid, "clients", clientId), { status: newStatus });
  } catch(e) { console.error(e); }
}

async function confirmDeleteClient(clientId) {
  if (!confirm("Excluir este cliente? Esta ação não pode ser desfeita.")) return;
  const uid = window._currentUid;
  if (!uid) return;
  try {
    await deleteDoc(doc(db, "users", uid, "clients", clientId));
  } catch(e) { console.error(e); }
}

// ─────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────
export function formatCNPJ(v) {
  if (!v) return "";
  v = v.replace(/\D/g, "");
  if (v.length !== 14) return v;
  return v.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
}

export function getClientData(name) {
  return allClients.find(c => c.name === name) || null;
}

// ─────────────────────────────────────────────
// INIT EVENTS (called from app.js)
// ─────────────────────────────────────────────
export function initClientsEvents(uid, showToast, loading) {
  $("addClientBtn")?.addEventListener("click", () => openClientModal());
  $("closeClientModal")?.addEventListener("click", closeClientModal);
  $("cancelClientModal")?.addEventListener("click", closeClientModal);
  $("saveClientBtn")?.addEventListener("click", () => saveClient(uid, showToast, loading));

  // CNPJ mask
  $("cCNPJ")?.addEventListener("input", e => {
    let v = e.target.value.replace(/\D/g,"").slice(0,14);
    if (v.length > 12) v = v.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,"$1.$2.$3/$4-$5");
    else if (v.length > 8) v = v.replace(/(\d{2})(\d{3})(\d{3})(\d+)/,"$1.$2.$3/$4");
    else if (v.length > 5) v = v.replace(/(\d{2})(\d{3})(\d+)/,"$1.$2.$3");
    else if (v.length > 2) v = v.replace(/(\d{2})(\d+)/,"$1.$2");
    e.target.value = v;
  });

  // CEP mask
  $("cCEP")?.addEventListener("input", e => {
    let v = e.target.value.replace(/\D/g,"").slice(0,8);
    if (v.length > 5) v = v.replace(/(\d{5})(\d+)/,"$1-$2");
    e.target.value = v;
  });
}
