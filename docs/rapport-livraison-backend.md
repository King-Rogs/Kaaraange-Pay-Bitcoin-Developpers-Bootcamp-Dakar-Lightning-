# Rapport de livraison du backend Kaaraange Pay

## Synthèse de la livraison

Le backend du prototype Kaaraange Pay est finalisé dans le périmètre regtest du Dakar Lightning Developer Bootcamp. Les fonctions métier, les arbitrages, les reprises après panne et les opérations Bitcoin ont été vérifiés. Les validations réelles ont été réalisées le 19 novembre 2026 sur le réseau Polar Kaaraange Pay, avec Fatou, Awa et Moussa.

| Vérification | Résultat |
|---|---|
| Tests backend HTTP et adaptateurs | 47 réussis, aucun échec |
| Contrôles et scénarios Lightning réels | 23 réussis, aucun échec |
| Contrôles Bitcoin Core réels | 4 réussis, aucun échec |
| Contrôle final des trois nœuds | Joignables et synchronisés à la hauteur 318 |
| Contrôle final des canaux | Actifs, aucun HTLC restant |

La livraison Git porte sur le backend, ses tests et sa documentation. L’équipe frontend doit prendre en charge le contrat API livré : motif obligatoire des arbitrages et affichage des états financiers en attente. Les changements locaux du frontend ne font pas partie de cette branche.

## Point de départ et résultat obtenu

Le backend Node.js existant disposait déjà des comptes, des commandes et du mécanisme à deux hold invoices. La base distante comportait 28 tests backend. L’intervention a complété les règles métier et la fiabilité, puis porté la suite à 47 tests applicatifs et ajouté les validations LND/Core réelles.

| Sujet | État initial | Livraison |
|---|---|---|
| Deux factures article/livraison | Mécanisme déjà présent | Confirmation des états et reprise persistante des opérations |
| Remboursement de la livraison | Action administrateur, cas limités | Automatique après refus et retour confirmé, pour les quatre motifs |
| Pannes et redémarrages | Risque d’état métier trop optimiste ou d’interruption entre A et B | Intentions durables, états en attente, reprise dans un nouveau processus |
| Logistique | Attribution et suivi déjà présents | Abandon avant/après retrait, non-présentation, note de service et délai de retour |
| Avis | Avis vendeur, livreur et client | Avis produit distinct, achat vérifié et moyenne publique |
| Administration | Écrans et routes présents | Alertes automatiques, admin local et motifs obligatoires des arbitrages de frais |
| Validation | Simulation | Essais réels couvrant les parcours et les incidents |

## Architecture livrée

Le backend utilise Node.js, Express, SQLite et ln-service. LND est appelé par gRPC avec macaroon et certificat TLS ; Bitcoin Core est appelé par JSON-RPC. Le mode simulé et le mode Polar utilisent la même interface applicative.

| Acteur | Nœud de la démo | Rôle financier |
|---|---|---|
| Fatou, acheteuse | fatou | Paie les deux factures |
| Awa, vendeuse | awa | Crée la facture A pour l’article |
| Moussa, livreur | moussa | Crée la facture B pour la livraison |

Les canaux sont Fatou - Awa, de capacité 2 000 000 sats, et Awa - Moussa, de capacité 1 000 000 sats. Le paiement de livraison suit Fatou - Awa - Moussa. Les capacités restent fixes ; les soldes locaux/distants changent avec les paiements et frais.

Le secret A est créé par l’acheteur et seul son hash est transmis à la création. À la remise, le backend vérifie le code reçu. Il le persiste temporairement dans l’intention de règlement pour permettre une reprise, puis supprime cette intention après confirmation. Le secret B reste côté serveur et n’est pas exposé par les réponses API.

A et B sont deux règlements successifs : A est réglée avant B. La reprise persistante couvre une interruption entre les deux ; ce mécanisme n’est pas un règlement atomique unique.

## Fonctionnalités backend livrées

