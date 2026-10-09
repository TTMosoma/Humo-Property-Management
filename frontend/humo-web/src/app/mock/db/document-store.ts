import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { DocumentTemplate, DocumentTemplateRef, DocumentType, EntitlementSet, OrganisationDocumentSettings, templateAvailability } from '../../domain';
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
  /** Humo's own templates ship with the app: any the saved catalogue doesn't have yet are added. */
  readonly templates = signal<DocumentTemplate[]>([
    ...this.saved.templates,
    ...seedTemplates().filter((t) => !t.organisationId && !this.saved.templates.some((x) => x.id === t.id)),
  ]);
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

  /** The template a document is issued with: the organisation's default if it may use it, else Humo's default for the type. */
  issuingTemplate(organisationId: string, type: DocumentType, entitlements: EntitlementSet): DocumentTemplateRef {
    const chosen = this.settingsFor(organisationId).defaults[type];
    const t =
      (chosen && this.templates().find((x) => x.id === chosen && templateAvailability(x, entitlements).state === 'available')) ||
      this.templates().find((x) => x.documentType === type && x.isDefault)!;
    return { templateId: t.id, version: t.currentVersion };
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
