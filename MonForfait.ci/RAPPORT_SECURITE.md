# Rapport de sécurité — MonForfait.ci

Audit du projet fourni (Supabase + front-end statique) avant mise en production.
Ce document liste : ce qui doit être fait **par vous, immédiatement**, ce qui a
**déjà été corrigé** dans le code livré, et ce qui reste **recommandé** avant/après
le déploiement.

---

## 🟣 0. Mise à jour — XSS stockée corrigée + CSP durcie

Un scan externe a signalé 13 usages d'`innerHTML` construits par concaténation
de chaînes (catégorie XSS/CWE-79). Vérification faite :

- **Faille réelle et corrigée** : dans `public/js/transactions.js` (panneau
  admin), les champs `payer`, `receveur`, `operateur`, `forfaitLabel` et
  `meta.providerRef` d'une transaction étaient insérés dans `innerHTML` sans
  aucun échappement, dans le tableau et dans la modale de détails. Comme
  `payer`/`receveur` viennent du formulaire public (contournable via la clé
  `anon` Supabase, voir §2), un attaquant pouvait faire exécuter du JavaScript
  **dans la session d'un admin** dès qu'il ouvrait `transactions.html` —
  potentiellement de quoi détourner sa session ou confirmer des transactions à
  sa place. Le rendu du tableau et de la modale utilise maintenant
  `createElement`/`textContent` exclusivement, plus aucune concaténation HTML.
- `public/js/app.js` : les 9 autres occurrences étaient déjà en grande partie
  échappées (`escapeHtml`/`eH`), risque réel faible, mais reconstruites en DOM
  natif par cohérence et pour éliminer le motif détecté par ce type d'outil.
- Le second point du scan ("Secure database queries", verrouillé derrière un
  paywall) ne correspond à aucune requête SQL brute ni `.rpc()` construit par
  concaténation dans le code — uniquement des appels `.from()` du client
  Supabase (paramétrés côté REST). À ne pas payer sans plus de détail.

**CSP durcie** : tous les `onclick="..."` inline (`dashboard.html`,
`index.html`, `register.html`) ont été remplacés par `addEventListener`
(boutons opérateur via `data-operateur`, boutons connexion/inscription via
`id`). `script-src` dans `public/_headers`, `vercel.json` et `firebase.json`
n'autorise donc plus `'unsafe-inline'` — seuls les scripts de `'self'` et
`cdn.jsdelivr.net` peuvent s'exécuter. `style-src` garde `'unsafe-inline'`
(les styles inline `style="..."`/`cssText` sont encore utilisés partout ;
retirer ce point serait un refactor plus large, séparé de celui-ci).

**À faire de votre côté** : redéployez pour que le nouvel en-tête CSP soit
servi (aucun changement de configuration Supabase requis pour ce point).

---

## 🔴 1. Action obligatoire, à faire MAINTENANT (avant toute autre chose)

**Le fichier `serviceAccountKey.json` présent dans votre archive contient une
vraie clé privée d'administration Firebase** (accès total : Auth, Firestore,
Storage de tout le projet `monforfait-32ab2`). Le fait qu'elle se trouve dans
un zip que vous avez partagé — même si `.gitignore` l'exclut de Git — suffit à
la considérer comme compromise : elle a pu être copiée, envoyée par email,
stockée sur un disque cloud, etc.

**À faire dans la console Firebase (Paramètres du projet → Comptes de
service)** :
1. Repérez le compte de service correspondant à `private_key_id` commençant
   par `aca3cd54...`.
2. **Révoquez/supprimez cette clé** puis générez-en une nouvelle si vous en
   avez encore besoin.
3. Ne remettez plus jamais ce fichier dans une archive, un email ou un dépôt
   Git. Gardez-le uniquement en local, hors du dossier du projet si possible.

Ce fichier a été **retiré du livrable ci-joint** — voir section 3.

