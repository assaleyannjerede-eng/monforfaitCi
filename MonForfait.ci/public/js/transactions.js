/**
 * transactions.js - Page d'administration des transactions
 * ==========================================================
 * Fonctionnalites :
 *  - Charge toutes les transactions depuis Supabase (source principale)
 *  - Fallback sur localStorage si Supabase est indisponible
 *  - Mise à jour en temps réel via Realtime
 *  - Filtrage par statut, operateur, date, recherche
 *  - Pagination, export CSV
 *  - Actions : voir details, confirmer, rejeter, supprimer (synchronisees Supabase)
 */
document.addEventListener('DOMContentLoaded', () => {

  /* =====================================================
     Req 7 : Nettoyage des donnees de demo
     ===================================================== */
  if (!localStorage.getItem('mf_v2_initialized')) {
    Object.keys(localStorage)
      .filter(k => k.startsWith('monforfait_historique_'))
      .forEach(k => localStorage.removeItem(k));
    localStorage.setItem('mf_v2_initialized', '1');
    console.log('[Transactions] Donnees de demo supprimees.');
  }

  /* =====================================================
     CONFIGURATION
     ===================================================== */
  const ITEMS_PER_PAGE = 10;

  let allTransactions = [];
  let filteredTransactions = [];
  let currentPage = 1;
  let selectedTransactionId = null;
  let selectedCheckboxes = new Set();
  let realtimeChannel = null;
  let firestoreAvailable = false;

  // Opérateur de cette page : lu depuis <body data-operator="MTN"> (agent-mtn.html,
  // agent-orange.html, agent-moov.html). Pas de <script> inline ici — la CSP du
  // site (_headers / vercel.json) interdit script-src 'unsafe-inline', donc
  // l'attribut HTML est le seul moyen fiable de transmettre cette information.
  // window.ADMIN_FILTER_OPERATOR reste lu en secours, au cas où une page future
  // continuerait à utiliser l'ancien mécanisme.
  const ACTIVE_OPERATOR_FILTER =
    (document.body.dataset.operator || window.ADMIN_FILTER_OPERATOR || '').trim();

  // Mode agent = page dédiée à un seul opérateur (agent-mtn.html, agent-orange.html,
  // agent-moov.html). false uniquement sur la page globale du super-admin
  // (transactions.html), qui n'a pas de window.ADMIN_FILTER_OPERATOR.
  const AGENT_MODE = !!ACTIVE_OPERATOR_FILTER;

  // Page dédiée de chaque opérateur, utilisée par le contrôle d'accès
  // (enforceAccess) pour renvoyer un agent vers SA page s'il atterrit
  // ailleurs (page d'un autre opérateur, ou page globale du super-admin).
  const OPERATOR_AGENT_PAGES = {
    MTN: 'agent-mtn.html',
    Orange: 'agent-orange.html',
    MOOV: 'agent-moov.html'
  };

  // ====== Éléments DOM ======
  const filterStatus       = document.getElementById('filterStatus');
  const filterOperator     = document.getElementById('filterOperator');
  const filterSearch       = document.getElementById('filterSearch');
  const filterDateFrom     = document.getElementById('filterDateFrom');
  const filterDateTo       = document.getElementById('filterDateTo');
  const btnFilter          = document.getElementById('btnFilter');
  const btnReset           = document.getElementById('btnReset');

  const statTotal          = document.getElementById('statTotal');
  const statPending        = document.getElementById('statPending');
  const statConfirmed      = document.getElementById('statConfirmed');
  const statFailed         = document.getElementById('statFailed');

  const transactionsBody   = document.getElementById('transactionsBody');
  const selectAllCheckbox  = document.getElementById('selectAll');
  const btnExport          = document.getElementById('btnExport');
  const btnDeleteSelected  = document.getElementById('btnDeleteSelected');

  const btnPrevPage        = document.getElementById('btnPrevPage');
  const btnNextPage        = document.getElementById('btnNextPage');
  const pageInfo           = document.getElementById('pageInfo');
  const startEntry         = document.getElementById('startEntry');
  const endEntry           = document.getElementById('endEntry');
  const totalTx            = document.getElementById('totalTx');

  const detailsModal       = document.getElementById('detailsModal');
  const closeDetailsModal  = document.getElementById('closeDetailsModal');
  const detailsContent     = document.getElementById('detailsContent');
  const btnConfirmTx       = document.getElementById('btnConfirmTx');
  const btnRejectTx        = document.getElementById('btnRejectTx');
  const btnDeleteTx        = document.getElementById('btnDeleteTx');
  const btnCloseTx         = document.getElementById('btnCloseTx');

  // Indicateur de source de données
  const dataSourceBadge = (function() {
    const badge = document.createElement('span');
    badge.id = 'dataSourceBadge';
    badge.style.cssText = 'font-size:11px;padding:3px 8px;border-radius:12px;margin-left:10px;font-weight:600;vertical-align:middle';
    const h2 = document.querySelector('.transactions-table-section h2');
    if (h2) h2.appendChild(badge);
    return badge;
  })();

  function setSourceBadge(source) {
    if (!dataSourceBadge) return;
    if (source === 'firestore') {
      dataSourceBadge.textContent = '⚡ Supabase';
      dataSourceBadge.style.background = 'rgba(251,146,60,0.2)';
      dataSourceBadge.style.color = '#fb923c';
    } else {
      dataSourceBadge.textContent = '💾 Local';
      dataSourceBadge.style.background = 'rgba(148,163,184,0.15)';
      dataSourceBadge.style.color = '#94a3b8';
    }
  }

  /* =====================================================
     CONTRÔLE D'ACCÈS
     Cette page (super-admin ou agent d'un opérateur) est réservée aux
     comptes role = 'admin' (agent, limité à son operator) ou
     role = 'super_admin' (accès aux 3 opérateurs). Tout le monde
     d'autre est renvoyé vers la connexion ou vers sa propre page.
     ===================================================== */
  async function enforceAccess(supabase, user) {
    if (!user) {
      window.location.href = 'index.html';
      return null;
    }

    let profile = null;
    try {
      const { data, error } = await supabase
        .from('profiles').select('role, operator').eq('id', user.id).maybeSingle();
      if (error) throw error;
      profile = data;
    } catch (error) {
      console.warn('[Transactions] Impossible de vérifier le profil :', error);
      window.location.href = 'index.html';
      return null;
    }

    const role = profile?.role;
    const operator = profile?.operator;

    if (role === 'super_admin') {
      return { role: role, operator: operator };
    }

    if (role === 'admin') {
      if (AGENT_MODE) {
        if (operator === ACTIVE_OPERATOR_FILTER) return { role: role, operator: operator };
        // Agent connecté mais sur la page d'un AUTRE opérateur : on le
        // renvoie vers la sienne plutôt que d'afficher une page vide.
        window.location.href = OPERATOR_AGENT_PAGES[operator] || 'index.html';
        return null;
      }
      // Page globale (transactions.html) réservée au super-admin : un
      // agent par opérateur n'y a pas accès, direction sa propre page.
      window.location.href = OPERATOR_AGENT_PAGES[operator] || 'index.html';
      return null;
    }

    // Ni admin, ni super-admin : compte client normal (ou pas de profil).
    window.location.href = 'index.html';
    return null;
  }

  /* =====================================================
     SUPABASE — Source principale
     ===================================================== */
  async function startFirestoreListener(user) {
    const supabase = window.supabaseClient;
    if (!supabase) {
      console.warn('[Transactions] Client Supabase non disponible — fallback localStorage.');
      loadFromLocalStorage();
      return;
    }

    const access = await enforceAccess(supabase, user);
    if (!access) return; // redirection en cours, ne rien charger/afficher

    firestoreAvailable = true;
    setSourceBadge('firestore');

    async function loadRows() {
      let query = supabase.from('transactions').select('*').order('date', { ascending: false });
      if (ACTIVE_OPERATOR_FILTER) query = query.eq('operateur', ACTIVE_OPERATOR_FILTER);
      const { data, error } = await query;
      if (error) throw error;
      allTransactions = (data || []).map(row => ({
        ...row,
        transactionId: row.transaction_id,
        forfaitCode: row.forfait_code,
        forfaitLabel: row.forfait_label,
        userKey: row.user_id || 'guest'
      }));
      applyFilters();
    }

    if (realtimeChannel) await supabase.removeChannel(realtimeChannel);
    await loadRows();
    realtimeChannel = supabase.channel('transactions-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, loadRows)
      .subscribe();
  }

  /* =====================================================
     LOCALSTORAGE — Fallback
     ===================================================== */
  function loadFromLocalStorage() {
    try {
      const allKeys = Object.keys(localStorage).filter(k => k.startsWith('monforfait_historique_'));
      allTransactions = [];
      allKeys.forEach(key => {
        try {
          const raw = localStorage.getItem(key);
          if (raw) {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) {
              allTransactions.push(...arr.map(tx => ({
                ...tx,
                userKey: key.replace('monforfait_historique_', '')
              })));
            }
          }
        } catch (e) { console.warn('Erreur localStorage :', key, e); }
      });
      allTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));
      applyFilters();
    } catch (e) {
      console.warn('[Transactions] Erreur chargement localStorage', e);
    }
  }

  function saveToLocalStorage() {
    const byUser = {};
    allTransactions.forEach(tx => {
      const key = tx.userKey || 'guest';
      if (!byUser[key]) byUser[key] = [];
      const { userKey: _, ...clean } = tx;
      byUser[key].push(clean);
    });
    Object.keys(byUser).forEach(k =>
      localStorage.setItem('monforfait_historique_' + k, JSON.stringify(byUser[k]))
    );
  }

  /* =====================================================
     OPÉRATIONS SUPABASE
     ===================================================== */
 async function firestoreUpdate(txId, fields) {
  if (!firestoreAvailable || !window.supabaseClient) {
    throw new Error('Supabase non disponible.');
  }

  const payload = {
    ...fields,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await window.supabaseClient
    .from('transactions')
    .update(payload)
    .eq('transaction_id', txId)
    .select();

  if (error) {
    console.error('[Transactions] ERREUR UPDATE SUPABASE :', error);
    throw error;
  }

  console.log('[Transactions] UPDATE SUPABASE OK :', data);

  if (!data || data.length === 0) {
    throw new Error(
      'Supabase n’a modifié aucune transaction. Vérifie la RLS/policy.'
    );
  }

  return data;
}

  function firestoreDelete(txId) {
    if (!firestoreAvailable || !window.supabaseClient) return Promise.resolve();
    return window.supabaseClient.from('transactions').delete()
      .eq('transaction_id', txId).then(({ error }) => {
        if (error) throw error;
      });
  }

  /* =====================================================
     UTILITAIRES
     ===================================================== */
  function formatDate(dateString) {
    const d = new Date(dateString);
    return isNaN(d) ? dateString : d.toLocaleString('fr-FR');
  }

  function formatCurrency(amount) {
    if (!amount && amount !== 0) return '—';
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    return isNaN(num) ? '—' : Math.round(num) + ' F';
  }

  /* =====================================================
     FILTRAGE
     ===================================================== */
  function applyFilters() {
    currentPage = 1;
    const activeOperator = ACTIVE_OPERATOR_FILTER || filterOperator.value;
    const status   = filterStatus.value;
    const search   = filterSearch.value.toLowerCase();
    const dateFrom = filterDateFrom.value ? new Date(filterDateFrom.value) : null;
    const dateTo   = filterDateTo.value   ? new Date(filterDateTo.value)   : null;

    if (ACTIVE_OPERATOR_FILTER && filterOperator) {
      filterOperator.value = ACTIVE_OPERATOR_FILTER;
      filterOperator.disabled = true;
    }

    filteredTransactions = allTransactions.filter(tx => {
      if (status   && tx.status    !== status)   return false;
      if (activeOperator && tx.operateur !== activeOperator) return false;
      if (search) {
        const ok =
          (tx.payer?.toLowerCase().includes(search)) ||
          (tx.receveur?.toLowerCase().includes(search)) ||
          (tx.forfaitLabel?.toLowerCase().includes(search)) ||
          (tx.forfaitCode?.toLowerCase().includes(search)) ||
          (tx.transactionId?.toLowerCase().includes(search));
        if (!ok) return false;
      }
      if (dateFrom || dateTo) {
        const d = new Date(tx.date);
        if (dateFrom && d < dateFrom) return false;
        if (dateTo) {
          const next = new Date(dateTo);
          next.setDate(next.getDate() + 1);
          if (d >= next) return false;
        }
      }
      return true;
    });

    updateStats();
    renderTransactions();
  }

  function resetFilters() {
    filterStatus.value   = '';
    if (ACTIVE_OPERATOR_FILTER && filterOperator) {
      filterOperator.value = ACTIVE_OPERATOR_FILTER;
      filterOperator.disabled = true;
    } else if (filterOperator) {
      filterOperator.value = '';
    }
    filterSearch.value   = '';
    filterDateFrom.value = '';
    filterDateTo.value   = '';
    selectedCheckboxes.clear();
    if (selectAllCheckbox) selectAllCheckbox.checked = false;
    applyFilters();
  }

  /* =====================================================
     STATISTIQUES
     ===================================================== */
  function updateStats() {
    statTotal.textContent     = filteredTransactions.length;
    statPending.textContent   = filteredTransactions.filter(t => t.status === 'pending').length;
    statConfirmed.textContent = filteredTransactions.filter(t => t.status === 'confirmed').length;
    statFailed.textContent    = filteredTransactions.filter(t => t.status === 'failed').length;
  }

  /* =====================================================
     RENDU DU TABLEAU
     ===================================================== */
  /** Cree une <td> avec du texte en toute securite (jamais interprete comme du HTML) */
  function makeCell(text) {
    const td = document.createElement('td');
    td.textContent = text;
    return td;
  }

  function renderTransactions() {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const page  = filteredTransactions.slice(start, start + ITEMS_PER_PAGE);

    transactionsBody.replaceChildren();

    if (page.length === 0) {
      const row = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = AGENT_MODE ? 8 : 10;
      td.className = 'no-data';
      td.textContent = 'Aucune transaction trouvée';
      row.appendChild(td);
      transactionsBody.appendChild(row);
      updatePaginationInfo();
      return;
    }

    page.forEach(tx => {
      // tx.payer, tx.receveur, tx.forfaitLabel, etc. viennent de donnees soumises
      // par le formulaire public (ou potentiellement directement via l'API Supabase) :
      // on les traite TOUJOURS comme non fiables et on ne les insere jamais via innerHTML.
      const row = document.createElement('tr');
      const statusLabel = tx.status === 'pending' ? 'En attente'
                        : tx.status === 'confirmed' ? 'Confirmé' : 'Échoué';
      const userLabel   = (!tx.userKey || tx.userKey === 'guest') ? 'Anonyme' : 'Connecté';

      // Checkbox (sélection groupée) : uniquement sur la page globale du
      // super-admin. Les agents n'ont pas de suppression, donc pas de
      // sélection groupée non plus.
      if (!AGENT_MODE) {
        const checkboxTd = document.createElement('td');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'tx-checkbox';
        checkbox.dataset.txId = tx.transactionId;
        checkbox.checked = selectedCheckboxes.has(tx.transactionId);
        checkbox.addEventListener('change', function() {
          this.checked
            ? selectedCheckboxes.add(tx.transactionId)
            : selectedCheckboxes.delete(tx.transactionId);
          updateSelectAllCheckbox();
        });
        checkboxTd.appendChild(checkbox);
        row.appendChild(checkboxTd);
      }

      row.appendChild(makeCell(formatDate(tx.date)));
      // Colonne Opérateur : redondante sur une page déjà dédiée à un seul
      // opérateur, donc affichée seulement sur la page globale.
      if (!AGENT_MODE) {
        row.appendChild(makeCell(tx.operateur || '—'));
      }
      row.appendChild(makeCell(tx.forfaitLabel || tx.forfaitCode || '—'));
      row.appendChild(makeCell(tx.payer || '—'));
      row.appendChild(makeCell(tx.receveur || '—'));
      row.appendChild(makeCell(
        tx.is_bonus
          ? '🎁 OFFERT (0 F)'
          : (tx.reduction_pct > 0
              ? formatCurrency(tx.prix) + ' 🎁 −' + tx.reduction_pct + ' %'
              : formatCurrency(tx.prix))
      ));

      const statusTd = document.createElement('td');
      const statusBadge = document.createElement('span');
      statusBadge.className = 'status-badge ' + tx.status;
      statusBadge.textContent = statusLabel;
      statusTd.appendChild(statusBadge);
      row.appendChild(statusTd);

      row.appendChild(makeCell(userLabel));

      // Actions : addEventListener avec tx.transactionId capture par closure,
      // jamais concatene dans une chaine HTML/onclick.
      const actionsTd = document.createElement('td');
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'tx-actions';

      const viewBtn = document.createElement('button');
      viewBtn.className = 'tx-actions button btn-view';
      viewBtn.textContent = '👁️ Voir';
      viewBtn.addEventListener('click', () => window.openTransactionDetails(tx.transactionId));
      actionsDiv.appendChild(viewBtn);

      if (tx.status === 'pending') {
        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'tx-actions button btn-confirm';
        confirmBtn.textContent = '✓ Confirmer';
        confirmBtn.addEventListener('click', () => window.confirmTransaction(tx.transactionId));
        actionsDiv.appendChild(confirmBtn);
      }

      // Suppression : réservée au super-admin (les agents ne font que
      // consulter / confirmer / rejeter — voir aussi la policy RLS
      // "Super admin deletes transactions").
      if (!AGENT_MODE) {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'tx-actions button btn-remove';
        removeBtn.textContent = '🗑️ Suppr';
        removeBtn.addEventListener('click', () => window.deleteTransaction(tx.transactionId));
        actionsDiv.appendChild(removeBtn);
      }

      actionsTd.appendChild(actionsDiv);
      row.appendChild(actionsTd);

      transactionsBody.appendChild(row);
    });

    updatePaginationInfo();
  }

  function updatePaginationInfo() {
    const total = filteredTransactions.length;
    const s     = total === 0 ? 0 : (currentPage - 1) * ITEMS_PER_PAGE + 1;
    const e     = Math.min(currentPage * ITEMS_PER_PAGE, total);
    startEntry.textContent = s;
    endEntry.textContent   = e;
    totalTx.textContent    = total;
    pageInfo.textContent   = 'Page ' + currentPage;
    btnPrevPage.disabled   = currentPage === 1;
    btnNextPage.disabled   = e >= total;
  }

  function updateSelectAllCheckbox() {
    if (!selectAllCheckbox) return;
    const boxes   = document.querySelectorAll('.tx-checkbox');
    const checked = Array.from(boxes).filter(c => c.checked).length;
    selectAllCheckbox.checked  = checked === boxes.length && boxes.length > 0;
    if (btnDeleteSelected) btnDeleteSelected.disabled = selectedCheckboxes.size === 0;
  }

  /* =====================================================
     ACTIONS SUR LES TRANSACTIONS
     ===================================================== */
  /** Ajoute une ligne "label: valeur" dans le panneau de details, texte toujours en textContent */
  function addDetailItem(container, label, value, valueClassExtra) {
    const item = document.createElement('div');
    item.className = 'detail-item';

    const labelSpan = document.createElement('span');
    labelSpan.className = 'detail-label';
    labelSpan.textContent = label;

    const valueSpan = document.createElement('span');
    valueSpan.className = 'detail-value' + (valueClassExtra ? ' ' + valueClassExtra : '');
    valueSpan.textContent = value;

    item.appendChild(labelSpan);
    item.appendChild(valueSpan);
    container.appendChild(item);
  }

  window.openTransactionDetails = function(txId) {
    selectedTransactionId = txId;
    const tx = allTransactions.find(t => t.transactionId === txId);
    if (!tx) return;

    // tx.* peut contenir des donnees non fiables (voir renderTransactions) :
    // toujours via textContent, jamais via innerHTML.
    detailsContent.replaceChildren();
    addDetailItem(detailsContent, 'ID Transaction', tx.transactionId);
    addDetailItem(detailsContent, 'Date', formatDate(tx.date));
    addDetailItem(detailsContent, 'Opérateur', tx.operateur || '—');
    addDetailItem(detailsContent, 'Forfait', tx.forfaitLabel || tx.forfaitCode || '—');
    addDetailItem(detailsContent, 'Payeur', tx.payer || '—');
    addDetailItem(detailsContent, 'Bénéficiaire', tx.receveur || '—');
    addDetailItem(
      detailsContent, 'Montant',
      tx.is_bonus
        ? '🎁 OFFERT — aucun paiement Wave à vérifier'
        : (tx.reduction_pct > 0
            ? formatCurrency(tx.prix) + ' — réduction fidélité −' + tx.reduction_pct + ' % déjà appliquée (montant Wave à vérifier : ' + formatCurrency(tx.prix) + ')'
            : formatCurrency(tx.prix))
    );
    addDetailItem(
      detailsContent, 'Statut',
      tx.status === 'pending' ? 'En attente' : tx.status === 'confirmed' ? 'Confirmé' : 'Échoué',
      'status-badge ' + tx.status
    );
    addDetailItem(detailsContent, 'Source', firestoreAvailable ? '⚡ Supabase' : '💾 Local');
    if (tx.meta && tx.meta.providerRef) {
      addDetailItem(detailsContent, 'Référence opérateur', tx.meta.providerRef);
    }

    btnConfirmTx.classList.add('hidden');
    btnRejectTx.classList.add('hidden');
    if (btnDeleteTx) btnDeleteTx.classList.remove('hidden');
    if (tx.status === 'pending') {
      btnConfirmTx.classList.remove('hidden');
      btnRejectTx.classList.remove('hidden');
    }

    detailsModal.classList.remove('hidden');
    detailsModal.setAttribute('aria-hidden', 'false');
  };

  window.confirmTransaction = function(txId) {
    const idx = allTransactions.findIndex(t => t.transactionId === txId);
    if (idx === -1) return;

    const providerRef = prompt('Référence opérateur (optionnel) :', '');
    const meta = Object.assign({}, allTransactions[idx].meta || {}, providerRef ? { providerRef } : {});

    allTransactions[idx].status = 'confirmed';
    allTransactions[idx].meta   = meta;

   firestoreUpdate(txId, { status: 'confirmed', meta })
  .then(function() {

    console.log('[Transactions] Confirmée dans Supabase :', txId);

    if (!firestoreAvailable) {
      saveToLocalStorage();
    }

    applyFilters();

    alert('✅ Transaction confirmée avec succès.');

    if (!detailsModal.classList.contains('hidden')) {
      window.openTransactionDetails(txId);
    }

  })
  .catch(function(err) {

    console.error('[Transactions] ÉCHEC confirmation :', err);

    // On remet l'état local comme avant
    allTransactions[idx].status = 'pending';
    allTransactions[idx].meta = allTransactions[idx].meta || {};

    applyFilters();

    alert(
      '❌ La transaction n’a pas pu être confirmée dans Supabase.\n\n' +
      'Erreur : ' + (err.message || 'Erreur inconnue')
    );
  });
    if (!detailsModal.classList.contains('hidden')) window.openTransactionDetails(txId);
  };

  window.deleteTransaction = function(txId) {
    if (AGENT_MODE) {
      alert('Action non autorisée sur cet espace : seul le super-admin peut supprimer une transaction.');
      return;
    }
    if (!confirm('Êtes-vous sûr de vouloir supprimer cette transaction ?')) return;

    allTransactions = allTransactions.filter(t => t.transactionId !== txId);
    selectedCheckboxes.delete(txId);

    firestoreDelete(txId)
      .then(function() { console.log('[Transactions] Supprimée de Firestore :', txId); })
      .catch(function(err) { console.warn('[Transactions] Erreur Firestore delete :', err); });

    if (!firestoreAvailable) saveToLocalStorage();
    applyFilters();
    if (!detailsModal.classList.contains('hidden')) closeDetailsModal.click();
    alert('Transaction supprimée.');
  };

  function rejectTransaction(txId) {
    const idx = allTransactions.findIndex(t => t.transactionId === txId);
    if (idx === -1) return;

    const reason = prompt('Raison du rejet (optionnel) :', '');
    const meta = Object.assign({}, allTransactions[idx].meta || {}, reason ? { reason } : {});

    allTransactions[idx].status = 'failed';
    allTransactions[idx].meta   = meta;

    firestoreUpdate(txId, { status: 'failed', meta })
      .then(function() { console.log('[Transactions] Rejetée dans Firestore :', txId); })
      .catch(function(err) { console.warn('[Transactions] Erreur Firestore reject :', err); });

    if (!firestoreAvailable) saveToLocalStorage();
    applyFilters();
    alert('Transaction rejetée.');
    if (!detailsModal.classList.contains('hidden')) window.openTransactionDetails(txId);
  }

  function deleteSelectedTransactions() {
    if (AGENT_MODE) {
      alert('Action non autorisée sur cet espace : seul le super-admin peut supprimer des transactions.');
      return;
    }
    if (selectedCheckboxes.size === 0) { alert('Aucune transaction sélectionnée.'); return; }
    if (!confirm('Êtes-vous sûr de vouloir supprimer ' + selectedCheckboxes.size + ' transaction(s) ?')) return;

    var ids = Array.from(selectedCheckboxes);
    allTransactions = allTransactions.filter(t => !selectedCheckboxes.has(t.transactionId));
    selectedCheckboxes.clear();

    if (firestoreAvailable && window.supabaseClient) {
      window.supabaseClient.from('transactions').delete().in('transaction_id', ids)
        .then(function(result) {
          if (result.error) throw result.error;
          console.log('[Transactions] Suppression batch Supabase OK');
        })
        .catch(function(err) { console.warn('[Transactions] Erreur batch delete :', err); });
    }

    if (!firestoreAvailable) saveToLocalStorage();
    applyFilters();
    alert('Transactions supprimées.');
  }

  function exportToCSV() {
    if (filteredTransactions.length === 0) { alert('Aucune transaction à exporter.'); return; }
    var csv = 'ID Transaction,Date,Opérateur,Forfait,Payeur,Bénéficiaire,Montant,Statut\n';
    filteredTransactions.forEach(function(tx) {
      csv += '"' + tx.transactionId + '","' + formatDate(tx.date) + '","' + tx.operateur + '","' +
        (tx.forfaitLabel || tx.forfaitCode) + '","' + tx.payer + '","' + tx.receveur + '","' +
        (tx.is_bonus ? 'OFFERT' : (tx.prix || '')) + '","' + tx.status + '"\n';
    });
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var link = document.createElement('a');
    link.setAttribute('href', URL.createObjectURL(blob));
    link.setAttribute('download', 'transactions_' + Date.now() + '.csv');
    link.click();
  }

  /* =====================================================
     ÉVÉNEMENTS
     ===================================================== */
  btnFilter.addEventListener('click', applyFilters);
  btnReset.addEventListener('click', resetFilters);
  if (btnExport) btnExport.addEventListener('click', exportToCSV);
  if (btnDeleteSelected) btnDeleteSelected.addEventListener('click', deleteSelectedTransactions);

  var btnAutoRefresh = document.getElementById('btnAutoRefresh');
  if (btnAutoRefresh) {
    btnAutoRefresh.textContent = '🔄 Recharger';
    btnAutoRefresh.addEventListener('click', function() {
      if (firestoreAvailable) {
        window.supabaseClient.auth.getUser().then(function(result) {
          startFirestoreListener(result.data.user);
        });
        alert('Données rechargées depuis Supabase.');
      } else {
        loadFromLocalStorage();
        alert('Données rechargées depuis localStorage.');
      }
    });
  }

  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener('change', function() {
      var boxes = document.querySelectorAll('.tx-checkbox');
      boxes.forEach(function(cb) {
        cb.checked = selectAllCheckbox.checked;
        selectAllCheckbox.checked
          ? selectedCheckboxes.add(cb.dataset.txId)
          : selectedCheckboxes.delete(cb.dataset.txId);
      });
      updateSelectAllCheckbox();
    });
  }

  btnPrevPage.addEventListener('click', function() {
    if (currentPage > 1) { currentPage--; renderTransactions(); window.scrollTo({top:0,behavior:'smooth'}); }
  });
  btnNextPage.addEventListener('click', function() {
    var max = Math.ceil(filteredTransactions.length / ITEMS_PER_PAGE);
    if (currentPage < max) { currentPage++; renderTransactions(); window.scrollTo({top:0,behavior:'smooth'}); }
  });

  closeDetailsModal.addEventListener('click', function() {
    detailsModal.classList.add('hidden'); detailsModal.setAttribute('aria-hidden','true');
  });
  btnCloseTx.addEventListener('click', function() {
    detailsModal.classList.add('hidden'); detailsModal.setAttribute('aria-hidden','true');
  });
  btnConfirmTx.addEventListener('click', function() {
    if (selectedTransactionId) window.confirmTransaction(selectedTransactionId);
  });
  btnRejectTx.addEventListener('click', function() {
    if (selectedTransactionId) rejectTransaction(selectedTransactionId);
  });
  if (btnDeleteTx) {
    btnDeleteTx.addEventListener('click', function() {
      if (selectedTransactionId) window.deleteTransaction(selectedTransactionId);
    });
  }

  detailsModal.addEventListener('click', function(e) {
    if (e.target === detailsModal) { detailsModal.classList.add('hidden'); detailsModal.setAttribute('aria-hidden','true'); }
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && !detailsModal.classList.contains('hidden')) {
      detailsModal.classList.add('hidden'); detailsModal.setAttribute('aria-hidden','true');
    }
  });

  window.addEventListener('beforeunload', function() {
    if (realtimeChannel && window.supabaseClient) window.supabaseClient.removeChannel(realtimeChannel);
  });

  /* =====================================================
     INITIALISATION
     ===================================================== */
  if (window.supabaseClient) {
    window.supabaseClient.auth.getUser().then(function(result) {
      startFirestoreListener(result.data.user);
    });
  } else {
    startFirestoreListener(null);
  }
});
