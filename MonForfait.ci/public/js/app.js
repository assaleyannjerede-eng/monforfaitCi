/**
 * app.js - Logique principale de MonForfait.ci
 * ===============================================
 * Fonctionnalités :
 * - Modal forfait par opérateur
 * - Forfaits dynamiques depuis forfaits.js
 * - Validation numéro receveur selon opérateur 07/05/01
 * - Prix x1.10
 * - Historique localStorage
 * - Supabase pour les transactions
 * - Authentification Supabase
 * - hCaptcha sur connexion et inscription
 * - Administration
 */

document.addEventListener('DOMContentLoaded', () => {

  /* =====================================================
     THEMES VISUELS PAR OPERATEUR
     ===================================================== */

  const OPERATOR_THEMES = {
    Orange: {
      accent: '#ff6b00',
      accentStrong: '#ff8f3a',
      accentSoft: 'rgba(255,107,0,0.12)',
      panelBg: 'rgba(255,255,255,0.02)',
      modalBg:
        'linear-gradient(180deg, rgba(255,107,0,0.06), rgba(7,16,40,0.0))'
    },

    MTN: {
      accent: '#ffd400',
      accentStrong: '#ffea66',
      accentSoft: 'rgba(255,212,0,0.12)',
      panelBg: 'rgba(255,255,255,0.02)',
      modalBg:
        'linear-gradient(180deg, rgba(255,212,0,0.06), rgba(7,16,40,0.0))'
    },

    MOOV: {
      accent: '#00b894',
      accentStrong: '#33d6a6',
      accentSoft: 'rgba(0,184,148,0.12)',
      panelBg: 'rgba(255,255,255,0.02)',
      modalBg:
        'linear-gradient(180deg, rgba(0,184,148,0.06), rgba(7,16,40,0.0))'
    }
  };

  function applyOperatorTheme(op) {
    const theme =
      OPERATOR_THEMES[op] || OPERATOR_THEMES.MTN;

    const mc = document.querySelector('.modal-content');

    if (mc) {
      mc.style.setProperty('--accent', theme.accent);
      mc.style.setProperty('--accent-strong', theme.accentStrong);
      mc.style.setProperty('--accent-soft', theme.accentSoft);
      mc.style.setProperty('--panel-bg', theme.panelBg);
      mc.style.setProperty('--modal-bg', theme.modalBg);
    }

    const footer = document.querySelector('.site-footer');

    if (footer) {
      footer.style.borderTopColor = theme.accent;
    }

    document.querySelectorAll('.forfait-name').forEach(el => {
      el.style.color = theme.accent;
    });

    document.querySelectorAll('.btn-primary').forEach(el => {
      el.style.background =
        `linear-gradient(90deg,${theme.accent},${theme.accentStrong})`;
    });
  }

  /* =====================================================
     SELECTEURS DOM
     ===================================================== */

  const modal = document.getElementById('modal');

  const btnAppels =
    document.getElementById('btn-appels');

  const btnInternet =
    document.getElementById('btn-internet');

  const panelAppels =
    document.getElementById('panel-appels');

  const panelInternet =
    document.getElementById('panel-internet');

  const closeModalBtn =
    document.getElementById('closeModal');

  const cancelModalBtn =
    document.getElementById('cancelModal');

  const paymentForm =
    document.getElementById('paymentForm');

  const payerNumero =
    document.getElementById('payerNumero');

  const receveurNumero =
    document.getElementById('receveurNumero');

  const formMessage =
    document.getElementById('formMessage');

  const historiqueContainer =
    document.querySelector('.historique-list');

  let currentOperateur = 'MTN';
  let lastFocused = null;

  /* =====================================================
     CLE LOCALSTORAGE PAR UTILISATEUR
     ===================================================== */

  function getHistoryStorageKey() {

    const stored =
      sessionStorage.getItem('mf_session');

    if (!stored) {
      return 'monforfait_historique_guest';
    }

    try {

      const user = JSON.parse(stored);

      if (user && user.uid) {
        return 'monforfait_historique_' + user.uid;
      }

    } catch (err) {
      console.warn('Session error', err);
    }

    return 'monforfait_historique_guest';
  }

  function isUserConnected() {

    const stored =
      sessionStorage.getItem('mf_session');

    if (!stored) return false;

    try {

      const u = JSON.parse(stored);

      return !!(u && u.uid);

    } catch {
      return false;
    }
  }

  /* =====================================================
     PURGE AUTOMATIQUE DES TRANSACTIONS ANCIENNES
     ===================================================== */

  const KEEP_MS =
    7 * 24 * 60 * 60 * 1000;

  function loadAndPruneHistory() {

    try {

      const raw =
        localStorage.getItem(getHistoryStorageKey());

      if (!raw) return [];

      const arr = JSON.parse(raw);

      const now = Date.now();

      const pruned = arr.filter(item => {

        if (!item) return false;

        const t =
          item.date
            ? Date.parse(item.date)
            : NaN;

        return (
          !isNaN(t) &&
          now - t <= KEEP_MS
        );
      });

      if (pruned.length !== arr.length) {

        localStorage.setItem(
          getHistoryStorageKey(),
          JSON.stringify(pruned)
        );
      }

      return pruned;

    } catch (e) {

      localStorage.removeItem(
        getHistoryStorageKey()
      );

      return [];
    }
  }

  function startPeriodicPurge() {

    setInterval(() => {

      historique =
        loadAndPruneHistory();

      afficherHistorique();

    }, 60 * 60 * 1000);
  }

  let historique =
    loadAndPruneHistory();

  /* =====================================================
     UTILITAIRES
     ===================================================== */

  function isValidPhone(v) {

    return /^\+?\d{8,15}$/.test(
      (v || '').trim()
    );
  }

  function disableForm(disabled) {

    const b =
      paymentForm &&
      paymentForm.querySelector(
        'button[type="submit"]'
      );

    if (b) b.disabled = disabled;
  }

  function makeSpan(text, style) {

    const span =
      document.createElement('span');

    if (style) {
      span.style.cssText = style;
    }

    span.textContent = text;

    return span;
  }

  /* =====================================================
     PRIX DEPUIS LA BASE DE DONNEES (SUPABASE)
     -----------------------------------------------------
     La table public.forfaits + app_settings.commission_rate
     sont la source de verite. forfaits.js ne sert plus que
     de secours d'affichage si la base est injoignable.
     ===================================================== */

  let commissionRateDb = null;

  function prixAvecCommission(prixBase) {

    const taux =
      commissionRateDb ||
      (typeof COMMISSION_RATE === 'number'
        ? COMMISSION_RATE
        : 1.10);

    return Math.round(prixBase * taux);
  }

  async function chargerTauxCommission() {

    try {

      const { data, error } =
        await window.supabaseClient
          .from('app_settings')
          .select('value')
          .eq('key', 'commission_rate')
          .maybeSingle();

      if (error) throw error;

      const taux = parseFloat(data?.value);

      if (Number.isFinite(taux) && taux > 0) {
        commissionRateDb = taux;
      }

    } catch (err) {

      console.warn(
        '[MonForfait] Taux de commission BDD indisponible, taux par defaut utilise :',
        err
      );
    }
  }

  /* Charge tout le catalogue actif au demarrage de la page
     et remplace FORFAITS_DATA en memoire (affichage). */
  async function chargerCatalogueDepuisBDD() {

    if (
      !window.supabaseClient ||
      typeof FORFAITS_DATA === 'undefined'
    ) {
      return false;
    }

    try {

      await chargerTauxCommission();

      const { data, error } =
        await window.supabaseClient
          .from('forfaits')
          .select(
            'code, operateur, categorie, nom, description, prix'
          )
          .eq('active', true)
          .order('prix', { ascending: true })
          .order('code', { ascending: true });

      if (error) throw error;

      if (!data || !data.length) return false;

      const neuf = {};

      data.forEach(f => {

        neuf[f.operateur] =
          neuf[f.operateur] || {};

        neuf[f.operateur][f.categorie] =
          neuf[f.operateur][f.categorie] || [];

        neuf[f.operateur][f.categorie].push({
          code: f.code,
          nom: f.nom,
          desc: f.description || '',
          prix: Number(f.prix)
        });
      });

      Object.keys(FORFAITS_DATA).forEach(
        k => delete FORFAITS_DATA[k]
      );

      Object.assign(FORFAITS_DATA, neuf);

      console.log(
        '[MonForfait] Catalogue charge depuis Supabase :',
        data.length + ' forfaits.'
      );

      return true;

    } catch (err) {

      console.warn(
        '[MonForfait] Catalogue BDD indisponible, forfaits.js utilise :',
        err
      );

      return false;
    }
  }

  /* Prix officiel d'UN forfait, relu en base au moment de payer. */
  async function obtenirPrixOfficiel(forfaitCode) {

    if (!window.supabaseClient) {
      throw new Error('Supabase indisponible.');
    }

    await chargerTauxCommission();

    const { data, error } =
      await window.supabaseClient
        .from('forfaits')
        .select('code, operateur, nom, prix')
        .eq('code', forfaitCode)
        .eq('active', true)
        .maybeSingle();

    if (error) throw error;

    if (!data) {
      throw new Error('Forfait introuvable ou desactive.');
    }

    return {
      operateur: data.operateur,
      nom: data.nom,
      prix: prixAvecCommission(Number(data.prix))
    };
  }

  /* =====================================================
     OUTILS : format des prix + recherche d'une offre
     ===================================================== */

  function formaterPrix(n) {
    return Number(n).toLocaleString('fr-FR') + '\u00a0F';
  }

  /* Retrouve une offre du catalogue (base ou forfaits.js) par son code.
     Renvoie null si elle n'existe plus (forfait retiré, etc.). */
  function trouverOffre(operateur, code) {

    if (typeof getForfaits !== 'function') return null;

    for (const cat of ['appels', 'internet']) {

      const offre =
        getForfaits(operateur, cat)
          .find(f => f.code === code);

      if (offre) return { offre, categorie: cat };
    }

    return null;
  }

  /* =====================================================
     GENERATION DYNAMIQUE DES FORFAITS
     ===================================================== */

  function construireForfaits(
    container,
    operateur,
    categorie
  ) {

    container.replaceChildren();

    if (typeof getForfaits !== 'function') {

      const p =
        document.createElement('p');

      p.style.color = '#f87171';

      p.textContent =
        'Erreur : forfaits.js non chargé.';

      container.appendChild(p);

      return;
    }

    /* Offres rangées du moins cher au plus cher */
    const offres =
      getForfaits(
        operateur,
        categorie
      )
        .slice()
        .sort((a, b) => a.prix - b.prix);

    if (!offres.length) {

      const p =
        document.createElement('p');

      p.style.cssText =
        'color:#9aa6b2;padding:8px';

      p.textContent =
        'Aucune offre disponible.';

      container.appendChild(p);

      return;
    }

    offres.forEach(offre => {

      const prixFinal =
        prixAvecCommission(
          offre.prix
        );

      const label =
        document.createElement('label');

      label.className =
        'forfait-card';

      const input =
        document.createElement('input');

      input.type = 'radio';
      input.name = 'forfait';
      input.value = offre.code;

      input.dataset.prix =
        prixFinal;

      input.dataset.label =
        offre.nom;

      const info =
        document.createElement('div');

      info.className =
        'forfait-info';

      const nameEl =
        document.createElement('div');

      nameEl.className =
        'forfait-name';

      nameEl.textContent =
        offre.nom;

      const descEl =
        document.createElement('div');

      descEl.className =
        'forfait-desc';

      descEl.textContent =
        offre.desc;

      const priceEl =
        document.createElement('span');

      priceEl.className =
        'forfait-price';

      priceEl.textContent =
        formaterPrix(prixFinal);

      info.appendChild(nameEl);
      info.appendChild(descEl);

      label.appendChild(input);
      label.appendChild(info);
      label.appendChild(priceEl);

      container.appendChild(label);
    });
  }

  function refreshForfaitsPanel(
    operateur
  ) {

    if (panelAppels) {

      panelAppels.replaceChildren();

      const rowAppels =
        document.createElement('div');

      rowAppels.className =
        'forfait-row';

      panelAppels.appendChild(
        rowAppels
      );

      construireForfaits(
        rowAppels,
        operateur,
        'appels'
      );
    }

    if (panelInternet) {

      panelInternet.replaceChildren();

      const rowInternet =
        document.createElement('div');

      rowInternet.className =
        'forfait-row';

      panelInternet.appendChild(
        rowInternet
      );

      construireForfaits(
        rowInternet,
        operateur,
        'internet'
      );
    }
  }

  /* =====================================================
     AFFICHAGE HISTORIQUE
     ===================================================== */

  function afficherHistorique() {

    if (!historiqueContainer) return;

    historiqueContainer.replaceChildren();

    afficherHabituels();

    const connected =
      isUserConnected();

    const liste = connected
      ? historique
      : historique.filter(
          it => it.status === 'pending'
        );

    const clearBtn =
      document.getElementById(
        'clearHistoryBtnContainer'
      );

    if (clearBtn) {
      clearBtn.style.display =
        connected ? 'block' : 'none';
    }

    if (liste.length === 0) {

      const empty =
        document.createElement('div');

      empty.className =
        'transaction';

      empty.appendChild(
        makeSpan(
          'Aucun historique',
          'color:#9aa6b2'
        )
      );

      historiqueContainer.appendChild(
        empty
      );

      return;
    }

    liste.forEach(it => {

      const d =
        new Date(it.date);

      const dateStr =
        isNaN(d)
          ? ''
          : d.toLocaleString('fr-FR');

      const statusMap = {

        pending: {
          l: 'En attente',
          c: '#fbbf24'
        },

        confirmed: {
          l: 'Confirmé',
          c: '#34d399'
        },

        failed: {
          l: 'Rejeté',
          c: '#f87171'
        }
      };

      const s =
        statusMap[it.status] || {
          l: it.status,
          c: '#9aa6b2'
        };

      const div =
        document.createElement('div');

      div.className =
        'transaction';

      div.style.cssText =
        'display:flex;' +
        'justify-content:space-between;' +
        'align-items:center;' +
        'padding:10px;' +
        'border-radius:8px;' +
        'background:rgba(255,255,255,0.02);' +
        'margin-bottom:6px';

      const left =
        document.createElement('div');

      left.style.cssText =
        'display:flex;' +
        'flex-direction:column;' +
        'gap:2px';

      left.appendChild(
        makeSpan(
          dateStr,
          'font-size:12px;color:#cbd5e1'
        )
      );

      left.appendChild(
        makeSpan(
          it.forfaitLabel ||
          it.forfait ||
          '—',
          'font-weight:700'
        )
      );

      left.appendChild(
        makeSpan(
          it.receveur || '',
          'font-size:12px;color:#9aa6b2'
        )
      );

      left.appendChild(
        makeSpan(
          it.operateur || '',
          'font-size:12px;color:#ffd400'
        )
      );

      const right =
        document.createElement('div');

      right.style.cssText =
        'display:flex;' +
        'flex-direction:column;' +
        'align-items:flex-end;' +
        'gap:4px';

      right.appendChild(
        makeSpan(
          s.l,
          'font-weight:700;color:' + s.c
        )
      );

      right.appendChild(
        makeSpan(
          it.prix
            ? it.prix + ' F'
            : '',
          'font-size:12px;color:#cbd5e1'
        )
      );

      if (it.operateur && it.forfaitCode) {

        const rebuy =
          document.createElement('button');

        rebuy.type = 'button';

        rebuy.className = 'rebuy-btn';

        rebuy.textContent = '↻ Racheter';

        rebuy.setAttribute(
          'aria-label',
          'Racheter ' +
          (it.forfaitLabel || 'ce forfait') +
          ' pour ' +
          (it.receveur || 'ce numéro')
        );

        rebuy.addEventListener(
          'click',
          () => racheter(it)
        );

        right.appendChild(rebuy);
      }

      div.appendChild(left);
      div.appendChild(right);

      historiqueContainer.appendChild(div);
    });
  }

  /* =====================================================
     VOS ACHATS HABITUELS
     -----------------------------------------------------
     Les 3 achats confirmés les plus répétés (même opérateur,
     même forfait, même receveur). Réservé aux comptes connectés
     (un invité ne voit pas ses achats confirmés, cf. req 9).
     Le prix affiché est celui d'AUJOURD'HUI, pas l'ancien.
     ===================================================== */

  function calculerHabituels() {

    const groupes = new Map();

    historique.forEach(tx => {

      if (
        !tx ||
        tx.status !== 'confirmed' ||
        !tx.forfaitCode ||
        !tx.receveur
      ) return;

      const cle = [
        tx.operateur,
        tx.forfaitCode,
        tx.receveur
      ].join('|');

      const t = Date.parse(tx.date) || 0;

      const g = groupes.get(cle);

      if (g) {

        g.count++;

        if (t > g.last) {
          g.last = t;
          g.tx = tx;
        }

      } else {
        groupes.set(cle, { count: 1, last: t, tx });
      }
    });

    return Array.from(groupes.values())
      /* on ne propose pas une offre qui n'existe plus */
      .filter(g => trouverOffre(g.tx.operateur, g.tx.forfaitCode))
      .sort((a, b) => b.count - a.count || b.last - a.last)
      .slice(0, 3);
  }

  function afficherHabituels() {

    const card =
      document.getElementById('habitualCard');

    const list =
      document.getElementById('habitualList');

    if (!card || !list) return;

    list.replaceChildren();

    const items =
      isUserConnected()
        ? calculerHabituels()
        : [];

    card.hidden = items.length === 0;

    items.forEach(g => {

      const tx = g.tx;

      const { offre } =
        trouverOffre(tx.operateur, tx.forfaitCode);

      const prixActuel =
        prixAvecCommission(offre.prix);

      const btn =
        document.createElement('button');

      btn.type = 'button';

      btn.className = 'habit-item';

      btn.setAttribute(
        'aria-label',
        'Racheter ' + offre.nom + ' ' + offre.desc +
        ' pour ' + tx.receveur
      );

      const main =
        document.createElement('div');

      main.className = 'habit-main';

      const titre =
        document.createElement('span');

      titre.className = 'habit-title';

      titre.textContent =
        offre.nom + ' · ' + offre.desc;

      const sub =
        document.createElement('span');

      sub.className = 'habit-sub';

      const opSpan =
        document.createElement('span');

      opSpan.textContent = tx.operateur;

      opSpan.style.color =
        (OPERATOR_THEMES[tx.operateur] || {}).accent ||
        '#ffd400';

      sub.appendChild(opSpan);

      sub.append(' · ' + tx.receveur);

      main.appendChild(titre);
      main.appendChild(sub);

      const side =
        document.createElement('div');

      side.className = 'habit-side';

      const prix =
        document.createElement('span');

      prix.className = 'habit-price';

      prix.textContent =
        formaterPrix(prixActuel);

      const cta =
        document.createElement('span');

      cta.className = 'habit-cta';

      cta.textContent = '↻ Racheter';

      side.appendChild(prix);
      side.appendChild(cta);

      btn.appendChild(main);
      btn.appendChild(side);

      btn.addEventListener(
        'click',
        () => racheter(tx)
      );

      list.appendChild(btn);
    });
  }

  /* =====================================================
     EFFACER HISTORIQUE
     ===================================================== */

  function clearHistory() {

    if (
      !confirm(
        'Effacer tout votre historique ? Action irréversible.'
      )
    ) {
      return;
    }

    historique = [];

    localStorage.removeItem(
      getHistoryStorageKey()
    );

    afficherHistorique();

    alert(
      'Historique effacé avec succès.'
    );
  }

  const clearHistoryBtn =
    document.getElementById(
      'clearHistoryBtn'
    );

  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener(
      'click',
      clearHistory
    );
  }

  /* =====================================================
     ACCORDEONS
     ===================================================== */

  function toggleAccordion(
    button,
    panel
  ) {

    const expanded =
      button.getAttribute(
        'aria-expanded'
      ) === 'true';

    [btnAppels, btnInternet]
      .forEach(b => {

        if (b) {
          b.setAttribute(
            'aria-expanded',
            'false'
          );
        }
      });

    [panelAppels, panelInternet]
      .forEach(p => {

        if (p) {

          p.classList.add('hidden');

          p.setAttribute(
            'aria-hidden',
            'true'
          );
        }
      });

    if (!expanded) {

      button.setAttribute(
        'aria-expanded',
        'true'
      );

      panel.classList.remove(
        'hidden'
      );

      panel.setAttribute(
        'aria-hidden',
        'false'
      );
    }
  }

  if (btnAppels) {
    btnAppels.addEventListener(
      'click',
      () =>
        toggleAccordion(
          btnAppels,
          panelAppels
        )
    );
  }

  if (btnInternet) {
    btnInternet.addEventListener(
      'click',
      () =>
        toggleAccordion(
          btnInternet,
          panelInternet
        )
    );
  }

  /* =====================================================
     FOCUS TRAP
     ===================================================== */

  let focusableElements = [];

  function updateFocusable() {

    if (!modal) return;

    focusableElements =
      Array.from(
        modal.querySelectorAll(
          'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])'
        )
      ).filter(
        el => el.offsetParent !== null
      );
  }

  function trapFocus(e) {

    if (
      !modal ||
      modal.classList.contains('hidden') ||
      e.key !== 'Tab'
    ) {
      return;
    }

    updateFocusable();

    if (!focusableElements.length) {
      e.preventDefault();
      return;
    }

    const first =
      focusableElements[0];

    const last =
      focusableElements[
        focusableElements.length - 1
      ];

    if (e.shiftKey) {

      if (
        document.activeElement === first
      ) {
        e.preventDefault();
        last.focus();
      }

    } else {

      if (
        document.activeElement === last
      ) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  document.addEventListener(
    'keydown',
    e => {

      if (
        e.key === 'Escape' &&
        modal &&
        !modal.classList.contains(
          'hidden'
        )
      ) {
        fermerModal();
      }

      trapFocus(e);
    }
  );

  /* =====================================================
     FERMER MODAL
     ===================================================== */

  function fermerModal() {

    if (!modal) return;

    modal.classList.add(
      'hidden'
    );

    modal.setAttribute(
      'aria-hidden',
      'true'
    );

    document.body.classList.remove(
      'modal-open'
    );

    if (paymentForm) {
      paymentForm.reset();
    }

    if (formMessage) {

      formMessage.textContent = '';

      formMessage.style.color =
        '#ffd700';
    }

    [btnAppels, btnInternet]
      .forEach(b => {

        if (b) {
          b.setAttribute(
            'aria-expanded',
            'false'
          );
        }
      });

    [panelAppels, panelInternet]
      .forEach(p => {

        if (p) {

          p.classList.add(
            'hidden'
          );

          p.setAttribute(
            'aria-hidden',
            'true'
          );
        }
      });

    if (
      lastFocused &&
      typeof lastFocused.focus ===
        'function'
    ) {
      lastFocused.focus();
    }
  }

  if (closeModalBtn) {
    closeModalBtn.addEventListener(
      'click',
      fermerModal
    );
  }

  if (cancelModalBtn) {
    cancelModalBtn.addEventListener(
      'click',
      fermerModal
    );
  }

  /* =====================================================
     OUVRIR MODAL
     ===================================================== */

  /* prefill (optionnel, utilisé par « Racheter ») :
       { payer, receveur, forfaitCode, ancienPrix } */
  window.ouvrirModal =
    function(op, prefill) {

      currentOperateur =
        op || 'MTN';

      lastFocused =
        document.activeElement;

      const titreEl =
        document.getElementById(
          'titre'
        );

      if (titreEl) {
        titreEl.textContent =
          currentOperateur;
      }

      if (receveurNumero) {

        const prefixMap = {
          Orange: '07',
          MTN: '05',
          MOOV: '01'
        };

        const pref =
          prefixMap[
            currentOperateur
          ] || 'XX';

        receveurNumero.placeholder =
          '+225 ' + pref + 'XXXXXXXX';

        const hint =
          document.getElementById(
            'receveurHint'
          );

        if (hint) {

          hint.textContent =
            'Numéro ' +
            currentOperateur +
            ' (doit commencer par ' +
            pref +
            ')';
        }
      }

      refreshForfaitsPanel(
        currentOperateur
      );

      applyOperatorTheme(
        currentOperateur
      );

      if (!modal) return;

      modal.classList.remove(
        'hidden'
      );

      modal.setAttribute(
        'aria-hidden',
        'false'
      );

      /* Empêche la page derrière de défiler */
      document.body.classList.add(
        'modal-open'
      );

      [btnAppels, btnInternet]
        .forEach(b => {

          if (b) {
            b.setAttribute(
              'aria-expanded',
              'false'
            );
          }
        });

      [panelAppels, panelInternet]
        .forEach(p => {

          if (p) {

            p.classList.add(
              'hidden'
            );

            p.setAttribute(
              'aria-hidden',
              'true'
            );
          }
        });

      /* --- Racheter : on préremplit numéros + forfait --- */
      if (prefill) {
        appliquerPrefill(prefill);
      }

      const formScroll =
        modal.querySelector('form');

      if (formScroll && !prefill) {
        formScroll.scrollTop = 0;
      }

      setTimeout(() => {

        updateFocusable();

        if (prefill) {

          /* Tout est prêt : le curseur va directement sur « Payer » */
          const payBtn =
            modal.querySelector(
              '.btn-payer'
            );

          if (payBtn) payBtn.focus();

          return;
        }

        const p =
          document.getElementById(
            'payerNumero'
          );

        if (p) p.focus();

      }, 50);
    };

  function appliquerPrefill(prefill) {

    if (payerNumero && prefill.payer) {
      payerNumero.value = prefill.payer;
    }

    if (receveurNumero && prefill.receveur) {
      receveurNumero.value = prefill.receveur;
    }

    const radio =
      Array.from(
        paymentForm.querySelectorAll(
          'input[name="forfait"]'
        )
      ).find(
        r => r.value === prefill.forfaitCode
      );

    if (!radio) {

      /* L'offre n'existe plus : on garde les numéros, on laisse choisir */
      formMessage.textContent =
        'Ce forfait n\'est plus disponible. Choisissez-en un autre.';

      formMessage.style.color =
        '#fbbf24';

      return;
    }

    radio.checked = true;

    /* Ouvre l'accordéon (Appels ou Internet) qui contient l'offre */
    const panel =
      radio.closest('.panel');

    const bouton =
      panel === panelAppels
        ? btnAppels
        : btnInternet;

    if (panel && bouton) {
      toggleAccordion(bouton, panel);
    }

    radio.closest('.forfait-card')
      ?.scrollIntoView({ block: 'center' });

    const nouveauPrix =
      parseInt(radio.dataset.prix, 10) || 0;

    const ancienPrix =
      Number(prefill.ancienPrix) || 0;

    if (ancienPrix && nouveauPrix !== ancienPrix) {

      formMessage.textContent =
        'Le prix a changé depuis votre dernier achat : ' +
        formaterPrix(ancienPrix) +
        ' → ' +
        formaterPrix(nouveauPrix) +
        '. Vérifiez puis payez.';

      formMessage.style.color =
        '#fbbf24';

    } else {

      formMessage.textContent =
        'Votre achat précédent est prérempli. Vérifiez puis payez.';

      formMessage.style.color =
        '#cbd5e1';
    }
  }

  /* Bouton « Racheter » : rouvre le formulaire avec le même achat */
  function racheter(tx) {

    if (!tx || !tx.operateur) return;

    window.ouvrirModal(
      tx.operateur,
      {
        payer: tx.payer,
        receveur: tx.receveur,
        forfaitCode: tx.forfaitCode,
        ancienPrix: tx.prix
      }
    );
  }

  document
    .querySelectorAll(
      '.op-btn[data-operateur]'
    )
    .forEach(btn => {

      btn.addEventListener(
        'click',
        () =>
          window.ouvrirModal(
            btn.dataset.operateur
          )
      );
    });

  const userAreaLoginFallback =
    document.getElementById(
      'userAreaLoginFallback'
    );

  const userAreaRegisterFallback =
    document.getElementById(
      'userAreaRegisterFallback'
    );

  if (userAreaLoginFallback) {

    userAreaLoginFallback.addEventListener(
      'click',
      () => {
        window.location.href =
          'index.html';
      }
    );
  }

  if (userAreaRegisterFallback) {

    userAreaRegisterFallback.addEventListener(
      'click',
      () => {
        window.location.href =
          'register.html';
      }
    );
  }

  /* =====================================================
     GESTION TRANSACTIONS
     ===================================================== */

  function generateTransactionId() {

    return (
      'mf-' +
      Date.now().toString(36) +
      '-' +
      Math.random()
        .toString(36)
        .slice(2, 8)
    );
  }

  function buildPayload(data) {

    return {

      transactionId:
        generateTransactionId(),

      date:
        new Date().toISOString(),

      operateur:
        data.operateur,

      payer:
        data.payer,

      receveur:
        data.receveur,

      forfaitCode:
        data.forfaitCode,

      forfaitLabel:
        data.forfaitLabel,

      prix:
        data.prix,

      status:
        'pending',

      meta: {}
    };
  }

  function addTransactionToHistory(tx) {

    historique.unshift(tx);

    if (historique.length > 50) {
      historique =
        historique.slice(0, 50);
    }

    localStorage.setItem(
      getHistoryStorageKey(),
      JSON.stringify(historique)
    );

    afficherHistorique();

    /* Sauvegarde Supabase */

    if (window.supabaseClient) {

      const stored =
        sessionStorage.getItem(
          'mf_session'
        );

      let uid = 'guest';

      try {

        if (stored) {

          const session =
            JSON.parse(stored);

          uid =
            session.uid || 'guest';
        }

      } catch {}

      const supabasePayload = {

        transaction_id:
          tx.transactionId,

        user_id:
          uid === 'guest'
            ? null
            : uid,

        date:
          tx.date,

        operateur:
          tx.operateur,

        payer:
          tx.payer,

        receveur:
          tx.receveur,

        forfait_code:
          tx.forfaitCode,

        forfait_label:
          tx.forfaitLabel,

        prix:
          tx.prix,

        status:
          tx.status,

        meta:
          tx.meta
      };

      window.supabaseClient
        .from('transactions')
        .upsert(
          supabasePayload
        )
        .then(
          ({ error }) => {

            if (error) {
              throw error;
            }

            console.log(
              '[MonForfait] Transaction sauvegardée dans Supabase :',
              tx.transactionId
            );
          }
        )
        .catch(err => {

          console.warn(
            '[MonForfait] Erreur Supabase :',
            err
          );
        });
    }
  }

  /* =====================================================
     SOUMISSION DU PAIEMENT
     ===================================================== */

  if (paymentForm) {

    paymentForm.addEventListener(
      'submit',
      async e => {

        e.preventDefault();

        const payer =
          payerNumero.value.trim();

        const receveur =
          receveurNumero.value.trim();

        const forfaitInput =
          paymentForm.querySelector(
            'input[name="forfait"]:checked'
          );

        if (!isValidPhone(payer)) {

          formMessage.textContent =
            'Numéro payeur invalide (ex: +225XXXXXXXX).';

          formMessage.style.color =
            '#f87171';

          payerNumero.focus();

          return;
        }

        if (!receveur) {

          formMessage.textContent =
            'Entrez le numéro du receveur.';

          formMessage.style.color =
            '#f87171';

          receveurNumero.focus();

          return;
        }

        if (
          typeof validerNumeroReceveur ===
            'function' &&
          !validerNumeroReceveur(
            receveur,
            currentOperateur
          )
        ) {

          const prefixMap = {
            Orange: '07',
            MTN: '05',
            MOOV: '01'
          };

          const pref =
            prefixMap[
              currentOperateur
            ] || 'XX';

          formMessage.textContent =
            'Le numéro ' +
            currentOperateur +
            ' doit commencer par ' +
            pref +
            ' (ex: +225 ' +
            pref +
            'XXXXXXXX).';

          formMessage.style.color =
            '#f87171';

          receveurNumero.focus();

          return;
        }

        if (!forfaitInput) {

          formMessage.textContent =
            'Veuillez sélectionner un forfait.';

          formMessage.style.color =
            '#f87171';

          return;
        }

        const prixAffiche =
          parseInt(
            forfaitInput.dataset.prix,
            10
          ) || 0;

        let forfaitLabel =
          forfaitInput.dataset.label ||
          forfaitInput
            .closest('.forfait-card')
            ?.querySelector(
              '.forfait-name'
            )
            ?.textContent
            ?.trim() ||
          forfaitInput.value;

        /* =================================================
           PRIX OFFICIEL DEPUIS LA BASE
           (onglet ouvert tout de suite : apres un await,
           les navigateurs bloqueraient le popup Wave)
           ================================================= */

        const waveTab =
          window.open('', '_blank');

        if (waveTab) {
          try { waveTab.opener = null; } catch {}
        }

        disableForm(true);

        formMessage.textContent =
          'Vérification du prix…';

        formMessage.style.color =
          '#9aa6b2';

        let prix = prixAffiche;

        try {

          const officiel =
            await obtenirPrixOfficiel(
              forfaitInput.value
            );

          if (
            officiel.operateur !==
            currentOperateur
          ) {
            throw new Error(
              'Incohérence opérateur/forfait.'
            );
          }

          prix = officiel.prix;
          forfaitLabel =
            officiel.nom || forfaitLabel;

        } catch (err) {

          console.error(
            '[MonForfait] Lecture du prix impossible :',
            err
          );

          if (waveTab) waveTab.close();

          formMessage.textContent =
            'Impossible de vérifier le prix pour le moment. Réessayez dans un instant.';

          formMessage.style.color =
            '#f87171';

          disableForm(false);

          return;
        }

        if (prix !== prixAffiche) {

          /* Le prix a change en base depuis l'affichage :
             on met a jour et on redemande confirmation. */

          if (waveTab) waveTab.close();

          forfaitInput.dataset.prix = prix;

          const strongPrix =
            forfaitInput
              .closest('.forfait-card')
              ?.querySelector(
                '.forfait-price'
              );

          if (strongPrix) {
            strongPrix.textContent =
              formaterPrix(prix);
          }

          formMessage.textContent =
            'Le prix de ce forfait a changé : ' +
            prix +
            ' F. Cliquez à nouveau sur Payer pour confirmer.';

          formMessage.style.color =
            '#fbbf24';

          disableForm(false);

          return;
        }

        /* =================================================
           WAVE
           ================================================= */

        const montantWave =
          Number.isFinite(prix) &&
          prix > 0
            ? prix
            : 0;

        const WAVE_URL =
          'https://pay.wave.com/m/M_ci_2kDAe7GPVh9b/c/ci/?amount=' +
          encodeURIComponent(
            montantWave
          );

        if (waveTab) {
          waveTab.location.href = WAVE_URL;
        } else {
          window.open(WAVE_URL, '_blank');
        }

        /* =================================================
           CREATION TRANSACTION
           ================================================= */

        const payload =
          buildPayload({

            operateur:
              currentOperateur,

            payer,

            receveur,

            forfaitCode:
              forfaitInput.value,

            forfaitLabel,

            prix
          });

        formMessage.textContent =
          'Demande enregistrée ! Ref : ' +
          payload.transactionId +
          '. Confirmation après validation.';

        formMessage.style.color =
          '#34d399';

        addTransactionToHistory(
          payload
        );

        disableForm(true);

        setTimeout(
          () => disableForm(false),
          1500
        );
      }
    );
  }

  /* =====================================================
     ADMIN UI
     ===================================================== */

  const ADMIN_UI_SESSION_KEY =
    'mf_isAdmin';

  const adminUi =
    document.getElementById(
      'admin-ui'
    ) ||
    (() => {

      const d =
        document.createElement('div');

      d.id = 'admin-ui';

      d.style.cssText =
        'position:fixed;' +
        'top:12px;' +
        'right:12px;' +
        'z-index:9999;' +
        'display:flex;' +
        'gap:8px';

      document.body.appendChild(d);

      return d;
    })();

  function renderAdminControls(
    isAllowed,
    role,
    operator
  ) {

    adminUi.replaceChildren();

    if (!isAllowed) return;

    const badge =
      document.createElement('span');

    badge.textContent =
      role === 'super_admin'
        ? '👑 Super Admin'
        : ('🛡️ Agent ' + (operator || ''));

    badge.style.cssText =
      'background:#111827;' +
      'color:#fff;' +
      'padding:6px 10px;' +
      'border-radius:6px;' +
      'font-size:13px';

    adminUi.appendChild(
      badge
    );

    const logout =
      document.createElement('button');

    logout.textContent =
      'Déconnexion';

    logout.style.cssText =
      'padding:6px 10px;' +
      'border-radius:6px;' +
      'border:1px solid rgba(255,255,255,0.06);' +
      'background:transparent;' +
      'color:#fff';

    logout.addEventListener(
      'click',
      () => {

        /* Utilise la vraie déconnexion Supabase (window.logout, définie
           plus bas) : se contenter de masquer ce badge laissait la
           session active, ce qui est problématique sur un poste
           partagé entre plusieurs agents. */
        if (typeof window.logout === 'function') {

          window.logout();

        } else {

          sessionStorage.removeItem(
            ADMIN_UI_SESSION_KEY
          );

          renderAdminControls(
            false
          );
        }
      }
    );

    adminUi.appendChild(
      logout
    );
  }

  /* =====================================================
     NETTOYAGE DONNEES DEMO
     ===================================================== */

  if (
    !localStorage.getItem(
      'mf_v2_initialized'
    )
  ) {

    Object.keys(localStorage)
      .filter(k =>
        k.startsWith(
          'monforfait_historique_'
        )
      )
      .forEach(k =>
        localStorage.removeItem(k)
      );

    localStorage.setItem(
      'mf_v2_initialized',
      '1'
    );

    historique = [];

    console.log(
      '[MonForfait] Nettoyage des données de demo effectué.'
    );
  }
/* =====================================================
   SYNCHRONISATION HISTORIQUE AVEC SUPABASE
   ===================================================== */

let clientRealtimeChannel = null;

async function synchroniserHistoriqueSupabase() {
  if (!window.supabaseClient) {
    console.warn('[MonForfait] Supabase indisponible.');
    return;
  }

  const stored = sessionStorage.getItem('mf_session');

  if (!stored) {
    return;
  }

  let session;

  try {
    session = JSON.parse(stored);
  } catch (err) {
    console.warn('[MonForfait] Session invalide.');
    return;
  }

  const uid = session?.uid;

  if (!uid) {
    return;
  }

  try {
    const { data, error } = await window.supabaseClient
      .from('transactions')
      .select('*')
      .eq('user_id', uid)
      .order('date', { ascending: false });

    if (error) {
      throw error;
    }

    historique = (data || []).map(tx => ({
      transactionId: tx.transaction_id,
      date: tx.date,
      operateur: tx.operateur,
      payer: tx.payer,
      receveur: tx.receveur,
      forfaitCode: tx.forfait_code,
      forfaitLabel: tx.forfait_label,
      prix: tx.prix,
      status: tx.status,
      meta: tx.meta || {}
    }));

    localStorage.setItem(
      getHistoryStorageKey(),
      JSON.stringify(historique)
    );

    afficherHistorique();

    console.log(
      '[MonForfait] Historique synchronisé avec Supabase.',
      historique
    );

  } catch (err) {
    console.error(
      '[MonForfait] Erreur synchronisation Supabase :',
      err
    );
  }
}
function demarrerRealtimeTransactions(uid) {
  if (!window.supabaseClient || !uid) {
    return;
  }

  if (clientRealtimeChannel) {
    window.supabaseClient.removeChannel(
      clientRealtimeChannel
    );
  }

  clientRealtimeChannel =
    window.supabaseClient
      .channel('client-transactions-' + uid)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'transactions',
          filter: 'user_id=eq.' + uid
        },
        payload => {

          console.log(
            '[MonForfait] Transaction mise à jour :',
            payload.new
          );

          const updated = payload.new;

          const index = historique.findIndex(
            tx =>
              tx.transactionId ===
              updated.transaction_id
          );

          const newTransaction = {
            transactionId:
              updated.transaction_id,
            date:
              updated.date,
            operateur:
              updated.operateur,
            payer:
              updated.payer,
            receveur:
              updated.receveur,
            forfaitCode:
              updated.forfait_code,
            forfaitLabel:
              updated.forfait_label,
            prix:
              updated.prix,
            status:
              updated.status,
            meta:
              updated.meta || {}
          };

          if (index !== -1) {
            historique[index] =
              newTransaction;
          } else {
            historique.unshift(
              newTransaction
            );
          }

          localStorage.setItem(
            getHistoryStorageKey(),
            JSON.stringify(historique)
          );

          afficherHistorique();

          if (updated.status === 'confirmed') {
            alert(
              '✅ Votre souscription a été acceptée !'
            );
          }

          if (updated.status === 'failed') {
            const reason =
              updated.meta?.reason
                ? '\nMotif : ' +
                  updated.meta.reason
                : '';

            alert(
              '❌ Votre souscription a été rejetée.' +
              reason
            );
          }
        }
      )
      .subscribe(status => {
        console.log(
          '[MonForfait] Realtime transactions :',
          status
        );
      });
}
  /* =====================================================
     INITIALISATION
     ===================================================== */

  renderAdminControls(false);

  afficherHistorique();

  applyOperatorTheme('MTN');

  startPeriodicPurge();

  /* Une fois le catalogue chargé, on rafraîchit les achats habituels
     (leurs prix et leur disponibilité dépendent du catalogue). */
  chargerCatalogueDepuisBDD()
    .then(() => afficherHistorique());

  /* Pont vers le scope externe (onAuthStateChange) :
     ces deux fonctions sont définies ici et n'existaient
     nulle part ailleurs, d'où l'échec silencieux. */
  window.__mfSyncHistorique = synchroniserHistoriqueSupabase;
  window.__mfStartRealtime = demarrerRealtimeTransactions;

});


