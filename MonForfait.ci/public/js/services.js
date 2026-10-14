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
 *
 * Frais de service : gérés par la base (app_settings) :
 *   - taux_commission_depot
 *   - taux_commission_fibre
 * Le client paie montant × taux (arrondi). Le montant crédité reste celui choisi.
 * Validation serveur : trigger BEFORE INSERT (006_validation_depot_fibre.sql).
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

  /* Taux de commission lus depuis app_settings (fallback 1.06 = 6 %). */
  var tauxDepot = null;
  var tauxFibre = null;
  var TAUX_DEFAUT = 1.06;

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

  function tauxPour(kind) {
    if (kind === 'depot') {
      return (typeof tauxDepot === 'number' && tauxDepot > 0) ? tauxDepot : TAUX_DEFAUT;
    }
    if (kind === 'fibre') {
      return (typeof tauxFibre === 'number' && tauxFibre > 0) ? tauxFibre : TAUX_DEFAUT;
    }
    return TAUX_DEFAUT;
  }

  function prixAvecFrais(montant, kind) {
    return Math.round(Number(montant) * tauxPour(kind));
  }

  async function chargerTauxCommissionServices() {
    if (!window.supabaseClient) {
      console.warn('[MonForfait] Supabase indisponible pour les taux dépôt/fibre.');
      return;
    }

    try {
      var { data, error } = await window.supabaseClient
        .from('app_settings')
        .select('key, value')
        .in('key', ['taux_commission_depot', 'taux_commission_fibre']);

      if (error) throw error;

      if (data && data.length) {
        data.forEach(function (row) {
          var t = parseFloat(row.value);
          if (!Number.isFinite(t) || t <= 0) return;
          if (row.key === 'taux_commission_depot') tauxDepot = t;
          if (row.key === 'taux_commission_fibre') tauxFibre = t;
        });
      }

      console.log(
        '[MonForfait] Taux services — dépôt:',
        tauxDepot || TAUX_DEFAUT,
        '| fibre:',
        tauxFibre || TAUX_DEFAUT
      );
    } catch (err) {
      console.warn(
        '[MonForfait] Taux commission dépôt/fibre indisponibles, fallback 6 % :',
        err
      );
    }
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

    /* Zone d'affichage du total (créée dynamiquement si absente). */
    var totalEl = $('svcTotal');
    if (!totalEl) {
      totalEl = document.createElement('p');
      totalEl.id = 'svcTotal';
      totalEl.className = 'svc-total';
      totalEl.hidden = true;
      if (msg && msg.parentNode) {
        msg.parentNode.insertBefore(totalEl, msg);
      } else {
        form.appendChild(totalEl);
      }
    }

    var cur = null;       /* { kind: 'depot'|'fibre', op: 'MTN'|'Orange'|'MOOV' } */
    var montant = null;   /* montant choisi (FCFA) — montant crédité */
    var occupe = false;   /* évite le double envoi */

    function afficher(texte, etat) {
      msg.className = 'svc-msg' + (etat ? ' is-' + etat : '');
      msg.textContent = texte || '';
    }

    function afficherTotal() {
      if (!cur || montant == null) {
        totalEl.hidden = true;
        totalEl.textContent = '';
        return;
      }
      var prix = prixAvecFrais(montant, cur.kind);
      totalEl.hidden = false;
      totalEl.textContent =
        'Vous payez ' + fmt(prix) +
        ' (frais de service inclus). ' +
        (cur.kind === 'depot'
          ? 'Le destinataire reçoit ' + fmt(montant) + '.'
          : 'La ligne est rechargée de ' + fmt(montant) + '.');
    }

    function construireMontants(kind) {
      chipsBox.replaceChildren();
      montant = null;
      totalEl.hidden = true;
      totalEl.textContent = '';

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
          afficherTotal();
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
        selectionner(t, e.detail === 0);
      });
    });

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

      /* Recharge les taux au moment du paiement (au cas où ils ont changé). */
      await chargerTauxCommissionServices();

      /* Onglet ouvert tout de suite (clic) : après un await, les
         navigateurs bloqueraient la fenêtre. */
      var waveTab = window.open('', '_blank');
      if (waveTab) {
        try { waveTab.opener = null; } catch (err) { /* ignoré */ }
      }

      afficher('Enregistrement de votre demande…', '');

      var nom = NOM_OP[cur.op] || cur.op;
      var montantBase = montant;
      var prix = prixAvecFrais(montantBase, cur.kind);

      var tx = core.buildPayload({
        operateur: cur.op,
        payer: champs.payeur,
        receveur: champs.numero,
        forfaitCode: cur.kind + '_' + cur.op.toLowerCase(),
        forfaitLabel: (cur.kind === 'depot'
          ? 'Dépôt ' + nom + ' Money '
          : 'Recharge fibre ' + nom + ' ') + fmt(montantBase),
        prix: prix,
        meta: {
          montant_base: montantBase,
          taux_applique: tauxPour(cur.kind)
        }
      });

      var envoi = { ok: false, message: '' };
      try {
        /* Préfère la version détaillée pour afficher le message serveur (22023). */
        if (typeof core.envoyerTransactionDetail === 'function') {
          envoi = await core.envoyerTransactionDetail(tx);
        } else {
          envoi.ok = await core.envoyerTransaction(tx);
        }
      } catch (err) {
        envoi = { ok: false, message: '' };
      }

      if (!envoi.ok) {
        if (waveTab) waveTab.close();
        afficher(
          envoi.message ||
          ('Votre demande n\'a pas pu être enregistrée. Aucun paiement n\'a été lancé : ' +
           'réessayez dans un instant ou contactez-nous sur WhatsApp.'),
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
      totalEl.hidden = true;
      totalEl.textContent = '';
      Array.prototype.forEach.call(chipsBox.children, function (c) {
        c.setAttribute('aria-pressed', 'false');
      });

      setTimeout(function () {
        occupe = false;
        go.disabled = false;
      }, 1500);
    });

    /* Charge les taux dès l'ouverture de la page. */
    chargerTauxCommissionServices();
  });
})();
