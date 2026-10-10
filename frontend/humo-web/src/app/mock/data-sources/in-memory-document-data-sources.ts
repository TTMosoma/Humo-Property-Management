import { Injectable, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable, combineLatest, map, switchMap } from 'rxjs';
import {
  DOCUMENT_TYPE_META,
  DocumentBrandingDetails,
  DocumentTemplate,
  DocumentTemplateDataSource,
  DocumentType,
  FieldErrors,
  OrganisationDocumentSettings,
  PlatformTemplateDataSource,
  TEMPLATE_STATUS_LABELS,
  TEMPLATE_STATUS_MOVES,
  TEMPLATE_TIERS,
  TemplateAdoption,
  TemplateDesign,
  TemplateStatus,
  entitlementSet,
  isHexColour,
  templateAvailability,
  validateDesign,
} from '../../domain';
import { DocumentStore } from '../db/document-store';
import { PlatformStore } from '../db/platform-store';
import { OrganisationStore } from '../db/organisation-store';
import { mockResponder } from '../mock-latency';
import { MockAuthSession } from '../server/mock-auth-session';
import { MockGateway } from '../server/mock-gateway';
import { seedTemplates } from '../db/seed-documents';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** The registry as one organisation sees it. The server filters out every other organisation's custom templates. */
@Injectable()
export class InMemoryDocumentTemplateDataSource extends DocumentTemplateDataSource {
  private readonly auth = inject(MockAuthSession);
  private readonly store = inject(DocumentStore);
  private readonly gateway = inject(MockGateway);
  private readonly respond = mockResponder();
  private readonly templates$ = toObservable(this.store.templates);
  private readonly settings$ = toObservable(this.store.settings);

  private orgId(): string {
    return this.auth.current.organisation?.id ?? '';
  }

  templates(): Observable<DocumentTemplate[]> {
    return combineLatest([this.auth.session$, this.templates$]).pipe(
      switchMap(([s, all]) => this.respond(all.filter((t) => !t.organisationId || t.organisationId === s.organisation?.id))),
    );
  }

  settings(): Observable<OrganisationDocumentSettings> {
    return combineLatest([this.auth.session$, this.settings$]).pipe(switchMap(([s]) => this.respond(this.store.settingsFor(s.organisation?.id ?? ''))));
  }

  setDefault(type: DocumentType, templateId: string, expectedVersion: number): Observable<void> {
    const orgId = this.orgId();
    const t = this.store.template(templateId);
    const current = this.store.settingsFor(orgId);
    return this.gateway.command(
      {
        action: `Set the default ${DOCUMENT_TYPE_META[type].label.toLowerCase()} template to ${t?.name ?? templateId}`,
        resource: 'DocumentSettings',
        resourceId: orgId,
        permission: 'Documents.Configure',
        version: { expected: expectedVersion, current: current.version },
        validate: () => {
          // The same rule the registry shows: only templates this organisation may use.
          if (!t || t.documentType !== type || (t.organisationId && t.organisationId !== orgId)) return { templateId: 'Choose one of the templates listed.' };
          const state = templateAvailability(t, entitlementSet(this.auth.current.entitlements ?? [])).state;
          return state === 'available' ? null : { templateId: `${t.name} isn’t available on your plan.` };
        },
      },
      () => this.store.changeSettings(orgId, (s) => ({ ...s, defaults: { ...s.defaults, [type]: templateId } })),
    );
  }

