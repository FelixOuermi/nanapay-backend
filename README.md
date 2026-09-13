# NanaPay Backend

API Backend de NanaPay (paiement en tranches : Épargne / Crédit Bancaire).
Stack : Node.js + TypeScript + Express + Prisma + PostgreSQL.

## Architecture

```
prisma/schema.prisma        Schema DB (fidele au schema SQL fourni + tables techniques)
src/
  config/                   env, prisma client, logger
  common/
    errors/                 AppError (erreurs HTTP typees)
    middleware/              auth (JWT), rbac, rateLimiter, upload, validate, idempotency, errorHandler
    types/                  augmentation Express.Request (req.user)
    utils/                  asyncHandler, notImplemented
  services/
    financial/              SOURCE UNIQUE des regles metier (taux, durees, penalites)
    payment/                Abstraction Mobile Money (Orange Money / Coris Money)
    email/                  Envoi des identifiants / notifications
    qr/                     Generation des tokens QR
    audit/                  Journal d'audit
  modules/                  Un dossier par domaine (auth, clients, merchants, orders,
                             bank, admin, webhooks, ...), chacun avec ses routes
  routes/                   Agregation des routers sous /api/v1
  app.ts / server.ts        Bootstrap Express
docs/openapi.yaml           Specification OpenAPI 3.0 complete (servie sur /api-docs)
tests/
  unit/                     Tests unitaires (Prisma mocke)
  integration/              Tests d'integration (vraie base, npm run test:integration)
```

Le service `services/financial/financialService.ts` centralise tous les calculs
(versements minimums, durees max Epargne/Credit, commissions, penalites) pour eviter
les nombres magiques dans les controleurs. **Règle de pénalité actuelle en cas de
dépassement de délai d'Épargne : 15 % de pénalité, remboursement de 85 % des
cotisations.**

Les routes des modules sont deja cablees avec les bons middlewares (`requireAuth`,
`requireRole`, `idempotent`, `uploadDocument`) mais les controleurs sont pour l'instant
des placeholders (`notImplemented`) : la logique metier sera ajoutee module par module.

**Module `auth` implemente** (register/login/refresh/logout/recovery) :
- Refresh token opaque (valeur aleatoire, seule son empreinte SHA-256 est stockee en
  base) avec rotation a chaque `/auth/refresh` et revocation immediate au `/auth/logout`.
- Compte Client/Commercant cree inactif (`isActive: false`) : `/auth/login` renvoie 403
  tant que l'Admin n'a pas valide le dossier (module `admin`, a venir).
- `/auth/recovery` ne revele jamais si un e-mail existe (meme reponse dans tous les cas).
- Testé unitairement avec Prisma mocke (`tests/unit/auth.service.test.ts`) : ce sandbox
  de dev n'a pas Docker/PostgreSQL installe, donc le flux n'a pas pu etre rejoue contre
  une vraie base ici. A verifier sur ta machine avec `docker compose up -d` puis
  `npm run prisma:migrate` avant de tester les endpoints en conditions reelles.

## Demarrage

```bash
cp .env.example .env
docker compose up -d          # lance PostgreSQL local
npm install
npm run prisma:migrate        # cree les tables
npm run dev                   # demarre l'API sur http://localhost:4000
```

## Tests

```bash
npm test
```

## Uploads : documents prives vs medias publics

- `uploads/private/` (KYC : CNIB, bulletins, autorisations) — jamais servi statiquement,
  cf. `common/middleware/upload.ts` (`uploadPrivateDocument`). A servir plus tard via un
  endpoint dedie qui verifie les droits (Admin/Banque/proprietaire) avant de renvoyer le fichier.
