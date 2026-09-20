# NanoPay — Backend

API Backend de NanoPay, construite d'après le **« Cahier de construction BACKEND »** : une **commande centrale unique** relie Client, Commerçant, Banque et Admin, avec trois modes de financement — **Épargne**, **Coffre** (prélèvement automatique sur salaire) et **Crédit**.

> Le frontend ne doit jamais être la source de vérité des règles financières ou de sécurité : tout est calculé et vérifié ici.

Stack : Node.js 20+, TypeScript, Express, Prisma, PostgreSQL, Zod, JWT.

## Démarrage rapide

```bash
npm ci
cp .env.example .env            # renseigner DATABASE_URL et les secrets
npx prisma migrate deploy       # ou : npm run prisma:migrate (dev)
npm run seed:demo               # référentiel + comptes de démonstration
npm run dev                     # http://localhost:4000
```

- Documentation interactive : `http://localhost:4000/api-docs` (spec brute : `/api-docs.json`, source : `docs/openapi.yaml`).
- Collection Postman : `docs/NanoPay.postman_collection.json` (régénérée par `npm run docs:postman`).
- PostgreSQL local : `docker compose up -d`.

Comptes de démonstration (`npm run seed:demo`, mot de passe `Password123!`) :
`admin@nanopay.test`, `banque@nanopay.test`, `commercant@nanopay.test` (validé, boutique + 3 produits), `client@nanopay.test`.

> ⚠️ La migration `20260920000000_cahier_refonte` **remplace entièrement** l'ancien modèle de données (ancienne architecture NanaPay) : elle supprime les anciennes tables. Ne l'appliquer que sur une base sans données à conserver.

## Contrat de connexion Backend ⇄ Frontend

| Élément | Contrat |
|---|---|
| Base URL | `/api` (alias historique `/api/v1`) — variable frontend `VITE_API_URL` |
| Format | JSON UTF-8 (multipart pour les documents) |
| Auth | `Authorization: Bearer <accessToken>` ; `POST /auth/refresh` avec rotation du refresh token |
| Succès | `{ "data": …, "meta"?: … }` |
| Erreur | `{ "code", "message", "details?", "requestId" }` (+ en-tête `X-Request-Id`) |
| Pagination | `?page=&limit=` → `meta: { page, limit, total, nextPage }` |
| Dates | ISO 8601 |
| Montants | FCFA **entiers**, jamais de flottant |
| Identifiants | UUID ; `orderNumber` lisible (`NP-2026-00001245`) |
| Temps réel | polling contrôlé (`GET /api/notifications`) — pas de WebSocket |

## Circuit d'une commande

```
Client → produit → POST /orders (CREEE)
       → POST /orders/:id/select-financing (FINANCEMENT_EN_COURS)
            ├─ SAVINGS : POST /orders/:id/savings   → versements Mobile Money (webhook)
            ├─ VAULT   : POST /orders/:id/vault     → prélèvements salaire (webhook) → POST /vaults/:id/use
            └─ CREDIT  : POST /credit/requests      → décision banque → avis de virement
       → FINANCEE → PRETE_A_LIVRER + QR  (GET /orders/:id/qr)
       → Commerçant : POST /merchant/qr/scan → POST /merchant/orders/:id/withdrawal-confirm (LIVREE)
       → règlement commerçant → POST /admin/settlements/:id/paid (TERMINEE)
```

Statuts implémentés exactement comme dans le cahier : Commande `CREEE / FINANCEMENT_EN_COURS / FINANCEE / PRETE_A_LIVRER / LIVREE / TERMINEE`, Épargne `EN_COURS / PROLONGATION / ATTEINTE / ECHOUEE / REMBOURSEE`, Coffre `PROGRAMME / PRELEVEMENT_EN_COURS / OBJECTIF_ATTEINT / UTILISE / BASCULE_VERS_CREDIT`, Crédit `ACCEPTE / EN_ATTENTE_DE_VIREMENT / FINANCE / TERMINE`, Paiement `INITIE / EN_ATTENTE / CONFIRME / ECHOUE`, QR `GENERE / UTILISE / EXPIRE`, etc. Les transitions de commande sont centralisées dans `src/modules/orders/orderStateMachine.ts`.

## Règles métier (source unique : `src/services/financial`)

