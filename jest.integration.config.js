/** @type {import('jest').Config} */
// Config separee de jest.config.js : ces tests utilisent le VRAI Prisma Client contre
// DATABASE_URL (aucun mock), donc necessitent une base accessible. Volontairement exclus
// de `npm test` (qui doit pouvoir tourner sans base de donnees, ex: en CI sans secrets) ;
// a lancer explicitement via `npm run test:integration`.
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: ".",
  testMatch: ["<rootDir>/tests/integration/**/*.test.ts"],
  moduleNameMapper: {
    "^@config/(.*)$": "<rootDir>/src/config/$1",
    "^@common/(.*)$": "<rootDir>/src/common/$1",
    "^@services/(.*)$": "<rootDir>/src/services/$1",
    "^@modules/(.*)$": "<rootDir>/src/modules/$1",
  },
  testTimeout: 30_000,
};
