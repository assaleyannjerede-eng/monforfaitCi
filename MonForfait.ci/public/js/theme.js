/**
 * theme.js — Thème clair / sombre (dashboard.html)
 * ------------------------------------------------
 * - Chargé dans le <head> : le thème est posé sur <html data-theme="...">
 *   AVANT le premier affichage (pas de flash sombre -> clair).
 * - Le choix est mémorisé dans localStorage (clé « mf_theme »).
 * - Par défaut : sombre, comme le site avant l'ajout du bouton.
 * - Fichier externe (pas de <script> inline) : la CSP du site
 *   n'autorise pas 'unsafe-inline' pour les scripts.
 */
(function () {
  'use strict';

  var KEY = 'mf_theme';
  var root = document.documentElement;

  function lire() {
    try {
      var v = localStorage.getItem(KEY);
      return v === 'light' || v === 'dark' ? v : null;
    } catch (e) {
      return null; /* stockage bloqué (navigation privée stricte...) */
    }
  }

  function ecrire(v) {
    try { localStorage.setItem(KEY, v); } catch (e) { /* sans importance */ }
  }

  function majBouton(theme) {
    var btn = document.getElementById('themeToggle');
    if (!btn) return;
    /* Le bouton annonce l'action : en sombre il propose le mode clair. */
    var versClair = theme === 'dark';
    var icone = document.getElementById('themeIcon');
    var libelle = document.getElementById('themeLabel');
    if (icone) icone.textContent = versClair ? '☀️' : '🌙';
    if (libelle) libelle.textContent = versClair ? 'Mode clair' : 'Mode sombre';
    btn.setAttribute(
      'aria-label',
      versClair ? 'Passer le site en mode clair' : 'Passer le site en mode sombre'
    );
  }

  function appliquer(theme) {
    root.setAttribute('data-theme', theme);
    majBouton(theme);
  }

  /* 1. Tout de suite (script du <head>) */
  root.setAttribute('data-theme', lire() || 'dark');

  /* 2. Quand le bouton existe */
  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('themeToggle');
    majBouton(root.getAttribute('data-theme'));
    if (!btn) return;
    btn.addEventListener('click', function () {
      var suivant = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      appliquer(suivant);
      ecrire(suivant);
    });
  });
})();
