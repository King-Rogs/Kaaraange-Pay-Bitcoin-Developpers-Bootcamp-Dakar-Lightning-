> Livraison backend : consulter [le rapport complet](docs/rapport-livraison-backend.md), [la checklist validée](docs/backend-finalise.md) et [le contrat API](docs/contrat-api-backend.md). Les 47 tests backend, 23 contrôles Lightning et 4 contrôles Core ont réussi. La branche de livraison contient le backend et sa documentation ; l’équipe frontend doit intégrer les nouveaux états financiers et le motif obligatoire des arbitrages.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/kaaraange-logo-dark.png">
    <img src="docs/brand/kaaraange-logo-light.png" alt="Kaaraange Pay" width="220">
  </picture>
</p>

# Kaaraange Pay

**Le séquestre automatique sur Bitcoin Lightning pour le commerce sur WhatsApp, TikTok et Instagram.**

L'argent de l'acheteur reste bloqué jusqu'à la remise du colis. Le vendeur **et** le livreur sont payés en un seul scan du QR code du client. Après refus, le livreur est payé au retour confirmé, puis le vendeur rembourse la livraison à l’acheteur selon la règle retenue.

> *Kaaraange* veut dire « protection » en wolof. Cette démonstration regtest utilise des nœuds partagés pilotés par le serveur ; les HTLC ne rendent pas les portefeuilles indépendants de l’opérateur.

Projet réalisé pour le hackathon de clôture d'un Bitcoin Bootcamp au Sénégal.

---

## 1. Le problème, la solution

Au Sénégal, une grande partie du commerce se fait entre inconnus sur les réseaux sociaux. Payer d'avance expose l'acheteur à l'arnaque ; payer à la livraison expose le vendeur aux faux clients et le livreur aux trajets pour rien.

Kaaraange Pay résout les trois problèmes à la fois avec un **séquestre Lightning à deux factures** :

| Facture | Montant | Créée par | Secret (preimage) |
|---|---|---|---|
| **A : article** | Prix du produit | Nœud du vendeur (`bob`) | Généré dans le **navigateur de l'acheteur**. Seul son hash SHA-256 est envoyé au serveur : c'est le **code de livraison**. |
| **B : livraison** | Frais de livraison | Nœud du livreur (`carol`) | Généré et gardé **côté serveur**, jamais renvoyé par l'API. |

À la remise, un seul scan du code de l'acheteur règle les deux factures : `settle(A)` avec le code scanné, puis `settle(B)` avec le secret serveur. Même en connaissant le secret B, personne ne peut détourner les fonds : B ne peut payer que le livreur.

Si le client refuse le colis ou est absent, `cancel(A)` rend le prix à l'acheteur, et B reste bloquée jusqu'à ce que le vendeur confirme le retour du colis — le livreur est payé pour son déplacement dans tous les cas.

---

## 2. Aperçu de l'application

- **Site public** : landing page avec cours BTC en direct (WebSocket Binance), académie des 9 notions du bootcamp, atelier interactif preimage → SHA-256 → payment_hash.
- **Espace vendeur** : boutique positionnée sur une carte OpenStreetMap, articles en BTC + FCFA, commandes reçues, confirmation du retour d'un colis refusé.
- **Espace acheteur** : catalogue, devis en direct (distance → frais → sats), suivi en 5 étapes avec la carte du livreur qui bouge en direct, code de livraison en QR, refus avec motif, notation.
- **Espace livreur** : en ligne/hors ligne, position GPS réelle ou simulée, fenêtre d'offre avec compte à rebours de 30 s, course en cours (carte boutique → client), retrait, scan du code, client absent.
- **Portefeuille Bitcoin** : un portefeuille regtest par utilisateur (createwallet, adresses, minage, envoi, UTXO).
- **Console Lightning** : les 3 nœuds (alice, bob, carol), canaux avec barres de liquidité, création/décodage/paiement de factures, vérification SHA-256(preimage) = payment_hash dans le navigateur.
- **Explorateur** : hauteur, mempool, derniers blocs, détail d'un bloc.
- **Administration** : vue d'ensemble, utilisateurs (export CSV, suspension, refus comptés), commandes et litiges (remboursement, paiement/annulation des frais, remboursement des frais par le vendeur), carte de tous les livreurs (dispatch), modération, santé du système, journal d'audit complet.