  updateBranding(details: DocumentBrandingDetails, expectedVersion: number): Observable<void> {
    const orgId = this.orgId();
    const current = this.store.settingsFor(orgId);
    // Branding is a paid capability: without it the API keeps what's there and changes contact details only.
    const branded = this.auth.hasFeature('document-branding');
    return this.gateway.command(
      {
        action: 'Updated document contact details and branding',
        resource: 'DocumentSettings',
        resourceId: orgId,
        permission: 'Documents.Configure',
        version: { expected: expectedVersion, current: current.version },
        validate: () => {
          const e: FieldErrors = {};
          if (!EMAIL.test(details.contact.email)) e['email'] = 'Enter an email address like accounts@agency.co.za.';
          if (details.contact.phone.replace(/\D/g, '').length < 9) e['phone'] = 'Enter a phone number with its area code.';
          if ((details.footerText?.length ?? 0) > 200) e['footerText'] = 'Keep the footer line under 200 characters.';
          if (branded && details.branding) {
            if (!isHexColour(details.branding.palette.primary)) e['primary'] = 'Use a colour like #0a3d62.';
            if (!isHexColour(details.branding.palette.accent)) e['accent'] = 'Use a colour like #1d7a52.';
            if ((details.branding.logo?.text.length ?? 0) > 24) e['logo'] = 'Keep the wordmark under 24 characters.';
          }
          return Object.keys(e).length ? e : null;
        },
      },
      () =>
        this.store.changeSettings(orgId, (s) => ({
          ...s,
          contact: { email: details.contact.email.trim(), phone: details.contact.phone.trim() },
          footerText: details.footerText?.trim() || undefined,
          branding: branded && details.branding ? details.branding : s.branding,
        })),
    );
  }

  publishVersion(templateId: string, design: TemplateDesign, notes: string, expectedVersion: number): Observable<number> {
    const orgId = this.orgId();
    const t = this.store.template(templateId);
    return this.gateway.command(
      {
        action: `Published a new version of ${t?.name ?? templateId}`,
        resource: 'DocumentTemplate',
        resourceId: templateId,
        permission: 'Documents.Configure',
        feature: 'document-templates-custom',
        version: { expected: expectedVersion, current: t?.version },
        validate: () => {
          if (!t || t.organisationId !== orgId) return { templateId: 'This isn’t one of your organisation’s templates.' };
          const e: FieldErrors = validateDesign(design);
          if (!notes.trim()) e['notes'] = 'Say what changed, for the version history.';
          return Object.keys(e).length ? e : null;
        },
      },
      () => {
        const next = Math.max(...t!.versions.map((v) => v.version)) + 1;
        this.store.changeTemplate(templateId, (x) => ({
          ...x,
          currentVersion: next,
          // Earlier versions are kept, retired, for the documents that were generated with them.
          versions: [
            ...x.versions.map((v) => (v.status === 'published' ? { ...v, status: 'retired' as const } : v)),
            { version: next, status: 'published', design, notes: notes.trim(), publishedAt: new Date().toISOString(), publishedBy: this.auth.current.identity.name },
          ],
        }));
        return next;
      },
    );
  }
}

/** Humo's view across customers: the catalogue, every custom template and how widely templates are used. */
@Injectable()
export class InMemoryPlatformTemplateDataSource extends PlatformTemplateDataSource {
  private readonly store = inject(DocumentStore);
  private readonly platform = inject(PlatformStore);
  private readonly orgs = inject(OrganisationStore);
  private readonly gateway = inject(MockGateway);
  private readonly respond = mockResponder();
  private readonly templates$ = toObservable(this.store.templates);
  private readonly customers$ = toObservable(this.platform.customers);
  private readonly settings$ = toObservable(this.store.settings);

  adoption(): Observable<TemplateAdoption> {
    return combineLatest([this.templates$, this.customers$, this.settings$]).pipe(
      map(([templates, customers]) => {
        const live = customers.filter((c) => c.status !== 'archived');
        const defaultOf = (orgId: string, type: DocumentType) =>
          this.store.settingsFor(orgId).defaults[type] ?? templates.find((t) => t.documentType === type && t.isDefault)?.id;
        const usage = templates.map((t) => ({
          template: t,
          owner: t.organisationId ? (this.orgs.get(t.organisationId)?.shortName ?? t.organisationId) : undefined,
          defaultFor: t.status === 'planned' ? 0 : live.filter((c) => defaultOf(c.organisationId, t.documentType) === t.id).length,
          entitledCustomers: live.filter((c) => (t.organisationId ? c.organisationId === t.organisationId : true) && templateAvailability(t, entitlementSet(c.entitlements)).state === 'available').length,
        }));
        const premiumDefaults = live.filter((c) => {
          const id = defaultOf(c.organisationId, 'levy-statement');
          const t = templates.find((x) => x.id === id);
          return !!t && t.tier !== 'standard';
        }).length;
        return { customers: live.length, premiumDefaults, customTemplates: templates.filter((t) => t.tier === 'custom').length, usage };
      }),
      switchMap((a) => this.respond(a)),
    );
  }

