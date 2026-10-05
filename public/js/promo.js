/**
 * promo.js — Page d'annonce « Offre fidélité » (-10 % pendant 3 jours)
 * =============================================================
 * - S'affiche une fois par session, dès l'entrée sur dashboard.html.
 * - Les règles (200 F : 4 achats / 500 F : 3 achats / 1 000 F : 2 achats,
 *   -10 %, 3 jours) sont LUES EN BASE (table bonus_rules). Si vous
 *   changez une règle dans Supabase, l'annonce se met à jour toute seule.
 * - Si la migration 006 n'est pas exécutée (colonnes absentes) ou si
 *   l'offre est désactivée, rien ne s'affiche : on n'annonce jamais une
 *   offre que le serveur n'appliquera pas.
 * - Aucun innerHTML, aucun script inline (compatible avec la CSP du site).
 */
(function () {
  'use strict';

  var SEEN_KEY = 'mf_promo_vu';

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function formaterPrix(n) {
    return Number(n).toLocaleString('fr-FR') + '\u00a0F';
  }

  /* ---------- Lecture des règles + du taux de commission ---------- */

  async function chargerOffre() {
    var sb = window.supabaseClient;
    if (!sb) return null;

    var res = await Promise.all([
      sb.from('bonus_rules')
        .select('prix_base, achats_requis, reduction_pct, validite_jours')
        .eq('active', true)
        .order('prix_base', { ascending: true }),
      sb.from('app_settings')
        .select('value')
        .eq('key', 'commission_rate')
        .maybeSingle()
    ]);

    var rules = res[0];
    var rate = res[1];

    if (rules.error || !rules.data || !rules.data.length) return null;

    var taux = parseFloat(rate && rate.data && rate.data.value);
    if (!isFinite(taux) || taux <= 0) {
      taux = (typeof COMMISSION_RATE === 'number') ? COMMISSION_RATE : 1.10;
    }

    return rules.data.map(function (r) {
      return {
        /* Les clients voient les prix AVEC commission : on annonce donc
           220 F / 550 F (et non 200 / 500) pour que ça corresponde aux
           cartes de forfaits. */
        prixAffiche: Math.round(Number(r.prix_base) * taux),
        requis: Number(r.achats_requis),
        reduction: Number(r.reduction_pct),
        jours: Number(r.validite_jours)
      };
    });
  }

  /* ---------- Phrase d'une règle ---------- */

  function construireRegle(rule, compact) {
    var li = el('li', 'promo-rule');
    var n = rule.requis;

    li.appendChild(document.createTextNode(
      'Après ' + n + (n > 1 ? ' souscriptions' : ' souscription') + ' de '
    ));
    li.appendChild(el('strong', null, formaterPrix(rule.prixAffiche)));
    li.appendChild(document.createTextNode(' : '));
    li.appendChild(el('span', 'promo-free', '−' + rule.reduction + ' % 🎁'));
    li.appendChild(document.createTextNode(
      ' pendant ' + rule.jours + (rule.jours > 1 ? ' jours' : ' jour')
    ));

    return li;
  }

  function construireListe(regles) {
    var ul = el('ul', 'promo-rules');
    regles.forEach(function (r) { ul.appendChild(construireRegle(r)); });
    return ul;
  }

  /* ---------- Page d'annonce plein écran ---------- */

  var overlay = null;
  var lastFocus = null;

  function fermer() {
    if (!overlay) return;
    overlay.hidden = true;
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    try { sessionStorage.setItem(SEEN_KEY, '1'); } catch (e) {}
    if (lastFocus && typeof lastFocus.focus === 'function') {
      try { lastFocus.focus(); } catch (e) {}
    }
  }

  function onKey(e) {
    if (e.key === 'Escape') { fermer(); return; }

    /* Garde le focus dans la fenêtre d'annonce */
    if (e.key === 'Tab' && overlay) {
      var f = overlay.querySelectorAll('button');
      if (!f.length) return;
      var first = f[0];
      var last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    }
  }

  function allerAuxOperateurs() {
    fermer();
    var cible = document.querySelector('.op-btn');
    var bloc = document.querySelector('.operators');
    if (bloc && bloc.scrollIntoView) bloc.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (cible) cible.focus({ preventScroll: true });
  }

  function construireOverlay(regles) {
    var ov = el('div', 'promo-overlay');
    ov.id = 'promoOverlay';
    ov.hidden = true;

    var card = el('div', 'promo-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'promoTitle');

    var close = el('button', 'promo-close', '✖');
    close.type = 'button';
    close.setAttribute('aria-label', 'Fermer l\'annonce');
    close.addEventListener('click', fermer);

    var titre = el('h2', 'promo-title', 'Offre fidélité : −10 % sur votre prochain forfait !');
    titre.id = 'promoTitle';

    var note = el('p', 'promo-note',
      'Les souscriptions sont comptées à partir de votre numéro Wave (payeur), ' +
      'une fois confirmées. La réduction s\'applique à votre prochain forfait de ' +
      'la même tranche de prix et reste valable quelques jours : ' +
      'pensez à en profiter ! Pas besoin de compte.');

    var actions = el('div', 'promo-actions');

    var cta = el('button', 'promo-cta', 'J\'en profite');
    cta.type = 'button';
    cta.addEventListener('click', allerAuxOperateurs);

    var later = el('button', 'promo-later', 'Plus tard');
    later.type = 'button';
    later.addEventListener('click', fermer);

    actions.appendChild(cta);
    actions.appendChild(later);

    card.appendChild(close);
    card.appendChild(el('div', 'promo-gift', '🎁'));
    card.appendChild(titre);
    card.appendChild(el('p', 'promo-sub', 'Plus vous achetez, plus vous gagnez.'));
    card.appendChild(construireListe(regles));
    card.appendChild(note);
    card.appendChild(actions);

    ov.appendChild(card);

    /* Clic sur le fond sombre = fermer */
    ov.addEventListener('click', function (e) { if (e.target === ov) fermer(); });

    document.body.appendChild(ov);
    return ov;
  }

  function ouvrir() {
    if (!overlay) return;
    lastFocus = document.activeElement;
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    var cta = overlay.querySelector('.promo-cta');
    if (cta) cta.focus();
  }

  /* ---------- Rappel permanent dans « Actualités & Promotions » ---------- */

  function remplirRappel(regles) {
    var zone = document.getElementById('promoInline');
    if (!zone) return;

    zone.replaceChildren();
    zone.appendChild(construireListe(regles));

    var btn = el('button', 'promo-inline-btn', '🎁 Voir l\'offre fidélité');
    btn.type = 'button';
    btn.addEventListener('click', ouvrir);
    zone.appendChild(btn);

    zone.hidden = false;
  }

  /* ---------- Démarrage ---------- */

  async function init() {
    var regles;

    try {
      regles = await chargerOffre();
    } catch (err) {
      console.warn('[MonForfait] Offre fidélité indisponible :', err);
      return;
    }

    if (!regles || !regles.length) return;

    overlay = construireOverlay(regles);
    remplirRappel(regles);

    var dejaVu = false;
    try { dejaVu = sessionStorage.getItem(SEEN_KEY) === '1'; } catch (e) {}

    if (!dejaVu) ouvrir();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