Toute l'interface est en français ; tous les montants sont affichés en BTC avec l'équivalent FCFA en direct (parité 1 € = 655,957 FCFA).

---

## 3. Architecture

```
kaaraange-pay/
├── backend/                  Node.js 22+, Express 5, ln-service — dérivé de connect-lnd
│   ├── src/
│   │   ├── server.js         Express, routes, boucles de fond (toutes les 2 s)
│   │   ├── config.js         lecture de backend/.env
│   │   ├── db.js             schéma SQLite (node:sqlite) + journal d'audit
│   │   ├── util.js           erreurs HTTP, haversine, validation, erreurs ln-service → FR
│   │   ├── price.js          cours BTC/FCFA (Binance → CoinGecko → repli fixe)
│   │   ├── auth.js           comptes, sessions, mot de passe oublié, profil, photo, avis
│   │   ├── orders.js         articles, devis, commandes à 2 factures, livraison, échéances
│   │   ├── dispatch.js       livreurs, offres, attribution automatique, simulation
│   │   ├── chain.js          portefeuille, explorateur, console Lightning
│   │   ├── admin.js          espace administrateur
│   │   ├── bitcoin.js        client JSON-RPC Bitcoin Core + chaîne regtest simulée
│   │   └── lightning/        index.js (façade) · real.js (ln-service) · mock.js (réseau simulé)
│   ├── test/flow.test.js     28 scénarios de bout en bout (npm test)
│   └── .env.example
└── frontend/                 React 18 + TypeScript + Vite 5 + Tailwind + Leaflet
    └── src/
        ├── pages/             Landing, Auth, Academy, app/*
        ├── components/        design system, cartes (Leaflet), graphe BTC (Recharts)
        ├── context/           authentification, thème, notifications
        └── lib/                client API, cours BTC, formats, secrets de livraison
```

### Les trois nœuds Lightning

