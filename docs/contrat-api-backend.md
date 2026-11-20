# Contrat des arbitrages et opérations financières

Le backend Kaaraange Pay utilise une session authentifiée dans un cookie HttpOnly. Les routes `/api/admin/*` exigent un compte administrateur ; les autres actions vérifient le rôle de l’utilisateur dans la commande.

## Arbitrer les frais de livraison

`POST /api/admin/orders/:id/fee`

```json
{
  "action": "pay",
  "reason": "Retour du colis vérifié auprès du vendeur"
}
```

- `action` : `pay` pour payer le livreur, `cancel` pour annuler les frais.
- `reason` : motif obligatoire, texte de 3 à 200 caractères après suppression des espaces en bordure.
- Cette action concerne une commande en retour. Le motif est persisté avant l’appel LND et conservé dans le journal après confirmation.
- Un motif absent ou invalide donne HTTP 400 avec `field: "reason"`. Aucun mouvement n’est déclenché.

## Interpréter le résultat

| Réponse | Traitement attendu |
|---|---|
| HTTP 200, `order.financial_pending: false` | Lire l’état confirmé de la commande et de ses deux factures. |
| HTTP 202, `order.financial_pending: true` | Action enregistrée, confirmation LND en attente. Actualiser la commande ; la reprise est automatique. |
| HTTP 400 | Corriger le champ indiqué ; la décision est refusée. |
| HTTP 401 / 403 | Session absente ou droits insuffisants. |
| HTTP 409 | Étape incompatible, décision concurrente ou commande déjà traitée. Actualiser avant toute nouvelle action. |
| HTTP 502 sur tentative de remboursement vendeur | Consulter le statut du remboursement ; une nouvelle tentative est programmée. |
| HTTP 504 sur Bitcoin Core | Réponse trop tardive : vérifier portefeuille, hauteur ou transaction avant de relancer. L’opération peut avoir abouti. |

Exemple d’action conservée pour reprise :

```json
{
  "order": {
    "status": "return_payment_pending",
    "financial_pending": true,
    "financial_action": "return_complete"
  }
}
```

Les champs sont un extrait de la réponse complète. `financial_error` peut fournir le dernier problème de confirmation. Le secret B et le contenu des intentions financières ne sont jamais exposés par l’API.

## Remboursement de la livraison par le vendeur

La confirmation du retour déclenche le paiement du livreur puis, pour un refus client ou un retour demandé par le vendeur, le remboursement de la livraison à l’acheteur.

`fee_refund_status` est indépendant de `financial_pending` :

- `awaiting_return` : remboursement prévu après retour.
- `pending` : remboursement vendeur en attente de liquidité ou de confirmation ; réessai automatique.
- `completed` : facture de remboursement confirmée réglée chez l’acheteur.
- `not_applicable` : règle non applicable, notamment client absent.

Une commande peut donc être `returned` et avoir encore `fee_refund_status: "pending"`. Afficher ces deux informations. Le prix de livraison remboursé n’inclut pas les frais de routage Lightning déjà consommés.

## Actions métier disponibles

| Route POST | Acteur autorisé | Effet |
|---|---|---|
| `/api/orders/:id/pay` | Acheteur | Paiement des deux factures ; le backend déduplique les demandes simultanées. |
| `/api/orders/:id/deliver` | Acheteur ou livreur affecté | Vérifie `code` et déclenche le règlement A puis B. |
| `/api/orders/:id/refuse` | Acheteur | Reçoit `reason` parmi les motifs prévus et un commentaire facultatif ; démarre le retour. |
| `/api/orders/:id/absent` | Livreur affecté | Vérifie sa proximité du point de livraison et démarre le retour. |
| `/api/orders/:id/refund` | Vendeur | Reçoit `reason` de 3 à 300 caractères ; annule avant retrait, demande un retour après retrait. |
| `/api/orders/:id/abandon` | Livreur affecté | Reçoit `reason` de 3 à 300 caractères ; réattribue avant retrait, impose le retour après retrait. |
| `/api/orders/:id/confirm-return` | Vendeur | Confirme le retour, paie le livreur et applique le remboursement vendeur prévu. |
| `/api/admin/orders/:id/refund` | Administrateur | Remboursement total avant remise avec `reason` obligatoire de 3 à 200 caractères. |
| `/api/admin/orders/:id/refund-fee` | Administrateur | Réessaie le remboursement vendeur prévu, sans créer un deuxième débit. |

Consulter `GET /api/orders/:id` pour actualiser l’état. Les états en attente sont `cancel_pending`, `delivery_pending`, `return_pending` et `return_payment_pending`. L’interface ne doit pas les annoncer comme un paiement ou un remboursement déjà confirmé.

Les montants de l’API sont des entiers en sats (`item_sat`, `fee_sat`, etc.). Le devis fournit aussi `fee_xof` et `btc_xof`. La conversion BTC de l’interface respecte 100 000 000 sats par BTC.
