# Kaaraange Pay — backend

Backend Node.js du projet Kaaraange Pay : Express 5 + `ln-service`, dérivé de la passerelle [connect-lnd](https://github.com/heyolaniran/connect-lnd) (Express + `ln-service`, nœuds LND configurés par variables d'environnement). Ce document est destiné à l'équipe qui reprend ou maintient ce backend ; la présentation générale du produit, la démo et le guide Polar sont dans le [README à la racine du dépôt](../README.md).

CommonJS, Node.js 22+. Aucune dépendance native : la base SQLite utilise `node:sqlite`, intégré à Node (lancer avec `--experimental-sqlite --no-warnings=ExperimentalWarning`, déjà fait par les scripts npm).

```powershell
npm install
npm test     # 28 scénarios de bout en bout, base temporaire, mode simulé
npm start    # API sur http://localhost:5000 (npm run dev pour le rechargement auto)
```

Config : copier `.env.example` en `.env` (entièrement commenté). Sans `.env`, tout tourne en mode simulé (`LND_MODE=mock`, `BTC_MODE=mock`), sans besoin de Polar.

---

## Carte des modules (`src/`)

| Fichier | Responsabilité |
|---|---|
| `server.js` | Point d'entrée : assemble Express, branche les routeurs, les en-têtes de sécurité, le gestionnaire d'erreurs central, lance la boucle de fond (`setInterval`, toutes les `TICK_MS`), sert `frontend/dist` en production. |
| `config.js` | Lit `.env` une fois au démarrage et expose un objet `config` figé. Toute nouvelle variable d'environnement passe par ici (jamais de `process.env.X` ailleurs dans le code). |
| `db.js` | Ouvre la base SQLite (`node:sqlite`), porte le schéma (`CREATE TABLE IF NOT EXISTS …`), et expose des helpers minces (`one`, `all`, `run`, `tx`, `update`, `kvGet`/`kvSet`, `audit`). Pas d'ORM : SQL explicite, volontairement portable vers MySQL. |
| `util.js` | `HttpError`/`fail()` pour les erreurs HTTP typées, `haversine`/`moveToward` pour la géo, les validateurs (`email`, `password`, `coords`, …), et `lnError()` qui traduit les erreurs `ln-service` (`[code, 'NomErreur', détails]`) en messages français lisibles. |
| `price.js` | Cours BTC/FCFA côté serveur, mis en cache 60 s (Binance → CoinGecko → repli fixe `BTC_XOF_FALLBACK`). |
| `auth.js` | Comptes, sessions (cookie `HttpOnly` + hash SHA-256 en base), mot de passe oublié, profil, photo (upload en mémoire + vérification de signature d'octets), avis/notes. Exporte aussi les middlewares `requireAuth` / `requireAdmin` utilisés par les autres modules. |
| `orders.js` | Le cœur métier : articles, devis (`/api/quote`), création d'une commande à **deux hold invoices**, cycle de vie complet (paiement, retrait, livraison, refus, retour, échéances), notes. Voir « Les deux hold invoices » ci-dessous avant d'y toucher. |
| `dispatch.js` | Livreurs : statut, position, coût d'attribution, offres de 30 s, tours successifs, simulation des livreurs fictifs. |
| `chain.js` | Portefeuille Bitcoin par utilisateur, explorateur de blocs, console Lightning (3 nœuds), et les routes héritées de connect-lnd (`/api/nodes/...`, protégées par `API_KEY` si définie). |
| `bitcoin.js` | Deux implémentations derrière la même interface : `RpcChain` (vrai `bitcoind` en JSON-RPC) et `MockChain` (chaîne regtest simulée, mêmes règles : halving, maturité coinbase à 101 blocs, mempool, frais fixes). |
| `admin.js` | Toutes les routes `/api/admin/*`, protégées par `requireAdmin` (401 sans session, 403 si non admin, vérifié dans `admin.js` lui-même, jamais supposé côté client). |
| `lightning/index.js` | Façade unique : expose `{ acheteur, vendeur, livreur }` (alice/bob/carol) quel que soit le mode, plus `ln.call()` qui enveloppe un appel LND et traduit son erreur. **Tout le reste du code appelle les nœuds via ce module**, jamais `real.js`/`mock.js` directement. |
| `lightning/real.js` | Un nœud = `ln-service` + `authenticatedLndGrpc` (host gRPC, macaroon et certificat TLS en base64, comme connect-lnd). |
| `lightning/mock.js` | Réseau Lightning simulé en mémoire : 3 nœuds, 2 canaux (alice→bob, bob→carol), hold invoices avec les 4 états LND, recherche de chemin par parcours en largeur, HTLC verrouillés, frais de routage, persisté dans la table `kv` pour survivre aux redémarrages. |

## Les deux hold invoices (à comprendre avant de modifier `orders.js`)

Chaque commande paie **deux** factures Lightning distinctes en un seul clic :

- **A (article)** — créée par le nœud **vendeur**, avec le `payment_hash` fourni par le client (hash du secret généré dans le navigateur de l'acheteur). Le serveur ne connaît jamais ce secret, seulement son hash.
- **B (livraison)** — créée par le nœud **livreur**, avec un secret tiré côté serveur (`randomHex(32)`), stocké dans `orders.fee_preimage` et **jamais renvoyé par aucune route** (vérifier `orders.js::view()` si vous ajoutez un champ : ne jamais y inclure `fee_preimage`).

À la remise, `POST /orders/:id/deliver` vérifie `sha256(code) === item_hash`, puis `settle(A)` avec ce code, puis `settle(B)` avec le secret serveur — un scan, deux paiements. Au refus/absence, `cancel(A)` rend le prix ; `B` reste bloquée jusqu'à `POST /orders/:id/confirm-return` (vendeur), qui déclenche `settle(B)`.

## Basculer sur de vrais nœuds LND (Polar)

Changer uniquement `LND_MODE=lnd` et `BTC_MODE=rpc` dans `.env`, plus les informations de connexion (`LND_GRPC_HOST_*`, `LND_MACAROON_BASE64_*`, `LND_TLS_CERT_BASE64_*`, `BTC_RPC_*`). Aucun autre fichier à toucher : `lightning/real.js` et `bitcoin.js::RpcChain` implémentent exactement la même interface que leurs équivalents simulés. Voir le guide Polar complet dans le [README racine, §9](../README.md#9-guide-polar-pour-aller-plus-loin-que-le-mode-simulé).

## Tests

`test/flow.test.js` est le seul test, mais il est exhaustif : serveur réel sur un port aléatoire, base temporaire, mode simulé, client HTTP qui garde son cookie de session. Avant de merger un changement dans `orders.js` ou `dispatch.js`, relancez `npm test` — les scénarios couvrent les cas limites (livreur occupé, offre expirée, code de livraison invalide, délai dépassé, refus avec remboursement des frais par le vendeur…) qui sont faciles à casser par inadvertance.

## Sécurité — points à ne pas régresser

- Le secret B (`fee_preimage`) ne doit jamais apparaître dans une réponse JSON.
- Toute nouvelle route `/api/admin/*` doit passer par `requireAdmin` (voir `admin.js`, ligne `router.use('/admin', requireAdmin)`).
- Les mots de passe passent par `auth.js::hashPassword`/`checkPassword` (scrypt) — ne jamais stocker ou comparer en clair.
- Toute route qui accepte un fichier doit vérifier la vraie signature d'octets (voir `auth.js::sniffImage`), jamais l'extension ou le `Content-Type` déclaré par le client.