/* =========================================================
   HCAPTCHA
   ========================================================= */

let hcaptchaToken = null;


/*
 * Appelé automatiquement par hCaptcha
 * lorsque le CAPTCHA est validé.
 */
window.onHCaptchaSuccess =
  function(token) {

    hcaptchaToken = token;

    console.log(
      '[MonForfait] hCaptcha validé.'
    );
  };


/*
 * Appelé lorsque le CAPTCHA expire.
 */
window.onHCaptchaExpired =
  function() {

    hcaptchaToken = null;

    console.log(
      '[MonForfait] hCaptcha expiré.'
    );
  };


/*
 * Appelé lorsqu'une erreur hCaptcha survient.
 */
window.onHCaptchaError =
  function() {

    hcaptchaToken = null;

    console.warn(
      '[MonForfait] Erreur hCaptcha.'
    );
  };


/*
 * Réinitialise le CAPTCHA.
 */
function resetHCaptcha() {

  hcaptchaToken = null;

  if (
    typeof hcaptcha !==
    'undefined'
  ) {

    try {
      hcaptcha.reset();
    } catch (err) {
      console.warn(
        '[MonForfait] Impossible de reset hCaptcha :',
        err
      );
    }
  }
}


/* =========================================================
   SUPABASE AUTH
   Connexion / Inscription / Déconnexion
   ========================================================= */

