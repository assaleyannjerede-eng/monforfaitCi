# MonForfait.ci

Site web (front-end statique + Firebase) pour l'achat et le suivi de forfaits
mobiles (MTN, Orange, Moov, Wave) en Côte d'Ivoire.

## Structure du projet

```
MonForfait.ci/
├── public/              Site statique (à déployer tel quel : Firebase Hosting, Netlify, etc.)
│   ├── index.html
│   ├── register.html
│   ├── dashboard.html
│   ├── transactions.html
│   ├── css/
│   ├── js/
│   └── img/             Logos (logo.png, logo_mtn.png, logo_orange.png, logo_moov.jpg, logo_wave.jpg)
├── admin/
│   └── set-admin.js      Script Node (Admin SDK) pour attribuer le rôle admin à un utilisateur
├── server/
│   └── server.js         Prototype de backend Express (⚠️ non branché au site, voir note plus bas)
├── docs/
│   └── FIREBASE_SETUP.md Détails de la configuration Firestore / Auth
├── firestore.rules
├── serviceAccountKey.json   ⚠️ clé privée Firebase Admin — ne jamais committer ni partager
├── package.json
└── package-lock.json
```

## Démarrage

```bash
npm install            # installe firebase-admin (utilisé par admin/set-admin.js)
npm run set-admin       # attribue le rôle admin à l'UID défini dans admin/set-admin.js
```

Le site (`public/`) est statique : ouvrez `public/index.html` dans un navigateur,
ou servez le dossier `public/` avec Firebase Hosting / n'importe quel serveur statique.

Voir `docs/FIREBASE_SETUP.md` pour la configuration Firestore, les règles de
sécurité et l'intégration Wave à venir.

## ⚠️ Points de sécurité à corriger

1. **`serviceAccountKey.json` a été trouvé dans l'archive fournie.** C'est une
   clé d'administration Firebase (accès total au projet). Le `.gitignore`
   l'exclut bien de Git, mais puisqu'elle a déjà été zippée/partagée, il est
   recommandé de la **révoquer et régénérer** depuis la console Firebase
   (Paramètres du projet → Comptes de service), par précaution.
2. **`server/server.js`** (anciennement `js/node.js`) est un prototype Express
   non relié au reste du site : ni `express` n'est dans `package.json`, ni la
   route `/api/paiement` n'est appelée depuis le front-end. Il contient aussi
   une variable non définie (`prix` au lieu de `montant`). À corriger ou
   supprimer selon que vous comptez le développer ou non.
3. **`public/img/logo_wave.jpg`** n'est référencé dans aucune page pour
   l'instant (le logo Wave n'apparaît pas encore à côté de MTN/Orange/Moov
   dans `dashboard.html`) — probablement en attente de l'intégration Wave
   mentionnée dans `docs/FIREBASE_SETUP.md`.

## Ce qui a changé par rapport à l'archive d'origine

- Le dossier dupliqué `MonForfait.ci/MonForfait.ci/` a été aplati.
- Le site statique a été regroupé sous `public/` (au lieu d'être mélangé à la
  racine avec le script admin et les dépendances Node).
- Les logos (`logo*.png/jpg`) ont été déplacés dans `public/img/` ; les
  balises `<img src="...">` des 4 pages ont été mises à jour en conséquence.
- `js/node.js` (backend isolé, sans lien avec le reste du dossier `js/` qui
  est 100 % front-end) a été déplacé vers `server/server.js`.
- `FIREBASE_SETUP.md` a été déplacé vers `docs/`.
- `node_modules/` n'est pas inclus dans cette archive (86 Mo, régénérable via
  `npm install`) — le `.gitignore` l'exclut déjà.

## Espaces agents et super-admin (MTN / Orange / Moov)

> Le reste de ce README (structure du projet, `admin/set-admin.js`,
> `server/`, Firebase...) décrit une version antérieure du projet et ne
> correspond plus à cette archive, qui est 100 % Supabase (voir
> `supabase/schema.sql`, `002_security_hardening.sql`,
> `RAPPORT_SECURITE.md`). Cette section décrit uniquement l'ajout ci-dessous.


La restriction par opérateur est appliquée à **deux niveaux** (défense en
profondeur, dans l'esprit de `RAPPORT_SECURITE.md`) :
- **Base de données (RLS Supabase)** — un agent ne peut techniquement lire/
  modifier que les lignes de son propre `operateur`, même en contournant
  l'interface (voir `supabase/003_super_admin_access.sql`).
- **Interface** — chaque page agent masque la colonne « Opérateur », le
  filtre correspondant, ainsi que la suppression et l'export (réservés au
  super-admin), et redirige automatiquement un agent qui atterrirait sur la
  page d'un autre opérateur ou sur la page super-admin.

### Mise en place du compte super-admin (à faire une seule fois)

1. Dans Supabase, exécutez **`supabase/003_super_admin_access.sql`**
   (SQL Editor) — ajoute le rôle `super_admin` et les policies associées.
