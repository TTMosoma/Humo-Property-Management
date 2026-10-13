/**
 * Which data layer the app runs on. Development, tests and the demo build:
 * the in-memory simulation. Production builds replace this file with
 * provide-data.production.ts (angular.json "fileReplacements"), so no mock
 * code or demo data is in a production bundle (docs/18 R-6).
 */
export { provideMockData as provideData } from '../mock/provide-mock-data';