- Épargne : ≤ 50 000 → min 1 000 FCFA, 8 mois max ; 50 000–100 000 → 2 000, 18 mois ; > 100 000 → 5 000, 36 mois. Départ = **premier versement validé**. Prolongation : 2 mois max au total, avant l'échéance. Échec : pénalité **15 %**, remboursement 85 %, commande annulée et stock restitué.
- Crédit : ≤ 50 000 → 8 mois ; 50 000–100 000 → 12 mois ; au-delà +6 mois par tranche (entamée) de 50 000. Montant à virer par la banque = prix + frais (2 %).
- Coffre : réservé aux salariés dont le profil crédit est déjà `VALIDE` ; bascule possible vers un crédit pour le reste.
- Le **prix d'un produit publié est définitif** ; suppression refusée tant qu'une commande non terminée existe.
- Paiement commerçant déclenché **après retrait confirmé** ; commission 4 % (crédit) ou par palier (épargne/coffre).
- Tous ces paramètres sont **configurables dans le back-office** : `GET/PATCH /api/admin/settings/financial` (tracé dans l'audit).

## Sécurité

- RBAC `CLIENT / MERCHANT / BANK / ADMIN` + contrôle du propriétaire sur chaque ressource (404 plutôt que 403 pour ne pas révéler l'existence).
- **QR** : jeton serveur opaque (256 bits), expirant (`qrTtlHours`, 72 h par défaut), à usage unique (consommation atomique). Le QR ne contient aucune donnée métier.
- **Webhook** `POST /api/webhooks/payment` : signature `X-Signature` = HMAC-SHA256 du corps brut avec `PAYMENT_WEBHOOK_SECRET` ; `providerTransactionId` UNIQUE (jamais comptabilisé deux fois, y compris en cas de livraisons simultanées) ; vérification signature / montant / commande / devise (`XOF`) / statut avant toute écriture ; verrou de ligne sur l'épargne/le coffre.
- CNIB et documents bancaires stockés en privé (`uploads/private`, jamais servis statiquement) ; accès via `GET /api/documents/:filename` (contrôle d'accès) ou **URL temporaire** de 5 minutes (`POST /api/documents/:filename/temporary-url`).
- Audit : date/heure, identifiant, acteur, montant, statut (`GET /api/admin/audit-logs`).
- Rate limiting, validation Zod de toutes les entrées, CORS restreint au domaine du frontend (`CORS_ORIGIN`), secrets uniquement en variables d'environnement.

Exemple de signature d'un webhook :

```js
const sig = require("crypto").createHmac("sha256", process.env.PAYMENT_WEBHOOK_SECRET).update(rawBody).digest("hex");
// POST /api/webhooks/payment  -H "X-Signature: <sig>"
// { providerTransactionId, orderId, amount, currency: "XOF", status: "SUCCESS", payerReference, timestamp }
```

## Structure

```
prisma/            schema.prisma, migrations, seed.ts
src/
  app.ts, server.ts, routes/
  config/          env, prisma, logger, openapi
  common/          middleware (auth, rbac, requestId, errorHandler, upload…), utils, errors
  services/        financial (règles + paramètres), audit, notification, qr, payment (signature), email
  modules/         auth, marketplace, merchants, orders, savings, vaults, credit, bank,
                   payments (webhook), withdrawals (QR + retrait), admin, notifications, documents
tests/unit/        règles financières, machine d'état, webhook, retrait/QR, contrat HTTP + RBAC
docs/              openapi.yaml, collection Postman
```

## Scripts

| Commande | Rôle |
|---|---|
| `npm run dev` | serveur en rechargement à chaud |
| `npm run build` / `npm start` | compilation / production |
| `npm test` | tests unitaires (aucune base requise) |
| `npm run lint` | ESLint |
| `npm run seed` / `seed:demo` | référentiel villes-communes / + comptes de démo |
| `npm run prisma:migrate` / `prisma:deploy` | migrations (dev / déploiement) |
| `npm run docs:postman` | régénère la collection Postman |

## Déploiement (Render / staging)

`render.yaml` exécute `npm ci`, le build, `prisma migrate deploy` puis `npm run seed` (référentiel villes/communes, idempotent). Variables à renseigner : `DATABASE_URL`, `PAYMENT_WEBHOOK_SECRET`, `CORS_ORIGIN` (URL du frontend), SMTP ; les secrets JWT sont générés. Le frontend pointe `VITE_API_URL` vers `https://<service>.onrender.com/api`.

## Ce qui reste à brancher (hors périmètre du code)

- **Intégration Mobile Money réelle** : le backend reçoit et vérifie les événements (webhook signé) mais n'initie pas encore de collecte ni de virement. Le règlement commerçant et le remboursement d'épargne (85 %) sont exécutés hors plateforme, puis confirmés par l'Admin (`/admin/settlements/:id/paid`, `/admin/savings/:id/refund`).
- **Prélèvement salaire du Coffre** : les prélèvements arrivent par le même webhook (`orderId` du Coffre).
- Temps réel : polling uniquement (WebSocket/SSE non activé).