| Rôle | Nœud Polar | Usage |
|---|---|---|
| `acheteur` | **alice** | Paie les deux factures (le serveur pilote alice à la place du portefeuille réel de l'acheteur, pour la démo) |
| `vendeur` | **bob** | Crée la hold invoice de l'**article** |
| `livreur` | **carol** | Crée la hold invoice de la **livraison** |

Canaux : **alice → bob** (2 000 000 sats) et **bob → carol** (1 000 000 sats). Les frais de livraison suivent donc le chemin **alice → bob → carol**, en 2 sauts — une démonstration concrète du routage Lightning, vérifiable dans la console (`route`) et dans les tests.

### Deux modes, pour tout démontrer même sans Polar

- `LND_MODE=mock` (par défaut) : réseau Lightning simulé en mémoire, qui se comporte comme LND (hold invoices, HTLC, recherche de chemin par parcours en largeur, liquidité qui se déplace, erreurs de liquidité insuffisante). `LND_MODE=lnd` bascule sur de vrais nœuds LND (Polar) via `ln-service`.
- `BTC_MODE=mock` (par défaut) : chaîne regtest simulée qui respecte les règles du regtest (50 BTC/bloc, halving tous les 150 blocs, maturité coinbase à 101 blocs, mempool, frais de 141 sats). `BTC_MODE=rpc` bascule sur un vrai `bitcoind` (Polar).
- `SIMULATION=true` (par défaut) : 6 livreurs fictifs se déplacent dans Dakar, acceptent 85 % des offres après 3 s, pour que la démo soit vivante sans personne pour jouer le livreur.

**Basculer sur Polar ne demande que de modifier `backend/.env`** (`LND_MODE=lnd`, `BTC_MODE=rpc`) : le reste du code est strictement identique.

---

## 4. Lancer le projet (Windows, PowerShell)

```powershell
# une seule fois, si l'exécution de scripts est bloquée
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force

# terminal 1 — backend (mode simulé, sans Polar)
cd backend
npm install
npm test        # 28 scénarios de bout en bout, doivent tous passer
npm start       # API sur http://localhost:5000

# terminal 2 — frontend
cd frontend
npm install
npm run dev     # interface sur http://localhost:5173
```

Ouvrez **http://localhost:5173**. Des comptes de démonstration sont créés automatiquement (mot de passe `demo1234`) :

| Rôle | E-mail |
|---|---|
| Vendeuse (boutique « Awa Couture », placée à Médina) | `awa@demo.kaaraange.sn` |
| Acheteuse | `fatou@demo.kaaraange.sn` |
| Livreur (compte réel, en plus des 6 livreurs simulés) | `moussa@demo.kaaraange.sn` |

Il n'y a **pas de compte admin tout prêt** : `admin@kaaraange.sn` (la valeur par défaut de `ADMIN_EMAIL` dans `.env.example`) n'existe pas tant que personne ne s'inscrit avec cette adresse. Pour obtenir un compte administrateur, **inscrivez-vous** (pas « se connecter ») avec cet e-mail — il est promu admin automatiquement dès l'inscription.

**Notes :**
- `python3` n'existe pas sous Windows et n'est pas utilisé ici (backend 100 % Node.js).
- Si `npm install` échoue (coupure réseau), relancez-le simplement : il reprend où il s'est arrêté.
- En production, `npm run build` dans `frontend/` puis `npm start` dans `backend/` : Express sert directement `frontend/dist`.

---

## 5. Démo guidée (≈ 8 minutes)

1. **Landing page** (30 s) — cours BTC en direct, section « Fonctionnement » : deux factures, un seul scan.
2. **Inscription vendeuse** (30 s) → *Ma boutique* : placer le point sur la carte (Médina), ajouter un article à 25 000 sats.
3. **Connexion acheteuse** (`fatou@demo.kaaraange.sn`) → *Acheter* → choisir l'article → placer le point de livraison sur la carte (Plateau) → voir le devis en direct (distance, frais, total) → **Payer**. Montrer que le statut passe à « Recherche d'un livreur ».
4. **Espace admin → Dispatch** : la carte montre les livreurs simulés qui se déplacent ; l'un d'eux reçoit une offre de 30 s, l'accepte, se dirige vers la boutique.
5. **Mes achats** (acheteuse) : la carte montre le livreur en direct ; le QR du code de livraison.
6. **Suite automatique (mode simulé)** : le livreur fictif récupère le colis puis attend ; **scanner/saisir le code** (bouton « J'ai reçu mon colis ») → règlements successifs du vendeur et du livreur, avec reprise persistante. Montrer les deux factures « SETTLED » dans « Sous le capot ».
7. **Scénario de refus** : refaire un achat, le livreur récupère le colis, l'acheteuse **refuse** (motif « non conforme ») → le prix revient instantanément, les frais restent bloqués → le vendeur confirme le retour → le livreur est payé quand même.
8. **Console Lightning** : montrer les 3 nœuds, les canaux alice→bob→bob→carol, payer une facture console et vérifier SHA-256(preimage) = payment_hash dans le navigateur.
9. **Portefeuille** : miner 101 blocs, montrer les 50 BTC qui deviennent disponibles, envoyer une transaction.

---

## 6. Questions probables du jury

**Combien de temps les fonds restent-ils bloqués ?**
`DEADLINE_MIN` (120 minutes par défaut) après le paiement : au-delà, une boucle de fond annule les deux factures et rembourse intégralement l'acheteur, en pratique la livraison se fait le jour même à Dakar. Sur un vrai réseau Lightning, le HTLC lui-même a un verrou temporel (CLTV) imposé par le protocole, bien plus long (de l'ordre de la journée à la semaine selon le nombre de sauts) ; notre délai applicatif est volontairement plus court et strict, car c'est la plateforme — pas le protocole — qui décide quand annuler une hold invoice encore ouverte.

**Et si le client refuse de donner son code ?**
Le livreur peut toujours déclarer le colis refusé (avec motif) ou le client absent (s'il est sur place). Dans les deux cas, `cancel(A)` rend le prix à l'acheteur sans son accord — la facture A n'exige **pas** le consentement du client pour être annulée, seulement son autorisation pour être réglée. Le livreur, lui, est payé dès que le vendeur confirme le retour du colis.

**La plateforme peut-elle voler l'argent ?**
Non. La plateforme ne détient jamais les secrets des deux factures en même temps avec les moyens de les utiliser à son profit : le secret A appartient à l'acheteur (créé dans son navigateur), le secret B ne peut régler que la facture du livreur (créée par le nœud du livreur, que la plateforme ne contrôle pas sur un vrai déploiement Polar). La seule chose qu'un opérateur malhonnête pourrait faire est de retarder un règlement — jamais rediriger les fonds vers un autre destinataire, puisque chaque hold invoice est verrouillée sur le `payment_hash` et le nœud qui l'a émise.

**Comment passe-t-on du FCFA aux sats ?**
`price.js` interroge Binance (`BTCEUR`, converti en FCFA à 655,957 F/€, parité fixe du franc CFA), avec repli sur CoinGecko puis sur une valeur fixe (`BTC_XOF_FALLBACK`) si les deux APIs sont injoignables. Le cours est mis en cache 60 secondes côté serveur pour éviter de le requêter à chaque devis.

**Pourquoi pas Wave ou Orange Money ?**
Ces portefeuilles mobiles sont excellents pour transférer de l'argent entre comptes de confiance, mais aucun ne propose de séquestre conditionnel programmable : l'argent part immédiatement, sans condition de livraison. Lightning permet de verrouiller des fonds contre un secret cryptographique (HTLC) sans faire confiance à un tiers — c'est un **bâtiment**, pas seulement un **virement**.

**Regtest vs mainnet : qu'est-ce qui change en vrai ?**
Rien dans le code applicatif : seules deux variables d'environnement changent (`LND_MODE=lnd`, `BTC_MODE=rpc`, plus les informations de connexion aux vrais nœuds). En production, on utiliserait le réseau Lightning public au lieu de canaux ouverts manuellement dans Polar, avec de vrais bitcoins plutôt que des bitcoins de test.

---

## 7. Sécurité (résumé)

- Mots de passe : `crypto.scrypt` avec sel aléatoire (pas de dépendance native).
- Sessions : jeton aléatoire dans un cookie `HttpOnly; SameSite=Lax`, seul son SHA-256 est stocké en base.
- Jetons de réinitialisation : hachés, à usage unique, valables 30 minutes ; `/forgot` répond identiquement que l'e-mail existe ou non.
- Le secret de la facture B n'est **jamais** exposé par l'API, sous aucune route.
- Le secret A reste dans le navigateur jusqu’à la confirmation de remise. Seul son hash arrive à la création. Le code transmis à la remise est persisté pour permettre la reprise financière, puis supprimé après confirmation.
- Vérification du vrai type des images par signature d'octets (pas par extension), nom de fichier aléatoire, taille limitée à 2 Mo.
- Toutes les routes `/api/admin/*` sont vérifiées côté serveur (401 sans session, 403 pour un compte non admin).
- Limite de taille des requêtes JSON (100 ko).

---

## 8. Tests

```powershell
cd backend
npm test
```

`backend/test/flow.test.js` lance un vrai serveur Express sur un port aléatoire, une base SQLite temporaire, en mode simulé (`LND_MODE=mock`, `BTC_MODE=mock`, `SIMULATION=false`), avec un client HTTP qui conserve son cookie de session comme un navigateur. Il couvre notamment :

- inscription, mots de passe faibles, doublons, mot de passe oublié à usage unique, photo de profil (vraie/fausse image) ;
- devis, double hold invoice sans exposer le secret B, paiement, attribution au livreur le plus proche, refus/expiration d'offre, livreur occupé non sollicité ;
- retrait (rayon), mauvais code refusé, un scan qui règle A et B avec les frais routés **alice → bob → carol**, refus avec retour confirmé, remboursement des frais par le vendeur, client absent, délai dépassé ;
- notes (vendeur/livreur/client), portefeuille (101 blocs → 50 BTC, envoi, mempool), Lightning (3 nœuds, preimage vérifiée), administration (401/403, statistiques, dispatch, audit complet), simulation des livreurs fictifs.

Le frontend doit passer `tsc --noEmit` et `vite build` sans erreur :

```powershell
cd frontend
npm run build
```

---

## 9. Guide Polar (pour aller plus loin que le mode simulé)

1. Dans [Polar](https://lightningpolar.com/), créez un réseau avec **3 nœuds LND** nommés `alice`, `bob`, `carol`, plus un nœud Bitcoin Core (`backend1`).
2. Démarrez le réseau, attendez que les nœuds soient synchronisés.
3. Financez chaque nœud (bouton *Deposit*) puis ouvrez les canaux :
   - **alice → bob**, capacité 2 000 000 sats ;
   - **bob → carol**, capacité 1 000 000 sats.
4. Minez 6 blocs pour confirmer l'ouverture des canaux (clic droit sur `backend1` → *Mine Block*, ou bouton de minage).
5. Pour chaque nœud, onglet **Connect** : notez le port **gRPC Host** (ex. `127.0.0.1:10001`), puis exportez le **macaroon admin** et le **certificat TLS** en base64 :
   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\chemin\vers\admin.macaroon"))
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\chemin\vers\tls.cert"))
   ```
6. Copiez `backend/.env.example` en `backend/.env` et renseignez, pour chaque rôle (`ACHETEUR`→alice, `VENDEUR`→bob, `LIVREUR`→carol) : `LND_GRPC_HOST_*`, `LND_MACAROON_BASE64_*`, `LND_TLS_CERT_BASE64_*`.
7. Sur `backend1`, onglet **Connect**, notez le port RPC (par défaut `18443` pour Polar) et renseignez `BTC_RPC_URL` (les identifiants `polaruser` / `polarpass` sont ceux par défaut de Polar).
8. Passez `LND_MODE=lnd` et `BTC_MODE=rpc` dans `backend/.env`.
9. Relancez le backend (`npm start`) et vérifiez avec :
   ```
   GET http://localhost:5000/api/health
   ```
   Les trois nœuds et `bitcoind` doivent apparaître avec `"reachable": true`.

---

## 10. Variables d'environnement

Voir [`backend/.env.example`](backend/.env.example), entièrement commenté : serveur, Lightning (par rôle), Bitcoin Core, cours BTC/FCFA, frais de livraison, délais, attribution des livreurs, simulation.

---

## 11. Les 9 notions du bootcamp, et où les voir dans l'app

| Notion | Où |
|---|---|
| Bitcoin Core et regtest | `/app/explorateur`, `/app/portefeuille` |
| Portefeuilles, clés, adresses | `/app/portefeuille` |
| Minage et coinbase | `/app/portefeuille` (miner 101 blocs) |
| Transactions et UTXO | `/app/portefeuille` |
| RPC (JSON-RPC Bitcoin Core) | `backend/src/bitcoin.js`, encadrés « commande » |
| Canaux Lightning | `/app/lightning` (barres de liquidité) |
| BOLT11 | `/app/lightning` (créer/décoder une facture) |
| HTLC et hold invoices | `/app/achats` (« Sous le capot »), `backend/src/orders.js` |
| Polar, macaroons, TLS | `backend/.env.example`, `/app/lightning` |

La page **Académie** (`/academie`) détaille chacune avec les commandes `bitcoin-cli` / `lncli` / `ln-service` équivalentes, et un atelier interactif preimage → SHA-256 → payment_hash.

---

*Les données de démonstration (Awa Couture, Fatou Ndiaye, Moussa Sarr) sont des exemples fictifs créés automatiquement au démarrage (`SEED_DEMO=true`).*
