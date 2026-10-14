/**
 * services.js — Dépôt Mobile Money & Recharge fibre (dashboard.html)
 * ===================================================================
 * Flux (même logique que les forfaits et le transfert d'unités) :
 *   1. le client choisit un service + un opérateur (tuiles),
 *   2. il saisit le numéro, choisit un montant et indique son numéro Wave,
 *   3. la demande est enregistrée dans Supabase (statut « pending »),
 *   4. SEULEMENT si la base l'a acceptée, Wave s'ouvre pour le paiement.
 *      Si l'enregistrement échoue, Wave n'est PAS ouvert : le client ne
 *      peut pas payer une demande que l'agent ne verra jamais.
 *   5. un agent traite la demande et la confirme depuis son espace.
 *
 * Dépend de js/app.js (pont window.MonForfaitCore) et de js/forfaits.js
 * (validerNumeroReceveur / OPERATOR_PREFIXES). Fichier externe : la CSP
 * du site interdit les <script> inline.
 *
 * Codes enregistrés dans transactions.forfait_code :
 *   depot_orange | depot_mtn | depot_moov
 *   fibre_orange | fibre_mtn | fibre_moov
 * Libellés : « Dépôt Orange Money 5 000 F », « Recharge fibre MTN 15 000 F ».
 * Le prix enregistré est le montant choisi (aucun frais ajouté ici).
 */
