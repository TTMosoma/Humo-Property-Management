import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { Logo } from '../../../ui/brand/logo';
import { NavService } from '../../navigation/nav.service';
import { NavGroup, NavLink, NavNode, isGroup } from '../../navigation/nav.model';

@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, NgTemplateOutlet, IonIcon, Logo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.scss',
  host: { '[class.collapsed]': 'collapsed()' },
})
export class Sidebar {
  protected readonly nav = inject(NavService);
  private readonly router = inject(Router);

  readonly collapsed = input(false);
  readonly canCollapse = input(true);
  readonly toggleCollapse = output<void>();
  /** Emitted after a link is followed, so the mobile menu can close itself. */
  readonly navigated = output<void>();

  protected readonly mainSections = computed(() => this.nav.sections().filter((s) => s.id !== 'footer'));
  protected readonly footerNodes = computed(
    () => this.nav.sections().find((s) => s.id === 'footer')?.nodes ?? [],
  );

  protected readonly isGroup = isGroup;

  protected asGroup(node: NavNode): NavGroup {
    return node as NavGroup;
  }

  protected asLink(node: NavNode): NavLink {
    return node as NavLink;
  }

  protected groupHasBadge(group: NavGroup): boolean {
    return group.children.some((c) => c.badge?.tone === 'attention');
  }

  protected onGroupClick(group: NavGroup): void {
    if (this.collapsed()) {
      // In the icon rail there is no room for sub-items: jump to the first one.
      this.router.navigateByUrl(group.children[0].route);
      this.navigated.emit();
      return;
    }
    this.nav.toggle(group.id);
  }
}
