import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { CHANNEL_LABELS, Channel, CommunicationsDataSource, MERGE_FIELDS, MessageTemplate, TEMPLATE_CATEGORY_LABELS, TemplateCategory } from '../../domain';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { loadable } from '../../core/data/loadable';
import { SessionService } from '../../core/session/session.service';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { formatDate } from '../../ui/format/money';
import { PageHeader } from '../../ui/page-header/page-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { openForm } from '../shared/form-drawer';

const CHANNELS: Channel[] = ['email', 'sms', 'whatsapp', 'portal'];

/** Communications › Templates: reusable messages with merge fields, used by Compose and the Inbox. */
@Component({
  selector: 'app-templates-page',
  imports: [PageHeader, StatusPill, EmptyState, ErrorState, Skeleton, IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header eyebrow="Communications" title="Templates" subtitle="Reusable messages. Merge fields like {person.firstName} are filled in for each recipient.">
      @if (canEdit()) {
        <button type="button" class="btn btn-primary" (click)="edit()"><ion-icon name="add-outline" aria-hidden="true" /> New template</button>
      }
    </ui-page-header>

    @if (result.loading()) {
      <ui-skeleton variant="tiles" [count]="6" />
    } @else if (result.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load templates" (retry)="result.retry()" /></div>
    } @else if (!(result.value() ?? []).length) {
      <div class="surface"><ui-empty-state kind="first-use" title="No templates yet" message="Write the messages you send often once, and reuse them." /></div>
    } @else {
      @for (g of groups(); track g.id) {
        <h2 class="g-title">{{ g.label }}</h2>
        <div class="cards">
          @for (t of g.items; track t.id) {
            <article class="card surface">
              <div class="c-head">
                <strong>{{ t.name }}</strong>
                @if (t.builtIn) { <ui-status-pill label="Starter" tone="neutral" /> }
              </div>
              @if (t.channels.includes('email')) { <div class="subject">{{ t.subject }}</div> }
              <p class="body">{{ t.body }}</p>
              <div class="meta">{{ channels(t) }} · {{ t.body.length }} characters · {{ formatDate(t.updatedAt, true) }}, {{ t.updatedBy }}</div>
              <div class="acts">
                <button type="button" class="btn btn-secondary btn-sm" (click)="use(t)">Use</button>
                @if (canEdit()) {
                  <button type="button" class="btn btn-ghost btn-sm" (click)="edit(t)">Edit</button>
                  @if (!t.builtIn) { <button type="button" class="btn btn-ghost btn-sm" (click)="archive(t)">Archive</button> }
                }
              </div>
            </article>
          }
        </div>
      }
    }
  `,
  styles: `
    :host { display: block; }
    .g-title { margin: var(--s-4) 0 var(--s-2); font-size: var(--fs-md); }
    .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: var(--s-3); }
    .card { display: flex; flex-direction: column; gap: var(--s-1); padding: var(--s-4); }
    .c-head { display: flex; gap: var(--s-2); align-items: center; justify-content: space-between; }
    .subject { font-size: var(--fs-sm); font-weight: var(--fw-medium); color: var(--c-text-2); }
    .body { display: -webkit-box; overflow: hidden; margin: 0; font-size: var(--fs-sm); color: var(--c-text-2); white-space: pre-line; -webkit-line-clamp: 4; -webkit-box-orient: vertical; }
    .meta { font-size: var(--fs-xs); color: var(--c-text-muted); }
    .acts { display: flex; gap: var(--s-1); margin-top: auto; padding-top: var(--s-2); }
  `,
})
export class TemplatesPage {
  private readonly router = inject(Router);
  private readonly data = inject(CommunicationsDataSource);
  private readonly drawer = inject(DrawerService);
  private readonly feedback = inject(FeedbackService);
  private readonly session = inject(SessionService);

  protected readonly result = loadable(() => this.data.templates());
  protected readonly groups = computed(() => {
    const ts = this.result.value() ?? [];
    return (Object.keys(TEMPLATE_CATEGORY_LABELS) as TemplateCategory[]).map((id) => ({ id, label: TEMPLATE_CATEGORY_LABELS[id], items: ts.filter((t) => t.category === id) })).filter((g) => g.items.length);
  });
  protected readonly canEdit = computed(() => this.session.can('Messages.Reply') && this.session.hasFeature('communications') && !this.session.readOnly());
  protected readonly formatDate = formatDate;
  protected readonly channels = (t: MessageTemplate) => t.channels.map((c) => CHANNEL_LABELS[c]).join(', ');

  protected use(t: MessageTemplate): void {
    void this.router.navigate(['/communications/compose'], { queryParams: { template: t.id } });
  }

  protected edit(t?: MessageTemplate): void {
    openForm(this.drawer, {
      eyebrow: 'Templates',
      title: t ? `Edit “${t.name}”` : 'New template',
      intro: `Merge fields: ${MERGE_FIELDS.map((f) => `{${f.key}}`).join(' ')}. Anything in [square brackets] is for the sender to fill in before sending.`,
      fields: [
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: 'category', label: 'Category', type: 'select', required: true, half: true, options: (Object.keys(TEMPLATE_CATEGORY_LABELS) as TemplateCategory[]).map((c) => ({ value: c, label: TEMPLATE_CATEGORY_LABELS[c] })) },
        { key: 'channels', label: 'Written for', type: 'checks', required: true, options: CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABELS[c] })) },
        { key: 'subject', label: 'Email subject', type: 'text', showIf: (v) => (v['channels'] ?? '').includes('email') },
        { key: 'body', label: 'Message', type: 'textarea', required: true, help: 'SMS: keep it under 160 characters for one message (480 at most).' },
      ],
      initial: t ? { name: t.name, category: t.category, channels: t.channels.join(','), subject: t.subject, body: t.body } : { category: 'general', channels: 'email,portal' },
      submitLabel: t ? 'Save' : 'Create template',
      submit: (v) => this.data.saveTemplate({ name: v['name'], category: v['category'] as TemplateCategory, channels: v['channels'].split(',').filter(Boolean) as Channel[], subject: v['subject'] ?? '', body: v['body'] }, t?.id, t?.version),
      success: () => (t ? 'Template saved.' : 'Template created.'),
      failure: 'The template wasn’t saved',
    });
  }

  protected archive(t: MessageTemplate): void {
    this.data.archiveTemplate(t.id).subscribe({ next: () => this.feedback.success('Template archived.'), error: () => this.feedback.error('The template wasn’t archived.') });
  }
}
