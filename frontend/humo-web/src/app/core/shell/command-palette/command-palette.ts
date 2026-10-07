import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { DialogRef } from '@angular/cdk/dialog';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, map, of } from 'rxjs';
import { Scheme, SchemeDataSource } from '../../../domain';
import { AttentionService } from '../../attention/attention.service';
import { NavService } from '../../navigation/nav.service';
import { ScopeService } from '../../scope/scope.service';
import { SessionService } from '../../session/session.service';

interface PaletteItem {
  id: string;
  kind: 'Work' | 'Pages' | 'Schemes' | 'Actions';
  label: string;
  hint: string;
  icon: string;
  route: string;
  haystack: string;
}

/** Ctrl K: jump to any page or scheme. Units, people and suppliers join in later checkpoints. */
@Component({
  selector: 'app-command-palette',
  imports: [IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './command-palette.html',
  styleUrl: './command-palette.scss',
})
export class CommandPalette {
  private readonly dialogRef = inject(DialogRef);
  private readonly router = inject(Router);
  private readonly nav = inject(NavService);
  private readonly session = inject(SessionService);
  private readonly scope = inject(ScopeService);
  private readonly attention = inject(AttentionService);
  private readonly schemeData = inject(SchemeDataSource);

  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('input');
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');

  protected readonly query = signal('');
  protected readonly cursor = signal(0);

  /** Loaded fresh for each search; a failure is reported, never shown as "no matches". */
  private readonly schemeResult = toSignal(
    this.schemeData.list().pipe(
      map((list) => ({ list, failed: false })),
      catchError(() => of({ list: [] as Scheme[], failed: true })),
    ),
    { initialValue: { list: [] as Scheme[], failed: false } },
  );
  protected readonly schemesFailed = computed(() => this.schemeResult().failed);

  private readonly items = computed<PaletteItem[]>(() => {
    const pages: PaletteItem[] = this.nav.links().map(({ link, group }) => ({
      id: 'page-' + link.id,
      kind: 'Pages',
      label: link.label,
      hint: group?.label ?? '',
      icon: link.icon ?? group?.icon ?? 'arrow-forward-outline',
      route: link.route,
      haystack: [link.label, group?.label, link.keywords].join(' ').toLowerCase(),
    }));

    const accessible = new Set(this.scope.accessible().map((s) => s.id));
    const schemes: PaletteItem[] = this.schemeResult()
      .list.filter((s) => accessible.has(s.id))
      .map((s) => ({
        id: 'scheme-' + s.id,
        kind: 'Schemes',
        label: s.name,
        hint: `${s.code} · ${s.suburb}, ${s.city} · ${s.unitCount} units`,
        icon: 'business-outline',
        route: `/schemes/${s.id}/overview`,
        haystack: [s.name, s.code, s.suburb, s.city, s.type].join(' ').toLowerCase(),
      }));

    // Open work items are searchable by reference ("MR-1042", "INV-20944") and title.
    const work: PaletteItem[] = this.attention.open().map((w) => ({
      id: 'work-' + w.id,
      kind: 'Work',
      label: w.title,
      hint: `${w.ref} · ${this.scope.findScheme(w.schemeId)?.name ?? ''}`,
      icon: w.kind === 'approval' ? 'shield-checkmark-outline' : w.kind === 'message' ? 'mail-outline' : 'checkmark-done-outline',
      route: w.kind === 'approval' ? '/approvals' : w.kind === 'message' ? '/inbox' : '/tasks',
      haystack: [w.title, w.ref, w.unitLabel, w.personName, w.supplierName].join(' ').toLowerCase(),
    }));

    const actions: PaletteItem[] = this.session.isStaff()
      ? [
          { label: 'Log maintenance request', route: '/maintenance/new', icon: 'construct-outline', k: 'new job repair' },
          { label: 'Send a notice', route: '/communications/compose', icon: 'megaphone-outline', k: 'announcement message email sms' },
          { label: 'Allocate receipts', route: '/finance/receipts', icon: 'cash-outline', k: 'payment bank' },
          { label: 'Show all schemes (clear scope)', route: '', icon: 'layers-outline', k: 'scope all schemes reset' },
        ].map((a) => ({ id: 'action-' + a.label, kind: 'Actions' as const, label: a.label, hint: '', icon: a.icon, route: a.route, haystack: (a.label + ' ' + a.k).toLowerCase() }))
      : [];

    return [...pages, ...schemes, ...work, ...actions];
  });

  protected readonly results = computed(() => {
    const terms = this.query().toLowerCase().trim().split(/\s+/).filter(Boolean);
    const all = this.items();
    if (terms.length === 0) {
      const pinned = new Set(this.scope.pinnedIds());
      const schemes = all.filter((i) => i.kind === 'Schemes');
      const firstSchemes = [...schemes.filter((i) => pinned.has(i.id.slice(7))), ...schemes.filter((i) => !pinned.has(i.id.slice(7)))].slice(0, 5);
      return [...all.filter((i) => i.kind === 'Pages').slice(0, 6), ...firstSchemes];
    }
    return all.filter((i) => terms.every((t) => i.haystack.includes(t))).slice(0, 20);
  });

  protected readonly groups = computed(() => {
    const out: { kind: string; items: { item: PaletteItem; index: number }[] }[] = [];
    this.results().forEach((item, index) => {
      let g = out.find((x) => x.kind === item.kind);
      if (!g) out.push((g = { kind: item.kind, items: [] }));
      g.items.push({ item, index });
    });
    return out;
  });

  constructor() {
    effect(() => {
      this.query();
      this.cursor.set(0);
    });
    queueMicrotask(() => this.input().nativeElement.focus());
  }

  protected onKeydown(e: KeyboardEvent): void {
    const count = this.results().length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.cursor.update((c) => (count ? (c + 1) % count : 0));
      this.scrollActiveIntoView();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.cursor.update((c) => (count ? (c - 1 + count) % count : 0));
      this.scrollActiveIntoView();
    } else if (e.key === 'Enter') {
      const item = this.results()[this.cursor()];
      if (item) this.open(item);
    }
  }

  protected open(item: PaletteItem): void {
    this.dialogRef.close();
    if (item.id === 'action-Show all schemes (clear scope)') {
      this.scope.setScope(null);
      return;
    }
    this.router.navigateByUrl(item.route);
  }

  private scrollActiveIntoView(): void {
    queueMicrotask(() =>
      this.list()?.nativeElement.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }),
    );
  }
}
