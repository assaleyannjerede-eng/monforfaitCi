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
