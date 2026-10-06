import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { DialogRef } from '@angular/cdk/dialog';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, of } from 'rxjs';
import { Scheme, SchemeDataSource } from '../../../domain';
import { NavService } from '../../navigation/nav.service';
import { SessionService } from '../../session/session.service';

interface PaletteItem {
  id: string;
  kind: 'Pages' | 'Schemes';
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
  private readonly schemeData = inject(SchemeDataSource);

  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('input');
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');

  protected readonly query = signal('');
  protected readonly cursor = signal(0);

  private readonly schemes = toSignal(this.schemeData.list().pipe(catchError(() => of([] as Scheme[]))), {
    initialValue: [] as Scheme[],
  });

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

    const persona = this.session.persona();
    const canSeeSchemes = this.session.isStaff() || persona.role === 'trustee';
    const allowed = (s: Scheme) => persona.schemeIds.length === 0 || persona.schemeIds.includes(s.id);
    const schemes: PaletteItem[] = canSeeSchemes
      ? this.schemes()
          .filter(allowed)
          .map((s) => ({
            id: 'scheme-' + s.id,
            kind: 'Schemes',
            label: s.name,
            hint: `${s.suburb}, ${s.city} · ${s.unitCount} units`,
            icon: 'business-outline',
            route: `/schemes/${s.id}/overview`,
            haystack: [s.name, s.code, s.suburb, s.city, s.type].join(' ').toLowerCase(),
          }))
      : [];

    return [...pages, ...schemes];
  });

  protected readonly results = computed(() => {
    const terms = this.query().toLowerCase().trim().split(/\s+/).filter(Boolean);
    const all = this.items();
    if (terms.length === 0) {
      return [...all.filter((i) => i.kind === 'Pages').slice(0, 6), ...all.filter((i) => i.kind === 'Schemes').slice(0, 5)];
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
    this.router.navigateByUrl(item.route);
  }

  private scrollActiveIntoView(): void {
    queueMicrotask(() =>
      this.list()?.nativeElement.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }),
    );
  }
}
