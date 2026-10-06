import { Injectable, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';
import { SessionService } from '../session/session.service';
import { NAV } from './nav.config';
import { NavGroup, NavLink, NavNode, NavSection, isGroup } from './nav.model';

@Injectable({ providedIn: 'root' })
export class NavService {
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);

  readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  /** Navigation filtered to the current role. Groups left with one link collapse into that link. */
  readonly sections = computed<NavSection[]>(() => {
    const role = this.session.role();
    return NAV.map((section) => ({
      ...section,
      nodes: section.nodes
        .map((node): NavNode | null => {
          if (!isGroup(node)) {
            return node.roles.includes(role) ? node : null;
          }
          const children = node.children.filter((c) => c.roles.includes(role));
          if (children.length === 0) return null;
          if (children.length === 1) {
            return { ...children[0], label: node.label, icon: node.icon };
          }
          return { ...node, children };
        })
        .filter((n): n is NavNode => n !== null),
    })).filter((s) => s.nodes.length > 0);
  });

  /** Flat list of every link the current role can reach (used by the command palette). */
  readonly links = computed<{ link: NavLink; group?: NavGroup }[]>(() =>
    this.sections().flatMap((s) =>
      s.nodes.flatMap((n) => (isGroup(n) ? n.children.map((link) => ({ link, group: n })) : [{ link: n }])),
    ),
  );

  /** Groups the user has manually opened or closed; the active group is always open. */
  private readonly toggled = signal<Record<string, boolean>>({});

  /**
   * The link that best matches the current URL (longest matching route wins),
   * so /maintenance/MR-1042 highlights "Requests" while /maintenance/quotes highlights "Quotes".
   */
  readonly activeLinkId = computed(() => {
    const path = this.url().split(/[?#]/)[0];
    let best: NavLink | null = null;
    for (const { link } of this.links()) {
      const matches = path === link.route || path.startsWith(link.route + '/');
      if (matches && (!best || link.route.length > best.route.length)) best = link;
    }
    return best?.id ?? null;
  });

  readonly activeGroupId = computed(() => {
    const active = this.activeLinkId();
    return this.links().find((l) => l.link.id === active)?.group?.id ?? null;
  });

  isExpanded(groupId: string): boolean {
    const t = this.toggled()[groupId];
    return t ?? groupId === this.activeGroupId();
  }

  toggle(groupId: string): void {
    const open = this.isExpanded(groupId);
    this.toggled.update((s) => ({ ...s, [groupId]: !open }));
  }

  isActive(link: NavLink): boolean {
    return this.activeLinkId() === link.id;
  }
}
