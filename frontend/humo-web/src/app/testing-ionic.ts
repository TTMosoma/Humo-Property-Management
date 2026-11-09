import { Component } from '@angular/core';

/**
 * Stands in for `@ionic/angular/standalone` in specs (Ionic can't load under vitest). Specs share the mocked module, so
 * whichever loads first is the mock the others get: every spec uses this one, and it's built once, so a class used as
 * an injection token (ToastController) is the same class whichever spec loaded it.
 * No decorator syntax: its helper isn't loaded yet when a mock factory runs ahead of the imports.
 */
const STANDIN = {
  IonIcon: Component({ selector: 'ion-icon', template: '', inputs: ['name'] })(class {}),
  ToastController: class {},
};

export function ionicStandin() {
  return STANDIN;
}
