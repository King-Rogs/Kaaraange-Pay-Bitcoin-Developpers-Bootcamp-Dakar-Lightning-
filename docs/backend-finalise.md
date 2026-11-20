# Backend Kaaraange Pay finalisé et validé sur Polar

Le backend du prototype regtest couvre les comptes, le commerce, le séquestre à deux factures, les livreurs, les avis, l’administration et les opérations Bitcoin. Les trois points ouverts du dernier bilan backend sont fermés : motif obligatoire des arbitrages de frais, validation complète des parcours Lightning et validation des incidents avec de vrais nœuds LND.

## Checklist backend

- [x] Node.js, Express, ln-service, configuration gRPC, TLS et macaroons des trois rôles.
- [x] Comptes polyvalents, mots de passe hachés, sessions, réinitialisation locale et droits administrateur.
- [x] Profil, boutique, articles, images et catalogue public par API.
- [x] Devis calculé côté serveur, frais de livraison et montants en sats entiers.
- [x] Deux hold invoices par commande, article chez Awa et livraison chez Moussa.
- [x] Blocage des deux montants avant attribution et vérification des états LND.
- [x] Vérification du code de livraison, rejet d’un faux code et protection des secrets dans les réponses.
- [x] Livraison : règlement de A puis B, avec intention persistée avant les opérations.
- [x] Refus avec motif : annulation de A, retour puis règlement de B.
- [x] Remboursement automatique de la livraison par Awa pour les quatre motifs de refus.
- [x] Reprise d’un remboursement vendeur indisponible ou sans liquidité, avec la même facture.
- [x] Client absent : contrôle de proximité et paiement livraison au retour.
- [x] Aucun livreur ou non-présentation : échéance, annulation confirmée et pénalité de service si affecté.
- [x] Attribution au score, offre limitée, un livreur par course et une course par livreur.
- [x] Abandon avant retrait : réattribution sans nouveau débit ; après retrait : retour obligatoire.
- [x] Remboursement volontaire vendeur avant retrait ; demande de retour après retrait.
- [x] Avis produit, vendeur, livreur et client, vérification des participants et prévention des doublons.
- [x] Alertes administrateur : notes faibles, incidents, retours en retard et paiements en attente.
- [x] Administration : statistiques, comptes, suspension, CSV, modération, litiges, santé et audit.
- [x] Motif personnel obligatoire pour payer ou annuler les frais par arbitrage, conservé lors d’une reprise.
- [x] Délai de retour, alerte de dépassement, marge CLTV explicite et contrôle de configuration.
- [x] Réponses bornées face à un LND figé ; état de santé dégradé et statut financier en attente.
- [x] Protection des actions concurrentes et absence de nouveau débit lors d’une reprise.
- [x] Reprise après arrêt brutal du processus entre règlement article et livraison.
- [x] Portefeuilles Bitcoin, adresses, minage, transactions, confirmations, UTXO et explorateur par API.
- [x] Séparation stricte administrateur/utilisateur : les administrateurs ne peuvent pas acheter, vendre, livrer ni créer ou utiliser un portefeuille utilisateur.
- [x] Solde total disponible par compte dans l’administration (`trusted_sat`, hors soldes en attente ou immatures).
- [x] Comptabilité du solde : paiement déduit immédiatement du total, montant bloqué jusqu’à livraison ou résolution, dépense confirmée conservée après livraison réussie et remboursement restauré après annulation ou refus confirmé.
- [x] Comptes de démonstration initialisés à 2 000 000 sats et soldes vendeurs/livreurs/acheteurs actualisés automatiquement après règlement ou remboursement.
- [x] Minage réel de 101 blocs avec délai adapté ; timeout signalé sans affirmer à tort que Core est arrêté.
- [x] Jeu de simulation séparé, compte administrateur local et sauvegarde des données principales.
- [x] Validation avec les vrais nœuds Fatou, Awa et Moussa, et vérification finale sans HTLC restant.

