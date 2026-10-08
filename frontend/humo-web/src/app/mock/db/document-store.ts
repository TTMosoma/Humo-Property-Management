import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { DocumentTemplate, OrganisationDocumentSettings } from '../../domain';
import { simulationStorage } from '../simulation/simulation-storage';
import { PlatformStore } from './platform-store';
import { defaultDocumentSettings, seedCustomerDocuments, seedDocumentSettings, seedTemplates } from './seed-documents';

interface DocumentSnapshot {
  templates: DocumentTemplate[];
  settings: OrganisationDocumentSettings[];
}

/**
 * The simulated backend's document tables: the template catalogue (Humo's and
 * every customer's custom templates, with all their versions) and each
 * organisation's document settings. Development / simulation only.
 */
@Injectable({ providedIn: 'root' })
export class DocumentStore {
  private readonly saved = simulationStorage.load<DocumentSnapshot>('documents') ?? this.seed();
  readonly templates = signal<DocumentTemplate[]>(this.saved.templates);
  readonly settings = signal<OrganisationDocumentSettings[]>(this.saved.settings);

  constructor() {
    effect(() => {
      const snapshot: DocumentSnapshot = { templates: this.templates(), settings: this.settings() };
      untracked(() => simulationStorage.save('documents', () => snapshot));
    });
  }

  private seed(): DocumentSnapshot {
    const named = seedDocumentSettings();
    const others = seedCustomerDocuments(inject(PlatformStore).seeds(), [...named.map((s) => s.organisationId), 'acacia']);
    return { templates: [...seedTemplates(), ...others.templates], settings: [...named, ...others.settings] };
  }

  template(id: string): DocumentTemplate | undefined {
    return this.templates().find((t) => t.id === id);
  }

  settingsFor(organisationId: string): OrganisationDocumentSettings {
    return this.settings().find((s) => s.organisationId === organisationId) ?? defaultDocumentSettings(organisationId);
  }

  /** Applies a change to an organisation's settings (creating them on first change) and bumps the version. */
  changeSettings(organisationId: string, apply: (s: OrganisationDocumentSettings) => OrganisationDocumentSettings): void {
    const current = this.settingsFor(organisationId);
    const next = { ...apply(current), version: current.version + 1 };
    this.settings.update((all) => (all.some((s) => s.organisationId === organisationId) ? all.map((s) => (s.organisationId === organisationId ? next : s)) : [...all, next]));
  }

  addTemplate(t: DocumentTemplate): void {
    this.templates.update((all) => [...all, t]);
  }

  changeTemplate(id: string, apply: (t: DocumentTemplate) => DocumentTemplate): void {
    this.templates.update((all) => all.map((t) => (t.id === id ? { ...apply(t), version: t.version + 1 } : t)));
  }
}