(function () {
  'use strict';

  /* Montants proposés (maquette). Pour en changer, modifier ces listes. */
  var MONTANTS = {
    depot: [1000, 5000, 10000, 20000],
    fibre: [10000, 15000, 25000, 35000]
  };

  /* Noms affichés ; la clé est la valeur stockée dans « operateur »
     (même casse que le reste du site : MTN / Orange / MOOV). */
  var NOM_OP = { MTN: 'MTN', Orange: 'Orange', MOOV: 'Moov' };

  var RE_NUMERO = /^\+?\d{8,15}$/;

  function fmt(n) {
    return Number(n).toLocaleString('fr-FR') + '\u00a0F';
  }

  function sansEspaces(v) {
    return String(v || '').replace(/\s+/g, '');
  }

  function prefixe(op) {
    return typeof OPERATOR_PREFIXES !== 'undefined' &&
      OPERATOR_PREFIXES[op] && OPERATOR_PREFIXES[op][0]
      ? OPERATOR_PREFIXES[op][0]
      : '';
  }

  document.addEventListener('DOMContentLoaded', function () {

    var $ = function (id) { return document.getElementById(id); };

    var panel   = $('svcPanel');
    var form    = $('svcForm');
    if (!panel || !form) return;

    var titre    = $('svcTitre');
    var numLabel = $('svcNumLabel');
    var num      = $('svcNum');
    var numHint  = $('svcNumHint');
    var chipsBox = $('svcChips');
    var payer    = $('svcPayer');
    var msg      = $('svcMsg');
    var go       = $('svcGo');
    var tiles    = Array.prototype.slice.call(document.querySelectorAll('.svc-tile'));

    var cur = null;       /* { kind: 'depot'|'fibre', op: 'MTN'|'Orange'|'MOOV' } */
    var montant = null;   /* montant choisi (FCFA) */
    var occupe = false;   /* évite le double envoi */

    function afficher(texte, etat) {
      msg.className = 'svc-msg' + (etat ? ' is-' + etat : '');
      msg.textContent = texte || '';
    }

    function construireMontants(kind) {
      chipsBox.replaceChildren();
      montant = null;
      MONTANTS[kind].forEach(function (m) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'svc-chip';
        b.textContent = fmt(m);
        b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', function () {
          montant = m;
          Array.prototype.forEach.call(chipsBox.children, function (c) {
            c.setAttribute('aria-pressed', c === b ? 'true' : 'false');
          });
          afficher('');
        });
        chipsBox.appendChild(b);
      });
    }

    function selectionner(tile, auClavier) {
      var meme = cur && cur.kind === tile.dataset.kind && cur.op === tile.dataset.op;

      cur = { kind: tile.dataset.kind, op: tile.dataset.op };
      var nom = NOM_OP[cur.op] || cur.op;
      var pref = prefixe(cur.op);

      tiles.forEach(function (t) {
        t.setAttribute('aria-pressed', t === tile ? 'true' : 'false');
      });

      panel.dataset.op = cur.op;

      if (cur.kind === 'depot') {
        titre.textContent = 'Dépôt ' + nom + ' Money';
        numLabel.textContent = 'Numéro à créditer';
        numHint.textContent = pref ? 'Numéro ' + nom + ' : doit commencer par ' + pref : '';
        num.placeholder = pref ? '+225 ' + pref + 'XXXXXXXX' : '+225XXXXXXXXXX';
      } else {
        titre.textContent = 'Recharge fibre ' + nom;
        numLabel.textContent = 'Numéro de la ligne fibre';
        numHint.textContent = 'Le numéro de l\'abonnement fibre à recharger.';
        num.placeholder = 'Numéro de ligne fibre';
      }

      if (!meme) {
        num.value = '';
        construireMontants(cur.kind);
      }
      afficher('');
      panel.hidden = false;

      try {
        panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } catch (e) { /* anciens navigateurs */ }
      if (auClavier) num.focus({ preventScroll: true });
    }

    tiles.forEach(function (t) {
      t.addEventListener('click', function (e) {
        /* e.detail === 0 : activation au clavier -> on place le focus */
        selectionner(t, e.detail === 0);
      });
    });

    /* Renvoie { numero, payeur } si tout est valide, sinon affiche l'erreur. */
    function valider() {
      var nom = NOM_OP[cur.op] || cur.op;
      var numero = sansEspaces(num.value);
      var payeur = sansEspaces(payer.value);

      if (!RE_NUMERO.test(numero)) {
        afficher(
          cur.kind === 'depot'
            ? 'Entrez un numéro valide (chiffres uniquement, ex : +225 ' + (prefixe(cur.op) || '07') + 'XXXXXXXX).'
            : 'Entrez le numéro de la ligne fibre (chiffres uniquement).',
          'error'
        );
        num.focus();
        return null;
      }

      if (
        cur.kind === 'depot' &&
        typeof validerNumeroReceveur === 'function' &&
        !validerNumeroReceveur(numero, cur.op)
      ) {
        var p = prefixe(cur.op);
        afficher(
          'Le numéro ' + nom + ' doit commencer par ' + p + ' (ex : +225 ' + p + 'XXXXXXXX).',
          'error'
        );
        num.focus();
        return null;
      }

      if (!montant) {
        afficher('Choisissez un montant.', 'error');
        if (chipsBox.firstChild) chipsBox.firstChild.focus();
        return null;
      }

      if (!RE_NUMERO.test(payeur)) {
        afficher('Numéro Wave du payeur invalide (ex : +225XXXXXXXXXX).', 'error');
        payer.focus();
        return null;
      }

      return { numero: numero, payeur: payeur };
    }

    function afficherSucces(ref, urlWave, popupBloque) {
      msg.className = 'svc-msg is-ok';
      msg.textContent = 'Demande enregistrée ! Ref : ' + ref + '. Confirmation après validation.';
      if (popupBloque) {
        /* Le navigateur a bloqué l'ouverture de Wave : lien à cliquer. */
        msg.appendChild(document.createTextNode(' '));
        var a = document.createElement('a');
        a.href = urlWave;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = 'Ouvrir Wave pour payer';
        msg.appendChild(a);
      }
    }

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (occupe || !cur) return;

      var core = window.MonForfaitCore;
      if (!core) {
        afficher('Service momentanément indisponible. Rechargez la page et réessayez.', 'error');
        return;
      }

      var champs = valider();
      if (!champs) return;

      occupe = true;
      go.disabled = true;

      /* Onglet ouvert tout de suite (clic) : après un await, les
         navigateurs bloqueraient la fenêtre. */
      var waveTab = window.open('', '_blank');
      if (waveTab) {
        try { waveTab.opener = null; } catch (err) { /* ignoré */ }
      }

      afficher('Enregistrement de votre demande…', '');

      var nom = NOM_OP[cur.op] || cur.op;
      var prix = montant;
      var tx = core.buildPayload({
        operateur: cur.op,
        payer: champs.payeur,
        receveur: champs.numero,
        forfaitCode: cur.kind + '_' + cur.op.toLowerCase(),
        forfaitLabel: (cur.kind === 'depot'
          ? 'Dépôt ' + nom + ' Money '
          : 'Recharge fibre ' + nom + ' ') + fmt(prix),
        prix: prix,
        meta: {}
      });

      var ok = false;
      try {
        ok = await core.envoyerTransaction(tx);
      } catch (err) {
        ok = false;
      }

      if (!ok) {
        if (waveTab) waveTab.close();
        afficher(
          'Votre demande n\'a pas pu être enregistrée. Aucun paiement n\'a été lancé : ' +
          'réessayez dans un instant ou contactez-nous sur WhatsApp.',
          'error'
        );
        occupe = false;
        go.disabled = false;
        return;
      }

      core.ajouterHistoriqueLocal(tx);

      var urlWave = core.waveUrl(prix);
      var popupBloque = !waveTab;
      if (waveTab) {
        waveTab.location.href = urlWave;
      }
      afficherSucces(tx.transactionId, urlWave, popupBloque);

      /* On efface le montant : pas de second paiement par réflexe. */
      montant = null;
      Array.prototype.forEach.call(chipsBox.children, function (c) {
        c.setAttribute('aria-pressed', 'false');
      });

      setTimeout(function () {
        occupe = false;
        go.disabled = false;
      }, 1500);
    });
  });
})();
