import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import {
  DOCUMENT_TYPE_META,
  DocumentTemplate,
  PlatformDataSource,
  PlatformTemplateDataSource,
  TEMPLATE_STATUS_LABELS,
  TEMPLATE_TIERS,
  TemplateStatus,
} from '../../domain';
import { loadable } from '../../core/data/loadable';
import { SessionService } from '../../core/session/session.service';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { PageHeader } from '../../ui/page-header/page-header';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill, Tone } from '../../ui/status-pill/status-pill';
import { customTemplateForm, setUpCustomTemplateForm, templateStatusForm } from '../documents/document-forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of } from 'rxjs';

const STATUS_TONE: Record<TemplateStatus, Tone> = { planned: 'neutral', preview: 'info', active: 'success', deprecated: 'warning' };

/**
 * Humo's document template catalogue across customers: every template, its
 * status and current version, and adoption. System administrators move
 * platform templates through their lifecycle; account managers set customers
 * up with custom templates; executives read adoption. Templates are never
 * edited as code here — layouts ship with Humo, designs are versioned data.
 */
@Component({
  selector: 'app-document-templates-page',
  imports: [PageHeader, StatusPill, Skeleton, ErrorState, IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header eyebrow="Platform" title="Document templates" subtitle="Templates by document type, who can use them and how widely they’re used. Access comes from entitlements, not package names.">
      @if (canSetUp()) {
        <button type="button" class="btn btn-primary" (click)="setUp()"><ion-icon name="add-outline" aria-hidden="true" /> Set up a custom template</button>
      }
    </ui-page-header>

    @if (result.loading()) {
      <ui-skeleton variant="tiles" [count]="3" />
    } @else if (result.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load the template catalogue" (retry)="result.retry()" /></div>
    } @else {
      @let a = result.value()!;
      <section class="kpis">
        <div class="kpi surface"><span class="k-label">Customers</span><strong>{{ a.customers }}</strong></div>
        <div class="kpi surface"><span class="k-label">Premium or custom statement default</span><strong>{{ a.premiumDefaults }}</strong><span class="muted">{{ pct(a.premiumDefaults, a.customers) }} of customers</span></div>
        <div class="kpi surface"><span class="k-label">Custom templates</span><strong>{{ a.customTemplates }}</strong></div>
      </section>

      <div class="surface table-wrap">
        <table class="table">
          <thead>
            <tr><th>Template</th><th>Document</th><th>Tier</th><th>Status</th><th class="end">Version</th><th class="end">Default for</th><th class="end">Can use</th><th></th></tr>
          </thead>
          <tbody>
            @for (u of a.usage; track u.template.id) {
              <tr>
                <td><strong>{{ u.template.name }}</strong>@if (u.owner) { <span class="muted"> · {{ u.owner }}</span> }</td>
                <td>{{ typeLabel(u.template) }}</td>
                <td>{{ tierLabel(u.template) }}</td>
                <td><ui-status-pill [label]="statusLabel[u.template.status]" [tone]="statusTone[u.template.status]" /></td>
                <td class="end">{{ u.template.currentVersion ? 'v' + u.template.currentVersion : '—' }}</td>
                <td class="end">{{ u.template.status === 'planned' ? '—' : u.defaultFor }}</td>
                <td class="end">{{ u.template.status === 'planned' ? '—' : u.entitledCustomers }}</td>
                <td class="end">
                  @if (canManage() && !u.template.organisationId) {
                    <button type="button" class="btn btn-ghost btn-sm" (click)="changeStatus(u.template)">Status</button>
                  }
                  @if (canSetUp() && u.template.organisationId) {
                    <button type="button" class="btn btn-ghost btn-sm" (click)="publish(u.template, u.owner ?? '')">Publish version</button>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--s-4); }
    .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--s-3); }
    .kpi { display: flex; flex-direction: column; gap: 2px; padding: var(--s-4); }
    .kpi strong { font-family: var(--font-display); font-size: var(--fs-2xl); }
    .k-label { font-size: var(--fs-xs); color: var(--c-text-muted); }
    .muted { color: var(--c-text-muted); font-size: var(--fs-xs); }
    .table-wrap { overflow-x: auto; }
    .table { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
    .table th { padding: var(--s-2) var(--s-3); font-size: var(--fs-2xs); letter-spacing: 0.08em; text-align: left; text-transform: uppercase; color: var(--c-text-muted); border-bottom: 1px solid var(--c-border); }
    .table td { padding: var(--s-2) var(--s-3); border-bottom: 1px solid var(--c-border); white-space: nowrap; }
    .end { text-align: right; }
  `,
})
export class DocumentTemplatesPage {
  private readonly data = inject(PlatformTemplateDataSource);
  private readonly platform = inject(PlatformDataSource);
  private readonly drawer = inject(DrawerService);
  private readonly session = inject(SessionService);

  protected readonly result = loadable(() => this.data.adoption());
  protected readonly statusLabel = TEMPLATE_STATUS_LABELS;
  protected readonly statusTone = STATUS_TONE;
  protected readonly canManage = computed(() => this.session.can('Platform.Templates.Manage') && !this.session.readOnly());
  protected readonly canSetUp = computed(() => this.session.can('Platform.Customers.Manage') && !this.session.readOnly());

  private readonly customers = toSignal(
    this.platform.customers({ pageSize: 500 }).pipe(
      map((p) => p.items.map((c) => ({ id: c.organisationId, name: c.name })).sort((a, b) => a.name.localeCompare(b.name))),
      catchError(() => of([])),
    ),
    { initialValue: [] as { id: string; name: string }[] },
  );

  protected typeLabel(t: DocumentTemplate): string {
    return DOCUMENT_TYPE_META[t.documentType].label;
  }

  protected tierLabel(t: DocumentTemplate): string {
    return TEMPLATE_TIERS[t.tier].label;
  }

  protected pct(n: number, of: number): string {
    return of ? `${Math.round((n / of) * 100)}%` : '0%';
  }

  protected changeStatus(t: DocumentTemplate): void {
    templateStatusForm(this.drawer, this.data, t);
  }

  protected setUp(): void {
    setUpCustomTemplateForm(this.drawer, this.data, this.customers());
  }

  /** D12: Humo publishes a customer's custom template once they've approved the proof. */
  protected publish(t: DocumentTemplate, customer: string): void {
    customTemplateForm(this.drawer, this.data, t, customer);
  }
}