> Bonne nouvelle en creusant le code : `public/js/firebase.js` (qui ne
> contient que la config publique de l'app Firebase, pas la clé privée)
> n'est en réalité **chargé par aucune page HTML** du site. Firebase
> Auth/Firestore ne semble plus utilisé du tout — vous êtes passés à 100% sur
> Supabase. La clé de service n'en reste pas moins un accès total au projet
> Firebase tant qu'elle n'est pas révoquée, même si le site ne s'en sert plus.

---

## 🟠 2. Faille corrigée dans le code : le prix et le statut étaient fabriqués côté client

C'était la faille la plus grave après la clé exposée, car elle touche
directement l'argent.

**Avant correction**, le formulaire de paiement calculait le prix dans le
navigateur (`data-prix` sur un bouton radio HTML) puis l'envoyait tel quel à
Supabase. La policy RLS `"Anyone can create a transaction"` ne vérifiait que
le `user_id`, pas la cohérence des données. N'importe qui pouvait, depuis la
console du navigateur, exécuter :

```js
supabaseClient.from('transactions').insert({
  operateur: 'MTN', forfait_code: 'invente', prix: 1,
  status: 'confirmed',   // ← déjà "confirmé", sans jamais payer
  payer: '0700000000', receveur: '0500000000', ...
})
```

et créer une transaction avec le prix de son choix, déjà marquée comme
confirmée — sans être jamais passé par Wave.

**Cause racine découverte en creusant** : la table `public.forfaits` existait
dans le schéma SQL mais n'avait **jamais été peuplée**. Le catalogue des
offres n'existait que dans le fichier front-end `forfaits.js`, donc côté
client — il n'y avait tout simplement aucune source de vérité côté serveur à
laquelle comparer le prix envoyé.

**Bug annexe découvert** : dans `forfaits.js`, 3 forfaits partageaient le même
`code` que 2 ou 5 autres offres à des prix différents (ex. `mtn_net_mois_3000`
utilisé pour 3 forfaits distincts à 200 F / 300 F / 500 F). Impossible de
valider un prix côté serveur par code tant que les codes ne sont pas uniques.

**Corrections appliquées dans ce livrable :**
- `public/js/forfaits.js` : les codes dupliqués ont été renommés en `_2`,
  `_3`, etc. (ex. `mtn_net_mois_3000_2`) pour qu'un code identifie une seule
  offre à un seul prix.
- `supabase/002_security_hardening.sql` (nouveau fichier, à exécuter dans
  Supabase Dashboard → SQL Editor) :
  - Remplit `public.forfaits` avec les vraies offres/prix (source de vérité).
  - Ajoute un **trigger serveur** qui, à chaque insertion de transaction,
    ignore le prix et le libellé envoyés par le client et les **recalcule**
    depuis `public.forfaits` (prix catalogue × commission).
  - **Force `status = 'pending'`** à l'insertion, quoi que le client envoie :
    plus personne ne peut créer une transaction déjà "confirmée".
  - Vérifie que l'opérateur envoyé correspond bien au forfait.
  - Revalide le format des numéros payeur/receveur côté serveur (le client
    peut toujours être contourné).
  - Ajoute un garde-fou anti-rafale (5 transactions max par numéro payeur sur
    5 minutes) — un vrai captcha reste recommandé en complément, voir §5.
  - Ajoute un **trigger d'immutabilité** : une fois créée, une transaction ne
    peut plus voir son prix, son forfait ou son opérateur modifiés — même par
    un compte admin — seuls le statut et la décision peuvent changer.

**À faire de votre côté** : ouvrez le SQL Editor de votre projet Supabase et
exécutez le contenu de `supabase/002_security_hardening.sql` (après avoir déjà
exécuté `schema.sql` si ce n'est pas fait). Vérifiez ensuite dans *Table
Editor* que la table `forfaits` contient bien ~32 lignes.

---

## 🟡 3. Autres correctifs appliqués dans ce livrable

| Fichier | Correctif |
|---|---|
| `serviceAccountKey.json` | **Retiré** du livrable (secret compromis, voir §1) |
| `public/index.html`, `register.html`, `dashboard.html`, `transactions.html` | Le SDK Supabase était chargé via `@supabase/supabase-js@2` (tag flottant : la version exacte livrée peut changer sans préavis). Épinglé en dur sur `@2.117.0`, la dernière version stable au moment de l'audit. |
| `.gitignore` | Renforcé : ajout de `*.pem`, `*.key`, `*firebase-adminsdk*.json`, `.env.*`, `.vercel`, `.netlify`, etc. |
| `public/js/firebase.js` | Commentaire ajouté : ce fichier n'est chargé par aucune page, probablement du code mort à supprimer une fois confirmé (voir §6). |
| `public/_headers`, `vercel.json`, `firebase.json` | Nouveaux : en-têtes de sécurité HTTP (CSP, HSTS, anti-clickjacking...) pour Netlify/Cloudflare Pages, Vercel et Firebase Hosting — utilisez celui qui correspond à votre hébergeur, supprimez les deux autres. |

---

## 🟢 4. Checklist Supabase à vérifier avant la mise en production

Ces réglages se font dans le **Dashboard Supabase** et ne peuvent pas être
appliqués depuis le code :

- [ ] **Authentication → URL Configuration** : renseignez le vrai *Site URL*
  de production et supprimez les URLs de redirection de test/localhost.
- [ ] **Authentication → Providers → Email** : activez *Confirm email* (sinon
  n'importe qui crée un compte avec un email qu'il ne possède pas).
- [ ] **Authentication → Attack Protection** : activez le *CAPTCHA*
  (Cloudflare Turnstile, gratuit) sur les formulaires d'inscription/connexion
  — bloque l'essentiel de la création de comptes automatisée.
- [ ] **Authentication → Policies** : activez la protection contre les mots de
  passe compromis (*leaked password protection*) et envisagez un minimum de 8
  caractères au lieu de 6 côté client (`app.js`, ligne `password.length < 6`).
- [ ] **Authentication → Users** : vérifiez que les 3 comptes admin créés via
  `admin-setup.sql` (AgentMTN/ORANGE/MOOV) ont des mots de passe forts et,
  idéalement, activez la 2FA sur ces comptes — ce sont eux qui valident les
  paiements.
- [ ] **Database → Roles** : ne collez jamais la clé `service_role` dans un
  fichier du dossier `public/` ou dans un dépôt Git ; elle contourne
  totalement RLS. Seule la clé `anon` (`sb_publishable_...`) doit apparaître
  côté client — c'est déjà le cas ici, à vérifier si le projet évolue.
- [ ] **Settings → API → CORS** (si vous appelez l'API REST directement) :
  restreignez aux domaines de production une fois le nom de domaine final
  connu.
- [ ] **Database → Backups** : activez les sauvegardes automatiques /
  Point-in-Time Recovery avant d'avoir de vraies transactions financières en
  base.

---

## 🔵 5. Recommandations supplémentaires (au-delà de ce livrable)

- **CAPTCHA sur le formulaire de paiement**, pas seulement sur
  inscription/connexion : c'est le formulaire accessible sans compte
  (`ouvrirModal` → soumission anonyme), donc le plus exposé au spam/bots. Le
  garde-fou anti-rafale ajouté en base (§2) limite les dégâts mais un captcha
  bloque en amont.
- **Flux de confirmation plus robuste côté front-end** : actuellement,
  `addTransactionToHistory()` affiche « Demande enregistrée ! » à
  l'utilisateur **avant même** de connaître le résultat de l'envoi vers
  Supabase (l'appel est en `.then()/.catch()`, jamais attendu). Avec les
  nouvelles validations serveur (§2), une transaction rejetée par le serveur
  (numéro invalide, forfait inconnu, rafale détectée...) affichera quand même
  un succès à l'utilisateur alors que rien n'a été enregistré côté admin. Je
  peux corriger ce flux si vous le souhaitez (`await` l'insertion, afficher
  une vraie erreur en cas d'échec).
- **CSP sans `'unsafe-inline'` pour `script-src`** : ✅ fait, voir §0. Il reste
  `'unsafe-inline'` sur `style-src` (nombreux `style="..."` / `.cssText` dans
  le code) — dites-moi si vous voulez aussi ce refactor, plus large.
- **Nettoyage Firebase** : si vous confirmez que Firebase Auth/Firestore
  n'est plus utilisé (tout indique que non), supprimez `public/js/firebase.js`
  et `firestore.rules` du dépôt, et envisagez de supprimer les données restées
  dans Firestore/Firebase Auth pour ne plus payer/gérer un projet inutile.
- **Rate limiting réseau** : si votre hébergeur le permet (Cloudflare,
  Netlify), ajoutez une règle de rate limiting par IP sur les routes
  Supabase appelées depuis le navigateur, en complément du garde-fou SQL.
- **Journalisation des actions admin** : aujourd'hui, `decision_by` stocke
  l'email de l'admin qui confirme/rejette (déjà bien). Envisagez une table
  `audit_log` séparée si vous devez un jour justifier chaque décision
  (litige client, contrôle).

---

## Résumé express

| Priorité | Action | Qui |
|---|---|---|
| 🔴 Immédiat | Révoquer la clé `serviceAccountKey.json` dans la console Firebase | **Vous, maintenant** |
| 🟠 Avant mise en prod | Exécuter `supabase/002_security_hardening.sql` | **Vous** (5 min) |
| 🟠 Avant mise en prod | Cocher la checklist Supabase (§4) | **Vous** |
| 🟡 Avant mise en prod | Déployer avec le fichier d'en-têtes correspondant à votre hébergeur | **Vous** |
| 🔵 Recommandé | Captcha, flux de confirmation front-end, CSP stricte | Dites-moi si vous voulez que je m'en charge |