## Résultats

| Vérification | Résultat |
|---|---|
| Tests backend HTTP et tests des adaptateurs | 47 réussis, aucun échec |
| Contrôles et scénarios Lightning sur Polar | 23 réussis, aucun échec |
| Contrôles Bitcoin Core sur Polar | 4 réussis, aucun échec |

Les scénarios réels couvrent les quatre motifs de refus, réception, absence, annulation vendeur, retour vendeur, absence de livreur, non-présentation, abandon avant et après retrait, arbitrage payé ou annulé, expiration de factures non payées et actions concurrentes.

Les incidents utilisent les vrais nœuds : gel temporaire de Awa et de Moussa par Docker, saturation temporaire de la liquidité Awa vers Fatou par un HTLC annulé après l’essai, et arrêt immédiat du processus applicatif après règlement de A. Un nouveau processus reprend B depuis la base. Le remboursement après manque de liquidité conserve le même hash de facture. Tous les conteneurs interrompus sont remis en service et les HTLC de validation sont résolus.

Les vérifications Bitcoin utilisent des portefeuilles aux identifiants réservés, distincts des utilisateurs de la base principale. Elles couvrent création, adresse bech32, maturité de la récompense de minage, envoi exact de 50 000 sats, mempool, confirmation dans un bloc et synchronisation LND à la nouvelle hauteur.

## Corrections finales

1. L’arbitrage des frais exige `reason` (3 à 200 caractères), pour `pay` comme pour `cancel`. Le motif est enregistré avec l’intention durable et le journal d’audit.
2. Les arbitrages dont la confirmation financière est en attente répondent HTTP 202. Le résultat définitif dépend des champs d’état retournés.
3. Les lectures et ordres LND ont un délai de réponse borné. Un dépassement laisse la confirmation en attente ; il ne prouve pas qu’un paiement a échoué. La reprise relit les mêmes factures.
4. Le minage de 101 blocs dispose d’un délai dédié. Sur cet ordinateur, le délai RPC ordinaire de 15 secondes pouvait expirer pendant que Core continuait à miner. Le délai de minage est maintenant de 120 secondes par défaut. Une réponse tardive produit un message demandant de vérifier l’état avant de relancer.

## Reproduire les vérifications

Depuis `backend/` :

```powershell
npm.cmd test
npm.cmd run test:polar
npm.cmd run test:bitcoin:polar
```

Les deux dernières commandes font de vrais essais regtest et déplacent des liquidités de test. Le test Lightning utilise le réseau local Kaaraange Pay numéro 5 ; il vérifie la clé publique des conteneurs avant toute interruption. Terminer les commandes en cours et éviter des paiements parallèles pendant la validation. Le test Bitcoin refuse de miner si des HTLC sont encore bloqués.

Les bases de validation sont isolées. Les historiques LND, les blocs et les portefeuilles de test restent dans Polar. Aucun réseau ni canal n’est supprimé. Les relevés sont dans `backend/data/backend-validation/polar-resultats.json` et `bitcoin-resultats.json`, ignorés par Git. Les sauvegardes précédant la finalisation sont dans `backend/data/backups/backend-final-*`.

## Contrat à transmettre à l’équipe interface

Consulter [le contrat des arbitrages et opérations financières](contrat-api-backend.md). Le frontend existant doit fournir le motif lorsqu’un administrateur arbitre les frais. Le backend le refuse désormais lorsqu’il est absent. Le code du frontend n’a pas été modifié pendant cette finalisation backend.

## Architecture de cette version

Cette version est le prototype local regtest prévu pour le bootcamp. Le serveur pilote trois nœuds partagés et possède leurs accès administrateur ; elle ne fournit pas des portefeuilles indépendants de l’opérateur. Le paiement article et le paiement livraison sont deux opérations successives avec reprise persistante. Les e-mails utilisent le mécanisme de démonstration local. Une mise en production et une architecture à portefeuilles indépendants constituent un périmètre distinct.
