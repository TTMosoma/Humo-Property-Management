import { Component } from '@angular/core';

/**
 * Stands in for `@ionic/angular/standalone` in specs (Ionic can't load under vitest). Every spec that mocks the
 * module uses this one, because specs share it: whichever loads first is the mock the others get.
 * No decorator syntax: its helper isn't loaded yet when a mock factory runs ahead of the imports.
 */
export function ionicStandin() {
  return {
    IonIcon: Component({ selector: 'ion-icon', template: '', inputs: ['name'] })(class {}),
    ToastController: class {},
  };
}