- [x] Comptes polyvalents, sessions, mots de passe hachés, réinitialisation locale et droits administrateur.
- [x] Profil, boutique, articles, import d’images et catalogue public par API.
- [x] Calcul serveur des devis, distances et frais ; montants en sats entiers.
- [x] Deux hold invoices, paiement, blocage des fonds et vérification des états LND.
- [x] Contrôle du code, réception et règlements article/livraison.
- [x] Refus avec motif, retour et remboursement vendeur automatique.
- [x] Absence client, non-présentation, échéances et pénalités de service.
- [x] Attribution au score, offres limitées, unicité des courses et gestion de l’abandon.
- [x] Remboursement volontaire vendeur et demande de retour après retrait.
- [x] Avis produit/vendeur/livreur/client, contrôle des participants et prévention des doublons.
- [x] Statistiques, CSV, suspension, modération, litiges, santé et journal d’audit.
- [x] Signalements des mauvaises notes, incidents, retours en retard et paiements en attente.
- [x] Motifs obligatoires des arbitrages de frais, conservés lors des reprises.
- [x] Délai de retour et marge CLTV explicites, réponses bornées aux pannes LND.
- [x] Intentions financières persistantes, protection des actions concurrentes et absence de double débit lors des reprises testées.
- [x] Portefeuilles Bitcoin, adresses, minage, transactions, UTXO et explorateur par API.
- [x] Simulation isolée, préparation de l’admin et données de démonstration.

## Règles financières retenues

| Situation | Article A | Livraison B et remboursement |
|---|---|---|
| Réception acceptée | Réglée au vendeur | Réglée au livreur |
| Refus client, quel que soit le motif | Annulée | Réglée au retour ; Awa rembourse la livraison à Fatou |
| Retour demandé par le vendeur | Annulée | Réglée au retour ; remboursement vendeur à l’acheteur |
| Client absent | Annulée | Réglée au retour, sans remboursement vendeur automatique |
| Annulation vendeur avant retrait | Annulée | Annulée |
| Aucun livreur ou non-présentation à l’échéance | Annulée | Annulée ; incident de service si un livreur était affecté avant retrait |
| Abandon avant retrait | Reste bloquée | Reste bloquée, course réattribuée sans nouveau débit |
| Abandon après retrait | Annulée | Retour obligatoire ; règlement au retour, sans remboursement vendeur automatique pour cette cause |
| Retour hors délai | Déjà annulée | Alerte et arbitrage administrateur payé ou annulé avec motif |

La règle de remboursement vendeur après refus remplace l’option initiale du second PDF. Elle couvre non-conformité, dommage, changement d’avis et autre motif. Le remboursement porte sur le prix de livraison (`fee_sat`) ; les frais de routage Lightning déjà consommés restent distincts.

## Fiabilité et corrections finales

Une intention est enregistrée avant l’opération financière. Un statut terminal n’est annoncé qu’après relecture et confirmation de la facture LND. Si un nœud est indisponible ou figé, la demande reste enregistrée et la boucle réessaie. Les demandes concurrentes incompatibles sont rejetées.

Le remboursement vendeur utilise une facture persistée avant paiement. Après coupure ou manque de liquidité, la reprise relit cette facture au lieu de créer un nouveau débit. Le test réel vérifie que le hash reste le même après résolution.

L’arbitrage des frais exige désormais un motif personnel de 3 à 200 caractères, pour le paiement comme pour l’annulation. Ce motif est conservé dans l’intention et le journal. Une décision financière en attente répond HTTP 202.

Les appels LND ont des délais de réponse bornés. Un dépassement ne prouve pas l’échec d’un paiement : la reprise vérifie l’état de la même facture. Les paiements de hold invoices restent en cours jusqu’au règlement ou à l’annulation.

Le minage réel de 101 blocs a révélé un délai RPC trop court : Core continuait à miner alors que l’API annonçait une panne après 15 secondes. Le minage dispose maintenant d’un délai dédié, de 120 secondes par défaut. Une réponse trop tardive indique de vérifier l’état avant de relancer.

## Validation réelle sur Polar

Les 23 contrôles Lightning couvrent : préflight regtest et identité des nœuds, CLTV, fonds réellement bloqués, faux code, livraison, les quatre motifs de refus, absence client, annulation vendeur, retour vendeur, aucun livreur, non-présentation, les deux abandons, arbitrage payé ou annulé, factures non payées, pannes, arrêt brutal, manque de liquidité, concurrence et intégrité finale.

Les essais de panne ont réellement figé temporairement Awa et Moussa. L’essai d’arrêt brutal termine le processus applicatif entre A et B ; un nouveau processus reprend depuis SQLite. Le manque de liquidité est produit par un HTLC temporaire Awa vers Fatou, puis résolu en annulant cette réserve. Les conteneurs sont remis en service et les HTLC de validation sont résolus.

Les quatre contrôles Bitcoin vérifient deux portefeuilles aux identifiants réservés, des adresses bech32, le minage et la maturité des récompenses, un envoi exact de 50 000 sats, la mempool, la confirmation dans un bloc et la synchronisation des trois LND à la nouvelle hauteur.

