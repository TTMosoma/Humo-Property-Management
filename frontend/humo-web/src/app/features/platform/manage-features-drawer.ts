import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DIALOG_DATA } from '@angular/cdk/dialog';
import { IonIcon } from '@ionic/angular/standalone';
import { ADD_ONS, AddOn, FEATURES, Feature, FEATURE_META, PACKAGES, PackageId, PlatformDataSource, SubscriptionChange, entitlementSet } from '../../domain';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { StepUpService } from '../../core/security/step-up.service';
import { Drawer } from '../../ui/drawer/drawer';
import { formatDate } from '../../ui/format/money';

/**
 * Manage features for one customer: package, add-ons and time-limited
 * overrides (trials, goodwill). Each change needs a reason — it's recorded in
 * the audit log — and a fresh step-up. No pricing here: commercial terms
 * live with the billing system later.
 */
@Component({
  selector: 'app-manage-features-drawer',
  imports: [Drawer, IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './manage-features-drawer.html',
  styleUrl: './manage-features-drawer.scss',
})
export class ManageFeaturesDrawer {
  private readonly input = inject<{ organisationId: string }>(DIALOG_DATA);
  private readonly data = inject(PlatformDataSource);
  private readonly stepUp = inject(StepUpService);
  private readonly feedback = inject(FeedbackService);

  protected readonly customer = toSignal(this.data.customer(this.input.organisationId));
  /** The customer's effective entitlements, for lookups. */
  protected readonly entitled = computed(() => entitlementSet(this.customer()?.entitlements ?? []));
  protected readonly reason = signal('');
  protected readonly busy = signal(false);
  protected readonly pkg = signal<PackageId | null>(null);
  protected readonly trialFeature = signal<Feature>('governance');
  protected readonly trialDays = signal(30);

  protected readonly packages = PACKAGES;
  protected readonly addOns = ADD_ONS;
  protected readonly trialable = FEATURES.filter((f) => !f.baseline);
  protected readonly meta = FEATURE_META;
  protected readonly formatDate = formatDate;

  protected readonly reasonOk = computed(() => this.reason().trim().length >= 8);
  protected readonly selectedPkg = computed(() => this.pkg() ?? this.customer()?.subscription.packageId ?? 'professional');

  protected hasAddOn(a: AddOn): boolean {
    return !!this.customer()?.subscription.addOns.some((x) => x.addOnId === a.id);
  }

  /** An add-on whose features the package already includes adds nothing. */
  protected redundant(a: AddOn): boolean {
    const c = this.customer();
    return !!c && !this.hasAddOn(a) && a.features.every((f) => this.entitled().get(f).source === 'package');
  }

  protected changePackage(): void {
    const p = this.selectedPkg();
    if (p === this.customer()?.subscription.packageId) return;
    this.apply({ type: 'package', packageId: p, reason: this.reason().trim() }, `Change package to ${PACKAGES.find((x) => x.id === p)?.name}`);
  }

  protected toggleAddOn(a: AddOn): void {
    const enabled = !this.hasAddOn(a);
    this.apply({ type: 'add-on', addOnId: a.id, enabled, reason: this.reason().trim() }, `${enabled ? 'Add' : 'Remove'} the ${a.name} add-on`);
  }

  protected grantTrial(): void {
    const f = this.trialFeature();
    this.apply({ type: 'override', feature: f, enabled: true, days: this.trialDays(), reason: this.reason().trim() }, `Grant ${FEATURE_META[f].label} for ${this.trialDays()} days`);
  }

  protected clearOverride(feature: Feature): void {
    this.apply({ type: 'override', feature, enabled: null, reason: this.reason().trim() || 'Override removed' }, `Remove the override on ${FEATURE_META[feature].label}`);
  }

  private apply(change: SubscriptionChange, detail: string): void {
    const name = this.customer()?.name ?? 'customer';
    this.busy.set(true);
    this.stepUp.guard({ action: 'change-subscription', detail: `${detail} for ${name}` }, () => this.data.changeSubscription(this.input.organisationId, change)).subscribe({
      next: () => {
        this.busy.set(false);
        this.feedback.success(`${detail} — done. ${name} users see the change on their next page.`);
      },
      error: () => {
        this.busy.set(false);
        this.feedback.error('The subscription wasn’t changed.');
      },
      complete: () => this.busy.set(false),
    });
  }
}