(async function() {

  if (!window.supabaseClient) {

    console.warn(
      '[MonForfait] Supabase non initialisé. Vérifiez js/supabase.js.'
    );

    return;
  }

  const supabase =
    window.supabaseClient;


  /* =====================================================
     INSCRIPTION
     ===================================================== */

  const regName =
    document.getElementById('name');

  const regPhone =
    document.getElementById('phone');

  const regEmail =
    document.getElementById('email');

  const regPass =
    document.getElementById('password');


  if (regEmail && regPass) {

    window.register =
      async function() {

        const name =
          (regName?.value || '').trim();

        const phone =
          (regPhone?.value || '').trim();

        const email =
          (regEmail.value || '')
            .trim()
            .toLowerCase();

        const password =
          regPass.value || '';


        if (!name) {

          alert(
            'Indiquez votre nom complet.'
          );

          return;
        }


        if (
          !email ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/
            .test(email)
        ) {

          alert(
            'Email invalide.'
          );

          return;
        }


        if (
          !password ||
          password.length < 6
        ) {

          alert(
            'Mot de passe minimum 6 caractères.'
          );

          return;
        }


        /* ===========================
           VERIFICATION HCAPTCHA
           =========================== */

        if (!hcaptchaToken) {

          alert(
            'Veuillez compléter le hCaptcha avant de vous inscrire.'
          );

          return;
        }


        try {

          const {
            data,
            error
          } =
            await supabase.auth.signUp({

              email,

              password,

              options: {

                data: {
                  name,
                  phone
                },

                captchaToken:
                  hcaptchaToken
              }
            });


          resetHCaptcha();


          if (error) {
            throw error;
          }


          if (data.user) {

            localStorage.setItem(

              'mf_profile_' +
                data.user.id,

              JSON.stringify({

                uid:
                  data.user.id,

                name,

                email,

                phone
              })
            );
          }


          alert(
            data.session
              ? 'Inscription réussie !'
              : 'Inscription réussie ! Vérifiez votre email avant de vous connecter.'
          );


          window.location.href =
            'index.html';


        } catch (err) {

          resetHCaptcha();

          console.error(
            '[MonForfait] Erreur inscription :',
            err
          );

          alert(
            err.message ||
            "Erreur lors de l'inscription."
          );
        }
      };


    const registerBtn =
      document.getElementById(
        'registerBtn'
      );


    if (registerBtn) {

      registerBtn.addEventListener(
        'click',
        () => window.register()
      );
    }
  }


  /* =====================================================
     CONNEXION
     ===================================================== */

  window.login =
    async function() {

      const email =
        (
          document.getElementById(
            'email'
          )?.value || ''
        ).trim();


      const password =
        document.getElementById(
          'password'
        )?.value || '';


      if (!email || !password) {

        alert(
          'Remplissez tous les champs.'
        );

        return;
      }


      /* ===========================
         VERIFICATION HCAPTCHA
         =========================== */

      if (!hcaptchaToken) {

        alert(
          'Veuillez compléter le hCaptcha avant de vous connecter.'
        );

        return;
      }


      try {

        /* ===========================
           CONNEXION SUPABASE
           =========================== */

        const {
          data,
          error
        } =
          await supabase.auth.signInWithPassword({

            email,

            password,

            options: {

              captchaToken:
                hcaptchaToken
            }
          });


        resetHCaptcha();


        if (error) {
          throw error;
        }


        /* ===========================
           RECUPERATION PROFIL
           =========================== */

        const {
          data: profile,
          error: profileError
        } =
          await supabase

            .from('profiles')

            .select(
              'role, operator'
            )

            .eq(
              'id',
              data.user.id
            )

            .maybeSingle();


        if (profileError) {
          throw profileError;
        }


        const role =
          profile?.role;

        const operator =
          role === 'admin'
            ? profile.operator
            : null;

        /* Pages dédiées par opérateur (agents), servies depuis public/
           au même niveau que index.html — voir aussi transactions.js
           (window.ADMIN_FILTER_OPERATOR) qui verrouille chaque page à
           son opérateur. */
        const operatorPages = {

          MTN:
            'agent-mtn.html',

          Orange:
            'agent-orange.html',

          MOOV:
            'agent-moov.html'
        };


        let destination =
          'dashboard.html';

        if (role === 'super_admin') {

          /* Le super-admin voit MTN + Orange + Moov : page globale. */
          destination =
            'transactions.html';

        } else if (
          role === 'admin' &&
          operatorPages[operator]
        ) {

          destination =
            operatorPages[operator];
        }


        window.location.href =
          destination;


      } catch (err) {

        resetHCaptcha();

        console.error(
          '[MonForfait] Erreur connexion :',
          err
        );

        alert(
          err.message ||
          'Erreur lors de la connexion.'
        );
      }
    };


  const loginBtn =
    document.getElementById(
      'loginBtn'
    );


  if (loginBtn) {

    loginBtn.addEventListener(
      'click',
      () => window.login()
    );
  }


  /* =====================================================
     DECONNEXION
     ===================================================== */

  window.logout =
    async function() {

      try {

        await supabase.auth.signOut();

        sessionStorage.removeItem(
          'mf_session'
        );

        sessionStorage.removeItem(
          'mf_isAdmin'
        );

        window.location.href =
          'index.html';


      } catch (err) {

        console.error(
          '[MonForfait] Erreur déconnexion :',
          err
        );

        alert(
          'Erreur lors de la déconnexion.'
        );
      }
    };


  /* =====================================================
     PROFIL STOCKE
     ===================================================== */

  function getStoredProfile() {

    const s =
      sessionStorage.getItem(
        'mf_session'
      );

    if (!s) return null;

    try {

      return JSON.parse(s);

    } catch {

      return null;
    }
  }


  /* =====================================================
     ZONE UTILISATEUR HEADER
     ===================================================== */

  function renderUserArea(profile) {

    const userArea =
      document.getElementById(
        'userArea'
      );

    if (!userArea) return;


    userArea.replaceChildren();


    if (
      !profile ||
      !profile.uid
    ) {

      const loginBtn =
        document.createElement(
          'button'
        );

      loginBtn.className =
        'auth-btn login-btn';

      loginBtn.textContent =
        'Se connecter';

      loginBtn.addEventListener(
        'click',
        () => {
          window.location.href =
            'index.html';
        }
      );


      const registerBtn =
        document.createElement(
          'button'
        );

      registerBtn.className =
        'auth-btn register-btn';

      registerBtn.textContent =
        "S'inscrire";

      registerBtn.addEventListener(
        'click',
        () => {
          window.location.href =
            'register.html';
        }
      );


      userArea.appendChild(
        loginBtn
      );

      userArea.appendChild(
        registerBtn
      );

      return;
    }


    const displayName =
      profile.name ||
      profile.email?.split('@')[0] ||
      'Utilisateur';


    const info =
      document.createElement(
        'div'
      );

    info.className =
      'user-info';


    const nameSpan =
      document.createElement(
        'span'
      );

    nameSpan.textContent =
      '👤 ' + displayName;


    const logoutBtn =
      document.createElement(
        'button'
      );

    logoutBtn.className =
      'auth-btn logout-btn';

    logoutBtn.textContent =
      'Déconnexion';

    logoutBtn.addEventListener(
      'click',
      () => {
        window.logout();
      }
    );


    info.appendChild(
      nameSpan
    );

    info.appendChild(
      logoutBtn
    );

    userArea.appendChild(
      info
    );
  }


  /* =====================================================
     SURVEILLANCE AUTH SUPABASE
     ===================================================== */

  supabase.auth.onAuthStateChange(
    async (_event, session) => {

      try {

        const welcomeBanner =
          document.getElementById(
            'welcomeBanner'
          );


        const user =
          session?.user || null;


        if (!user) {

          renderUserArea(
            getStoredProfile()
          );


          if (welcomeBanner) {

            welcomeBanner.classList.remove(
              'hidden'
            );

            welcomeBanner.textContent =
              '👋 Bienvenue sur MonForfait.ci ! Créez un compte pour sauvegarder votre historique.';
          }


          if (
            window.checkAndRenderAdminUI
          ) {

            await window
              .checkAndRenderAdminUI();
          }


          return;
        }


        /* ===========================
           UTILISATEUR CONNECTE
           =========================== */

        const profile = {

          uid:
            user.id,

          name:
            user.user_metadata?.name ||
            user.user_metadata?.full_name ||
            user.email?.split('@')[0] ||
            'Utilisateur',

          email:
            user.email,

          phone:
            user.user_metadata?.phone ||
            ''
        };


        sessionStorage.setItem(

          'mf_session',

          JSON.stringify(profile)
        );
if (typeof window.__mfSyncHistorique === 'function') {
  await window.__mfSyncHistorique();
} else {
  console.warn('[MonForfait] __mfSyncHistorique indisponible.');
}

if (typeof window.__mfStartRealtime === 'function') {
  window.__mfStartRealtime(user.id);
} else {
  console.warn('[MonForfait] __mfStartRealtime indisponible.');
}

        renderUserArea(
          profile
        );


        if (welcomeBanner) {

          welcomeBanner.classList.remove(
            'hidden'
          );

          welcomeBanner.textContent =
            '✨ Bienvenue, ' +
            profile.name +
            ' !';
        }


        /* ===========================
           MIGRATION HISTORIQUE GUEST
           =========================== */

        const guestKey =
          'monforfait_historique_guest';

        const userKey =
          'monforfait_historique_' +
          user.id;


        const guestData =
          localStorage.getItem(
            guestKey
          );


        if (guestData) {

          try {

            const guestArr =
              JSON.parse(
                guestData
              ) || [];


            const userArr =
              localStorage.getItem(
                userKey
              )
                ? JSON.parse(
                    localStorage.getItem(
                      userKey
                    )
                  ) || []
                : [];


            const merged = [
              ...guestArr,
              ...userArr
            ];


            localStorage.setItem(
              userKey,
              JSON.stringify(merged)
            );


            localStorage.removeItem(
              guestKey
            );


            console.log(
              '[MonForfait] Historique guest migré vers compte utilisateur.'
            );


          } catch (err) {

            console.warn(
              '[MonForfait] Migration historique échouée :',
              err
            );
          }
        }


        const clearBtn =
          document.getElementById(
            'clearHistoryBtnContainer'
          );


        if (clearBtn) {

          clearBtn.style.display =
            'block';
        }


      } catch (e) {

        console.error(
          '[MonForfait] onAuthStateChanged error :',
          e
        );
      }


      if (
        window.checkAndRenderAdminUI
      ) {

        await window
          .checkAndRenderAdminUI();
      }
    }
  );


  /* =====================================================
     VERIFICATION ROLE ADMIN
     ===================================================== */

  window.checkAndRenderAdminUI =
    async function() {

      try {

        const {
          data: { user }
        } =
          await supabase.auth.getUser();


        if (!user) {

          if (
            typeof renderAdminControls ===
            'function'
          ) {
            renderAdminControls(false);
          }

          return;
        }


        const {
          data: profile
        } =
          await supabase

            .from('profiles')

            .select('role, operator')

            .eq(
              'id',
              user.id
            )

            .maybeSingle();


        const isAdmin =
          profile?.role === 'admin' ||
          profile?.role === 'super_admin';


        if (isAdmin) {

          sessionStorage.setItem(
            'mf_isAdmin',
            '1'
          );

        } else {

          sessionStorage.removeItem(
            'mf_isAdmin'
          );
        }


        if (
          typeof renderAdminControls ===
          'function'
        ) {

          renderAdminControls(
            isAdmin,
            profile?.role,
            profile?.operator
          );
        }


      } catch (err) {

        console.error(
          '[MonForfait] Erreur claims :',
          err
        );


        if (
          typeof renderAdminControls ===
          'function'
        ) {

          renderAdminControls(false);
        }
      }
    };


  /* =====================================================
     CONFIRMATION TRANSACTION SERVEUR
     ===================================================== */

  window.confirmTransactionServer =
    async function(txId) {

      const {
        data: { user }
      } =
        await supabase.auth.getUser();


      if (!user) {
        throw new Error(
          'Non connecté.'
        );
      }


      const {
        data,
        error
      } =
        await supabase

          .from('transactions')

          .update({

            status:
              'confirmed',

            decision_by:
              user.email,

            decision_at:
              new Date().toISOString()
          })

          .eq(
            'transaction_id',
            txId
          )

          .select()
          .single();


      if (error) {
        throw error;
      }


      return data;
    };

})();
