import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ConnectedPosition } from '@angular/cdk/overlay';
import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { IonIcon } from '@ionic/angular/standalone';
import { Logo } from '../../../ui/brand/logo';
import { NavService } from '../../navigation/nav.service';
import { NavGroup, NavLink, NavNode, isGroup } from '../../navigation/nav.model';
import { ScopeService } from '../../scope/scope.service';

import { ContextCard } from '../context-card/context-card';
@Component({
  selector: 'app-sidebar',
  imports: [ContextCard, RouterLink, NgTemplateOutlet, IonIcon, Logo, CdkMenu, CdkMenuItem, CdkMenuTrigger],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.scss',
  host: { '[class.collapsed]': 'collapsed()' },
})
export class Sidebar {
  protected readonly nav = inject(NavService);
  protected readonly scope = inject(ScopeService);

  readonly collapsed = input(false);
  readonly canCollapse = input(true);
  readonly toggleCollapse = output<void>();
  /** Emitted after a link is followed, so the mobile menu can close itself. */
  readonly navigated = output<void>();

  protected readonly mainSections = computed(() => this.nav.sections().filter((s) => s.id !== 'footer'));
  protected readonly footerNodes = computed(
    () => this.nav.sections().find((s) => s.id === 'footer')?.nodes ?? [],
  );

  /** The scheme in the current URL, to highlight its pinned entry. */
  protected readonly activeSchemeId = computed(() => /^\/schemes\/([^/?#]+)/.exec(this.nav.url())?.[1] ?? null);

  protected readonly flyoutPosition: ConnectedPosition[] = [
    { originX: 'end', originY: 'top', overlayX: 'start', overlayY: 'top', offsetX: 8 },
  ];

  protected readonly isGroup = isGroup;

  protected asGroup(node: NavNode): NavGroup {
    return node as NavGroup;
  }

  protected asLink(node: NavNode): NavLink {
    return node as NavLink;
  }

  protected isPinned(id: string): boolean {
    return this.scope.isPinned(id);
  }

  protected groupAttention(group: NavGroup): boolean {
    return group.children.some((c) => this.nav.badgeAttention(c));
  }

  protected onGroupClick(group: NavGroup): void {
    // In the icon rail the flyout menu handles it.
    if (!this.collapsed()) this.nav.toggle(group.id);
  }
}