Les bases applicatives de test sont isolées. La base principale conserve sa commande livrée et son administrateur ; aucun ordre de validation n’y a été ajouté. Les historiques LND, les blocs minés et les portefeuilles de validation restent présents dans Polar. Les essais ont déplacé des liquidités regtest sans supprimer les canaux ni les réseaux existants.

Les résultats partageables sont dans [le relevé de validation](validation/backend-resultats.json). Les copies locales des bases, journaux et accès restent hors du dépôt public.

## Informations pour l’équipe frontend

Consulter [le contrat API](contrat-api-backend.md). Les adaptations prioritaires sont :

1. Envoyer `reason` lors de `POST /api/admin/orders/:id/fee`, avec `action: "pay"` ou `"cancel"`. Sans motif valide, le backend répond HTTP 400.
2. Gérer HTTP 202 et les états `delivery_pending`, `cancel_pending`, `return_pending`, `return_payment_pending`. Une action acceptée ne signifie pas qu’un mouvement est déjà confirmé.
3. Afficher séparément `financial_pending` et `fee_refund_status`. Une commande peut être retournée avec un remboursement vendeur encore en attente.
4. Conserver le code de livraison de l’acheteur jusqu’à la réception et transmettre le code à la route de remise.
5. Conserver des entiers en sats dans les échanges API ; le rendu BTC et FCFA appartient à l’interface.

Exemple d’arbitrage :

```json
{
  "action": "pay",
  "reason": "Retour physique du colis vérifié auprès du vendeur"
}
```

## Installation et vérifications

Prévoir Node.js 22 ou supérieur ; les vérifications de cette livraison ont utilisé Node.js 24. Depuis `backend/`, installer avec `npm ci`, copier `.env.example` vers `.env`, puis adapter les paramètres avant de démarrer avec `npm start`.

```powershell
npm.cmd test
npm.cmd run test:polar
npm.cmd run test:bitcoin:polar
```

La première commande ne requiert pas Polar. Les deux suivantes exigent la configuration LND/Core et modifient le regtest. Le test Lightning cible les conteneurs locaux du réseau Kaaraange Pay numéro 5 et vérifie leurs clés publiques avant interruption. Le test Bitcoin refuse de miner si des HTLC sont encore bloqués. Les autres activités de paiement doivent être terminées avant une validation contrôlée.

| Paramètre | Valeur par défaut |
|---|---|
| `RETURN_DEADLINE_MIN` | 120 minutes |
| `HOLD_CLTV_DELTA` | 288 blocs |
| `RECOVERY_RETRY_SEC` | 5 secondes |
| `LND_RPC_TIMEOUT_MS` | 5 000 ms |
| `LND_PAYMENT_TIMEOUT_MS` | 30 000 ms |
| `LND_PATHFINDING_MS` | 10 000 ms |
| `BTC_MINE_TIMEOUT_MS` | 120 000 ms |
| `LOW_RATING_THRESHOLD` | 3 sur 5 |

Le CLTV doit couvrir les délais configurés plus la marge imposée au démarrage. En regtest, il dépend du nombre de blocs minés ; éviter les séries de minage pendant une livraison.

`npm run demo:prepare` prépare l’administrateur local ; `npm run demo:scenarios` prépare six commandes cohérentes dans une base simulée séparée ; `npm run demo:simulate` démarre cette simulation sur le port 5001. Les accès admin sont écrits dans des fichiers locaux ignorés par Git.

## Périmètre et transmission

Cette livraison concerne le prototype local regtest. Le backend pilote trois nœuds partagés avec leurs accès administrateur ; il ne fournit pas des portefeuilles indépendants de l’opérateur. Les e-mails utilisent le mécanisme de démonstration local. Une exploitation avec de vrais fonds, un déploiement public et des portefeuilles indépendants exigent un périmètre distinct.

La branche de livraison `codex/backend-finalisation` est publiée dans le [fork de contribution](https://github.com/papysakho01/Kaaraange-Pay-Bitcoin-Developpers-Bootcamp-Dakar-Lightning-/tree/codex/backend-finalisation), puis proposée au [dépôt source Kaaraange Pay](https://github.com/King-Rogs/Kaaraange-Pay-Bitcoin-Developpers-Bootcamp-Dakar-Lightning-) par une demande d’intégration. Le compte connecté ne dispose pas d’écriture directe sur le dépôt source. La fusion vers `main` relève de son responsable et doit tenir compte du contrat API destiné au frontend. Les fichiers `.env`, certificats, macaroons, mots de passe admin, bases et sauvegardes locales sont exclus du push.