- `uploads/public/` (photos d'articles, spots publicitaires) — servi sur `/media/<fichier>`
  via `uploadPublicMedia`, car le Market doit pouvoir les afficher a tous les clients.

## Etat d'avancement

- [x] `auth` — register/login/refresh/logout/recovery (voir section dediee plus haut).
- [x] `admin` — validation/rejet des comptes Client/Commercant (KYC).
- [x] `clients` — `GET /client/profile`.
- [x] `merchants` — boutique (1 par commercant, contrainte UNIQUE ajoutee sur `shops.merchant_id`),
      produits (visibilite pilotee automatiquement par `remainingStock`), medias (photos/spots).
- [x] `shops`/`market` — recherche de boutiques, liste des articles visibles d'une boutique.
- [x] `orders` + `savings` — creation de commande (Epargne et Credit Bancaire, stock
      decremente atomiquement), `GET /orders/:id`, extension de delai (max 2 mois),
      `GET /orders/:id/qr`, `GET /client/savings` (baromètre), webhooks Mobile Money
      (`/webhooks/orange-money`, `/webhooks/coris-money`) qui valident les depots,
      completent l'Epargne a 100% (génère le QR, passe la commande a PRET_A_LIVRER) et
      appliquent la pénalité actuelle (15% / remboursement 85% / compte bloqué) en cas de
      délai dépassé. **Limite connue** : le remboursement des 85% n'est pas encore
      automatise (le numero Mobile Money du payeur n'est pas capture par
      `savings_deposits` et l'integration Orange/Coris Money reste a brancher) — les
      montants sont journalisés (`audit_logs` + logs serveur) pour un traitement manuel
      par l'Admin en attendant.
- [x] `bankCredits` (`orders/:id/bank-credit` + `.../terms`) + `bank` — soumission ou
      reutilisation du dossier KYC credit (autorisation de prelevement reutilisable des
      qu'une banque a approuve un premier dossier), calcul et validation de la duree
      (`assertValidCreditDuration`), calcul du virement Banque -> NanaPay (prix + 2%) ;
      cote Banque : liste/detail des dossiers assignes (scoping strict par `bankId`),
      approbation/rejet, execution du virement (protegee par `Idempotency-Key`) qui
      genere le QR et passe la commande a `PRET_A_LIVRER`. Chaque etape notifie l'Admin
      (table `notifications`).
- [x] `deliveries` (`POST /merchant/orders/:id/scan-qr`) + `payouts` — comparaison du
      token QR a temps constant (`timingSafeEqual`), refus explicite du double scan et
      des scans par un commercant non autorise (404), creation atomique de
      `order_deliveries` + passage a `LIVRE`. Pour l'**Epargne**, le scan declenche aussi
      le reversement commercant dans la meme transaction (HT degressif 8/5/3% sur le
      montant epargne, canal Mobile Money par defaut du commercant) : "cadre vert ET QR
      scanne" (cf. cahier). Pour le **Credit Bancaire**, le scan marque juste la livraison
      physique — le reversement (commission 4%, canal Coris Money impose) est un
      evenement separe declenche par l'Admin (voir ci-dessous), une fois le virement de
      la banque recu. `GET /merchant/orders` (ventes en cours + pretes par defaut,
      filtrable) et `GET /merchant/payouts` (historique) branches.
      **Limite connue** : le virement Mobile Money reel n'est pas encore automatise
      (integration fournisseur non branchee) ; montant et canal sont journalises pour
      execution manuelle par l'Admin.
- [x] `admin` (suite) — `GET /admin/savings` (cadre ROUGE/VERT + progression par
      commande), `GET /admin/credits` (dossiers avec client/commercant/statuts),
      `POST /admin/credits/:id/payout` (declenche le reversement commercant pour un
      Credit Bancaire une fois `transferStatus = VIREMENT_BANQUE_EFFECTUE`, protegee par
      `Idempotency-Key`), `GET /admin/transactions` (vue agregee depots Epargne +
      reversements commercants — aucune table `transactions` dediee dans le schema
      fourni), `GET /admin/notifications`.

Le cahier de taches Backend est maintenant couvert de bout en bout (auth, RBAC, les 4
API par role, regles metier Epargne/Credit, workflow QR, calculs financiers, audit,
tests unitaires). Les limites assumees (virements Mobile Money reels, integration
Orange/Coris Money) sont documentees a chaque section concernee plutot que masquees.

## Corrections apportees en cours de route

- `order.service.createOrder` ne verifiait pas, a la creation d'une commande Credit
  Bancaire, que le commercant disposait d'un numero Coris Money — condition pourtant
  explicitement posee par le cahier des charges ("Sans numero Coris Money valide,
  impossible de faire un payement credit, juste l'epargne pour les clients"). Corrige :
  la commande est refusee (400) si le commercant n'a pas de Coris Money, avant meme le
  decrement de stock.
- `delivery.service.scanQrCode` declenchait a tort le reversement commercant pour
  **tous** les modes de paiement au moment du scan QR. Le cahier separe explicitement
  les deux : pour l'Epargne, "cadre vert ET QR scanne" declenche le virement
  automatique ; pour le Credit Bancaire, le reversement est un acte distinct de l'Admin
  ("Gestion des Credits... bouton procéder au virement"), decouple de la livraison
  physique. Corrige : le scan ne cree plus de reversement pour le Credit Bancaire,
  desormais gere par `POST /admin/credits/:id/payout`.

## Test complet effectue contre une vraie base (Neon PostgreSQL)

L'ensemble du parcours a ete rejoue en conditions reelles (pas seulement en tests
unitaires avec Prisma mocke) : inscription Client/Commercant -> validation Admin ->
connexion -> creation boutique/produits -> commande Epargne (depot, completion a 100%,
QR, scan, reversement 8%) -> commande Credit Bancaire (dossier, modalites, approbation
Banque, virement, reversement Admin a 4%, scan) -> RBAC croise -> rotation refresh
token. Quatre bugs reels ont ete trouves et corriges a cette occasion (aucun n'etait
detecte par les tests unitaires, qui mockent Prisma) :

1. **Timeout de transaction Prisma** sur une base distante a latence non negligeable
   (5s par defaut, insuffisant pour les transactions enchainant plusieurs requetes comme
   la creation de commande). Corrige par `INTERACTIVE_TRANSACTION_OPTIONS` (15s) applique
   a toutes les transactions interactives (`config/prisma.ts`).
2. **`sendAccountApprovedEmail`/`sendAccountRejectedEmail` ne capturaient pas les
   erreurs SMTP**, contrairement a `sendGenericNotificationEmail` : sans serveur SMTP
   disponible, l'approbation d'un compte echouait en 500 alors que le compte etait deja
   approuve en base (etat incoherent). Corrige en centralisant la resilience dans
   `sendEmail()`.
3. **`assertValidCreditDuration` (financialService, module pur) leve une `Error`
   generique** ; le service appelant (`bankCredit.service.setBankCreditTerms`) ne la
   traduisait pas en `AppError`, donc une simple duree de credit invalide remontait en
   500 au lieu d'un 400 clair. Corrige par un `try/catch` de traduction.
4. **Critique** : le middleware `idempotent()` est `async` et peut lever/rejeter
   (en-tete manquant, erreur DB) sans etre lui-meme enveloppe dans `asyncHandler`.
   Express 4 ne rattrape pas les rejets d'un middleware async non protege : Node
   traite ca comme un `unhandledRejection` et **termine tout le process**, pas
   seulement la requete. Une seule requete sans `Idempotency-Key` sur
   `/bank/transfers/:id/execute` ou `/admin/credits/:id/payout` faisait planter
   l'API entiere. Corrige en enveloppant `idempotent()` dans `asyncHandler`. Audit
   fait sur tous les autres middlewares/controleurs : aucun autre point similaire.

Pour rejouer ce test toi-meme : cree un compte Admin/Banque via
`npx ts-node -r tsconfig-paths/register prisma/seed-dev.ts` (identifiants affiches en
sortie), puis suis le meme enchainement d'appels via curl/Postman.

## Finalisation (tout sauf l'integration Mobile Money reelle)

- **Documentation API** : `docs/openapi.yaml` (OpenAPI 3.0 complet — 38 endpoints,
  schemas, exemples de requete/reponse, codes d'erreur, role requis par endpoint),
  servie interactivement sur `GET /api-docs` (Swagger UI) et en brut sur
  `GET /api-docs.json`. Repond au point de coordination du cahier, section 16.
- **Consultation controlee des documents prives** (`GET /documents/:filename`) :
  jusqu'ici, les CNIB/bulletins/autorisations etaient stockes mais jamais consultables
  via l'API. Desormais accessible au proprietaire, a l'Admin, et a une Banque assignee
  a un dossier de credit du client concerne — 404 sinon (jamais 403, pour ne pas
  confirmer l'existence d'un fichier). Les fichiers sont maintenant stockes par leur
  seul nom (portable, independant de l'OS) plutot que leur chemin complet.
- **Notifications Client** (`GET /client/notifications`, jusque-la un stub) : le client
  est desormais notifie a chaque etape qui le concerne (compte valide, depot recu,
  Epargne terminee, penalite appliquee, commande livree, decision de la banque sur son
  dossier de credit).
- **Rate limiting etendu** aux endpoints sensibles hors authentification (approbations
  Admin/Banque, virements, soumission de dossier credit), conformement au cahier,
  section 14 ("authentification ET endpoints sensibles"). Les webhooks ont leur propre
  limite, plus permissive.
- **Tests d'integration reels** (`tests/integration/`, `npm run test:integration`,
  execute contre `DATABASE_URL`, exclu de `npm test`) :
  - Stock concurrent (cahier, section 15) : deux achats simultanes du dernier
    exemplaire d'un article ne peuvent pas tous les deux reussir — verifie avec une
    vraie concurrence (`Promise.allSettled`), pas seulement simulee en mock.
  - Idempotence webhook (cahier, section 15) : deux depots strictement simultanes avec
    la meme `transaction_reference` ne sont comptes qu'une fois.
- **Nettoyage automatique** (`services/maintenance/cleanupService.ts`, execute au
  demarrage puis toutes les 6h) : purge les `idempotency_keys` expirees et les
  `refresh_tokens` expires/revoques depuis plus de 30 jours, qui sinon s'accumulent
  indefiniment.

### Bugs supplementaires trouves et corriges pendant cette finalisation

1. **Race condition non geree dans `processSavingsDeposit`** : deux webhooks identiques
   strictement simultanes pouvaient tous les deux passer le controle "depot deja
   existant" avant que l'un des deux n'insere ; la contrainte UNIQUE de la base
   tranchait alors (erreur Prisma `P2002`), mais cette erreur n'etait pas rattrapee et
   remontait en 500 au lieu d'un traitement idempotent normal. Corrige, verifie par un
   test d'integration avec une vraie concurrence.
2. **`jest.config.js` ramassait aussi `tests/integration/`**, avec un timeout de 15s
   trop court pour de vrais appels reseau vers la base — `npm test` aurait echoue de
   facon aleatoire. Corrige par `testPathIgnorePatterns` ; les tests d'integration ont
   leur propre configuration (`jest.integration.config.js`) et leur propre commande.
3. **YAML invalide dans `docs/openapi.yaml`** : une description contenait `` `*Url` ``
   (backticks + asterisque), que YAML interprete comme une reference d'alias — le
   serveur plantait au demarrage. Corrige, et validation du parsing ajoutee au
   processus de verification.
4. Deux tests unitaires (`admin.service.test.ts`) ne mockaient pas
   `notifyUser`/`notifyAdmins` apres l'ajout des notifications Client : le vrai service
   appelait `prisma.notification.create` sur un mock incomplet, provoquant un `TypeError`
   ou un timeout selon le test. Corrige.

**Ce qui reste, volontairement** : l'integration reelle Orange Money / Coris Money
(`services/payment/*Provider.ts`) — bloquee tant que de vrais identifiants fournisseur
ne sont pas disponibles. Tout le reste (calculs, webhooks, idempotence, reversements)
est deja pret a recevoir cette integration sans changement structurel.
