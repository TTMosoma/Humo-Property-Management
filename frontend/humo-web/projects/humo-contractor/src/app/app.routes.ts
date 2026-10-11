import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', title: 'Humo Contractor', loadComponent: () => import('./landing/landing-page').then((m) => m.LandingPage) },
  { path: '**', redirectTo: '' },
];
