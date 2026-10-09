import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, map, of } from 'rxjs';
import {
  AUDIENCE_LABELS,
  Audience,
  AudienceKind,
  CHANNEL_LABELS,
  Channel,
  CommunicationsDataSource,
  MERGE_FIELDS,
  UnitDataSource,
  describeFailure,
  fieldErrorsOf,
  renderMerge,
} from '../../domain';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { loadable } from '../../core/data/loadable';
import { ScopeService } from '../../core/scope/scope.service';
import { SessionService } from '../../core/session/session.service';
import { PageHeader } from '../../ui/page-header/page-header';
import { Skeleton } from '../../ui/states/skeleton';

const CHANNELS: Channel[] = ['email', 'sms', 'whatsapp', 'portal'];
const KINDS: AudienceKind[] = ['owners', 'residents', 'tenants', 'trustees', 'arrears', 'units'];

/**
 * Communications › Compose (pattern P7): audience, template, channels,
 * preview for real recipients, then send now or schedule. Each person gets
 * their preferred channel among the ones chosen; anyone who can't be reached
 * is listed before sending.
 */
@Component({
  selector: 'app-compose-page',
  imports: [PageHeader, Skeleton, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './compose-page.html',
  styleUrl: './compose-page.scss',
})
export class ComposePage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly data = inject(CommunicationsDataSource);
  private readonly unitsDs = inject(UnitDataSource);
  private readonly feedback = inject(FeedbackService);
  private readonly scope = inject(ScopeService);
  protected readonly session = inject(SessionService);

  protected readonly schemes = this.scope.accessible;
  protected readonly schemeId = signal(this.route.snapshot.queryParamMap.get('scheme') ?? this.scope.scopeId() ?? this.scope.accessible()[0]?.id ?? '');
  protected readonly kind = signal<AudienceKind>((this.route.snapshot.queryParamMap.get('audience') as AudienceKind) ?? 'owners');
  protected readonly minDays = signal<30 | 60 | 90>(30);
  protected readonly unitIds = signal<string[]>([]);
  protected readonly includeTenants = signal(false);
  protected readonly templateId = signal<string | null>(null);
  protected readonly channels = signal<Channel[]>(['email', 'portal']);
  protected readonly subject = signal('');
  protected readonly body = signal('');
  protected readonly when = signal<'now' | 'later'>('now');
  protected readonly sendAt = signal('');
  protected readonly sample = signal(0);
  protected readonly showSkipped = signal(false);
  protected readonly busy = signal(false);
  protected readonly errors = signal<Record<string, string>>({});

  protected readonly templates = toSignal(this.data.templates().pipe(catchError(() => of([]))), { initialValue: [] });
  protected readonly units = loadable(() => this.unitsDs.list([this.schemeId()]).pipe(map((p) => p.items)));

  protected readonly audience = computed<Audience>(() => ({
    schemeId: this.schemeId(),
    kind: this.kind(),
    minDays: this.kind() === 'arrears' ? this.minDays() : undefined,
    unitIds: this.kind() === 'units' ? this.unitIds() : undefined,
    includeTenants: this.kind() === 'units' ? this.includeTenants() : undefined,
  }));
  protected readonly preview = loadable(() => this.data.preview(this.audience(), this.channels()));

  protected readonly recipient = computed(() => {
    const r = this.preview.value()?.recipients ?? [];
    return r.length ? r[Math.min(this.sample(), r.length - 1)] : undefined;
  });
  protected readonly rendered = computed(() => {
    const r = this.recipient();
    const v = r?.values ?? Object.fromEntries(MERGE_FIELDS.map((f) => [f.key, f.example]));
    return { subject: renderMerge(this.subject(), v), body: renderMerge(this.body(), v) };
  });
  protected readonly smsParts = computed(() => Math.max(1, Math.ceil(this.rendered().body.length / 160)));
  protected readonly placeholders = computed(() => /\[[^\]]+\]/.test(this.body()) || /\[[^\]]+\]/.test(this.subject()));

  protected readonly kinds = KINDS;
  protected readonly allChannels = CHANNELS;
  protected readonly mergeFields = MERGE_FIELDS;
  protected readonly kindLabel = (k: AudienceKind) => AUDIENCE_LABELS[k];
  protected readonly channelLabel = (c: Channel) => CHANNEL_LABELS[c];
  protected readonly canSend = computed(() => this.session.can('Messages.Reply') && this.session.hasFeature('communications') && !this.session.readOnly());

  constructor() {
    const t = this.route.snapshot.queryParamMap.get('template');
    if (t) this.templateId.set(t);
    // The scheme list can arrive after the page: default to the first one then.
    effect(() => {
      const list = this.schemes();
      if (list.length && !list.some((x) => x.id === this.schemeId())) this.schemeId.set(this.scope.scopeId() ?? list[0].id);
    });
    // Applying a template fills the message (once the templates have loaded).
    effect(() => {
      const id = this.templateId();
      const tpl = this.templates().find((x) => x.id === id);
      if (tpl) {
        this.subject.set(tpl.subject);
        this.body.set(tpl.body);
        this.channels.set(tpl.channels.filter((c) => CHANNELS.includes(c)));
      }
    });
  }

  protected setMinDays(v: string): void {
    this.minDays.set(v === '90' ? 90 : v === '60' ? 60 : 30);
  }

  protected toggleChannel(c: Channel, on: boolean): void {
    this.channels.update((cs) => (on ? [...new Set([...cs, c])] : cs.filter((x) => x !== c)));
  }

  protected toggleUnit(id: string, on: boolean): void {
    this.unitIds.update((ids) => (on ? [...ids, id] : ids.filter((x) => x !== id)));
  }

  protected insert(key: string): void {
    this.body.update((b) => `${b}${b && !b.endsWith(' ') ? ' ' : ''}{${key}}`);
  }

  protected step(d: number): void {
    const n = this.preview.value()?.recipients.length ?? 0;
    if (n) this.sample.set((this.sample() + d + n) % n);
  }

  protected send(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.errors.set({});
    this.data
      .send({
        audience: this.audience(),
        templateId: this.templateId() ?? undefined,
        subject: this.subject(),
        body: this.body(),
        channels: this.channels(),
        sendAt: this.when() === 'later' && this.sendAt() ? new Date(this.sendAt()).toISOString() : undefined,
      })
      .subscribe({
        next: (id) => {
          this.busy.set(false);
          this.feedback.success(this.when() === 'later' ? 'Message scheduled.' : 'Message sent.');
          void this.router.navigate(['/communications/sent', id]);
        },
        error: (e) => {
          this.busy.set(false);
          this.errors.set(fieldErrorsOf(e));
          this.feedback.error(describeFailure(e, 'The message wasn’t sent'));
        },
      });
  }
}