  setStatus(templateId: string, status: TemplateStatus, reason: string, expectedVersion: number): Observable<void> {
    const t = this.store.template(templateId);
    return this.gateway.command(
      {
        action: `Moved document template ${t?.name ?? templateId} (${t?.documentType}) to ${TEMPLATE_STATUS_LABELS[status]}`,
        resource: 'DocumentTemplate',
        resourceId: templateId,
        permission: 'Platform.Templates.Manage',
        category: 'activity',
        version: { expected: expectedVersion, current: t?.version },
        validate: (): FieldErrors | null => {
          if (!t || t.organisationId) return { status: 'Only Humo’s own templates are managed here.' };
          if (!TEMPLATE_STATUS_MOVES[t.status].includes(status)) return { status: `A ${TEMPLATE_STATUS_LABELS[t.status].toLowerCase()} template can’t move to ${TEMPLATE_STATUS_LABELS[status].toLowerCase()}.` };
          if (status !== 'planned' && t.versions.every((v) => v.status !== 'published')) return { status: 'Publish a version of the layout first: there’s nothing to render yet.' };
          if (t.isDefault && status === 'deprecated') return { status: 'This is the default for its document type. Make another template the default first.' };
          if (reason.trim().length < 5) return { reason: 'Give a short reason for the audit log.' };
          return null;
        },
      },
      () => this.store.changeTemplate(templateId, (x) => ({ ...x, status })),
    );
  }

  /** The account manager sets a customer up with their own template, starting from Humo's Standard design. */
  createCustomTemplate(organisationId: string, documentType: DocumentType): Observable<string> {
    const org = this.orgs.get(organisationId);
    const customer = this.platform.customers().find((c) => c.organisationId === organisationId);
    const id = `${organisationId}.${documentType}`;
    const base = seedTemplates().find((t) => t.documentType === documentType && t.isDefault && t.versions.length);
    return this.gateway.command(
      {
        action: `Set up a custom ${DOCUMENT_TYPE_META[documentType].label.toLowerCase()} template for ${org?.shortName ?? organisationId}`,
        resource: 'DocumentTemplate',
        resourceId: id,
        permission: 'Platform.Customers.Manage',
        validate: (): FieldErrors | null => {
          if (!org || !customer) return { organisationId: 'Choose a customer.' };
          if (!base) return { documentType: `Humo has no ${DOCUMENT_TYPE_META[documentType].label.toLowerCase()} layout yet.` };
          if (this.store.template(id)) return { organisationId: `${org.shortName} already has one. They change it from their own settings.` };
          const ent = entitlementSet(customer.entitlements);
          if (!ent.has(TEMPLATE_TIERS.custom.feature!)) return { organisationId: `${org.shortName} isn’t entitled to custom templates. Grant the feature on their subscription first.` };
          return null;
        },
      },
      () => {
        const design: TemplateDesign = { ...base!.versions[0].design, layout: 'levy-statement/branded', brandingMode: 'template', palette: { primary: '#041b40', accent: '#1d7a52' }, font: 'dm-sans' };
        this.store.addTemplate({
          id,
          documentType,
          name: `${org!.shortName} ${DOCUMENT_TYPE_META[documentType].label.toLowerCase()}`,
          description: `${org!.shortName}’s own ${DOCUMENT_TYPE_META[documentType].label.toLowerCase()}.`,
          purpose: 'Enterprise custom template, set up by their Humo account manager.',
          tier: 'custom',
          status: 'active',
          isDefault: false,
          organisationId,
          currentVersion: 1,
          version: 1,
          versions: [{ version: 1, status: 'published', design, notes: 'Set up from Humo’s Standard design.', publishedAt: new Date().toISOString(), publishedBy: 'Humo' }],
        });
        return id;
      },
    );
  }
}
