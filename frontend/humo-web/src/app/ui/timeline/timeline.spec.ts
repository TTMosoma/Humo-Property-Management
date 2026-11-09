import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TimelineEvent } from '../../domain';
import { Timeline } from './timeline';

// Ionic's components can't load in the test runner: a stand-in icon.
vi.mock('@ionic/angular/standalone', async () => (await import('../../testing-ionic')).ionicStandin());

describe('Timeline', () => {
  function render(events: TimelineEvent[]): string[] {
    TestBed.configureTestingModule({ imports: [Timeline], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(Timeline);
    fixture.componentRef.setInput('events', events);
    fixture.detectChanges();
    return [...(fixture.nativeElement as HTMLElement).querySelectorAll('li')].map((li) => li.querySelector('.meta')?.textContent?.replace(/\s+/g, ' ').trim() ?? '');
  }

  it('shows the time something was posted, and no time for an event that only has a date', () => {
    const metas = render([
      { id: 'a', at: '2026-10-18T14:32:00+02:00', kind: 'payment', title: 'Payment received' },
      { id: 'b', at: '2026-10-18T00:00:00+02:00', allDay: true, kind: 'status', title: 'Sipho Khumalo became the owner' },
      { id: 'c', at: '2026-10-17T00:00:00+02:00', allDay: true, kind: 'note', title: 'Note', actor: 'Priya Naidoo' },
    ]);
    expect(metas).toEqual(['14:32', '', 'Priya Naidoo']);
  });
});
