/**
 * password-reset.js - "Mot de passe oublié" SANS email (forgot.html)
 * ===================================================================
 * Etape 1 : le client choisit email ou numéro de téléphone.
 * Etape 2 : il répond à des questions sur sa dernière transaction (date, montant, numéro du receveur).
 *           Rien n'est vérifié dans le navigateur : tout part à la fonction Edge "account-recovery",
 *           qui compare avec la base de données.
 * Etape 3 : si la base confirme, la fonction renvoie un jeton à usage unique (10 min) ;
 *           le client choisit alors son nouveau mot de passe.
 * Fichier externe : la CSP du site interdit les <script> inline.
 */
(function () {
  'use strict';

  var sb = window.supabaseClient;
  if (!sb) return;

  function $(id) { return document.getElementById(id); }

  var etape = 1;
  var methode = 'email';
  var jeton = null;
  var minuteurJeton = null;
  var occupe = false;

  var ui = {
    label: $('stepLabel'), msg: $('msg'),
    s1: $('step1'), s2: $('step2'), s3: $('step3'),
    byEmail: $('byEmail'), byPhone: $('byPhone'), identifier: $('identifier'), next1: $('next1'),
    qDate: $('qDate'), qPrix: $('qPrix'), qRecv: $('qRecv'), verifyBtn: $('verifyBtn'), back2: $('back2'),
    pwd1: $('newPassword'), pwd2: $('confirmPassword'), toggleBtn: $('toggleBtn'), saveBtn: $('saveBtn')
  };

  var MESSAGES = {
    mismatch: "Les informations ne correspondent pas à votre dernière transaction. Vérifiez et réessayez. " +
              "Si vous n'avez encore fait aucune transaction, contactez-nous sur WhatsApp.",
    incomplete: 'Remplissez au moins 2 des 3 champs.',
    rate_limited: 'Trop de tentatives. Réessayez dans 30 minutes ou contactez-nous sur WhatsApp.',
    invalid_token: 'La vérification a expiré. Recommencez à l\'étape précédente.',
    weak_password: 'Mot de passe refusé : 6 caractères minimum, avec un chiffre, une majuscule et un caractère spécial (@ & € # $ £ ¥ %).',
    same_password: 'Choisissez un mot de passe différent de l\'ancien.',
    network: 'Problème de connexion internet. Vérifiez votre réseau.',
    server_error: 'Une erreur est survenue. Réessayez dans un instant.',
    bad_request: 'Demande invalide. Vérifiez les champs.',
    forbidden: 'Accès refusé depuis cette page.'
  };

  function message(texte, type) {
    ui.msg.textContent = texte || '';
    ui.msg.className = 'msg' + (type ? ' ' + type : '');
    ui.msg.hidden = !texte;
  }

  function aller(n) {
    etape = n;
    ui.s1.hidden = n !== 1;
    ui.s2.hidden = n !== 2;
    ui.s3.hidden = n !== 3;
    ui.label.textContent = 'Étape ' + n + ' sur 3';
    message('', '');
  }

  function validerMotDePasse(p) {
    if (!p || p.length < 6) return 'Le mot de passe doit contenir au moins 6 caractères.';
    if (!/\d/.test(p)) return 'Le mot de passe doit contenir au moins un chiffre.';
    if (!/[@&€#$£¥%]/.test(p)) return 'Le mot de passe doit contenir au moins un caractère spécial (@ & € # $ £ ¥ %).';
    if (!/[A-Z]/.test(p)) return 'Le mot de passe doit contenir au moins une lettre majuscule.';
    return '';
  }

  async function appeler(corps) {
    try {
      var res = await sb.functions.invoke('account-recovery', { body: corps });
      if (res.error) {
        var ctx = res.error.context;
        if (ctx && typeof ctx.json === 'function') {
          try { return await ctx.json(); } catch (e) { /* ignore */ }
        }
        return { ok: false, code: 'network' };
      }
      return res.data || { ok: false, code: 'server_error' };
    } catch (e) {
      return { ok: false, code: 'network' };
    }
  }

  function oublierJeton() {
    jeton = null;
    if (minuteurJeton) { clearTimeout(minuteurJeton); minuteurJeton = null; }
  }

  /* ----------------------------- ETAPE 1 ----------------------------- */
  function choisirMethode(m) {
    methode = m;
    ui.byEmail.setAttribute('aria-pressed', String(m === 'email'));
    ui.byPhone.setAttribute('aria-pressed', String(m === 'phone'));
    ui.identifier.value = '';
    if (m === 'email') {
      ui.identifier.type = 'email';
      ui.identifier.placeholder = 'Votre email';
      ui.identifier.setAttribute('autocomplete', 'email');
      ui.identifier.setAttribute('inputmode', 'email');
    } else {
      ui.identifier.type = 'tel';
      ui.identifier.placeholder = 'Numéro utilisé à l\'inscription (ex : 07 01 02 03 04)';
      ui.identifier.setAttribute('autocomplete', 'tel');
      ui.identifier.setAttribute('inputmode', 'tel');
    }
    message('', '');
    ui.identifier.focus();
  }

  function continuer() {
    var v = (ui.identifier.value || '').trim();
    if (methode === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      message('Entrez une adresse email valide.', 'err'); ui.identifier.focus(); return;
    }
    if (methode === 'phone' && v.replace(/\D/g, '').length < 10) {
      message('Entrez un numéro valide (10 chiffres).', 'err'); ui.identifier.focus(); return;
    }
    aller(2);
    ui.qDate.focus();
  }

  /* ----------------------------- ETAPE 2 ----------------------------- */
  async function verifier() {
    if (occupe) return;

    var date = (ui.qDate.value || '').trim();
    var prixTexte = (ui.qPrix.value || '').trim();
    var recv = (ui.qRecv.value || '').trim();

    var prix = prixTexte === '' ? null : Number(prixTexte);
    if (prix !== null && (!Number.isInteger(prix) || prix <= 0)) {
      message('Le montant doit être un nombre entier, par exemple 315.', 'err'); ui.qPrix.focus(); return;
    }
    if (recv !== '' && recv.replace(/\D/g, '').length < 10) {
      message('Le numéro du receveur doit contenir 10 chiffres.', 'err'); ui.qRecv.focus(); return;
    }

    var remplis = (date ? 1 : 0) + (prix !== null ? 1 : 0) + (recv ? 1 : 0);
    if (remplis < 2) { message(MESSAGES.incomplete, 'err'); return; }

    occupe = true;
    ui.verifyBtn.disabled = true;
    ui.verifyBtn.textContent = 'Vérification…';
    message('', '');

    var rep = await appeler({
      action: 'verify',
      method: methode,
      identifier: ui.identifier.value.trim(),
      date: date || null,
      prix: prix,
      receveur: recv || null
    });

    occupe = false;
    ui.verifyBtn.disabled = false;
    ui.verifyBtn.textContent = 'Vérifier';

    if (rep.ok && rep.token) {
      jeton = rep.token;
      /* le jeton n'existe qu'en mémoire : on l'oublie à son expiration */
      minuteurJeton = setTimeout(function () {
        oublierJeton();
        if (etape === 3) { aller(2); message('La vérification a expiré. Recommencez.', 'err'); }
      }, Math.max(30, (rep.expires_in || 600) - 5) * 1000);
      ui.qDate.value = ''; ui.qPrix.value = ''; ui.qRecv.value = '';
      aller(3);
      ui.pwd1.focus();
      return;
    }

    message(MESSAGES[rep.code] || MESSAGES.server_error, 'err');
  }

  /* ----------------------------- ETAPE 3 ----------------------------- */
  async function enregistrer() {
    if (occupe || !jeton) return;

    var p1 = ui.pwd1.value;
    var p2 = ui.pwd2.value;

    var probleme = validerMotDePasse(p1);
    if (probleme) { message(probleme, 'err'); ui.pwd1.focus(); return; }
    if (p1 !== p2) { message('Les deux mots de passe ne sont pas identiques.', 'err'); ui.pwd2.focus(); return; }

    occupe = true;
    ui.saveBtn.disabled = true;
    ui.saveBtn.textContent = 'Enregistrement…';
    message('', '');

    var rep = await appeler({ action: 'reset', token: jeton, password: p1 });

    occupe = false;

    if (rep.ok) {
      oublierJeton();
      ui.pwd1.value = ''; ui.pwd2.value = '';
      ui.pwd1.disabled = true; ui.pwd2.disabled = true;
      ui.saveBtn.hidden = true; ui.toggleBtn.hidden = true;
      message('Mot de passe modifié. Redirection vers la connexion…', 'ok');
      setTimeout(function () { window.location.href = 'index.html'; }, 2500);
      return;
    }

    ui.saveBtn.disabled = false;
    ui.saveBtn.textContent = 'Enregistrer le mot de passe';

    if (rep.code === 'invalid_token') {
      oublierJeton();
      aller(2);
      message(MESSAGES.invalid_token, 'err');
      return;
    }
    message(MESSAGES[rep.code] || MESSAGES.server_error, 'err');
  }

  /* ----------------------------- BRANCHEMENTS ----------------------------- */
  var aujourdhui = new Date().toISOString().slice(0, 10);
  ui.qDate.max = aujourdhui;

  ui.byEmail.addEventListener('click', function () { choisirMethode('email'); });
  ui.byPhone.addEventListener('click', function () { choisirMethode('phone'); });
  ui.next1.addEventListener('click', continuer);
  ui.identifier.addEventListener('keydown', function (e) { if (e.key === 'Enter') continuer(); });
  ui.verifyBtn.addEventListener('click', verifier);
  ui.back2.addEventListener('click', function () { aller(1); });
  ui.saveBtn.addEventListener('click', enregistrer);
  ui.pwd2.addEventListener('keydown', function (e) { if (e.key === 'Enter') enregistrer(); });

  ui.toggleBtn.addEventListener('click', function () {
    var afficher = ui.pwd1.type === 'password';
    ui.pwd1.type = afficher ? 'text' : 'password';
    ui.pwd2.type = afficher ? 'text' : 'password';
    ui.toggleBtn.textContent = afficher ? 'Masquer les mots de passe' : 'Afficher les mots de passe';
    ui.toggleBtn.setAttribute('aria-pressed', String(afficher));
  });
})();