2. **Authentication > Users** : créez le compte du super-admin (email de
   votre choix, mot de passe fort).
3. Ouvrez `supabase/admin-setup.sql`, remplacez `SuperAdmin@gmail.com` par
   le vrai email, puis exécutez (au moins) ce bloc dans le SQL Editor.
4. Déployez le contenu de `public/` (inchangé niveau hébergement) : les 3
   nouvelles pages `agent-mtn.html` / `agent-orange.html` / `agent-moov.html`
   doivent se trouver au même niveau que `index.html` et `transactions.html`.

Les comptes AgentMTN / AgentORANGE / AgentMOOV existants n'ont besoin
d'aucune manipulation : ils sont redirigés vers leur nouvelle page dès leur
prochaine connexion.

## Thème clair/sombre, dépôt Mobile Money et recharge fibre

Ajouts de `dashboard.html` (d'après la maquette `monforfait_dashboard_maquette_theme_depot_fibre`).

| Fichier | Rôle |
|---|---|
| `public/js/theme.js` | Bouton « Mode clair / Mode sombre » ; choix mémorisé (`localStorage`, clé `mf_theme`), sombre par défaut. Chargé dans le `<head>` pour éviter le flash. |
| `public/css/theme.css` | Style du bouton + thème clair (dashboard, fenêtre de paiement, souscriptions programmées). Le pied de page reste sombre. |
| `public/css/services.css` | Cartes « Dépôt Mobile Money » et « Recharge fibre » + panneau de saisie. |
| `public/js/services.js` | Logique des deux services (validation, enregistrement, ouverture de Wave). |
| `public/js/app.js` | `addTransactionToHistory` séparée en `ajouterHistoriqueLocal` + `envoyerTransaction` (même comportement qu'avant pour les forfaits/unités) et exposée via `window.MonForfaitCore`. Pas de bouton « Racheter » pour dépôt/fibre. |

**Contraintes de la CSP respectées** : aucun `<script>` ni handler inline ; pas de police d'icônes
externe (la maquette utilisait Tabler Icons depuis jsdelivr, bloquée par `style-src`/`font-src`) :
les icônes sont des emojis, comme le reste du site.

**Flux** : la demande est enregistrée dans `transactions` (statut `pending`) AVANT l'ouverture de
Wave. Si la base la refuse, Wave n'est pas ouvert et le client voit une erreur (le paiement n'est
jamais lancé pour une demande invisible des agents).

**Données envoyées à `transactions`** (côté base, ces valeurs doivent être acceptées) :

- `forfait_code` : `depot_orange`, `depot_mtn`, `depot_moov`, `fibre_orange`, `fibre_mtn`, `fibre_moov`
- `operateur` : `Orange` / `MTN` / `MOOV` (casse du reste du site)
- `forfait_label` : « Dépôt MTN Money 5 000 F », « Recharge fibre Orange 15 000 F »
- `prix` : montant choisi, sans frais ajoutés ; `receveur` : numéro à créditer (dépôt) ou ligne fibre
- montants proposés : dépôt 1 000 / 5 000 / 10 000 / 20 000 F, fibre 10 000 / 15 000 / 25 000 / 35 000 F
  (constante `MONTANTS` en tête de `services.js`)

⚠️ **À faire côté Supabase** : le trigger de `002_security_hardening.sql` recalcule le prix depuis
`public.forfaits` et rejette les codes inconnus. Tant qu'une migration n'autorise pas les codes
`depot_*` / `fibre_*` (et leurs montants), ces deux services afficheront « demande non enregistrée »
et ne lanceront aucun paiement.

## Ordre d'exécution des scripts SQL (Supabase > SQL Editor)

À exécuter **dans cet ordre**, chacun une seule fois (tous sont relançables sans danger) :

1. `supabase/schema.sql`
2. `supabase/002_security_hardening.sql`
3. `supabase/003_super_admin_access.sql`
4. `supabase/005_transfert_unites.sql`
5. `supabase/007_fix_transactions_sans_bonus.sql` — trigger d'insertion **complet**
   (forfaits + unités + dépôt/fibre) et **suppression définitive du bonus / de la réduction fidélité**

Le système de bonus/réduction n'existe plus (ni sur le site, ni dans la base) : les anciens
fichiers `006_bonus_reduction.sql` et `006_depot_fibre.sql` ont été retirés du projet. 007 contient
tout ce qui était utile dans `006_depot_fibre.sql`. Si un prérequis manque, 007 s'arrête et liste
précisément le fichier à exécuter avant.

⚠️ 007 supprime les tables `bonus_rules` / `bonus_rewards` et les colonnes
`transactions.is_bonus`, `reduction_pct`, `bonus_reward_id` : faites une sauvegarde avant si
vous voulez garder une trace des réductions déjà gagnées. Les transactions ne sont pas touchées.

Côté site, une demande n'est annoncée « enregistrée » et Wave n'est ouvert **qu'après**
acceptation par la base ; en cas de refus, le message du serveur est affiché au client.
