/**
 * programme.js - Souscriptions programmées (MonForfait.ci)
 * =========================================================
 * Le client choisit un achat (forfait ou transfert d'unités) et une date
 * d'exécution, éventuellement répétée.
 *
 * RÈGLE : le client PAIE TOUJOURS MAINTENANT par Wave, même si la date est
 * dans 10 ans. app.js enregistre la transaction (en attente) avec
 * meta.programme_pour = date d'exécution : l'agent la voit sur sa page et
 * l'exécute à cette date.
 *
 * Pour une répétition, la première occurrence est payée maintenant ; les
 * suivantes sont rappelées ici (rappel + « Payer maintenant »).
 *
 * Liste stockée dans le localStorage de l'appareil (par compte ou invité).
 */
(function () {
  'use strict';

  var MAX_PROGRAMMES = 10;
  var MAX_ANNEES = 20;
  var CHECK_EVERY_MS = 30 * 1000;
  var LIBELLE_REPETITION = {
    once: 'Une seule fois',
    daily: 'Chaque jour',
    weekly: 'Chaque semaine',
    monthly: 'Chaque mois'
  };

  var $ = function (id) { return document.getElementById(id); };

  var openBtn = $('progOpen');
  var modal = $('progModal');
  if (!openBtn || !modal) return;

  var content = $('progContent');
  var form = $('progForm');
  var msg = $('progMessage');
  var listEl = $('progList');
  var dueEl = $('progDue');
  var countEl = $('progCount');
  var unitesInput = $('progUnites');
  var lastFocus = null;
  var PREFIXES = { Orange: '07', MTN: '05', MOOV: '01' };
  var NOM_OP = { MTN: 'MTN', Orange: 'Orange', MOOV: 'Moov' };

  /* État de l'assistant (réinitialisé à chaque ouverture) */
  var state = { step: 1, op: '', tab: 'appels', code: '', label: '', court: '', unites: 0 };

  /* ---------- Stockage ---------- */

  function cle() {
    var uid = 'guest';
    try {
      var u = JSON.parse(sessionStorage.getItem('mf_session') || 'null');
      if (u && u.uid) uid = u.uid;
    } catch (e) { /* session illisible : invité */ }
    return 'monforfait_programmes_' + uid;
  }

  function charger() {
    try {
      var arr = JSON.parse(localStorage.getItem(cle()) || '[]');
      if (!Array.isArray(arr)) return [];
      return arr.filter(function (p) {
        return p && p.id && p.operateur && p.receveur && !isNaN(new Date(p.next).getTime());
      });
    } catch (e) { return []; }
  }

  function sauver(arr) {
    try { localStorage.setItem(cle(), JSON.stringify(arr)); } catch (e) { /* quota / mode privé */ }
  }

  /* ---------- Dates ---------- */

  function ajouterPas(date, repeat) {
    var d = new Date(date.getTime());
    if (repeat === 'daily') d.setDate(d.getDate() + 1);
    else if (repeat === 'weekly') d.setDate(d.getDate() + 7);
    else if (repeat === 'monthly') {
      var jour = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + 1);
      var dernier = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(jour, dernier));
    }
    return d;
  }

  function prochaineFuture(iso, repeat) {
    var d = new Date(iso);
    var now = new Date();
    var garde = 0;
    while (d <= now && garde++ < 1000) d = ajouterPas(d, repeat);
    return d;
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function versInputLocal(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function formaterDate(iso) {
    return new Date(iso).toLocaleString('fr-FR', {
      weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
    }).replace(',', '').replace(':', 'h');
  }

  function telValide(v) { return /^\+?\d{8,15}$/.test((v || '').trim()); }

  /* ---------- Assistant par étapes ---------- */

  function erreur(texte, champ) {
    msg.textContent = texte;
    msg.className = 'prog-message is-error';
    if (champ) champ.focus();
  }

  function majRecap() {
    var parts = [];
    if (state.op) parts.push(NOM_OP[state.op]);
    if (state.step >= 3 && state.court) parts.push(state.court);
    if (state.step >= 4 && $('progReceveur').value.trim()) parts.push('→ ' + $('progReceveur').value.trim());
    var r = $('progRecap');
    r.hidden = !parts.length;
    r.textContent = parts.join(' · ');
  }

  function aller(n) {
    state.step = n;
    form.querySelectorAll('.prog-step').forEach(function (sec) {
      sec.hidden = Number(sec.dataset.step) !== n;
    });
    Array.prototype.forEach.call($('progSteps').children, function (li, i) {
      li.className = (i + 1 < n) ? 'is-done' : ((i + 1 === n) ? 'is-active' : '');
      if (i + 1 === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
    $('progBack').hidden = n === 1;
    msg.textContent = '';
    msg.className = 'prog-message';
    majRecap();
    setTimeout(function () {
      var cible = { 1: '.prog-op', 2: '.prog-tab.is-active', 3: '#progPayer', 4: '#progPayNow' }[n];
      var el = form.querySelector(cible);
      if (el) el.focus();
    }, 40);
  }

  function rendreOffres() {
    var box = $('progOffres');
    box.replaceChildren();
    if (typeof getForfaits !== 'function' || !state.op) return;
    var offres = getForfaits(state.op, state.tab).slice().sort(function (a, b) { return a.prix - b.prix; });
    if (!offres.length) {
      var vide = document.createElement('p');
      vide.className = 'prog-hint';
      vide.textContent = 'Aucun forfait disponible dans cette catégorie.';
      box.appendChild(vide);
      return;
    }
    offres.forEach(function (o) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'prog-offre' + (o.code === state.code ? ' is-selected' : '');
      var d = document.createElement('span');
      d.className = 'prog-offre-desc';
      d.textContent = (o.desc ? String(o.desc).trim() : (o.nom || ''));
      var n = document.createElement('span');
      n.className = 'prog-offre-nom';
      n.textContent = o.nom || '';
      b.appendChild(d);
      b.appendChild(n);
      b.addEventListener('click', function () { choisirOffre(o, b); });
      box.appendChild(b);
    });
  }

  function setTab(tab) {
    state.tab = tab;
    form.querySelectorAll('.prog-tab').forEach(function (t) {
      var on = t.dataset.tab === tab;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    var unites = tab === 'unites';
    $('progOffres').hidden = unites;
    $('progUnitesBox').hidden = !unites;
    $('progPrixHint').hidden = unites;
    if (!unites) rendreOffres();
  }

  function choisirOp(op) {
    if (state.op !== op) { state.code = ''; state.label = ''; state.court = ''; state.unites = 0; }
    state.op = op;
    content.dataset.op = op;
    var pref = PREFIXES[op];
    $('progReceveurHint').textContent = 'Numéro ' + NOM_OP[op] + ' (doit commencer par ' + pref + ')';
    $('progReceveur').placeholder = '+225 ' + pref + 'XXXXXXXX';
    setTab('appels');
    aller(2);
  }

  function choisirOffre(o, bouton) {
    state.code = o.code;
    state.unites = 0;
    state.label = (o.nom || '') + (o.desc ? ' — ' + String(o.desc).trim() : '');
    state.court = o.desc ? String(o.desc).trim() : (o.nom || '');
    $('progOffres').querySelectorAll('.prog-offre').forEach(function (x) { x.classList.remove('is-selected'); });
    bouton.classList.add('is-selected');
    setTimeout(function () { aller(3); }, 160);
  }

  function choisirUnites(m) {
    var montant = parseInt(String(m).replace(/\D/g, ''), 10);
    if (!montant || montant < 100 || montant > 100000) {
      return erreur('Montant d\'unités invalide (entre 100 et 100 000 F).', unitesInput);
    }
    state.unites = montant;
    state.code = 'unites_' + montant;
    state.label = 'Transfert d\'unités ' + montant.toLocaleString('fr-FR') + ' F';
    state.court = 'Unités ' + montant.toLocaleString('fr-FR') + ' F';
    aller(3);
  }

  function validerNumeros() {
    var payer = $('progPayer').value.trim();
    var receveur = $('progReceveur').value.trim();
    if (!telValide(payer)) return erreur('Numéro Wave invalide (ex: +2250700000000).', $('progPayer'));
    if (!receveur) return erreur('Entrez le numéro du receveur.', $('progReceveur'));
    if (typeof validerNumeroReceveur === 'function' && !validerNumeroReceveur(receveur, state.op)) {
      return erreur('Le numéro ' + NOM_OP[state.op] + ' doit commencer par ' + PREFIXES[state.op] + '.', $('progReceveur'));
    }
    aller(4);
  }

  function ouvrir() {
    lastFocus = document.activeElement;
    state = { step: 1, op: '', tab: 'appels', code: '', label: '', court: '', unites: 0 };
    content.dataset.op = '';
    $('progPayer').value = '';
    $('progReceveur').value = '';
    unitesInput.value = '';
    $('progRepeat').value = 'once';
    form.querySelectorAll('.prog-chip').forEach(function (c) { c.classList.remove('is-active'); });

    var btnUnites = $('btn-unites');
    $('progTabUnites').hidden = !(btnUnites && !btnUnites.hidden);

    var d = new Date(Date.now() + 60 * 60 * 1000);
    d.setMinutes(0, 0, 0);
    $('progDate').value = versInputLocal(d);
    $('progDate').min = versInputLocal(new Date());
    $('progDate').max = versInputLocal(new Date(Date.now() + MAX_ANNEES * 365.25 * 24 * 3600 * 1000));

    aller(1);
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
  }

  function fermer() {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function payerMaintenant() {
    var payer = $('progPayer').value.trim();
    var receveur = $('progReceveur').value.trim();
    var op = state.op;
    var code = state.code;
    var unites = state.unites;
    fermer();
    if (typeof window.ouvrirModal === 'function') {
      window.ouvrirModal(op, { payer: payer, receveur: receveur, forfaitCode: code, unitesMontant: unites || 0, directWave: true });
    }
  }

  /* Programmer = PAYER MAINTENANT par Wave ; l'agent exécutera à la date
     choisie (même dans 10 ans). L'enregistrement dans la liste se fait
     seulement quand le paiement est réellement validé (événement app.js). */
  function programmer() {
    var quand = new Date($('progDate').value);
    var repeat = $('progRepeat').value;
    if (isNaN(quand.getTime()) || quand.getTime() < Date.now() + 60 * 1000) {
      return erreur('Choisissez une date et une heure dans le futur.', $('progDate'));
    }
    if (quand.getTime() > Date.now() + MAX_ANNEES * 365.25 * 24 * 3600 * 1000) {
      return erreur('La date ne peut pas dépasser ' + MAX_ANNEES + ' ans.', $('progDate'));
    }
    if (charger().length >= MAX_PROGRAMMES) {
      return erreur('Maximum ' + MAX_PROGRAMMES + ' souscriptions programmées. Retirez-en une d\'abord.');
    }
    var op = state.op, code = state.code, unites = state.unites;
    var payer = $('progPayer').value.trim();
    var receveur = $('progReceveur').value.trim();
    fermer();
    if (typeof window.ouvrirModal === 'function') {
      window.ouvrirModal(op, {
        payer: payer,
        receveur: receveur,
        forfaitCode: code,
        unitesMontant: unites || 0,
        programmePour: quand.toISOString(),
        repeat: LIBELLE_REPETITION[repeat] ? repeat : 'once',
        directWave: true
      });
    }
  }

  /* Wave a été ouvert directement (sans second modal) : petit message de
     confirmation, puisque le formulaire de paiement reste invisible. */
  var toastTimer = null;
  document.addEventListener('mf:wave-direct', function (e) {
    var d = e.detail || {};
    if (!d.ok) return;
    var t = document.getElementById('progToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'progToast';
      t.className = 'prog-toast';
      t.setAttribute('role', 'status');
      t.setAttribute('aria-live', 'polite');
      document.body.appendChild(t);
    }
    t.textContent = '✅ Wave est ouvert. ' + (d.message || '');
    t.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('is-visible'); }, 7000);
  });

  /* Paiement validé par app.js : on garde la souscription dans la liste */
  document.addEventListener('mf:souscription-programmee', function (e) {
    var d = e.detail || {};
    if (!d.programmePour || isNaN(new Date(d.programmePour).getTime())) return;
    var arr = charger();
    var item = {
      id: 'pg-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      operateur: d.operateur,
      kind: d.unitesMontant ? 'unites' : 'forfait',
      forfaitCode: d.forfaitCode,
      forfaitLabel: d.forfaitLabel,
      payer: d.payer,
      receveur: d.receveur,
      next: new Date(d.programmePour).toISOString(),
      repeat: LIBELLE_REPETITION[d.repeat] ? d.repeat : 'once',
      payee: true,
      txId: d.transactionId,
      created: new Date().toISOString()
    };
    if (d.unitesMontant) item.unitesMontant = d.unitesMontant;
    arr.push(item);
    sauver(arr);
    rendre();
  });

  /* ---------- Liste + rappels ---------- */

  function bouton(texte, classe, onClick, label) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = classe;
    b.textContent = texte;
    if (label) b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
  }

  function libelleCourt(p) {
    return p.operateur + ' · ' + p.forfaitLabel + ' → ' + p.receveur;
  }

  function payer(p) {
    var arr = charger();
    var i = arr.findIndex(function (x) { return x.id === p.id; });
    if (i >= 0) {
      if (p.repeat === 'once') arr.splice(i, 1);
      else arr[i].next = prochaineFuture(p.next, p.repeat).toISOString();
      sauver(arr);
    }
    rendre();
    if (typeof window.ouvrirModal === 'function') {
      window.ouvrirModal(p.operateur, {
        payer: p.payer,
        receveur: p.receveur,
        forfaitCode: p.forfaitCode,
        unitesMontant: p.unitesMontant || 0,
        directWave: true
      });
    }
  }

  function supprimer(id) {
    sauver(charger().filter(function (x) { return x.id !== id; }));
    rendre();
  }

  function reporter(id) {
    var arr = charger();
    var p = arr.find(function (x) { return x.id === id; });
    if (p) { p.next = new Date(Date.now() + 60 * 60 * 1000).toISOString(); sauver(arr); }
    rendre();
  }

  /* Une souscription déjà payée dont la date est passée est « exécutée » :
     on la retire, ou (si répétée) on passe à l'échéance suivante, à payer. */
  function nettoyerPayees() {
    var arr = charger();
    var now = Date.now();
    var change = false;
    var res = [];
    arr.forEach(function (p) {
      if (p.payee && new Date(p.next).getTime() <= now) {
        change = true;
        if (p.repeat === 'once') return;
        p.next = prochaineFuture(p.next, p.repeat).toISOString();
        p.payee = false;
      }
      res.push(p);
    });
    if (change) sauver(res);
  }

  function rendre() {
    nettoyerPayees();
    var arr = charger().sort(function (a, b) { return new Date(a.next) - new Date(b.next); });
    var now = Date.now();
    var dues = arr.filter(function (p) { return new Date(p.next).getTime() <= now; });
    var futurs = arr.filter(function (p) { return new Date(p.next).getTime() > now; });

    countEl.hidden = !arr.length;
    countEl.textContent = String(arr.length);

    dueEl.replaceChildren();
    dueEl.hidden = !dues.length;
    dues.forEach(function (p) {
      var box = document.createElement('div');
      box.className = 'prog-due-item';
      box.dataset.op = p.operateur;
      var t = document.createElement('p');
      t.className = 'prog-due-text';
      var strong = document.createElement('strong');
      strong.textContent = '⏰ C\'est l\'heure de votre souscription';
      t.appendChild(strong);
      t.appendChild(document.createElement('br'));
      t.appendChild(document.createTextNode(libelleCourt(p)));
      var actions = document.createElement('div');
      actions.className = 'prog-actions';
      actions.appendChild(bouton('💳 Payer maintenant', 'prog-btn prog-btn-go', function () { payer(p); }));
      actions.appendChild(bouton('Dans 1 h', 'prog-btn', function () { reporter(p.id); }));
      actions.appendChild(bouton('Annuler', 'prog-btn prog-btn-del', function () { supprimer(p.id); }));
      box.appendChild(t);
      box.appendChild(actions);
      dueEl.appendChild(box);
    });

    listEl.replaceChildren();
    listEl.hidden = !futurs.length;
    futurs.forEach(function (p) {
      var li = document.createElement('li');
      li.className = 'prog-item';
      li.dataset.op = p.operateur;
      var info = document.createElement('div');
      info.className = 'prog-info';
      var l1 = document.createElement('div');
      l1.className = 'prog-l1';
      l1.textContent = libelleCourt(p);
      var l2 = document.createElement('div');
      l2.className = 'prog-l2';
      l2.textContent = '📅 ' + formaterDate(p.next) + ' · ' + LIBELLE_REPETITION[p.repeat];
      info.appendChild(l1);
      info.appendChild(l2);
      if (p.payee) {
        var ok = document.createElement('span');
        ok.className = 'prog-badge-paye';
        ok.textContent = '✅ Payée · exécution à cette date';
        info.appendChild(ok);
      }
      li.appendChild(info);
      li.appendChild(bouton('✖', 'prog-btn prog-btn-del prog-x', function () {
        if (p.payee && !window.confirm('Retirer de la liste ? Le paiement déjà effectué n\'est pas annulé : contactez-nous pour toute modification.')) return;
        supprimer(p.id);
      },
        'Supprimer la souscription programmée ' + libelleCourt(p)));
      listEl.appendChild(li);
    });
  }

  /* ---------- Événements ---------- */

  openBtn.addEventListener('click', ouvrir);
  $('progCancel').addEventListener('click', fermer);
  $('progClose').addEventListener('click', fermer);
  $('progBack').addEventListener('click', function () { if (state.step > 1) aller(state.step - 1); });
  modal.addEventListener('click', function (e) { if (e.target === modal) fermer(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) fermer();
  });
  form.addEventListener('submit', function (e) { e.preventDefault(); });

  form.querySelectorAll('.prog-op').forEach(function (b) {
    b.addEventListener('click', function () { choisirOp(b.dataset.op); });
  });
  form.querySelectorAll('.prog-tab').forEach(function (t) {
    t.addEventListener('click', function () { setTab(t.dataset.tab); });
  });
  form.querySelectorAll('.prog-chip').forEach(function (c) {
    c.addEventListener('click', function () {
      form.querySelectorAll('.prog-chip').forEach(function (x) { x.classList.toggle('is-active', x === c); });
      unitesInput.value = c.dataset.montant;
      choisirUnites(c.dataset.montant);
    });
  });
  $('progUnitesOk').addEventListener('click', function () { choisirUnites(unitesInput.value); });
  unitesInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); choisirUnites(unitesInput.value); } });
  $('progNumerosOk').addEventListener('click', validerNumeros);
  [$('progPayer'), $('progReceveur')].forEach(function (i) {
    i.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); validerNumeros(); } });
  });
  $('progPayNow').addEventListener('click', payerMaintenant);
  $('progSchedule').addEventListener('click', programmer);

  rendre();
  setInterval(rendre, CHECK_EVERY_MS);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) rendre(); });
})();
