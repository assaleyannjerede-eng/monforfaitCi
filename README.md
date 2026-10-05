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

Après connexion (email + mot de passe) sur `index.html`, chaque compte est
redirigé automatiquement selon son rôle :

| Compte                | Rôle          | Redirigé vers        | Droits |
|------------------------|---------------|-----------------------|--------|
| AgentMTN@gmail.com      | admin / MTN    | `agent-mtn.html`      | Voir + confirmer/rejeter les transactions **MTN** uniquement |
| AgentORANGE@gmail.com   | admin / Orange | `agent-orange.html`   | Voir + confirmer/rejeter les transactions **Orange** uniquement |
| AgentMOOV@gmail.com     | admin / MOOV   | `agent-moov.html`     | Voir + confirmer/rejeter les transactions **MOOV** uniquement |
| (à créer) super-admin   | super_admin    | `transactions.html`   | Voir + confirmer/rejeter/**supprimer**/exporter, **MTN + Orange + Moov** |
| Client normal           | user           | `dashboard.html`      | Achat de forfaits (inchangé) |

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

## 🎁 Bonus fidélité : −10 % pendant 3 jours

| Souscriptions confirmées (prix catalogue) | Affiché au client | Récompense |
|---|---|---|
| **4** forfaits à 200 F | 220 F | **−10 %** sur le prochain forfait à 220 F (→ 198 F) |
| **3** forfaits à 500 F | 550 F | **−10 %** sur le prochain forfait à 550 F (→ 495 F) |
| **2** forfaits à 1 000 F | 1 100 F | **−10 %** sur le prochain forfait à 1 100 F (→ 990 F) |

La réduction reste valable **3 jours** à partir du moment où l'agent confirme
la souscription qui l'a fait gagner. Passé ce délai elle est perdue (le
compteur, lui, continue).

**Mise en place (une seule fois)**
1. Supabase > SQL Editor : exécuter **`supabase/006_bonus_reduction.sql`**
   (après schema.sql, 002, 003 et 005). **Le 004 n'est plus nécessaire** :
   le 006 crée lui-même ce dont il a besoin, et garde le transfert d'unités
   de 005. Si le 004 a déjà été exécuté, le 006 le remplace automatiquement.
   **À exécuter AVANT de déployer le nouveau `public/`.**
2. Déployer `public/` (fichiers modifiés : `js/app.js`, `js/promo.js`,
   `js/transactions.js`, `css/promo.css`, `dashboard.html`).

**Comportement**
- **Page d'annonce** : inchangée dans son principe (une fois par session +
  bouton « Voir l'offre fidélité »), mais son texte est lu dans `bonus_rules`
  et annonce maintenant la réduction.
- **Suivi par numéro payeur Wave** (pas besoin de compte), par tranche de
  prix, tous opérateurs confondus. Seuls les achats **confirmés** par un agent
  comptent. Un achat avec réduction compte aussi (il est payé).
- **Les compteurs repartent de zéro** à l'exécution de 006
  (`app_settings.bonus_start_at`) : pas de réductions rétroactives.
- **Dans le formulaire** : le client voit sa progression (« encore 2 achats
  confirmés… ») ou, s'il a une réduction, le prix barré → réduit, la date
  limite, et le bouton devient « Payer 495 F avec Wave (−10 %) ». Wave
  s'ouvre avec le montant réduit.
- **Notification** : quand l'agent confirme la souscription qui fait gagner la
  réduction, le client connecté reçoit, dans la même alerte temps réel que
  « Votre souscription a été acceptée ! », le message « 🎁 Vous avez gagné −10 %
  … valable jusqu'au … ». (Le serveur l'écrit dans `transactions.meta.bonus_gagne`.)
- **Côté agents** : la colonne Montant affiche le prix déjà réduit avec
  « 🎁 −10 % » : c'est ce montant qu'il faut retrouver dans Wave.
- **Rejet / suppression** : si une souscription avec réduction est rejetée ou
  supprimée, la réduction est rendue au client (tant qu'elle n'a pas expiré).
- **Sécurité** : c'est le serveur (triggers SQL) qui calcule le prix réduit,
  jamais le navigateur ; `reduction_pct` est immuable après création ; la table
  `bonus_rewards` est illisible depuis le client.
- Les transferts d'unités ne participent pas au bonus.

**Modifier / arrêter l'offre** (SQL Editor) :
```sql
update public.bonus_rules set achats_requis = 5 where prix_base = 200;       -- 5 achats au lieu de 4
update public.bonus_rules set reduction_pct = 15, validite_jours = 5;        -- 15 % pendant 5 jours
update public.bonus_rules set active = false;                                -- tout arrêter
insert into public.bonus_rules (prix_base, achats_requis) values (300, 3);   -- nouvelle tranche
```

## 💸 Transfert d'unités (montants rapides ou libres)

Le client paie par Wave (montant + frais) et un agent envoie les unités au
numéro receveur, comme pour un forfait.

**Mise en place** : exécuter `supabase/005_transfert_unites.sql` dans le SQL
Editor (après schema.sql, 002 et 003 ; le 004 n'est plus requis), puis déployer `public/` (nouveau : `css/unites.css`).
Tant que le SQL n'est pas exécuté, la section reste cachée et le site
fonctionne comme avant.

**Côté client** (formulaire de paiement, section « 💸 Transfert d'unités ») :
boutons 500 / 1 000 / 2 000 / 5 000 F, ou un autre montant saisi librement.
Le prix à payer (frais inclus) s'affiche avant le paiement. On choisit soit un
forfait, soit des unités (l'un annule l'autre). « Racheter » fonctionne aussi.

**Côté agents** : la colonne Forfait affiche « Transfert d'unités 2 000 F ».

**Sécurité** : le serveur valide le montant et recalcule le prix (le prix
envoyé par le navigateur est ignoré). `unites_montant` est immuable après
création. Les transferts d'unités ne comptent pas pour le bonus fidélité (réduction −10 %).

**Réglages** (table `app_settings`, SQL Editor) :
```sql
update public.app_settings set value = '100'   where key = 'units_min';              -- minimum (F)
update public.app_settings set value = '100000' where key = 'units_max';             -- maximum (F)
update public.app_settings set value = '1.05'  where key = 'units_commission_rate'; -- 1.05 = +5 %
update public.app_settings set value = 'false' where key = 'units_enabled';          -- couper le service
```
