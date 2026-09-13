/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: ".",
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
  // tests/integration utilise le vrai Prisma Client contre DATABASE_URL (aucun mock) et
  // a son propre runner (`npm run test:integration`, voir jest.integration.config.js)
  // avec un timeout adapte aux vrais appels reseau. Sans cette exclusion, `npm test`
  // les ramasserait aussi et echouerait (base non configuree, ou timeout de 15s trop
  // court pour de vrais aller-retours DB).
  testPathIgnorePatterns: ["/node_modules/", "<rootDir>/tests/integration/"],
  // Certains tests (auth, admin) utilisent le vrai bcrypt (cout 12), volontairement non
  // mocke pour valider le hash/compare reel. Le defaut Jest (5s) peut etre trop court
  // sous charge machine. On garde un cout de production realiste plutot que de le
  // baisser artificiellement juste pour les tests.
  testTimeout: 15_000,
  moduleNameMapper: {
    "^@config/(.*)$": "<rootDir>/src/config/$1",
    "^@common/(.*)$": "<rootDir>/src/common/$1",
    "^@services/(.*)$": "<rootDir>/src/services/$1",
    "^@modules/(.*)$": "<rootDir>/src/modules/$1",
  },
};
